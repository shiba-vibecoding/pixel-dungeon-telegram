/* Loads Telegram integration and restores saves before starting the GWT game. */
(function () {
  'use strict';

  var setupStarted = false;
  var gameStarted = false;
  var bootstrapSrc = document.currentScript && document.currentScript.src || '';
  var queryStart = bootstrapSrc.indexOf('?');
  var releaseQuery = queryStart >= 0 ? bootstrapSrc.slice(queryStart).split('#')[0] : '';

  function versioned(src) {
    return src + releaseQuery;
  }

  function loadScript(src, onDone) {
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () { onDone(true); };
    script.onerror = function () { onDone(false); };
    document.body.appendChild(script);
  }

  function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    loadScript(versioned('html/html.nocache.js'), function () {});
  }

  function restoreAndStart() {
    var storage = window.PixelDungeonStorage;
    if (!storage || typeof storage.restore !== 'function') {
      startGame();
      return;
    }
    try {
      storage.restore().then(startGame, startGame);
    } catch (e) {
      startGame();
    }
  }

  function finishSetup() {
    if (setupStarted) return;
    setupStarted = true;
    loadScript(versioned('telegram-init.js'), function () { restoreAndStart(); });
  }

  var launchParams = String(window.location.search || '') + String(window.location.hash || '');
  if (launchParams.indexOf('tgWebAppData=') < 0) {
    // Plain browser / GitHub Pages preview: no remote dependency blocks boot.
    finishSetup();
    return;
  }

  var sdk = document.createElement('script');
  sdk.src = 'https://telegram.org/js/telegram-web-app.js';
  sdk.onload = finishSetup;
  sdk.onerror = finishSetup;
  document.body.appendChild(sdk);

  // Network failure must never leave the game on a black loading screen.
  window.setTimeout(finishSetup, 2500);
})();
