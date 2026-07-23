import fs from 'node:fs';
import vm from 'node:vm';

class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.reads = 0;
    this.failSetKey = '';
    this.failSetCount = 0;
  }
  get length() { return this.data.size; }
  key(index) { return Array.from(this.data.keys())[index] ?? null; }
  getItem(key) {
    this.reads++;
    return this.data.has(String(key)) ? this.data.get(String(key)) : null;
  }
  setItem(key, value) {
    key = String(key);
    if (this.failSetCount > 0 && key === this.failSetKey) {
      this.failSetCount--;
      throw new Error('simulated localStorage quota failure');
    }
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(String(key)); }
}

const cloudData = Object.create(null);
let cloudWrites = 0;
let failChunkWriteAt = 0;
let armedChunkWrites = 0;
let failRemoveItems = 0;
let droppedCloudMethod = '';
let chunkWriteHook = null;
let dropCommittedManifestCallback = 0;
const cloud = {
  getItem(key, callback) {
    if (droppedCloudMethod === 'getItem') return;
    queueMicrotask(() => callback(null, cloudData[key] || ''));
  },
  getKeys(callback) { queueMicrotask(() => callback(null, Object.keys(cloudData))); },
  getItems(keys, callback) {
    if (droppedCloudMethod === 'getItems') return;
    const values = {};
    for (const key of keys) values[key] = cloudData[key] || '';
    queueMicrotask(() => callback(null, values));
  },
  setItem(key, value, callback) {
    if (droppedCloudMethod === 'setItem') return;
    cloudWrites++;
    if (failChunkWriteAt && key.startsWith('pdgdx_data_v2_')) {
      armedChunkWrites++;
      if (armedChunkWrites === failChunkWriteAt) {
        queueMicrotask(() => callback('simulated interrupted upload'));
        return;
      }
    }
    cloudData[key] = String(value);
    if (key === 'pdgdx_manifest_v2' && dropCommittedManifestCallback > 0) {
      dropCommittedManifestCallback--;
      return;
    }
    if (key.startsWith('pdgdx_data_v2_') && chunkWriteHook) {
      const hook = chunkWriteHook;
      chunkWriteHook = null;
      hook();
    }
    queueMicrotask(() => callback(null, true));
  },
  removeItems(keys, callback) {
    if (droppedCloudMethod === 'removeItems') return;
    if (failRemoveItems > 0) {
      failRemoveItems--;
      queueMicrotask(() => callback('simulated cleanup interruption'));
      return;
    }
    for (const key of keys) delete cloudData[key];
    queueMicrotask(() => callback(null, true));
  },
};

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const source = fs.readFileSync(new URL('./telegram-storage.js', import.meta.url), 'utf8');
let lastDocumentListeners;
let lastWindowListeners;
let lastWindow;

