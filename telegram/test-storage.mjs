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
const cloud = {
  getItem(key, callback) { queueMicrotask(() => callback(null, cloudData[key] || '')); },
  getItems(keys, callback) {
    const values = {};
    for (const key of keys) values[key] = cloudData[key] || '';
    queueMicrotask(() => callback(null, values));
  },
  setItem(key, value, callback) {
    cloudWrites++;
    cloudData[key] = String(value);
    queueMicrotask(() => callback(null, true));
  },
  removeItems(keys, callback) {
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
assert(cloudData.pdgdx_manifest_v1, 'cloud manifest is missing');

const secondDevice = new MemoryStorage();
bridge = install(secondDevice);
restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === true, 'second device did not restore cloud data');
assert(secondDevice.getItem('pd-prefs-tg-101:language') === 'ru', 'settings did not survive cloud restore');
assert(secondDevice.getItem('pd-files-tg-101:game.dat.s') === 'saved-run', 'progress did not survive cloud restore');

secondDevice.setItem('pd-files-tg-101:game.dat.s', 'newer-run');
assert(await bridge.syncNow(), 'updated progress was not uploaded');
const thirdDevice = new MemoryStorage();
bridge = install(thirdDevice);
restored = await bridge.restore();
assert(restored.restored === true, 'updated cloud snapshot was not restored');
assert(thirdDevice.getItem('pd-files-tg-101:game.dat.s') === 'newer-run',
  'latest progress did not win');

const validManifest = cloudData.pdgdx_manifest_v1;
cloudData.pdgdx_manifest_v1 = JSON.stringify({
  version: 1, chunks: 1, length: 10, hash: 'bad-data', updated: 'invalid'
});
const localFallback = new MemoryStorage();
localFallback.setItem('pd-files-tg-101:game.dat.s', 'local-safe-copy');
bridge = install(localFallback);
restored = await bridge.restore();
assert(restored.mode === 'local' && restored.reason === 'cloud-error',
  'corrupt cloud data must fall back to local storage');
assert(localFallback.getItem('pd-files-tg-101:game.dat.s') === 'local-safe-copy',
  'corrupt cloud data erased the local save');
cloudData.pdgdx_manifest_v1 = validManifest;

console.log('Telegram per-user migration and cloud restore: OK');
