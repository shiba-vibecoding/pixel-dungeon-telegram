/*
 * Per-user persistence for the Telegram build.
 *
 * libGDX continues to read and write its normal localStorage preferences. In a
 * Telegram Mini App those keys are namespaced by user id, then mirrored as one
 * chunked snapshot to Telegram CloudStorage. Cloud data is restored before the
 * GWT game starts, so the game's synchronous file API does not need to change.
 */
(function () {
  'use strict';

  var LEGACY_MANIFEST_KEY = 'pdgdx_manifest_v1';
  var LEGACY_CHUNK_PREFIX = 'pdgdx_data_v1_';
  var MANIFEST_KEY = 'pdgdx_manifest_v2';
  var CHUNK_PREFIX = 'pdgdx_data_v2_';
  var CHUNK_SIZE = 3600;
  // Telegram allows 1024 keys per bot/user. Two generations must fit at once
  // so the active save remains readable until the new manifest is committed.
  var MAX_CHUNKS = 480;
  // Starting a multi-chunk native CloudStorage upload two seconds after boot
  // can starve rendering in Telegram WebViews. Local progress is synchronous
  // and safe; cloud mirroring can happen less aggressively and cooperatively.
  var SYNC_INTERVAL = 30000;
  var CHUNK_YIELD = 25;
  var RESTORE_TIMEOUT = 4000;

  var cloudEnabled = false;
  var uploadActive = false;
  var uploadPending = false;
  var syncTimer = null;
  var uploadedSnapshot = null;
  var knownCloudManifest = null;

  function telegram() {
    return window.Telegram && window.Telegram.WebApp;
  }

  function userScope() {
    try {
      var tg = telegram();
      var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      var id = user && user.id != null ? String(user.id) : '';
      return tg && tg.initData && /^[0-9]+$/.test(id) ? 'tg-' + id : '';
    } catch (e) {
      return '';
    }
  }

  function scopedBases() {
    var scope = userScope();
    return scope ? ['pd-prefs-' + scope, 'pd-files-' + scope] : [];
  }

  function storageAvailable() {
    try {
      var test = '__pd_storage_test__';
      window.localStorage.setItem(test, '1');
      window.localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  function keysWithPrefix(prefix) {
    var result = [];
    for (var i = 0; i < window.localStorage.length; i++) {
      var key = window.localStorage.key(i);
      if (key && key.indexOf(prefix) === 0) result.push(key);
    }
    return result;
  }

  function migrateLegacyStore(base, scope) {
    var legacyPrefix = base + ':';
    var scopedPrefix = base + '-' + scope + ':';
    if (keysWithPrefix(scopedPrefix).length) return;

    var marker = 'pdgdx-migrated-' + base;
    var claimedBy = window.localStorage.getItem(marker);
    if (claimedBy && claimedBy !== scope) return;

    var legacyKeys = keysWithPrefix(legacyPrefix);
    for (var i = 0; i < legacyKeys.length; i++) {
      var key = legacyKeys[i];
      window.localStorage.setItem(
        scopedPrefix + key.substring(legacyPrefix.length),
        window.localStorage.getItem(key));
    }
    if (legacyKeys.length) window.localStorage.setItem(marker, scope);
  }

  function migrateLegacyData() {
    var scope = userScope();
    if (!scope || !storageAvailable()) return;
    migrateLegacyStore('pd-prefs', scope);
    migrateLegacyStore('pd-files', scope);
  }

  function allowedLocalKey(key) {
    var bases = scopedBases();
    for (var i = 0; i < bases.length; i++) {
      if (key.indexOf(bases[i] + ':') === 0) return true;
    }
    return false;
  }

  function snapshot() {
    if (!storageAvailable() || !userScope()) return null;
    var entries = {};
    var keys = [];
    for (var i = 0; i < window.localStorage.length; i++) {
      var key = window.localStorage.key(i);
      if (key && allowedLocalKey(key)) keys.push(key);
    }
    keys.sort();
    for (var j = 0; j < keys.length; j++) {
      entries[keys[j]] = window.localStorage.getItem(keys[j]);
    }
    return JSON.stringify({ version: 1, entries: entries });
  }

  function checksum(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return ('00000000' + hash.toString(16)).slice(-8);
  }

  function cloudStorage() {
    var tg = telegram();
    if (!tg || !tg.initData || !tg.CloudStorage) return null;
    if (typeof tg.isVersionAtLeast === 'function' && !tg.isVersionAtLeast('6.9')) return null;
    return tg.CloudStorage;
  }

  function cloudCall(method, args) {
    return new Promise(function (resolve, reject) {
      var cloud = cloudStorage();
      if (!cloud || typeof cloud[method] !== 'function') {
        reject(new Error('Telegram CloudStorage is unavailable'));
        return;
      }
      var callArgs = args.slice();
      callArgs.push(function (error, result) {
        if (error) reject(new Error(String(error)));
        else resolve(result);
      });
      try {
        cloud[method].apply(cloud, callArgs);
      } catch (error) {
        reject(error);
      }
    });
  }

  function legacyChunkKey(index) {
    return LEGACY_CHUNK_PREFIX + ('0000' + index).slice(-4);
  }

  function validGeneration(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
  }

  function generationChunkKey(generation, index) {
    return CHUNK_PREFIX + generation + '_' + ('0000' + index).slice(-4);
  }

  function chunkKey(manifest, index) {
    return manifest.version === 2
      ? generationChunkKey(manifest.generation, index)
      : legacyChunkKey(index);
  }

  function parseManifest(rawManifest, version) {
    var manifest = JSON.parse(rawManifest);
    var count = Number(manifest.chunks);
    if (Number(manifest.version) !== version) throw new Error('Unsupported cloud manifest');
    if (!(count >= 0 && count <= MAX_CHUNKS && Math.floor(count) === count)) {
      throw new Error('Invalid cloud manifest');
    }
    if (version === 2 && !validGeneration(manifest.generation)) {
      throw new Error('Invalid cloud generation');
    }
    return {
      version: version,
      generation: version === 2 ? manifest.generation : null,
      chunks: count,
      length: Number(manifest.length),
      hash: manifest.hash
    };
  }

  function readManifest() {
    return cloudCall('getItem', [MANIFEST_KEY]).then(function (rawManifest) {
      if (rawManifest) return parseManifest(rawManifest, 2);
      return cloudCall('getItem', [LEGACY_MANIFEST_KEY]).then(function (legacyManifest) {
        return legacyManifest ? parseManifest(legacyManifest, 1) : null;
      });
    });
  }

  function readChunks(manifest) {
    var result = {};
    var batches = [];
    for (var start = 0; start < manifest.chunks; start += 50) {
      var keys = [];
      for (var i = start; i < Math.min(start + 50, manifest.chunks); i++) {
        keys.push(chunkKey(manifest, i));
      }
      batches.push(keys);
    }

    var chain = Promise.resolve();
    batches.forEach(function (keys) {
      chain = chain.then(function () {
        return cloudCall('getItems', [keys]).then(function (values) {
          for (var key in values) {
            if (Object.prototype.hasOwnProperty.call(values, key)) result[key] = values[key];
          }
        });
      });
    });
    return chain.then(function () { return result; });
  }

  function applySnapshot(value) {
    var data = JSON.parse(value);
    if (!data || data.version !== 1 || !data.entries) throw new Error('Unsupported cloud save');

    var bases = scopedBases();
    for (var i = 0; i < bases.length; i++) {
      var oldKeys = keysWithPrefix(bases[i] + ':');
      for (var j = 0; j < oldKeys.length; j++) window.localStorage.removeItem(oldKeys[j]);
    }

    for (var key in data.entries) {
      if (Object.prototype.hasOwnProperty.call(data.entries, key) && allowedLocalKey(key)) {
        window.localStorage.setItem(key, data.entries[key]);
      }
    }
  }

  function restore() {
    migrateLegacyData();
    var cloud = cloudStorage();
    if (!cloud || !storageAvailable() || !userScope()) {
      return Promise.resolve({ mode: 'local' });
    }

    return new Promise(function (resolve) {
      var finished = false;
      var timer = window.setTimeout(function () {
        if (finished) return;
        finished = true;
        cloudEnabled = false;
        resolve({ mode: 'local', reason: 'cloud-timeout' });
      }, RESTORE_TIMEOUT);

      function done(result) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        resolve(result);
      }

      readManifest().then(function (manifest) {
        if (finished) return;
        if (!manifest) {
          return cleanupOrphanedGenerations(null).catch(function (error) {
            try { console.warn('Telegram Pixel Dungeon orphan cloud cleanup failed:', error); } catch (ignored) {}
          }).then(function () {
            if (finished) return;
            cloudEnabled = true;
            uploadedSnapshot = null;
            knownCloudManifest = null;
            startAutoSync();
            done({ mode: 'cloud', restored: false });
          });
        }

        return readChunks(manifest).then(function (values) {
          if (finished) return;
          var combined = '';
          for (var i = 0; i < manifest.chunks; i++) {
            combined += values[chunkKey(manifest, i)] || '';
          }
          if (combined.length !== Number(manifest.length) || checksum(combined) !== manifest.hash) {
            throw new Error('Incomplete cloud save');
          }
          applySnapshot(combined);
          uploadedSnapshot = snapshot();
          knownCloudManifest = manifest;
          return cleanupOrphanedGenerations(manifest).catch(function (error) {
            try { console.warn('Telegram Pixel Dungeon orphan cloud cleanup failed:', error); } catch (ignored) {}
          }).then(function () {
            if (finished) return;
            cloudEnabled = true;
            startAutoSync();
            done({ mode: 'cloud', restored: true });
          });
        });
      }).catch(function (error) {
        if (finished) return;
        cloudEnabled = false;
        try { console.warn('Telegram Pixel Dungeon cloud restore failed:', error); } catch (ignored) {}
        done({ mode: 'local', reason: 'cloud-error' });
      });
    });
  }

  function newGeneration() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function writeChunks(chunks, generation) {
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, index) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, CHUNK_YIELD);
        }).then(function () {
          return cloudCall('setItem', [generationChunkKey(generation, index), chunk]);
        });
      });
    });
    return chain;
  }

  function removeKeysBatched(keys) {
    if (!keys || !keys.length) return Promise.resolve();
    var chain = Promise.resolve();
    for (var start = 0; start < keys.length; start += 50) {
      (function (batch) {
        chain = chain.then(function () { return cloudCall('removeItems', [batch]); });
      })(keys.slice(start, start + 50));
    }
    return chain;
  }

  function removeManifestChunks(manifest) {
    if (!manifest || !manifest.chunks) return Promise.resolve();
    var keys = [];
    for (var i = 0; i < manifest.chunks; i++) keys.push(chunkKey(manifest, i));
    return removeKeysBatched(keys);
  }

  function cleanupOrphanedGenerations(activeManifest) {
    return cloudCall('getKeys', []).then(function (keys) {
      var stale = [];
      var activeV2Prefix = activeManifest && activeManifest.version === 2
        ? CHUNK_PREFIX + activeManifest.generation + '_'
        : null;

      (keys || []).forEach(function (key) {
        if (key.indexOf(CHUNK_PREFIX) === 0) {
          if (!activeV2Prefix || key.indexOf(activeV2Prefix) !== 0) stale.push(key);
        } else if (activeManifest && activeManifest.version === 2 &&
            (key === LEGACY_MANIFEST_KEY || key.indexOf(LEGACY_CHUNK_PREFIX) === 0)) {
          stale.push(key);
        } else if (!activeManifest && key.indexOf(LEGACY_CHUNK_PREFIX) === 0) {
          stale.push(key);
        }
      });
      return removeKeysBatched(stale);
    });
  }

  function removePreviousGeneration(manifest, currentGeneration) {
    if (!manifest) return Promise.resolve();
    if (manifest.version === 2 && manifest.generation === currentGeneration) {
      return Promise.resolve();
    }
    return removeManifestChunks(manifest).then(function () {
      if (manifest.version === 1) {
        return cloudCall('removeItems', [[LEGACY_MANIFEST_KEY]]);
      }
    });
  }

  function syncNow() {
    if (!cloudEnabled) return Promise.resolve(false);
    if (uploadActive) {
      uploadPending = true;
      return Promise.resolve(false);
    }
    var current = snapshot();
    if (current == null || current === uploadedSnapshot) return Promise.resolve(false);

    var chunks = [];
    for (var i = 0; i < current.length; i += CHUNK_SIZE) chunks.push(current.substring(i, i + CHUNK_SIZE));
    if (chunks.length > MAX_CHUNKS) {
      try { console.warn('Telegram Pixel Dungeon save is too large for Telegram CloudStorage'); } catch (ignored) {}
      return Promise.resolve(false);
    }

    uploadActive = true;
    var previousManifest = knownCloudManifest;
    var generation = newGeneration();
    var nextManifest = {
      version: 2,
      generation: generation,
      chunks: chunks.length,
      length: current.length,
      hash: checksum(current),
      updated: new Date().toISOString()
    };
    var manifestSwitched = false;
    return cleanupOrphanedGenerations(previousManifest).then(function () {
      return writeChunks(chunks, generation);
    }).then(function () {
      var manifest = JSON.stringify({
        version: nextManifest.version,
        generation: nextManifest.generation,
        chunks: nextManifest.chunks,
        length: nextManifest.length,
        hash: nextManifest.hash,
        updated: nextManifest.updated
      });
      return cloudCall('setItem', [MANIFEST_KEY, manifest]);
    }).then(function () {
      manifestSwitched = true;
      uploadedSnapshot = current;
      knownCloudManifest = nextManifest;
      return removePreviousGeneration(previousManifest, generation).catch(function (error) {
        try { console.warn('Telegram Pixel Dungeon old cloud generation cleanup failed:', error); } catch (ignored) {}
      });
    }).then(function () {
      return true;
    }).catch(function (error) {
      var cleanup = manifestSwitched ? Promise.resolve() :
        removeManifestChunks(nextManifest).catch(function (cleanupError) {
          try { console.warn('Telegram Pixel Dungeon failed cloud generation cleanup failed:', cleanupError); } catch (ignored) {}
        });
      return cleanup.then(function () {
        try { console.warn('Telegram Pixel Dungeon cloud sync failed:', error); } catch (ignored) {}
        return false;
      });
    }).then(function (result) {
      uploadActive = false;
      if (uploadPending) {
        uploadPending = false;
        window.setTimeout(syncNow, 0);
      }
      return result;
    });
  }

  function startAutoSync() {
    if (!cloudEnabled || syncTimer != null) return;
    syncTimer = window.setInterval(syncNow, SYNC_INTERVAL);
  }

  try {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) syncNow();
    });
    window.addEventListener('pagehide', syncNow);
  } catch (e) {
  }

  window.PixelDungeonStorage = {
    restore: restore,
    syncNow: syncNow,
    scope: userScope,
    mode: function () { return cloudEnabled ? 'cloud' : 'local'; }
  };
})();