function install(storage, options = {}) {
  lastDocumentListeners = Object.create(null);
  lastWindowListeners = Object.create(null);
  globalThis.document = {
    hidden: false,
    addEventListener(name, listener) { lastDocumentListeners[name] = listener; },
  };
  globalThis.window = {
    localStorage: storage,
    addEventListener(name, listener) { lastWindowListeners[name] = listener; },
    setTimeout: nativeSetTimeout,
    clearTimeout: nativeClearTimeout,
    setInterval() { return 1; },
    __pdCloudCallTimeoutMs: options.cloudTimeoutMs ?? 50,
    __pdChangeSyncDelayMs: options.changeSyncDelayMs ?? 0,
  };
  if (!options.noTelegram) {
    window.Telegram = {
      WebApp: {
        initData: 'signed-init-data',
        initDataUnsafe: { user: { id: options.userId ?? 101 } },
        isVersionAtLeast() { return true; },
        CloudStorage: cloud,
      },
    };
  }
  if (Object.prototype.hasOwnProperty.call(options, 'scope')) {
    window.__pdStorageScope = options.scope;
  }
  if (options.onPause) window.TelegramPixelDungeonPause = options.onPause;
  if (options.onResume) window.TelegramPixelDungeonResume = options.onResume;
  lastWindow = window;
  vm.runInThisContext(source, { filename: 'telegram-storage.js' });
  return window.PixelDungeonStorage;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checksum(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return (`00000000${hash.toString(16)}`).slice(-8);
}

function resetCloud() {
  for (const key of Object.keys(cloudData)) delete cloudData[key];
  cloudWrites = 0;
  failChunkWriteAt = 0;
  armedChunkWrites = 0;
  failRemoveItems = 0;
  droppedCloudMethod = '';
  chunkWriteHook = null;
  dropCommittedManifestCallback = 0;
}

async function flush(count = 8) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

function snapshotFor(entries) {
  const ordered = {};
  for (const key of Object.keys(entries).sort()) ordered[key] = entries[key];
  return JSON.stringify({ version: 1, entries: ordered });
}

function installCloudSnapshot(entries, generation) {
  const value = snapshotFor(entries);
  cloudData[`pdgdx_data_v2_${generation}_0000`] = value;
  cloudData.pdgdx_manifest_v2 = JSON.stringify({
    version: 2,
    generation,
    chunks: 1,
    length: value.length,
    hash: checksum(value),
    updated: 'test',
  });
  return value;
}

// Production loads storage before bootstrap. The bridge must wait until
// bootstrap installs its launch-derived immutable fallback scope.
const preBootstrapBridge = install(new MemoryStorage(), { noTelegram: true });
Object.defineProperty(lastWindow, '__pdStorageScope', {
  value: 'tg-202',
  writable: false,
  configurable: false,
});
assert(preBootstrapBridge.scope() === 'tg-202',
  'storage froze an empty scope before bootstrap supplied the launch user');

const unsignedLaunchDevice = new MemoryStorage();
unsignedLaunchDevice.setItem('pd-files:game.dat.s', 'legacy-must-not-be-claimed');
unsignedLaunchDevice.setItem('pd-files-tg-101:game.dat.s', 'verified-profile');
const unsignedBridge = install(unsignedLaunchDevice, {
  noTelegram: true,
  scope: 'tg-unverified-101',
});
const unsignedRestore = await unsignedBridge.restore();
assert(unsignedRestore.mode === 'local' &&
  unsignedBridge.scope() === 'tg-unverified-101',
  'unsigned launch scope was not kept in its isolated local namespace');
assert(unsignedLaunchDevice.getItem('pd-files-tg-unverified-101:game.dat.s') === null,
  'unsigned launch claimed the legacy save namespace');
assert(unsignedLaunchDevice.getItem('pd-files-tg-101:game.dat.s') === 'verified-profile',
  'unsigned launch accessed or changed a verified Telegram profile');

resetCloud();
const firstDevice = new MemoryStorage();
firstDevice.setItem('pd-prefs:language', 'ru');
firstDevice.setItem('pd-files:game.dat.s', 'saved-run');

let bridge = install(firstDevice);
assert(bridge.scope() === 'tg-101', 'storage did not freeze the Telegram user scope');
const scopeDescriptor = Object.getOwnPropertyDescriptor(lastWindow, '__pdStorageScope');
assert(scopeDescriptor && scopeDescriptor.writable === false && scopeDescriptor.configurable === false,
  'storage scope is not immutable when bootstrap is absent');
let restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === false, 'first device should start with empty cloud');
assert(firstDevice.getItem('pd-prefs-tg-101:language') === 'ru', 'legacy settings were not migrated');
assert(firstDevice.getItem('pd-files-tg-101:game.dat.s') === 'saved-run', 'legacy save was not migrated');
cloudWrites = 0;
const firstUpload = bridge.syncNow();
await Promise.resolve();
assert(cloudWrites === 0, 'cloud chunks must yield before crossing the native bridge');
const readsWhileUploading = firstDevice.reads;
assert(await bridge.syncNow() === false, 'parallel cloud upload should be coalesced');
assert(firstDevice.reads === readsWhileUploading,
  'parallel cloud upload rebuilt a synchronous localStorage snapshot');
assert(await firstUpload, 'first cloud upload did not run');
await new Promise((resolve) => nativeSetTimeout(resolve, 0));
assert(cloudData.pdgdx_manifest_v2, 'transactional cloud manifest is missing');
const firstManifest = JSON.parse(cloudData.pdgdx_manifest_v2);
assert(firstManifest.version === 2 && firstManifest.generation,
  'cloud upload did not use a generation-specific v2 manifest');

