/*
 * Telegram Mini App integration for the Pixel Dungeon (libGDX/GWT) web build.
 *
 * Loaded AFTER telegram-web-app.js and the game's GWT bootstrap. It is a safe
 * no-op when the page is opened outside Telegram (plain browser testing), so the
 * same build works both as a Mini App and as a normal web page.
 */
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp;
  var root = document.documentElement;

  function isTelegramContext(activeTg) {
    return !!(activeTg && typeof activeTg.initData === 'string' && activeTg.initData.length);
  }

  function setVar(name, value) {
    try { root.style.setProperty(name, value); } catch (e) {}
  }

  /*
   * libGDX's GWT backend measures window.innerWidth/innerHeight, while a
   * fullscreen Mini App has a smaller content-safe rectangle. Resize the GWT
   * panel and canvas to that rectangle; changing the canvas backing size is
   * detected by libGDX on its next frame and causes a normal game resize.
   */
  function fitGameToSafeArea() {
    var host = document.getElementById('embed-html');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    var width = Math.max(1, Math.round(rect.width));
    var height = Math.max(1, Math.round(rect.height));
    var panel = host.firstElementChild;
    if (panel) {
      panel.style.width = width + 'px';
      panel.style.height = height + 'px';
    }
    var canvas = host.getElementsByTagName('canvas')[0];
    if (!canvas) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }

  function scheduleSafeAreaFit() {
    window.setTimeout(fitGameToSafeArea, 0);
    window.setTimeout(fitGameToSafeArea, 80);
  }

  // --- Fallback viewport height (used before/without Telegram) ---------------
  function applyWindowHeight() {
    setVar('--tg-viewport-height', window.innerHeight + 'px');
    setVar('--tg-viewport-stable-height', window.innerHeight + 'px');
    scheduleSafeAreaFit();
  }
  applyWindowHeight();
  window.addEventListener('resize', applyWindowHeight);

  // libGDX's GWT backend fits its canvas to the window on the 'resize' event.
  // Fire a few delayed resizes so the canvas re-measures after the browser and
  // Telegram finish their own layout/animation passes.
  function pokeResize() {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (e) {
      var evt = document.createEvent('Event');
      evt.initEvent('resize', true, true);
      window.dispatchEvent(evt);
    }
    scheduleSafeAreaFit();
  }
  [50, 200, 500, 1000, 2000].forEach(function (t) { setTimeout(pokeResize, t); });

  if (!isTelegramContext(tg)) {
    // Not inside Telegram: keep the plain-browser fallback and stop here.
    return;
  }

  // Call a WebApp method only if this client version supports it.
  function call(name) {
    try {
      if (typeof tg[name] === 'function') {
        tg[name].apply(tg, Array.prototype.slice.call(arguments, 1));
        return true;
      }
    } catch (e) { /* method unsupported on this client version */ }
    return false;
  }

  // 1. Signal readiness and expand to the full available height.
  call('ready');
  call('expand');

  // 2. Stop the swipe-down gesture from closing the app mid-game (Bot API 7.7+).
  call('disableVerticalSwipes');

  // 3. Confirm before closing so a stray gesture never drops an active run.
  call('enableClosingConfirmation');

  // 4. Go fullscreen and lock to portrait where supported (Bot API 8.0+).
  var fullscreenRequested = call('requestFullscreen');
  call('lockOrientation', 'portrait');

  // 5. Match the Telegram chrome to the game's dark theme.
  call('setHeaderColor', '#1f1d1d');
  call('setBackgroundColor', '#1f1d1d');
  call('setBottomBarColor', '#1f1d1d');

  // --- Keep CSS variables in sync with the live Telegram viewport ------------
  function updateViewport() {
    if (typeof tg.viewportHeight === 'number' && tg.viewportHeight > 0) {
      setVar('--tg-viewport-height', tg.viewportHeight + 'px');
    }
    if (typeof tg.viewportStableHeight === 'number' && tg.viewportStableHeight > 0) {
      setVar('--tg-viewport-stable-height', tg.viewportStableHeight + 'px');
    }
  }

  function updateInsets() {
    var s = tg.safeAreaInset || {};
    var c = tg.contentSafeAreaInset || {};
    var top = Math.max(Number(s.top) || 0, Number(c.top) || 0);
    // In Telegram fullscreen mode the Close and overflow controls float below
    // the status-bar safe area.  Some iOS clients report only the notch/status
    // inset, so reserve the complete 96 CSS-pixel controls rail ourselves.
    if (fullscreenRequested && tg.isFullscreen !== false) {
      top = Math.max(top, 96);
    }
    var bottom = Math.max(Number(s.bottom) || 0, Number(c.bottom) || 0);
    var left = Math.max(Number(s.left) || 0, Number(c.left) || 0);
    var right = Math.max(Number(s.right) || 0, Number(c.right) || 0);
    setVar('--pd-safe-top', top + 'px');
    setVar('--pd-safe-bottom', bottom + 'px');
    setVar('--pd-safe-left', left + 'px');
    setVar('--pd-safe-right', right + 'px');
    scheduleSafeAreaFit();
  }

  updateViewport();
  updateInsets();

  ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']
    .forEach(function (name) {
      try {
        tg.onEvent(name, function () { updateViewport(); updateInsets(); pokeResize(); });
      } catch (e) {}
    });

  // The GWT canvas is inserted only after its assets finish preloading.
  if (typeof MutationObserver !== 'undefined') {
    var gameHost = document.getElementById('embed-html');
    if (gameHost) {
      new MutationObserver(scheduleSafeAreaFit).observe(gameHost, {
        childList: true,
        subtree: true
      });
    }
  }
})();
