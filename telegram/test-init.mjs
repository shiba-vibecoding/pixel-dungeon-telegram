import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./telegram-init.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(insideTelegram, graphicsInitiallyReady = true) {
  const styles = new Map();
  const events = Object.create(null);
  const calls = [];
  const storageCalls = [];
  const resizeCalls = [];
  const animationFrames = [];
  let graphicsReady = graphicsInitiallyReady;
  const root = { style: { setProperty(name, value) { styles.set(name, value); } } };
  const host = {
    getBoundingClientRect() {
      return { width: 390, height: insideTelegram ? 714 : 844 };
    },
  };
  const document = {
    documentElement: root,
    getElementById(id) { return id === 'embed-html' ? host : null; },
    addEventListener() {},
  };
  const window = {
    innerHeight: 844,
    addEventListener() {},
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    TelegramPixelDungeonResize(width, height) {
      resizeCalls.push([width, height]);
      return graphicsReady;
    },
    PixelDungeonStorage: {
      pauseAndSync() { storageCalls.push('pauseAndSync'); },
      resumeGame() { storageCalls.push('resumeGame'); },
    },
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
  return {
    styles, events, calls, storageCalls, webApp, resizeCalls,
    setGraphicsReady(value) { graphicsReady = value; },
    flushFrame() {
      const pending = animationFrames.splice(0);
      for (const callback of pending) callback();
    },
  };
}

const telegram = run(true);
telegram.flushFrame();
assert(telegram.styles.get('--pd-safe-top') === '96px',
  'fullscreen controls rail must reserve 96 CSS pixels');
assert(telegram.styles.get('--pd-safe-bottom') === '34px',
  'bottom safe area was not applied');
assert(telegram.resizeCalls.length === 1 &&
  telegram.resizeCalls[0][0] === 390 && telegram.resizeCalls[0][1] === 714,
  'safe rectangle was not sent through the GWT-owned resize bridge');
assert(telegram.calls.some(([name]) => name === 'requestFullscreen'),
  'fullscreen was not requested');
assert(telegram.calls.some((call) => call[0] === 'lockOrientation' && call.length === 1),
  'current Telegram orientation was not locked with the supported API');
telegram.events.deactivated();
telegram.events.activated();
assert(telegram.storageCalls.join(',') === 'pauseAndSync,resumeGame',
  'Telegram activation lifecycle was not forwarded to game save/resume');

const preloader = run(true, false);
preloader.flushFrame();
assert(preloader.resizeCalls.length === 1,
  'preloader resize was not attempted');
preloader.setGraphicsReady(true);
preloader.events.safeAreaChanged();
preloader.flushFrame();
assert(preloader.resizeCalls.length === 2,
  'failed preloader resize suppressed the retry after graphics became ready');

for (let i = 0; i < 20; i++) {
  telegram.events.viewportChanged({ isStateStable: false });
}
telegram.flushFrame();
assert(telegram.resizeCalls.length === 1,
  'unstable viewport events rebuilt the game scene');
telegram.events.viewportChanged({ isStateStable: true });
telegram.events.safeAreaChanged();
telegram.events.contentSafeAreaChanged();
telegram.flushFrame();
assert(telegram.resizeCalls.length === 1,
  'unchanged stable viewport caused redundant game resizes');

telegram.webApp.isFullscreen = false;
telegram.events.fullscreenChanged();
telegram.flushFrame();
assert(telegram.styles.get('--pd-safe-top') === '47px',
  'non-fullscreen layout should use Telegram safe area without the controls rail');

const browser = run(false);
browser.flushFrame();
assert(!browser.styles.has('--pd-safe-top'),
  'plain browser fallback must not invent Telegram insets');
assert(browser.resizeCalls.length === 1 &&
  browser.resizeCalls[0][0] === 390 && browser.resizeCalls[0][1] === 844,
  'plain browser did not use the same backend-owned resize path');

console.log('Telegram safe area uses one stable backend-owned resize: OK');