const secondDevice = new MemoryStorage();
bridge = install(secondDevice);
restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === true, 'second device did not restore cloud data');
assert(secondDevice.getItem('pd-prefs-tg-101:language') === 'ru', 'settings did not survive cloud restore');
assert(secondDevice.getItem('pd-files-tg-101:game.dat.s') === 'saved-run', 'progress did not survive cloud restore');

secondDevice.setItem('pd-files-tg-101:game.dat.s', 'newer-run');
failRemoveItems = 1;
assert(await bridge.syncNow(), 'updated progress was not uploaded');
assert(Object.keys(cloudData).some((key) =>
  key.startsWith(`pdgdx_data_v2_${firstManifest.generation}_`)),
  'simulated post-switch cleanup did not leave the previous generation');
const thirdDevice = new MemoryStorage();
bridge = install(thirdDevice);
restored = await bridge.restore();
await flush();
assert(restored.restored === true, 'updated cloud snapshot was not restored');
assert(thirdDevice.getItem('pd-files-tg-101:game.dat.s') === 'newer-run',
  'latest progress did not win');
assert(!Object.keys(cloudData).some((key) =>
  key.startsWith(`pdgdx_data_v2_${firstManifest.generation}_`)),
  'restore did not clean an old generation left after manifest switch');

const stableManifest = cloudData.pdgdx_manifest_v2;
const stableGeneration = JSON.parse(stableManifest).generation;
thirdDevice.setItem('pd-files-tg-101:game.dat.s', `interrupted-${'x'.repeat(8000)}`);
failChunkWriteAt = 2;
armedChunkWrites = 0;
assert(await bridge.syncNow() === false, 'interrupted upload should fail');
failChunkWriteAt = 0;
assert(cloudData.pdgdx_manifest_v2 === stableManifest,
  'interrupted upload replaced the active manifest');
assert(Object.keys(cloudData).some((key) => key.startsWith(`pdgdx_data_v2_${stableGeneration}_`)),
  'interrupted upload removed the active generation');
assert(!Object.keys(cloudData).some((key) =>
  key.startsWith('pdgdx_data_v2_') &&
  !key.startsWith(`pdgdx_data_v2_${stableGeneration}_`)),
  'interrupted upload left orphan generation chunks');

const afterInterruption = new MemoryStorage();
bridge = install(afterInterruption);
restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === true,
  'active generation was not restorable after an interrupted upload');
assert(afterInterruption.getItem('pd-files-tg-101:game.dat.s') === 'newer-run',
  'interrupted upload exposed partial progress');

const validManifest = cloudData.pdgdx_manifest_v2;
cloudData.pdgdx_manifest_v2 = JSON.stringify({
  version: 2,
  generation: 'corrupt',
  chunks: 1,
  length: 10,
  hash: 'bad-data',
  updated: 'invalid'
});
const localFallback = new MemoryStorage();
localFallback.setItem('pd-files-tg-101:game.dat.s', 'local-safe-copy');
bridge = install(localFallback);
restored = await bridge.restore();
assert(restored.mode === 'local' && restored.reason === 'cloud-error',
  'corrupt cloud data must fall back to local storage');
assert(localFallback.getItem('pd-files-tg-101:game.dat.s') === 'local-safe-copy',
  'corrupt cloud data erased the local save');
cloudData.pdgdx_manifest_v2 = validManifest;

resetCloud();
const legacySnapshot = JSON.stringify({
  version: 1,
  entries: {
    'pd-prefs-tg-101:language': 'de',
    'pd-files-tg-101:game.dat.s': 'legacy-cloud-run',
  },
});
cloudData.pdgdx_data_v1_0000 = legacySnapshot;
cloudData.pdgdx_manifest_v1 = JSON.stringify({
  version: 1,
  chunks: 1,
  length: legacySnapshot.length,
  hash: checksum(legacySnapshot),
  updated: 'legacy',
});

