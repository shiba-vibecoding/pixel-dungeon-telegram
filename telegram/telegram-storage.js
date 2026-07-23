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

  var MANIFEST_KEY = 'pdgdx_manifest_v1';
  var CHUNK_PREFIX = 'pdgdx_data_v1_';
  var CHUNK_SIZE = 3600;
  var MAX_CHUNKS = 1000;
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
  var knownCloudChunks = 0;

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

  function chunkKey(index) {
    return CHUNK_PREFIX + ('0000' + index).slice(-4);
  }

  function readChunks(count) {
    var result = {};
    var batches = [];
    for (var start = 0; start < count; start += 50) {
      var keys = [];
      for (var i = start; i < Math.min(start + 50, count); i++) keys.push(chunkKey(i));
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

      cloudCall('getItem', [MANIFEST_KEY]).then(function (rawManifest) {
        if (finished) return;
        if (!rawManifest) {
          cloudEnabled = true;
          uploadedSnapshot = null;
          startAutoSync();
          done({ mode: 'cloud', restored: false });
          return;
        }

        var manifest = JSON.parse(rawManifest);
        var count = Number(manifest.chunks);
        if (!(count >= 0 && count <= MAX_CHUNKS)) throw new Error('Invalid cloud manifest');
        knownCloudChunks = count;
        return readChunks(count).then(function (values) {
          if (finished) return;
          var combined = '';
          for (var i = 0; i < count; i++) combined += values[chunkKey(i)] || '';
          if (combined.length !== Number(manifest.length) || checksum(combined) !== manifest.hash) {
            throw new Error('Incomplete cloud save');
          }
          applySnapshot(combined);
          uploadedSnapshot = snapshot();
          cloudEnabled = true;
          startAutoSync();
          done({ mode: 'cloud', restored: true });
        });
      }).catch(function (error) {
        if (finished) return;
        cloudEnabled = false;
        try { console.warn('Pixel Dungeon cloud restore failed:', error); } catch (ignored) {}
        done({ mode: 'local', reason: 'cloud-error' });
      });
    });
  }

  function writeChunks(chunks) {
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, index) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, CHUNK_YIELD);
        }).then(function () {
          return cloudCall('setItem', [chunkKey(index), chunk]);
        });
      });
    });
    return chain;
  }

  function removeOldChunks(from, to) {
    if (to <= from) return Promise.resolve();
    var keys = [];
    for (var i = from; i < to; i++) keys.push(chunkKey(i));
    if (!keys.length) return Promise.resolve();
    return cloudCall('removeItems', [keys]);
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
      try { console.warn('Pixel Dungeon save is too large for Telegram CloudStorage'); } catch (ignored) {}
      return Promise.resolve(false);
    }

    uploadActive = true;
    var previousCount = knownCloudChunks;
    return writeChunks(chunks).then(function () {
      var manifest = JSON.stringify({
        version: 1,
        chunks: chunks.length,
        length: current.length,
        hash: checksum(current),
        updated: new Date().toISOString()
      });
      return cloudCall('setItem', [MANIFEST_KEY, manifest]);
    }).then(function () {
      uploadedSnapshot = current;
      knownCloudChunks = chunks.length;
      return removeOldChunks(chunks.length, previousCount);
    }).then(function () {
      return true;
    }).catch(function (error) {
      try { console.warn('Pixel Dungeon cloud sync failed:', error); } catch (ignored) {}
      return false;
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
