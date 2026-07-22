import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./telegram-init.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(insideTelegram) {
  const styles = new Map();
  const events = Object.create(null);
  const calls = [];
  const root = { style: { setProperty(name, value) { styles.set(name, value); } } };
  const panel = { style: {} };
  const canvas = { width: 390, height: 844, style: {} };
  const host = {
    firstElementChild: panel,
    getBoundingClientRect() {
      return { width: 390, height: insideTelegram ? 714 : 844 };
    },
    getElementsByTagName(name) { return name === 'canvas' ? [canvas] : []; },
  };
  const document = {
    documentElement: root,
    getElementById(id) { return id === 'embed-html' ? host : null; },
    addEventListener() {},
  };
  const window = {
    innerHeight: 844,
    addEventListener() {},
    dispatchEvent() {},
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  };

  let webApp = null;
  if (insideTelegram) {
    webApp = {
      initData: 'signed-init-data',
      safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 },
      isFullscreen: true,
      viewportHeight: 844,
      viewportStableHeight: 844,
      onEvent(name, callback) { events[name] = callback; },
    };
    for (const method of [
      'ready', 'expand', 'disableVerticalSwipes', 'enableClosingConfirmation',
      'requestFullscreen', 'lockOrientation', 'setHeaderColor',
      'setBackgroundColor', 'setBottomBarColor',
    ]) {
      webApp[method] = (...args) => { calls.push([method, ...args]); };
    }
    window.Telegram = { WebApp: webApp };
  }

  const context = vm.createContext({
    window,
    document,
    Event: class Event {},
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  });
  vm.runInContext(source, context, { filename: 'telegram-init.js' });
  return { styles, events, calls, webApp, panel, canvas };
}

const telegram = run(true);
assert(telegram.styles.get('--pd-safe-top') === '96px',
  'fullscreen controls rail must reserve 96 CSS pixels');
assert(telegram.styles.get('--pd-safe-bottom') === '34px',
  'bottom safe area was not applied');
assert(telegram.canvas.width === 390 && telegram.canvas.height === 714,
  'GWT canvas was not fitted to the Telegram-safe rectangle');
assert(telegram.panel.style.width === '390px' && telegram.panel.style.height === '714px',
  'GWT host panel was not fitted to the Telegram-safe rectangle');
assert(telegram.calls.some(([name]) => name === 'requestFullscreen'),
  'fullscreen was not requested');
assert(telegram.calls.some(([name, value]) => name === 'lockOrientation' && value === 'portrait'),
  'portrait orientation was not requested');

telegram.webApp.isFullscreen = false;
telegram.events.fullscreenChanged();
assert(telegram.styles.get('--pd-safe-top') === '47px',
  'non-fullscreen layout should use Telegram safe area without the controls rail');

const browser = run(false);
assert(!browser.styles.has('--pd-safe-top'),
  'plain browser fallback must not invent Telegram insets');

console.log('Telegram fullscreen controls safe area: OK');