const legacyDevice = new MemoryStorage();
bridge = install(legacyDevice);
restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === true,
  'v1 cloud manifest was not restored');
assert(legacyDevice.getItem('pd-prefs-tg-101:language') === 'de',
  'v1 cloud settings were not restored');
assert(legacyDevice.getItem('pd-files-tg-101:game.dat.s') === 'legacy-cloud-run',
  'v1 cloud progress was not restored');

legacyDevice.setItem('pd-files-tg-101:game.dat.s', 'migrated-v2-run');
assert(await bridge.syncNow(), 'v1 save was not migrated to v2');
assert(cloudData.pdgdx_manifest_v2, 'v2 manifest was not created after v1 migration');
assert(!cloudData.pdgdx_manifest_v1 && !cloudData.pdgdx_data_v1_0000,
  'legacy v1 generation was not cleaned up after the v2 manifest switched');

const v2RoundTripDevice = new MemoryStorage();
bridge = install(v2RoundTripDevice);
restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === true,
  'successful v2 save did not round-trip');
assert(v2RoundTripDevice.getItem('pd-files-tg-101:game.dat.s') === 'migrated-v2-run',
  'successful v2 round-trip restored the wrong progress');

// A device that changed while the known cloud generation stayed at the base
// must retain its local progress and publish it instead of restoring old cloud.
const locallyNewerDevice = new MemoryStorage();
bridge = install(locallyNewerDevice);
restored = await bridge.restore();
assert(restored.restored === true, 'local-newer setup did not restore its base snapshot');
locallyNewerDevice.setItem('pd-files-tg-101:game.dat.s', 'local-only-change');
bridge = install(locallyNewerDevice);
restored = await bridge.restore();
assert(restored.localPreserved === true,
  'locally changed progress was overwritten while cloud still matched the base');
assert(locallyNewerDevice.getItem('pd-files-tg-101:game.dat.s') === 'local-only-change',
  'local-newer restore changed the game file');
assert(await bridge.syncNow(), 'local-newer progress was not published');

// The older round-trip device now has a local change and a remote change from
// the device above. Neither side may be selected automatically.
v2RoundTripDevice.setItem('pd-files-tg-101:game.dat.s', 'other-local-change');
const conflictCloudManifest = cloudData.pdgdx_manifest_v2;
bridge = install(v2RoundTripDevice);
restored = await bridge.restore();
assert(restored.conflict === true && bridge.mode() === 'conflict',
  'two-sided restore divergence was not reported as a conflict');
assert(v2RoundTripDevice.getItem('pd-files-tg-101:game.dat.s') === 'other-local-change',
  'conflict restore overwrote local progress');
assert(cloudData.pdgdx_manifest_v2 === conflictCloudManifest,
  'conflict restore modified the remote generation');
assert(await bridge.syncNow() === false, 'conflicted progress was uploaded without a decision');
assert(await bridge.resolveConflict('cloud') === true,
  'cloud conflict choice was not accepted');
assert(bridge.mode() === 'cloud' &&
  v2RoundTripDevice.getItem('pd-files-tg-101:game.dat.s') === 'local-only-change',
  'cloud conflict choice did not restore the remote save');

// A later two-sided divergence can also be resolved explicitly in favour of
// this device; the selected local copy must become the new cloud generation.
v2RoundTripDevice.setItem('pd-files-tg-101:game.dat.s', 'chosen-local-copy');
installCloudSnapshot({
  'pd-files-tg-101:game.dat.s': 'chosen-remote-copy',
  'pd-prefs-tg-101:language': 'de',
}, 'choice_remote');
bridge = install(v2RoundTripDevice);
restored = await bridge.restore();
assert(restored.conflict === true, 'local-choice setup did not create a conflict');
assert(await bridge.resolveConflict('local') === true && bridge.mode() === 'cloud',
  'local conflict choice did not resume cloud synchronization');
const chosenManifest = JSON.parse(cloudData.pdgdx_manifest_v2);
const chosenSnapshot = cloudData[
  `pdgdx_data_v2_${chosenManifest.generation}_0000`
];
assert(JSON.parse(chosenSnapshot).entries['pd-files-tg-101:game.dat.s'] ===
  'chosen-local-copy',
  'local conflict choice was not published as the new cloud save');

