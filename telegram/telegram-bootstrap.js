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

  function parameter(value, name) {
    try {
      if (typeof URLSearchParams !== 'undefined') {
        var params = new URLSearchParams(value);
        return params.has(name) ? params.get(name) : null;
      }
    } catch (ignored) {
    }
    var pairs = String(value || '').split('&');
    for (var i = 0; i < pairs.length; i++) {
      var separator = pairs[i].indexOf('=');
      var rawKey = separator >= 0 ? pairs[i].slice(0, separator) : pairs[i];
      var rawValue = separator >= 0 ? pairs[i].slice(separator + 1) : '';
      try {
        if (decodeURIComponent(rawKey.replace(/\+/g, ' ')) === name) {
          return decodeURIComponent(rawValue.replace(/\+/g, ' '));
        }
      } catch (ignoredPair) {
      }
    }
    return null;
  }

  function launchParam(name) {
    var sources = [
      String(window.location.search || ''),
      String(window.location.hash || '')
    ];
    for (var i = 0; i < sources.length; i++) {
      var value = sources[i].replace(/^[?#]/, '');
      var queryStart = value.indexOf('?');
      if (queryStart >= 0) value = value.slice(queryStart + 1);
      var result = parameter(value, name);
      if (result != null) return result;
    }
    return null;
  }

  function numericUserId(value) {
    var id = value != null ? String(value) : '';
    return /^[0-9]+$/.test(id) ? id : '';
  }

  function fallbackUserId(webAppData) {
    if (!webAppData) return '';
    try {
      var user = parameter(webAppData, 'user');
      return numericUserId(user ? JSON.parse(user).id : '');
    } catch (ignored) {
      return '';
    }
  }

  function sdkUserId() {
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
      return tg && tg.initData ? numericUserId(user && user.id) : '';
    } catch (ignored) {
      return '';
    }
  }

  var webAppData = launchParam('tgWebAppData');
  var launchUserId = fallbackUserId(webAppData);

  function freezeStorageScope() {
    if (Object.prototype.hasOwnProperty.call(window, '__pdStorageScope')) return;
    var verifiedUserId = sdkUserId();
    /*
     * tgWebAppData in the URL is not trustworthy until the Telegram SDK has
     * supplied signed initData. Keep a timeout launch isolated, but never let
     * a crafted public URL select the verified tg-<id> namespace of another
     * account on the same browser profile.
     */
    var scope = verifiedUserId ? 'tg-' + verifiedUserId :
      (launchUserId ? 'tg-unverified-' + launchUserId : '');
    try {
      Object.defineProperty(window, '__pdStorageScope', {
        value: scope,
        writable: false,
        configurable: false
      });
    } catch (ignored) {
      window.__pdStorageScope = scope;
    }
  }

  function loadScript(src, onDone) {
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () { onDone(true); };
    script.onerror = function () { onDone(false); };
    document.body.appendChild(script);
  }

  var conflictCopy = {
    en: ['Choose progress', 'This device and Telegram Cloud have different saves. Which progress should Telegram Pixel Dungeon keep?', 'This device', 'Telegram Cloud'],
    de: ['Fortschritt wählen', 'Auf diesem Gerät und in der Telegram Cloud liegen unterschiedliche Spielstände. Welchen soll Telegram Pixel Dungeon behalten?', 'Dieses Gerät', 'Telegram Cloud'],
    es: ['Elige el progreso', 'Este dispositivo y Telegram Cloud tienen partidas diferentes. ¿Cuál debe conservar Telegram Pixel Dungeon?', 'Este dispositivo', 'Telegram Cloud'],
    fr: ['Choisir la progression', 'Cet appareil et Telegram Cloud contiennent des sauvegardes différentes. Laquelle Telegram Pixel Dungeon doit-il conserver ?', 'Cet appareil', 'Telegram Cloud'],
    id: ['Pilih progres', 'Perangkat ini dan Telegram Cloud memiliki simpanan berbeda. Progres mana yang harus disimpan Telegram Pixel Dungeon?', 'Perangkat ini', 'Telegram Cloud'],
    it: ['Scegli i progressi', 'Questo dispositivo e Telegram Cloud hanno salvataggi diversi. Quale deve conservare Telegram Pixel Dungeon?', 'Questo dispositivo', 'Telegram Cloud'],
    ja: ['進行状況を選択', 'この端末とTelegram Cloudに異なるセーブがあります。Telegram Pixel Dungeonでどちらを使いますか？', 'この端末', 'Telegram Cloud'],
    ko: ['진행 상황 선택', '이 기기와 Telegram Cloud에 서로 다른 저장 데이터가 있습니다. Telegram Pixel Dungeon에서 어느 쪽을 사용할까요?', '이 기기', 'Telegram Cloud'],
    pl: ['Wybierz postęp', 'Na tym urządzeniu i w Telegram Cloud są różne zapisy. Który ma zachować Telegram Pixel Dungeon?', 'To urządzenie', 'Telegram Cloud'],
    pt: ['Escolha o progresso', 'Este dispositivo e o Telegram Cloud têm jogos salvos diferentes. Qual deles o Telegram Pixel Dungeon deve manter?', 'Este dispositivo', 'Telegram Cloud'],
    ru: ['Выберите прогресс', 'На этом устройстве и в Telegram Cloud разные сохранения. Какой прогресс должна оставить Telegram Pixel Dungeon?', 'Это устройство', 'Telegram Cloud'],
    tr: ['İlerlemeyi seç', "Bu cihazda ve Telegram Cloud'da farklı kayıtlar var. Telegram Pixel Dungeon hangisini kullansın?", 'Bu cihaz', 'Telegram Cloud'],
    uk: ['Виберіть прогрес', 'На цьому пристрої та в Telegram Cloud різні збереження. Який прогрес має залишити Telegram Pixel Dungeon?', 'Цей пристрій', 'Telegram Cloud'],
    zh_cn: ['选择进度', '此设备和 Telegram Cloud 中有不同的存档。Telegram Pixel Dungeon 应保留哪一个？', '此设备', 'Telegram Cloud'],
    zh_tw: ['選擇進度', '此裝置和 Telegram Cloud 中有不同的存檔。Telegram Pixel Dungeon 應保留哪一個？', '此裝置', 'Telegram Cloud']
  };

  function languageKey() {
    var code = '';
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      code = tg && tg.initDataUnsafe && tg.initDataUnsafe.user &&
        tg.initDataUnsafe.user.language_code || '';
    } catch (ignored) {
    }
    if (!code) {
      try { code = window.navigator && window.navigator.language || ''; } catch (ignoredNavigator) {}
    }
    code = String(code || 'en').toLowerCase().replace('-', '_');
    if (code.indexOf('zh') === 0) {
      return /(?:tw|hk|hant)/.test(code) ? 'zh_tw' : 'zh_cn';
    }
    var base = code.split('_')[0];
    return conflictCopy[base] ? base : 'en';
  }

  function resolveSaveConflict(storage) {
    return new Promise(function (resolve) {
      var copy = conflictCopy[languageKey()] || conflictCopy.en;
      var settled = false;
      function choose(source) {
        if (settled) return;
        settled = true;
        try {
          Promise.resolve(storage.resolveConflict(source)).then(resolve, resolve);
        } catch (ignored) {
          resolve(false);
        }
      }

      try {
        var tg = window.Telegram && window.Telegram.WebApp;
        if (tg && typeof tg.showPopup === 'function') {
          tg.showPopup({
            title: copy[0],
            message: copy[1],
            buttons: [
              { id: 'local', type: 'default', text: copy[2] },
              { id: 'cloud', type: 'default', text: copy[3] }
            ]
          }, function (buttonId) {
            choose(buttonId === 'cloud' ? 'cloud' : 'local');
          });
          return;
        }
      } catch (ignoredPopup) {
      }

      var useCloud = false;
      try {
        useCloud = window.confirm(copy[1] + '\n\n' + copy[3] + '?');
      } catch (ignoredConfirm) {
      }
      choose(useCloud ? 'cloud' : 'local');
    });
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
      storage.restore().then(function (result) {
        if (result && result.conflict &&
            typeof storage.resolveConflict === 'function') {
          resolveSaveConflict(storage).then(startGame, startGame);
        } else {
          startGame();
        }
      }, startGame);
    } catch (e) {
      startGame();
    }
  }

  function finishSetup() {
    if (setupStarted) return;
    setupStarted = true;
    freezeStorageScope();
    loadScript(versioned('telegram-init.js'), function () { restoreAndStart(); });
  }

  if (webAppData == null) {
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
