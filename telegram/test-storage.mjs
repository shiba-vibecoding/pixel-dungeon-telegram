import fs from 'node:fs';
import vm from 'node:vm';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return Array.from(this.data.keys())[index] ?? null; }
  getItem(key) { return this.data.has(String(key)) ? this.data.get(String(key)) : null; }
  setItem(key, value) { this.data.set(String(key), String(value)); }
  removeItem(key) { this.data.delete(String(key)); }
}

const cloudData = Object.create(null);
const cloud = {
  getItem(key, callback) { queueMicrotask(() => callback(null, cloudData[key] || '')); },
  getItems(keys, callback) {
    const values = {};
    for (const key of keys) values[key] = cloudData[key] || '';
    queueMicrotask(() => callback(null, values));
  },
  setItem(key, value, callback) {
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
firstDevice.setItem('pd-prefs:languages', 'ru');
firstDevice.setItem('pd-files:game.dat.s', 'saved-run');

let bridge = install(firstDevice);
let restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === false, 'first device should start with empty cloud');
assert(firstDevice.getItem('pd-prefs-tg-101:languages') === 'ru', 'legacy settings were not migrated');
assert(firstDevice.getItem('pd-files-tg-101:game.dat.s') === 'saved-run', 'legacy save was not migrated');
assert(await bridge.syncNow(), 'first cloud upload did not run');
assert(cloudData.pdgdx_manifest_v1, 'cloud manifest is missing');

const secondDevice = new MemoryStorage();
bridge = install(secondDevice);
restored = await bridge.restore();
assert(restored.mode === 'cloud' && restored.restored === true, 'second device did not restore cloud data');
assert(secondDevice.getItem('pd-prefs-tg-101:languages') === 'ru', 'settings did not survive cloud restore');
assert(secondDevice.getItem('pd-files-tg-101:game.dat.s') === 'saved-run', 'progress did not survive cloud restore');

console.log('Telegram per-user migration and cloud restore: OK');