// Detect a second device switching the manifest while detached chunks upload.
const uploadRaceDevice = new MemoryStorage();
bridge = install(uploadRaceDevice);
restored = await bridge.restore();
assert(restored.restored === true, 'upload-race setup did not restore cloud');
uploadRaceDevice.setItem('pd-files-tg-101:game.dat.s', 'race-local');
let concurrentManifest = '';
chunkWriteHook = () => {
  installCloudSnapshot({
    'pd-files-tg-101:game.dat.s': 'race-remote',
    'pd-prefs-tg-101:language': 'de',
  }, 'other_device');
  concurrentManifest = cloudData.pdgdx_manifest_v2;
};
assert(await bridge.syncNow() === false, 'upload race should stop before switching the manifest');
assert(bridge.mode() === 'conflict', 'upload race did not enter conflict mode');
assert(cloudData.pdgdx_manifest_v2 === concurrentManifest,
  'upload race overwrote the concurrent device manifest');
assert(uploadRaceDevice.getItem('pd-files-tg-101:game.dat.s') === 'race-local',
  'upload race changed local progress');

// Applying a valid cloud snapshot is transactional: a quota error after some
// writes must restore every original key and remove newly introduced keys.
resetCloud();
const rollbackDevice = new MemoryStorage();
const rollbackEntries = {
  'pd-files-tg-101:game.dat.s': 'local-before-quota',
  'pd-prefs-tg-101:language': 'ru',
};
for (const [key, value] of Object.entries(rollbackEntries)) rollbackDevice.setItem(key, value);
const rollbackBase = snapshotFor(rollbackEntries);
rollbackDevice.setItem('pdgdx_sync_state_v3_tg-101', JSON.stringify({
  version: 1,
  baseHash: checksum(rollbackBase),
}));
installCloudSnapshot({
  'pd-files-tg-101:game.dat.s': 'cloud-after-quota',
  'pd-files-tg-101:level.dat.s': 'new-cloud-level',
  'pd-prefs-tg-101:language': 'fr',
}, 'quota_test');
rollbackDevice.failSetKey = 'pd-prefs-tg-101:language';
rollbackDevice.failSetCount = 1;
bridge = install(rollbackDevice);
restored = await bridge.restore();
assert(restored.mode === 'local' && restored.reason === 'cloud-error',
  'localStorage quota failure did not abort cloud restore');
assert(rollbackDevice.getItem('pd-files-tg-101:game.dat.s') === 'local-before-quota' &&
  rollbackDevice.getItem('pd-prefs-tg-101:language') === 'ru',
  'transaction rollback did not restore original keys');
assert(rollbackDevice.getItem('pd-files-tg-101:level.dat.s') === null,
  'transaction rollback left a partially restored cloud key');

// A correctly checksummed snapshot with an out-of-scope key is still invalid.
resetCloud();
installCloudSnapshot({ 'pd-files-tg-999:game.dat.s': 'wrong-user' }, 'invalid_scope');
const validationDevice = new MemoryStorage();
validationDevice.setItem('pd-files-tg-101:game.dat.s', 'validation-local');
bridge = install(validationDevice);
restored = await bridge.restore();
assert(restored.mode === 'local' && restored.reason === 'cloud-error',
  'out-of-scope cloud key passed snapshot validation');
assert(validationDevice.getItem('pd-files-tg-101:game.dat.s') === 'validation-local',
  'invalid snapshot changed valid local progress');

// If Telegram commits the manifest but loses its callback, timeout handling
// must not delete the generation now referenced by that manifest.
resetCloud();
const ambiguousCommitDevice = new MemoryStorage();
ambiguousCommitDevice.setItem('pd-files-tg-101:game.dat.s', 'callback-lost-after-commit');
bridge = install(ambiguousCommitDevice, { cloudTimeoutMs: 10 });
restored = await bridge.restore();
assert(restored.mode === 'cloud', 'ambiguous-commit setup did not enable cloud');
dropCommittedManifestCallback = 1;
assert(await bridge.syncNow() === false, 'lost manifest callback should report an unconfirmed sync');
const ambiguouslyCommittedManifest = JSON.parse(cloudData.pdgdx_manifest_v2);
assert(cloudData[
  `pdgdx_data_v2_${ambiguouslyCommittedManifest.generation}_0000`
], 'lost manifest callback cleanup deleted the possibly active generation');

