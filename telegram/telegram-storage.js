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
  var CHANGE_SYNC_DELAY = 2500;
  var CHUNK_YIELD = 25;
  var RESTORE_TIMEOUT = 4000;
  var CLOUD_CALL_TIMEOUT = 3000;
  var MAX_SNAPSHOT_ENTRIES = 4096;
  var MAX_LOCAL_KEY_LENGTH = 512;
  var SYNC_STATE_PREFIX = 'pdgdx_sync_state_v3_';

  var cloudEnabled = false;
  var uploadActive = false;
  var uploadPending = false;
  var syncTimer = null;
  var changeSyncTimer = null;
  var deferredLifecycleSync = false;
  var localDirty = false;
  var syncConflict = false;
  var uploadedSnapshot = null;
  var knownCloudManifest = null;

  function telegram() {
    return window.Telegram && window.Telegram.WebApp;
  }

  function liveTelegramScope() {
    try {
      var tg = telegram();
      var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      var id = user && user.id != null ? String(user.id) : '';
      return tg && tg.initData && /^[0-9]+$/.test(id) ? 'tg-' + id : '';
    } catch (e) {
      return '';
    }
  }

  function freezeUserScope() {
    var scope = '';
    try {
      if (Object.prototype.hasOwnProperty.call(window, '__pdStorageScope')) {
        scope = String(window.__pdStorageScope || '');
      } else {
        scope = liveTelegramScope();
        Object.defineProperty(window, '__pdStorageScope', {
          value: scope,
          writable: false,
          configurable: false
        });
      }
    } catch (ignored) {
      scope = scope || liveTelegramScope();
      try { window.__pdStorageScope = scope; } catch (ignoredAgain) {}
    }
    return /^tg-(?:[0-9]+|unverified-[0-9]+)$/.test(scope) ? scope : '';
  }

  // telegram-storage.js is loaded before telegram-bootstrap.js. Bootstrap
  // freezes the launch-derived fallback scope before restore(), so capture it
  // lazily on first use instead of prematurely freezing an empty namespace.
  var STORAGE_SCOPE = null;

  function userScope() {
    if (STORAGE_SCOPE === null) STORAGE_SCOPE = freezeUserScope();
    return STORAGE_SCOPE;
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
    // Only a Telegram SDK-verified identity may claim the one-time legacy
    // namespace. An unsigned launch URL remains isolated until the next
    // verified launch and can never take ownership of another user's data.
    if (!/^tg-[0-9]+$/.test(scope) || !storageAvailable()) return;
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

  function syncStateKey() {
    return SYNC_STATE_PREFIX + userScope();
  }

  function readBaseHash() {
    if (!userScope() || !storageAvailable()) return '';
    try {
      var state = JSON.parse(window.localStorage.getItem(syncStateKey()) || '{}');
      return state && typeof state.baseHash === 'string' &&
        /^[0-9a-f]{8}$/.test(state.baseHash) ? state.baseHash : '';
    } catch (ignored) {
      return '';
    }
  }

  function writeBaseHash(hash) {
    if (!userScope() || !storageAvailable()) return;
    try {
      window.localStorage.setItem(syncStateKey(), JSON.stringify({
        version: 1,
        baseHash: hash
      }));
    } catch (ignored) {
    }
  }

  function parseSnapshot(value) {
    if (typeof value !== 'string') throw new Error('Invalid cloud save');
    var data = JSON.parse(value);
    if (!data || data.version !== 1 || !data.entries ||
        Object.prototype.toString.call(data.entries) !== '[object Object]') {
      throw new Error('Unsupported cloud save');
    }

    var keys = Object.keys(data.entries);
    if (keys.length > MAX_SNAPSHOT_ENTRIES) throw new Error('Cloud save has too many entries');
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!key || key.length > MAX_LOCAL_KEY_LENGTH || !allowedLocalKey(key)) {
        throw new Error('Cloud save contains an invalid key');
      }
      if (typeof data.entries[key] !== 'string') {
        throw new Error('Cloud save contains a non-string value');
      }
    }
    return { entries: data.entries, keys: keys };
  }

  function snapshotIsEmpty(value) {
    return parseSnapshot(value).keys.length === 0;
  }

  function cloudStorage() {
    var tg = telegram();
    var scope = userScope();
    if (!tg || !tg.initData || !tg.CloudStorage) return null;
    if (!scope || liveTelegramScope() !== scope) return null;
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
      var settled = false;
      var timeoutMs = Number(window.__pdCloudCallTimeoutMs);
      if (!(timeoutMs > 0)) timeoutMs = CLOUD_CALL_TIMEOUT;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Telegram CloudStorage call timed out: ' + method));
      }, timeoutMs);

      function finish(error, result) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) reject(new Error(String(error)));
        else resolve(result);
      }

      var callArgs = args.slice();
      callArgs.push(finish);
      try {
        cloud[method].apply(cloud, callArgs);
      } catch (error) {
        finish(error);
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

  function parsePreviousManifest(previous) {
    if (!previous) return null;
    var version = Number(previous.version);
    var chunks = Number(previous.chunks);
    if ((version !== 1 && version !== 2) ||
        !(chunks >= 0 && chunks <= MAX_CHUNKS && Math.floor(chunks) === chunks)) {
      throw new Error('Invalid previous cloud generation');
    }
    if (version === 2 && !validGeneration(previous.generation)) {
      throw new Error('Invalid previous cloud generation');
    }
    return {
      version: version,
      generation: version === 2 ? previous.generation : null,
      chunks: chunks
    };
  }

  function parseManifest(rawManifest, version) {
    var manifest = JSON.parse(rawManifest);
    var count = Number(manifest.chunks);
    var length = Number(manifest.length);
    if (Number(manifest.version) !== version) throw new Error('Unsupported cloud manifest');
    if (!(count >= 0 && count <= MAX_CHUNKS && Math.floor(count) === count)) {
      throw new Error('Invalid cloud manifest');
    }
    if (!(length >= 0 && length <= MAX_CHUNKS * CHUNK_SIZE &&
        Math.floor(length) === length) || !/^[0-9a-f]{8}$/.test(String(manifest.hash || ''))) {
      throw new Error('Invalid cloud manifest');
    }
    if (version === 2 && !validGeneration(manifest.generation)) {
      throw new Error('Invalid cloud generation');
    }
    return {
      version: version,
      generation: version === 2 ? manifest.generation : null,
      chunks: count,
      length: length,
      hash: manifest.hash,
      previous: version === 2 ? parsePreviousManifest(manifest.previous) : null
    };
  }

  function sameManifest(left, right) {
    if (!left || !right) return left === right;
    return left.version === right.version &&
      left.generation === right.generation &&
      left.chunks === right.chunks &&
      left.length === right.length &&
      left.hash === right.hash;
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
    var parsed = parseSnapshot(value);
    var bases = scopedBases();
    var oldKeys = [];
    for (var i = 0; i < bases.length; i++) {
      oldKeys = oldKeys.concat(keysWithPrefix(bases[i] + ':'));
    }

    var backup = {};
    for (var j = 0; j < oldKeys.length; j++) {
      backup[oldKeys[j]] = window.localStorage.getItem(oldKeys[j]);
    }

    try {
      for (var k = 0; k < parsed.keys.length; k++) {
        var desiredKey = parsed.keys[k];
        var desiredValue = parsed.entries[desiredKey];
        window.localStorage.setItem(desiredKey, desiredValue);
        if (window.localStorage.getItem(desiredKey) !== desiredValue) {
          throw new Error('Cloud save write verification failed');
        }
      }
      for (var m = 0; m < oldKeys.length; m++) {
        if (!Object.prototype.hasOwnProperty.call(parsed.entries, oldKeys[m])) {
          window.localStorage.removeItem(oldKeys[m]);
          if (window.localStorage.getItem(oldKeys[m]) !== null) {
            throw new Error('Cloud save delete verification failed');
          }
        }
      }
    } catch (error) {
      try {
        var currentKeys = [];
        for (var n = 0; n < bases.length; n++) {
          currentKeys = currentKeys.concat(keysWithPrefix(bases[n] + ':'));
        }
        for (var p = 0; p < currentKeys.length; p++) {
          window.localStorage.removeItem(currentKeys[p]);
        }
        for (var oldKey in backup) {
          if (Object.prototype.hasOwnProperty.call(backup, oldKey)) {
            window.localStorage.setItem(oldKey, backup[oldKey]);
          }
        }
      } catch (rollbackError) {
        try { console.warn('Telegram Pixel Dungeon local rollback failed:', rollbackError); } catch (ignored) {}
      }
      throw error;
    }
  }

  function restore() {
    migrateLegacyData();
    var localBefore = snapshot();
    var localHash = localBefore == null ? '' : checksum(localBefore);
    var localEmpty = localBefore == null ? true : snapshotIsEmpty(localBefore);
    var baseHash = readBaseHash();
    localDirty = !localEmpty && (!baseHash || localHash !== baseHash);
    syncConflict = false;

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
          cloudEnabled = true;
          uploadedSnapshot = null;
          knownCloudManifest = null;
          startAutoSync();
          done({ mode: 'cloud', restored: false });
          return;
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

          // Validate even when the local copy wins, so a well-formed manifest
          // cannot smuggle invalid keys or values into a later reconciliation.
          parseSnapshot(combined);
          knownCloudManifest = manifest;
          uploadedSnapshot = combined;
          cloudEnabled = true;

          if (localHash === manifest.hash) {
            localDirty = false;
            writeBaseHash(manifest.hash);
            startAutoSync();
            done({ mode: 'cloud', restored: false, identical: true });
          } else if (localEmpty || (baseHash && localHash === baseHash)) {
            applySnapshot(combined);
            localDirty = false;
            writeBaseHash(manifest.hash);
            startAutoSync();
            done({ mode: 'cloud', restored: true });
          } else if (baseHash && manifest.hash === baseHash) {
            // Only this device changed since the last common snapshot. Keep
            // its progress and let the normal sync path publish it.
            localDirty = true;
            startAutoSync();
            done({ mode: 'cloud', restored: false, localPreserved: true });
          } else {
            // Both sides may contain progress that the other side has not
            // seen. Never choose silently: keep local playable and leave the
            // remote generation untouched until a future conflict UI decides.
            localDirty = true;
            syncConflict = true;
            done({ mode: 'local', reason: 'cloud-conflict', conflict: true });
          }

          if (manifest.previous) {
            removePreviousGeneration(manifest.previous, manifest.generation).catch(function (error) {
              try { console.warn('Telegram Pixel Dungeon superseded cloud cleanup failed:', error); } catch (ignored) {}
            });
          }
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

  function manifestReference(manifest) {
    if (!manifest) return null;
    return {
      version: manifest.version,
      generation: manifest.version === 2 ? manifest.generation : null,
      chunks: manifest.chunks
    };
  }

  function markSyncConflict() {
    localDirty = true;
    syncConflict = true;
    uploadPending = false;
    try {
      console.warn('Telegram Pixel Dungeon cloud sync paused because local and cloud progress diverged');
    } catch (ignored) {
    }
  }

  function syncNow() {
    if (!cloudEnabled || syncConflict || !cloudStorage()) return Promise.resolve(false);
    if (uploadActive) {
      uploadPending = true;
      return Promise.resolve(false);
    }
    var current = snapshot();
    if (current == null) return Promise.resolve(false);
    if (current === uploadedSnapshot) {
      localDirty = false;
      return Promise.resolve(false);
    }
    localDirty = true;

    var chunks = [];
    for (var i = 0; i < current.length; i += CHUNK_SIZE) chunks.push(current.substring(i, i + CHUNK_SIZE));
    if (chunks.length > MAX_CHUNKS) {
      try { console.warn('Telegram Pixel Dungeon save is too large for Telegram CloudStorage'); } catch (ignored) {}
      return Promise.resolve(false);
    }

    uploadActive = true;
    var previousManifest = null;
    var generation = newGeneration();
    var nextManifest = {
      version: 2,
      generation: generation,
      chunks: chunks.length,
      length: current.length,
      hash: checksum(current),
      updated: new Date().toISOString(),
      previous: null
    };
    var manifestSwitched = false;
    var manifestWriteAttempted = false;
    var uploadCommitted = false;
    var generationWriteStarted = false;
    return readManifest().then(function (remoteManifest) {
      if (!sameManifest(remoteManifest, knownCloudManifest)) {
        if (remoteManifest && remoteManifest.hash === nextManifest.hash) {
          uploadedSnapshot = current;
          knownCloudManifest = remoteManifest;
          localDirty = false;
          writeBaseHash(nextManifest.hash);
          return false;
        }
        markSyncConflict();
        return false;
      }
      previousManifest = remoteManifest;
      nextManifest.previous = manifestReference(previousManifest);
      generationWriteStarted = true;
      return writeChunks(chunks, generation);
    }).then(function () {
      if (syncConflict || uploadedSnapshot === current) return false;
      // A second device may have committed while our detached chunks were
      // uploading. Check again immediately before switching the manifest.
      return readManifest();
    }).then(function (remoteManifest) {
      if (syncConflict || uploadedSnapshot === current) return false;
      if (!sameManifest(remoteManifest, previousManifest)) {
        var conflict = new Error('Cloud generation changed during upload');
        conflict.pdCloudConflict = true;
        throw conflict;
      }
      var manifest = JSON.stringify({
        version: nextManifest.version,
        generation: nextManifest.generation,
        chunks: nextManifest.chunks,
        length: nextManifest.length,
        hash: nextManifest.hash,
        updated: nextManifest.updated,
        previous: nextManifest.previous
      });
      manifestWriteAttempted = true;
      return cloudCall('setItem', [MANIFEST_KEY, manifest]);
    }).then(function () {
      if (syncConflict || uploadedSnapshot === current) return false;
      manifestSwitched = true;
      uploadCommitted = true;
      uploadedSnapshot = current;
      knownCloudManifest = nextManifest;
      localDirty = false;
      writeBaseHash(nextManifest.hash);
      return removePreviousGeneration(previousManifest, generation).catch(function (error) {
        try { console.warn('Telegram Pixel Dungeon old cloud generation cleanup failed:', error); } catch (ignored) {}
      });
    }).then(function () {
      return uploadCommitted && !syncConflict && uploadedSnapshot === current;
    }).catch(function (error) {
      if (error && error.pdCloudConflict) markSyncConflict();
      // Once the manifest write crossed the native bridge, a lost callback
      // cannot tell us whether Telegram committed it. Never delete its chunks
      // in that ambiguous state: an orphan is safer than an active manifest
      // that points at data we just removed.
      var cleanup = (manifestSwitched || manifestWriteAttempted || !generationWriteStarted) ?
        Promise.resolve() :
        removeManifestChunks(nextManifest).catch(function (cleanupError) {
          try { console.warn('Telegram Pixel Dungeon failed cloud generation cleanup failed:', cleanupError); } catch (ignored) {}
        });
      return cleanup.then(function () {
        try { console.warn('Telegram Pixel Dungeon cloud sync failed:', error); } catch (ignored) {}
        return false;
      });
    }).then(function (result) {
      uploadActive = false;
      if (uploadPending && !syncConflict) {
        uploadPending = false;
        window.setTimeout(syncNow, 0);
      }
      return result;
    });
  }

  function resolveConflict( source ) {
    if (source !== 'local' && source !== 'cloud') {
      return Promise.resolve(false);
    }
    if (!syncConflict) {
      return Promise.resolve(false);
    }

    if (source === 'cloud') {
      try {
        if (!knownCloudManifest || uploadedSnapshot == null) {
          return Promise.resolve(false);
        }
        applySnapshot(uploadedSnapshot);
        localDirty = false;
        syncConflict = false;
        writeBaseHash(knownCloudManifest.hash);
        startAutoSync();
        return Promise.resolve(true);
      } catch (error) {
        try { console.warn('Telegram Pixel Dungeon cloud conflict resolution failed:', error); } catch (ignored) {}
        return Promise.resolve(false);
      }
    }

    // The user explicitly chose this device. The manifest seen during restore
    // becomes the new base, allowing the transactional uploader to replace it
    // without treating the deliberate choice as another conflict.
    syncConflict = false;
    localDirty = true;
    if (knownCloudManifest) {
      writeBaseHash(knownCloudManifest.hash);
    }
    startAutoSync();
    return syncNow().then(function (uploaded) {
      return uploaded || !syncConflict;
    });
  }

  function startAutoSync() {
    if (!cloudEnabled || syncTimer != null) return;
    syncTimer = window.setInterval(syncNow, SYNC_INTERVAL);
  }

  function markLocalChange() {
    localDirty = true;
    if (!cloudEnabled || syncConflict || changeSyncTimer != null) return;
    var delay = Number(window.__pdChangeSyncDelayMs);
    if (!(delay >= 0)) delay = CHANGE_SYNC_DELAY;
    changeSyncTimer = window.setTimeout(function () {
      changeSyncTimer = null;
      syncNow();
    }, delay);
  }

  function deferLifecycleSync() {
    if (deferredLifecycleSync) return;
    deferredLifecycleSync = true;
    Promise.resolve().then(function () {
      deferredLifecycleSync = false;
      syncNow();
    });
  }

  function pauseAndSync() {
    /*
     * GameScene.pause() serializes the current turn synchronously. Run it
     * before taking the localStorage snapshot so Telegram never uploads the
     * state from the previous turn when its WebView is deactivated.
     */
    try {
      if (typeof window.TelegramPixelDungeonPause === 'function') {
        window.TelegramPixelDungeonPause();
      }
    } catch (error) {
      try { console.warn('Telegram Pixel Dungeon pause-save failed:', error); } catch (ignored) {}
    }
    deferLifecycleSync();
  }

  function resumeGame() {
    try {
      if (typeof window.TelegramPixelDungeonResume === 'function') {
        window.TelegramPixelDungeonResume();
      }
    } catch (error) {
      try { console.warn('Telegram Pixel Dungeon resume failed:', error); } catch (ignored) {}
    }
  }

  try {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        pauseAndSync();
      } else {
        resumeGame();
      }
    });
    window.addEventListener('pagehide', pauseAndSync);
  } catch (e) {
  }

  window.PixelDungeonStorage = {
    restore: restore,
    syncNow: syncNow,
    resolveConflict: resolveConflict,
    markLocalChange: markLocalChange,
    pauseAndSync: pauseAndSync,
    resumeGame: resumeGame,
    scope: userScope,
    mode: function () {
      if (syncConflict) return 'conflict';
      return cloudEnabled ? 'cloud' : 'local';
    },
    state: function () {
      return {
        mode: syncConflict ? 'conflict' : (cloudEnabled ? 'cloud' : 'local'),
        dirty: localDirty,
        conflict: syncConflict,
        baseHash: readBaseHash()
      };
    }
  };
})();
