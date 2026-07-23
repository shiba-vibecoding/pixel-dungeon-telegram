import fs from 'node:fs';
import vm from 'node:vm';

class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.reads = 0;
  }
  get length() { return this.data.size; }
  key(index) { return Array.from(this.data.keys())[index] ?? null; }
  getItem(key) {
    this.reads++;
    return this.data.has(String(key)) ? this.data.get(String(key)) : null;
  }
  setItem(key, value) { this.data.set(String(key), String(value)); }
  removeItem(key) { this.data.delete(String(key)); }
}

const cloudData = Object.create(null);
let cloudWrites = 0;
let failChunkWriteAt = 0;
let armedChunkWrites = 0;
let failRemoveItems = 0;
const cloud = {
  getItem(key, callback) { queueMicrotask(() => callback(null, cloudData[key] || '')); },
  getKeys(callback) { queueMicrotask(() => callback(null, Object.keys(cloudData))); },
  getItems(keys, callback) {
    const values = {};
    for (const key of keys) values[key] = cloudData[key] || '';
    queueMicrotask(() => callback(null, values));
  },
  setItem(key, value, callback) {
    cloudWrites++;
    if (failChunkWriteAt && key.startsWith('pdgdx_data_v2_')) {
      armedChunkWrites++;
      if (armedChunkWrites === failChunkWriteAt) {
        queueMicrotask(() => callback('simulated interrupted upload'));
        return;
      }
    }
    cloudData[key] = String(value);
    queueMicrotask(() => callback(null, true));
  },
  removeItems(keys, callback) {
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

function install(storage) {
  globalThis.document = { hidden: false, addEventListener() {} };
  globalThis.window = {
    localStorage: storage,
    Telegram: {
      WebApp: {
        initData: 'signed-init-data',
        initDataUnsafe: { user: { id: 101 } },
        isVersionAtLeast() { return true; },
        CloudStorage: cloud,
      },
    },
    addEventListener() {},
    setTimeout: nativeSetTimeout,
    clearTimeout: nativeClearTimeout,
    setInterval() { return 1; },
  };
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
}

resetCloud();
const firstDevice = new MemoryStorage();
firstDevice.setItem('pd-prefs:language', 'ru');
firstDevice.setItem('pd-files:game.dat.s', 'saved-run');

let bridge = install(firstDevice);
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

console.log('Telegram transactional cloud storage, v1 compatibility, and v2 round-trip: OK');