// A native Telegram method that never invokes its callback must settle.
resetCloud();
droppedCloudMethod = 'getItem';
const timeoutStarted = Date.now();
bridge = install(new MemoryStorage(), { cloudTimeoutMs: 10 });
restored = await bridge.restore();
assert(restored.mode === 'local' && restored.reason === 'cloud-error',
  'hung CloudStorage callback did not fall back to local mode');
assert(Date.now() - timeoutStarted < 500,
  'CloudStorage callback timeout was not bounded');

// Lifecycle sync is deferred until later listeners have synchronously saved
// the game, and markLocalChange provides a debounced explicit write hook.
resetCloud();
const lifecycleDevice = new MemoryStorage();
lifecycleDevice.setItem('pd-files-tg-101:game.dat.s', 'before-pause');
const lifecycleCalls = [];
bridge = install(lifecycleDevice, {
  onPause() {
    lifecycleCalls.push('pause');
    lifecycleDevice.setItem(
      'pd-files-tg-101:game.dat.s', 'saved-by-gwt-pause-bridge');
    return true;
  },
  onResume() {
    lifecycleCalls.push('resume');
    return true;
  },
});
restored = await bridge.restore();
assert(restored.mode === 'cloud', 'lifecycle setup did not enable cloud sync');
document.hidden = true;
lastDocumentListeners.visibilitychange();
await new Promise((resolve) => nativeSetTimeout(resolve, 100));
let lifecycleManifest = JSON.parse(cloudData.pdgdx_manifest_v2);
let lifecycleSnapshot = cloudData[
  `pdgdx_data_v2_${lifecycleManifest.generation}_0000`
];
assert(JSON.parse(lifecycleSnapshot).entries['pd-files-tg-101:game.dat.s'] ===
  'saved-by-gwt-pause-bridge',
  'visibility sync ran before the GWT pause bridge saved');
assert(lifecycleCalls[0] === 'pause',
  'visibility lifecycle did not pause the game before cloud sync');
document.hidden = false;
lastDocumentListeners.visibilitychange();
assert(lifecycleCalls[1] === 'resume',
  'visible lifecycle did not resume the paused game');

lifecycleDevice.setItem('pd-files-tg-101:game.dat.s', 'marked-local-change');
bridge.markLocalChange();
assert(bridge.state().dirty === true, 'markLocalChange did not mark sync state dirty');
await new Promise((resolve) => nativeSetTimeout(resolve, 100));
lifecycleManifest = JSON.parse(cloudData.pdgdx_manifest_v2);
lifecycleSnapshot = cloudData[
  `pdgdx_data_v2_${lifecycleManifest.generation}_0000`
];
assert(JSON.parse(lifecycleSnapshot).entries['pd-files-tg-101:game.dat.s'] ===
  'marked-local-change',
  'markLocalChange did not schedule the updated snapshot');
assert(bridge.state().dirty === false && bridge.state().baseHash === lifecycleManifest.hash,
  'successful upload did not persist the common base hash');

// The captured scope remains immutable, and a mismatching live SDK identity
// disables cloud access instead of switching stores in the running session.
const manifestBeforeIdentityMismatch = cloudData.pdgdx_manifest_v2;
lastWindow.Telegram.WebApp.initDataUnsafe.user.id = 999;
lifecycleDevice.setItem('pd-files-tg-101:game.dat.s', 'must-stay-local');
assert(bridge.scope() === 'tg-101', 'live SDK identity changed the frozen scope');
assert(await bridge.syncNow() === false, 'mismatched SDK identity still accessed cloud');
assert(cloudData.pdgdx_manifest_v2 === manifestBeforeIdentityMismatch,
  'mismatched SDK identity changed the cloud manifest');

console.log(
  'Telegram transactional storage, v1/v2 compatibility, conflict guards, rollback, timeout, and lifecycle sync: OK'
);
