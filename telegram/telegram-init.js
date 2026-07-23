/*
 * Telegram Mini App integration for the Telegram Pixel Dungeon (libGDX/GWT) web build.
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
   * fullscreen Mini App has a smaller content-safe rectangle. The Java/GWT
   * backend owns the WebGL drawing buffer; this wrapper only measures the host
   * and asks that backend to resize it. Writing canvas.width here would reset
   * WebGL state behind libGDX and can freeze rendering or input in a WebView.
   */
  var fitScheduled = false;
  var fittedWidth = 0;
  var fittedHeight = 0;

  function fitGameToSafeArea() {
    var host = document.getElementById('embed-html');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    var width = Math.round(rect.width);
    var height = Math.round(rect.height);

    // Telegram can report a transient zero-sized viewport while animating its
    // native chrome. Never rebuild a complete game scene at 1x1 pixels.
    if (width < 64 || height < 96) return;

    var resize = window.TelegramPixelDungeonResize;
    if (typeof resize !== 'function') return;
    if (width === fittedWidth && height === fittedHeight) return;
    // The bridge is installed before libGDX creates its graphics object.
    // Remember the dimensions only after Java confirms that the drawing
    // buffer exists; the later canvas MutationObserver can then retry.
    if (resize(width, height) === false) return;
    fittedWidth = width;
    fittedHeight = height;
  }

  function scheduleSafeAreaFit() {
    if (fitScheduled) return;
    fitScheduled = true;
    var run = function () {
      fitScheduled = false;
      fitGameToSafeArea();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 0);
    }
  }

  // --- Fallback viewport height (used before/without Telegram) ---------------
  function applyWindowHeight() {
    setVar('--tg-viewport-height', window.innerHeight + 'px');
    setVar('--tg-viewport-stable-height', window.innerHeight + 'px');
    scheduleSafeAreaFit();
  }
  applyWindowHeight();
  window.addEventListener('resize', applyWindowHeight);

  // One delayed safety measurement covers a slow preloader. Telegram viewport
  // events and the canvas MutationObserver handle all normal later changes.
  window.setTimeout(scheduleSafeAreaFit, 500);

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

  // 4. Go fullscreen and lock the current (normally portrait) orientation
  // where supported (Bot API 8.0+). Telegram's lockOrientation takes no args.
  var fullscreenRequested = call('requestFullscreen');
  call('lockOrientation');

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
  }

  updateViewport();
  updateInsets();
  scheduleSafeAreaFit();

  ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']
    .forEach(function (name) {
      try {
        tg.onEvent(name, function (event) {
          updateViewport();
          updateInsets();
          // During Telegram's drag/expand animation the viewport may change
          // every frame. Wait for its stable notification and rebuild once.
          if (name !== 'viewportChanged' || !event || event.isStateStable !== false) {
            scheduleSafeAreaFit();
          }
        });
      } catch (e) {}
    });

  // Telegram may keep document.visibilityState unchanged while it temporarily
  // deactivates a Mini App. Save the current turn before cloud mirroring and
  // resume audio only after the app becomes active again.
  try {
    tg.onEvent('deactivated', function () {
      var storage = window.PixelDungeonStorage;
      if (storage && typeof storage.pauseAndSync === 'function') {
        storage.pauseAndSync();
      }
    });
    tg.onEvent('activated', function () {
      var storage = window.PixelDungeonStorage;
      if (storage && typeof storage.resumeGame === 'function') {
        storage.resumeGame();
      }
    });
  } catch (e) {}

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
