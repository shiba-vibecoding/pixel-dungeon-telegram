import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./telegram-bootstrap.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function launch(search) {
  const loaded = [];
  const timers = [];
  let sdk;
  let restores = 0;
  const window = {
    location: { search, hash: '' },
    PixelDungeonStorage: {
      restore() { restores++; return Promise.resolve({ mode: 'test' }); },
    },
    setTimeout(callback) { timers.push(callback); return timers.length; },
  };
  const document = {
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
  vm.runInNewContext(source, { window, document }, { filename: 'telegram-bootstrap.js' });
  return { loaded, timers, restores: () => restores, sdk };
}

const browser = launch('');
await flush();
assert(browser.loaded.join('|') === 'telegram-init.js|html/html.nocache.js',
  'plain browser must initialize the wrapper and then boot GWT');
assert(browser.restores() === 1, 'save restore must run exactly once before GWT');

const telegram = launch('?tgWebAppData=signed');
assert(telegram.loaded.length === 1 && telegram.loaded[0].startsWith('https://telegram.org/'),
  'Telegram launch must request the official SDK first');
assert(telegram.timers.length === 1, 'Telegram SDK fallback timer is missing');
telegram.timers[0]();
await flush();
assert(telegram.loaded.filter((src) => src === 'html/html.nocache.js').length === 1,
  'SDK timeout fallback did not boot GWT');
telegram.sdk.onload();
await flush();
assert(telegram.loaded.filter((src) => src === 'html/html.nocache.js').length === 1,
  'late SDK completion booted the game twice');

console.log('Telegram bootstrap and SDK timeout fallback: OK');
