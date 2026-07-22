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

  var donationCopy = {
    en: { title: 'Thank you!', message: 'A voluntary thank-you with no gameplay bonuses. Choose an amount:', missing: 'Telegram Stars payments are not configured yet.', paid: 'Thank you for supporting the port!', failed: 'The payment could not be completed.', cancel: 'Cancel' },
    ru: { title: 'Спасибо!', message: 'Добровольная благодарность без игровых бонусов. Выберите сумму:', missing: 'Платежи в Telegram Stars пока не настроены.', paid: 'Спасибо за поддержку порта!', failed: 'Не удалось завершить платёж.', cancel: 'Отмена' },
    es: { title: '¡Gracias!', message: 'Una propina voluntaria sin ventajas en el juego. Elige una cantidad:', missing: 'Los pagos con Telegram Stars aún no están configurados.', paid: '¡Gracias por apoyar el port!', failed: 'No se pudo completar el pago.', cancel: 'Cancelar' },
    fr: { title: 'Merci !', message: 'Un pourboire volontaire, sans avantage en jeu. Choisissez un montant :', missing: 'Les paiements Telegram Stars ne sont pas encore configurés.', paid: 'Merci de soutenir le portage !', failed: 'Le paiement n’a pas pu aboutir.', cancel: 'Annuler' },
    de: { title: 'Danke!', message: 'Ein freiwilliges Dankeschön ohne Spielvorteile. Wähle einen Betrag:', missing: 'Telegram-Stars-Zahlungen sind noch nicht eingerichtet.', paid: 'Danke für deine Unterstützung des Ports!', failed: 'Die Zahlung konnte nicht abgeschlossen werden.', cancel: 'Abbrechen' },
    pt_BR: { title: 'Obrigado!', message: 'Uma contribuição voluntária, sem vantagens no jogo. Escolha um valor:', missing: 'Os pagamentos com Telegram Stars ainda não foram configurados.', paid: 'Obrigado por apoiar o porte!', failed: 'Não foi possível concluir o pagamento.', cancel: 'Cancelar' },
    pl: { title: 'Dziękujemy!', message: 'Dobrowolne podziękowanie bez korzyści w grze. Wybierz kwotę:', missing: 'Płatności Telegram Stars nie są jeszcze skonfigurowane.', paid: 'Dziękujemy za wsparcie portu!', failed: 'Nie udało się zakończyć płatności.', cancel: 'Anuluj' },
    it: { title: 'Grazie!', message: 'Un contributo volontario senza vantaggi di gioco. Scegli un importo:', missing: 'I pagamenti Telegram Stars non sono ancora configurati.', paid: 'Grazie per il supporto al port!', failed: 'Impossibile completare il pagamento.', cancel: 'Annulla' },
    tr: { title: 'Teşekkürler!', message: 'Oyun avantajı sağlamayan gönüllü bir teşekkür. Bir miktar seç:', missing: 'Telegram Stars ödemeleri henüz yapılandırılmadı.', paid: 'Portu desteklediğin için teşekkürler!', failed: 'Ödeme tamamlanamadı.', cancel: 'İptal' },
    uk: { title: 'Дякуємо!', message: 'Добровільна подяка без ігрових переваг. Виберіть суму:', missing: 'Платежі в Telegram Stars ще не налаштовано.', paid: 'Дякуємо за підтримку порту!', failed: 'Не вдалося завершити платіж.', cancel: 'Скасувати' },
    id: { title: 'Terima kasih!', message: 'Dukungan sukarela tanpa keuntungan dalam permainan. Pilih jumlah:', missing: 'Pembayaran Telegram Stars belum dikonfigurasi.', paid: 'Terima kasih telah mendukung port ini!', failed: 'Pembayaran tidak dapat diselesaikan.', cancel: 'Batal' },
    ja: { title: 'ありがとう！', message: 'ゲーム内特典のない任意の応援です。金額を選んでください：', missing: 'Telegram Stars決済はまだ設定されていません。', paid: '移植版の応援ありがとうございます！', failed: '支払いを完了できませんでした。', cancel: 'キャンセル' },
    ko: { title: '감사합니다!', message: '게임 혜택이 없는 자발적인 후원입니다. 금액을 선택하세요:', missing: 'Telegram Stars 결제가 아직 설정되지 않았습니다.', paid: '포팅 버전을 후원해 주셔서 감사합니다!', failed: '결제를 완료하지 못했습니다.', cancel: '취소' },
    zh_CN: { title: '谢谢！', message: '这是自愿赞助，不提供任何游戏优势。请选择金额：', missing: 'Telegram Stars 支付尚未配置。', paid: '感谢你支持移植版！', failed: '无法完成支付。', cancel: '取消' },
    zh_TW: { title: '謝謝！', message: '這是自願贊助，不提供任何遊戲優勢。請選擇金額：', missing: 'Telegram Stars 付款尚未設定。', paid: '感謝你支持移植版！', failed: '無法完成付款。', cancel: '取消' }
  };

  function copyFor(language) {
    var normalized = String(language || 'en').replace('-', '_');
    return donationCopy[normalized] || donationCopy[normalized.split('_')[0]] || donationCopy.en;
  }

  function starsConfig() {
    return window.PixelDungeonStars || {};
  }

  function isTelegramContext(activeTg) {
    return !!(activeTg && typeof activeTg.initData === 'string' && activeTg.initData.length);
  }

  function validInvoices() {
    var invoices = starsConfig().invoices;
    if (!Array.isArray(invoices)) return [];
    return invoices.filter(function (invoice) {
      return invoice && Number(invoice.stars) > 0 && typeof invoice.url === 'string' &&
        /^(https:\/\/t\.me\/\$|tg:\/\/invoice\?slug=)/.test(invoice.url);
    }).slice(0, 3);
  }

  function openAuthor() {
    var url = starsConfig().authorUrl || 'https://t.me/barboskich';
    try {
      var activeTg = window.Telegram && window.Telegram.WebApp;
      if (isTelegramContext(activeTg) && typeof activeTg.openTelegramLink === 'function' && /^https:\/\/t\.me\//.test(url)) {
        activeTg.openTelegramLink(url);
      } else {
        window.open(url, '_blank', 'noopener');
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function openDonation(language) {
    var activeTg = window.Telegram && window.Telegram.WebApp;
    if (!isTelegramContext(activeTg) || typeof activeTg.openInvoice !== 'function') {
      return openAuthor();
    }

    var copy = copyFor(language);
    var invoices = validInvoices();
    if (!invoices.length) {
      if (typeof activeTg.showAlert === 'function') activeTg.showAlert(copy.missing);
      return true;
    }

    function pay(invoice) {
      activeTg.openInvoice(invoice.url, function (status) {
        if (status === 'paid') {
          try { activeTg.HapticFeedback.notificationOccurred('success'); } catch (e) {}
          if (typeof activeTg.showAlert === 'function') activeTg.showAlert(copy.paid);
        } else if (status === 'failed' && typeof activeTg.showAlert === 'function') {
          activeTg.showAlert(copy.failed);
        }
      });
    }

    if (invoices.length === 1 || typeof activeTg.showPopup !== 'function') {
      pay(invoices[0]);
      return true;
    }

    var buttons = invoices.map(function (invoice, index) {
      return { id: String(index), type: 'default', text: String(invoice.stars) + ' ⭐' };
    });
    activeTg.showPopup({ title: copy.title, message: copy.message, buttons: buttons }, function (id) {
      if (invoices[Number(id)]) pay(invoices[Number(id)]);
    });
    return true;
  }

  window.PixelDungeonTelegram = window.PixelDungeonTelegram || {};
  window.PixelDungeonTelegram.openDonation = openDonation;
  window.PixelDungeonTelegram.openAuthor = openAuthor;

  function setVar(name, value) {
    try { root.style.setProperty(name, value); } catch (e) {}
  }

  // --- Fallback viewport height (used before/without Telegram) ---------------
  function applyWindowHeight() {
    setVar('--tg-viewport-height', window.innerHeight + 'px');
    setVar('--tg-viewport-stable-height', window.innerHeight + 'px');
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
  call('requestFullscreen');
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
    setVar('--tg-safe-top', (s.top || 0) + 'px');
    setVar('--tg-safe-bottom', (s.bottom || 0) + 'px');
    setVar('--tg-safe-left', (s.left || 0) + 'px');
    setVar('--tg-safe-right', (s.right || 0) + 'px');
    setVar('--tg-content-top', (c.top || 0) + 'px');
    setVar('--tg-content-bottom', (c.bottom || 0) + 'px');
  }

  updateViewport();
  updateInsets();

  ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']
    .forEach(function (name) {
      try {
        tg.onEvent(name, function () { updateViewport(); updateInsets(); pokeResize(); });
      } catch (e) {}
    });
})();
