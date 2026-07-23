import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./telegram-bootstrap.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function launch(search, options = {}) {
  const loaded = [];
  const timers = [];
  let sdk;
  let restores = 0;
  const resolutions = [];
  const window = {
    location: { search, hash: options.hash || '' },
    PixelDungeonStorage: {
      restore() {
        restores++;
        return Promise.resolve(options.restoreResult || { mode: 'test' });
      },
      resolveConflict(source) {
        resolutions.push(source);
        return Promise.resolve(true);
      },
    },
    navigator: { language: options.language || 'en' },
    confirm() { return options.confirmCloud === true; },
    setTimeout(callback) { timers.push(callback); return timers.length; },
  };
  if (options.telegram) window.Telegram = { WebApp: options.telegram };
  const document = {
    currentScript: { src: 'https://example.test/telegram-bootstrap.js?v=release-test' },
    createElement() { return {}; },
    body: {
      appendChild(script) {
        loaded.push(script.src);
        if (script.src === 'https://telegram.org/js/telegram-web-app.js') {
          sdk = script;
        } else {
          queueMicrotask(() => script.onload());
        }
      },
    },
  };
  const context = { window, document };
  if (!options.noURLSearchParams) context.URLSearchParams = URLSearchParams;
  vm.runInNewContext(source, context, { filename: 'telegram-bootstrap.js' });
  return { loaded, timers, restores: () => restores, resolutions, sdk, window };
}

const browser = launch('');
await flush();
assert(browser.loaded.join('|') === 'telegram-init.js?v=release-test|html/html.nocache.js?v=release-test',
  'plain browser must initialize the wrapper and then boot GWT');
assert(browser.restores() === 1, 'save restore must run exactly once before GWT');
assert(browser.window.__pdStorageScope === '', 'plain browser must use an empty frozen scope');

const launchData = new URLSearchParams({
  user: JSON.stringify({ id: 202, first_name: 'Fallback' }),
  auth_date: '123',
  hash: 'signed',
}).toString();
const telegram = launch(`?tgWebAppData=${encodeURIComponent(launchData)}`);
assert(telegram.loaded.length === 1 && telegram.loaded[0].startsWith('https://telegram.org/'),
  'Telegram launch must request the official SDK first');
assert(telegram.timers.length === 1, 'Telegram SDK fallback timer is missing');
telegram.timers[0]();
await flush();
assert(telegram.window.__pdStorageScope === 'tg-unverified-202',
  'SDK timeout must isolate unsigned tgWebAppData from verified profiles');
const frozenDescriptor = Object.getOwnPropertyDescriptor(telegram.window, '__pdStorageScope');
assert(frozenDescriptor && frozenDescriptor.writable === false && frozenDescriptor.configurable === false,
  'Telegram storage scope must be immutable');
assert(telegram.loaded.filter((src) => src === 'html/html.nocache.js?v=release-test').length === 1,
  'SDK timeout fallback did not boot GWT');
telegram.window.Telegram = {
  WebApp: {
    initData: 'late-signed-data',
    initDataUnsafe: { user: { id: 999 } },
  },
};
telegram.sdk.onload();
await flush();
assert(telegram.loaded.filter((src) => src === 'html/html.nocache.js?v=release-test').length === 1,
  'late SDK completion booted the game twice');
assert(telegram.window.__pdStorageScope === 'tg-unverified-202',
  'late SDK completion changed the active storage namespace');

const sdkFirst = launch(`?tgWebAppData=${encodeURIComponent(launchData)}`, {
  telegram: {
    initData: 'verified-sdk-data',
    initDataUnsafe: { user: { id: 303 } },
  },
});
sdkFirst.sdk.onload();
await flush();
assert(sdkFirst.window.__pdStorageScope === 'tg-303',
  'SDK user id must win when the SDK is ready before the fallback timer');

const hashLaunch = launch('', { hash: `#tgWebAppData=${encodeURIComponent(launchData)}` });
hashLaunch.timers[0]();
await flush();
assert(hashLaunch.window.__pdStorageScope === 'tg-unverified-202',
  'tgWebAppData in the URL hash was not parsed');

const legacyParserLaunch = launch(`?tgWebAppData=${encodeURIComponent(launchData)}`, {
  noURLSearchParams: true,
});
legacyParserLaunch.timers[0]();
await flush();
assert(legacyParserLaunch.window.__pdStorageScope === 'tg-unverified-202',
  'fallback query parser did not preserve the Telegram user scope');

let conflictPopup;
const conflictLaunch = launch(`?tgWebAppData=${encodeURIComponent(launchData)}`, {
  restoreResult: { mode: 'local', conflict: true },
  telegram: {
    initData: 'verified-sdk-data',
    initDataUnsafe: { user: { id: 404, language_code: 'ru' } },
    showPopup(options, callback) {
      conflictPopup = options;
      queueMicrotask(() => callback('cloud'));
    },
  },
});
conflictLaunch.sdk.onload();
await flush();
assert(conflictPopup && conflictPopup.title === 'Выберите прогресс',
  'save conflict did not use the Telegram user language');
assert(conflictLaunch.resolutions.join('|') === 'cloud',
  'save conflict choice was not delegated to storage');
assert(conflictLaunch.loaded.filter((src) =>
  src === 'html/html.nocache.js?v=release-test').length === 1,
  'game did not start exactly once after resolving a save conflict');

console.log('Telegram bootstrap immutable SDK/fallback storage scope: OK');
