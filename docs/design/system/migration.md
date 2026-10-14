# Перенос в код

Что подключить, какие классы поменялись и какая разметка нужна каждому окну. Разметка в макетах этой системы та же — её можно копировать из превью компонентов.

## Подключение

1. `fonts/Galmuri11.woff2`, `fonts/Galmuri9.woff2` — через `@font-face` (он есть в `tokens.css`).
2. `tokens.css` — переменные цветов, отступов, размеров, `--px` и `--text-*`.
3. `components/bundle.css` — все компоненты. В начале файла лежат переменные спрайтов `--atlas-*` и `--spr-*`, встроенные как data: URI. Переопределите их своими файлами:

```css
:root {
  --atlas-items: url("assets/items.png");
  --atlas-buffs: url("assets/buffs.png");
  --atlas-badges: url("assets/badges.png");
  --atlas-avatars: url("assets/avatars.png");
  --spr-window: url("assets/ui-window.png");
}
```

4. Корню игры дайте класс `.pd-root`. Если HUD считается в JS, высоту HUD передайте в `--hud-h`: под ней появится toast.

## Старый класс → новый

| Было | Стало | Что сделать |
| --- | --- | --- |
| `.pd-window` | `.pd-window`, `.pd-window.narrow` | Рамка та же (`ui-window.png`, срез 7). Добавьте шапку `.pd-window-head` и крестик `.pd-close`. |
| кнопка «Назад» / «Закрыть» | `.pd-close` | Уберите кнопку и поставьте крестик первым дочерним элементом окна. Тап по `#overlay` закрывает окно. |
| `.pd-row` | `.pd-row` | Без изменений: кнопки в ряду делят ширину поровну. |
| `.pd-button` (все красные) | `.pd-button` — второстепенная, каменная | Красной теперь будет только `.primary`. Пройдитесь по окнам и пометьте главное действие. |
| `.pd-button.primary` | `.pd-button.primary` | Одна на окно, первой. |
| — | `.pd-button.danger` | «Выбросить», «Продать». Кладите в `.pd-danger-zone` в конце `.pd-actions`. |
| — | `.pd-button.quiet` | «Нет», «Отмена», «Главное меню». |
| — | `.pd-button.ally`, `.small`, `.big`, `.stacked` + `.pd-btn-sub` | Кооператив, компактная кнопка в карточке, крупная «Продолжить» с подписью. |
| столбик кнопок | `.pd-actions` | Основная → второстепенные по две в `.pd-row` → `.pd-danger-zone`. |
| `.pd-heading` | `.pd-heading`, `.center` | 24px, `gold`. |
| `.pd-info` | `.pd-info`, `.center` | 18px, `ink`. Выравнивание влево (было по центру). |
| `.pd-note` | `.pd-note`, `.center` | 15px, `ink-muted`. |
| строка-предупреждение | `.pd-callout.bad` / `.warn` / `.cursed` | Плашка с иконкой «!» или черепом. |
| `.pd-grid` | `.pd-grid`, `.c4`, `.c6` | 5 столбцов по `--slot` (52px), зазор 8px. `.c6` — значки. |
| `.pd-slot`, `.pd-slot.empty` | + `.equipped`, `.placeholder`, `.cursed`, `.selected`, `.pressed`, `.disabled`, `.new` | Подпись «надето» больше не нужна: надетое — в ряду `.pd-equip`. |
| `.pd-item` | `.pd-item` + `--ix`/`--iy` или `data-i` | `PD.sprite()` ставит переменные по `data-i` (номер в `items.png`). |
| `.pd-qty` | `.pd-qty` | Правый нижний угол, 15px, обводка `void`. Заряды тоже сюда: «2/2». |
| `.pd-lvl.up` / `.down` | без изменений | Левый верхний угол, `good` / `bad`. |
| `.pd-tag` | `.pd-tag`, `.bad`, `.unknown` | Правый верхний угол: сила («12»; если не хватает — `.bad`), «?» у неопознанного. |
| — | `.pd-mark.curse`, `.pd-mark.quick` | Значки «проклят» и «в быстром слоте». |
| `.pd-buff` | `.pd-buff > i[data-b]`, `.fading`, `.pd-buff-n` | Иконка 7×7 из `buffs.png` ×3 в квадрате 36px (`.big` — 44px). |
| `.pd-input` | `.pd-input` в `.pd-field` с `<label>` | Впадина `stone-800`, фокус — кольцо `focus`. |
| `.pd-classes` / `.pd-class` | + `.pd-class-face`, `.selected`, `.locked`, `.pd-class-info` | Лицо героя из `avatars.png` вместо иконки оружия. Имя класса — под рядом. |
| `#toast` | `#toast` или `.pd-toast` + `.good` / `.warn` / `.ally` / `.badge` | Рамка `chrome.png` TOAST. Место — под HUD. |
| `#overlay` | `#overlay.open` | Затемнение `scrim`, поля = safe-area + 8px. |
| HUD на canvas | `.pd-hud` | Разметка ниже. |
| панель на canvas | `.pd-toolbar` + `.pd-tool` | Разметка ниже. |
| строка лога на canvas | `.pd-log` + `.pd-log-line` | `PD.log(box, text, type)`. |

## Окна

### Окно предмета

```html
<div id="overlay" class="open">
  <section class="pd-window" role="dialog" aria-labelledby="item-title">
    <header class="pd-window-head">
      <div class="pd-slot"><i class="pd-item" data-i="20"></i><span class="pd-lvl up">+2</span></div>
      <div class="pd-titles"><h2 class="pd-heading" id="item-title">Пылающий меч <span class="pd-good">+2</span></h2></div>
      <button class="pd-close" aria-label="Закрыть"></button>
    </header>
    <p class="pd-info">Урон 9-22. Нужна сила 12.</p>
    <p class="pd-info">Удары этим оружием могут поджечь врага.</p>
    <p class="pd-callout bad">Слишком тяжело для вас: будете неуклюжи.</p>
    <div class="pd-actions">
      <button class="pd-button primary">Надеть</button>
      <div class="pd-row"><button class="pd-button">Бросить</button><button class="pd-button">…</button></div>
      <div class="pd-danger-zone"><button class="pd-button danger">Выбросить</button></div>
    </div>
  </section>
</div>
```

Действия раскладываются так: первое — `.primary`, остальные обычные по два в `.pd-row` (нечётное последнее — одно), «Выбросить» и «Продать» — в `.pd-danger-zone`. Шесть действий укладываются в 360×640.

### Рюкзак

```html
<section class="pd-window" role="dialog" aria-labelledby="bag-title">
  <header class="pd-bag-head">
    <h2 class="pd-heading" id="bag-title">Рюкзак</h2>
    <span class="pd-stat gold"><i class="pd-icon" style="width:16px;height:14px;background-image:var(--spr-coin)"></i>0</span>
    <span class="pd-stat"><span class="pd-stat-label">Сила</span>11</span>
    <button class="pd-close" aria-label="Закрыть"></button>
  </header>
  <div class="pd-equip">
    <button class="pd-slot equipped"><i class="pd-item" data-i="2"></i></button>   <!-- оружие -->
    <button class="pd-slot equipped"><i class="pd-item" data-i="24"></i></button>  <!-- доспех -->
    <div class="pd-slot placeholder"><i class="pd-item" data-i="7"></i></div>        <!-- пустое кольцо -->
    <div class="pd-slot placeholder"><i class="pd-item" data-i="7"></i></div>
  </div>
  <div class="pd-grid">
    <button class="pd-slot"><i class="pd-item" data-i="31"></i><span class="pd-qty">8</span><span class="pd-mark quick"></span></button>
    <!-- … до 20 ячеек; пустые: <div class="pd-slot empty"></div> -->
  </div>
  <div class="pd-bagrow-title"><span class="pd-note">В сумках и на связке ключей:</span></div>
  <div class="pd-bagrow"><button class="pd-slot"><i class="pd-item" data-i="88"></i><span class="pd-qty">2</span></button></div>
</section>
```

Пустые места экипировки показывают силуэт: 5 — оружие, 6 — доспех, 7 — кольцо. В режиме выбора предмета (кузнец, «бросить в…», «прочитать на…») неподходящие ячейки получают `.disabled`.

### Диалог с NPC: награды и ответы

```html
<section class="pd-window" role="dialog" aria-labelledby="npc">
  <header class="pd-npc-head">
    <div class="pd-portrait"><img src="ghost-frame.png" style="--w:14;--h:15" alt=""></div>
    <h2 class="pd-heading" id="npc">Грустный призрак</h2>
    <button class="pd-close" aria-label="Закрыть"></button>
  </header>
  <p class="pd-speech">…реплика…</p>
  <div class="pd-rewards">
    <div class="pd-reward">
      <div class="pd-slot"><i class="pd-item" data-i="21"></i><span class="pd-lvl up">+2</span></div>
      <div class="pd-reward-name">Длинный меч <span class="pd-good">+2</span></div>
      <div class="pd-reward-desc">Урон 9-29. Нужна сила 15.</div>
      <button class="pd-button small">Взять</button>
    </div>
  </div>
</section>
```

Портрет — первый кадр спрайта NPC, увеличенный ×3 (`--w`/`--h` — размер кадра). Если в диалоге нужен ответ «Да / Нет», вместо `.pd-rewards` поставьте `<div class="pd-row"><button class="pd-button quiet">Нет</button><button class="pd-button primary">Да</button></div>` и уберите крестик. В кооперативе карточку, которую забрал товарищ, пометьте `.taken`.

### Торговля

```html
<section class="pd-window" role="dialog">
  <header class="pd-window-head">
    <div class="pd-slot"><i class="pd-item" data-i="26"></i></div>
    <div class="pd-titles"><h2 class="pd-heading">Кольчуга</h2><span class="pd-price">270</span></div>
    <button class="pd-close" aria-label="Закрыть"></button>
  </header>
  <p class="pd-info">…описание…</p>
  <div class="pd-actions"><button class="pd-button primary">Купить</button></div>
  <p class="pd-note center">У вас 312 золота</p>
</section>
```

Если золота не хватает, цене добавьте `.short`, а кнопке — `disabled`. При продаже кнопки «Продать» — `.danger`, без основной.

### Кузнец

```html
<section class="pd-window">
  <header class="pd-npc-head">…портрет, «Тролль-кузнец», крестик…</header>
  <p class="pd-speech">…</p>
  <div class="pd-reforge">
    <button class="pd-slot selected"><i class="pd-item" data-i="20"></i></button>
    <span class="pd-reforge-arrow"></span>
    <button class="pd-slot empty" aria-label="Выбрать второй предмет"></button>
  </div>
  <div class="pd-actions"><button class="pd-button primary" disabled>Перековать</button></div>
</section>
```

Тап по пустой ячейке открывает рюкзак в режиме выбора. Кнопка включается, когда выбраны оба предмета.

### Окно героя

`.pd-window-head` с заголовком «Воин, уровень 1» и крестиком → `<dl class="pd-stats"><div><dt>Сила</dt><dd>11</dd></div>…</dl>` → подзаголовок «Состояние» → строки `<div class="pd-row"><span class="pd-buff"><i data-b="3"></i></span><span class="pd-info">Отравление</span></div>`. Если состояний нет — `<p class="pd-note">Ничего необычного.</p>`.

### Меню

`.pd-window.narrow` → шапка «Меню» + крестик → `.pd-menu-list`: `.pd-button.primary` «Продолжить», `.pd-button` «Справка», переключатели `<button class="pd-switch" role="switch" aria-checked="true"><span class="pd-info">Звук</span><span class="pd-switch-box"></span></button>`, ниже — «Главное меню».

### Справка

Шапка + крестик → вкладки `<div class="pd-tabs" role="tablist"><button class="pd-tab" role="tab" aria-selected="true">…</button>…</div>` → `<div class="pd-scroll" style="max-height:60vh">` с абзацами `.pd-info`. Прокручивается только текст внутри.

### «Осмотреть»

```html
<section class="pd-window">
  <header class="pd-examine-head">
    <div class="pd-portrait"><img src="rat-frame.png" style="--w:16;--h:15" alt=""></div>
    <div class="pd-titles"><h2 class="pd-heading">Крыса-мародёр</h2><div class="pd-bar" style="--v:.58"><span class="pd-bar-text">5/8</span></div></div>
    <button class="pd-close" aria-label="Закрыть"></button>
  </header>
  <p class="pd-info">…описание…</p>
  <div class="pd-buffs">…состояния монстра…</div>
</section>
```

Для места (клетки) полоски здоровья нет: в портрете — тайл, в заголовке — название.

### Табличка

`<div class="pd-sign"><p class="pd-info">…текст таблички…</p></div>` внутри `#overlay`. Без крестика, закрывается тапом в любом месте.

### Подтверждение

```html
<section class="pd-window narrow" role="alertdialog" aria-labelledby="q">
  <h2 class="pd-heading center" id="q">Прыгнуть в пропасть?</h2>
  <p class="pd-info center">…пояснение…</p>
  <div class="pd-row"><button class="pd-button quiet">Нет</button><button class="pd-button primary">Да</button></div>
</section>
```

Если действие необратимо и опасно, сделайте «Да» не `.primary`, а `.danger`.

### Конец забега

```html
<section class="pd-window pd-runend" role="dialog">   <!-- победа: pd-runend win -->
  <h2 class="pd-display">Вы погибли</h2>
  <p class="pd-cause">Убиты крысой-мародёром на глубине 3</p>
  <div class="pd-runend-hero"><div class="pd-avatar"><i style="--av:0"></i></div><div>…имя, класс, уровень…</div></div>
  <dl class="pd-stats">…<div><dt>Подземелье дня</dt><dd class="ally">12 из 214</dd></div></dl>
  <div class="pd-actions">
    <button class="pd-button primary">Поделиться</button>
    <button class="pd-button">Новая игра</button>
    <button class="pd-button quiet">Главное меню</button>
  </div>
</section>
```

### Рекорды дня

Шапка (заголовок, `.pd-note` с датой и числом героев, крестик) → `.pd-scroll` → `.pd-ranks` со строками `<div class="pd-rank"><span class="pd-rank-n">1</span><i class="pd-rank-face" style="--av:3"></i><span class="pd-rank-name">Ёжик<small>Охотница · глубина 9</small></span><span class="pd-rank-score">4 120</span></div>`. Своя строка — `.me`; первые три места выделены `gold-deep` автоматически.

### Значки

```html
<section class="pd-window" role="dialog">
  <header class="pd-window-head"><div class="pd-titles"><h2 class="pd-heading">Значки</h2><span class="pd-note">Получено 14 из 59</span></div><button class="pd-close" aria-label="Закрыть"></button></header>
  <div class="pd-scroll" style="max-height:400px">
    <div class="pd-grid c6">
      <button class="pd-slot selected"><i class="pd-badge" data-i="1"></i></button>
      <button class="pd-slot new"><i class="pd-badge" data-i="48"></i></button>
      <button class="pd-slot"><i class="pd-badge dim" data-i="2"></i></button>
    </div>
  </div>
  <div class="pd-badge-detail"><i class="pd-badge big" data-i="1"></i><span class="pd-badge-name">…название…</span><span class="pd-badge-desc">…описание…</span></div>
</section>
```

`data-i` — номер в `badges.png` (8 в ряд). Если выбран неполученный значок, добавьте `.pd-badge-detail.locked`: название станет приглушённым.

### Титульный экран

```html
<main class="pd-title-screen">
  <div class="pd-logo"><span class="pd-logo-kicker">TELEGRAM</span><img src="logo.png" alt="Pixel Dungeon"><span class="pd-logo-sub">кооперативное издание</span></div>
  <section class="pd-window">
    <div class="pd-classes" role="radiogroup" aria-label="Класс">
      <button class="pd-class selected" role="radio" aria-checked="true" aria-label="Воин"><i class="pd-class-face" style="--av:0"></i></button>
      <!-- Маг --av:1, Разбойник --av:2, Охотница --av:3 -->
    </div>
    <div class="pd-class-info"><span class="pd-class-name">Воин</span><p class="pd-note">…описание класса…</p></div>
    <div class="pd-field"><label for="name">Имя героя</label><input class="pd-input" id="name" placeholder="Имя героя"></div>
    <div class="pd-actions">
      <button class="pd-button primary big stacked">Продолжить<span class="pd-btn-sub">Воин, уровень 3 · глубина 4</span></button>
      <button class="pd-button">Новая игра</button>
      <button class="pd-button ally">Играть с друзьями</button>
    </div>
    <div class="pd-daily">
      <div class="pd-daily-head"><i class="pd-icon" style="background-image:var(--spr-stairs)"></i><h3>Подземелье дня</h3></div>
      <p class="pd-note">Сегодня у всех одно подземелье</p>
      <div class="pd-row"><button class="pd-button">Спуститься</button><button class="pd-button">Рекорды дня</button></div>
    </div>
  </section>
</main>
```

Если сохранения нет, «Продолжить» не показывается, а основной становится «Новая игра». Фон экрана задаётся через `--title-bg`. На экранах ниже 700px логотип уменьшается, а подпись логотипа, подпись поля и подпись блока дня скрываются — экран помещается в 360×640.

### Справка

```html
<section class="pd-window" role="dialog" aria-labelledby="help">
  <header class="pd-window-head"><div class="pd-titles"><h2 class="pd-heading" id="help">Справка</h2></div><button class="pd-close" aria-label="Закрыть"></button></header>
  <div class="pd-tabs" role="tablist">
    <button class="pd-tab" role="tab" aria-selected="true">Управление</button>
    <button class="pd-tab" role="tab" aria-selected="false">Советы</button>
  </div>
  <div class="pd-scroll" style="max-height:min(520px, 60vh)">
    <ul class="pd-tips">   <!-- вкладка «Советы»: class="pd-tips plain", без .pd-tip-ico -->
      <li class="pd-tip">
        <span class="pd-tip-ico"><i class="pd-icon" style="--w:12;--h:12;background-image:var(--spr-tool-wait)"></i></span>
        <p class="pd-info">Касание часов — пропустить ход. Удержание — отдых…</p>
      </li>
    </ul>
  </div>
</section>
```

Иконки строк: `--spr-target` (касание клетки), `--spr-tool-wait/-search/-info/-backpack`, `.pd-item` (быстрый слот), `--spr-menu`. `--w/--h` — размер кадра в пикселях спрайта.

### Строка состояния

```html
<header class="pd-hud">
  …
  <div class="pd-status target" role="status">
    <i class="pd-item" data-i="31" style="width:32px;height:32px"></i>
    <span class="pd-status-text">Выберите цель</span>
    <button class="pd-button small">Отмена</button>
  </div>
</header>
```

Остальные варианты: `.connecting` и `.reconnecting` с `<span class="pd-dots"><i></i><i></i><i></i></span>` вместо иконки; `.waiting` с `--spr-busy` и именами в `<span class="pd-ally">`; `.dead` с `--spr-skull`; `.examine` с `--spr-tool-info`. Когда режима нет — `hidden`. Кнопке «Осмотреть» на панели в этом режиме ставьте `aria-pressed="true"`.

### Выбор пути

```html
<section class="pd-window" role="dialog" aria-labelledby="way">
  <header class="pd-window-head">
    <div class="pd-slot"><i class="pd-item" data-i="82"></i></div>
    <div class="pd-titles"><h2 class="pd-heading" id="way">Какой путь выберете?</h2></div>
  </header>
  <div class="pd-choices">
    <div class="pd-choice">
      <span class="pd-choice-name">Гладиатор</span>
      <p class="pd-choice-desc">…2–3 строки…</p>
      <button class="pd-button small">Выбрать</button>
    </div>
    <div class="pd-choice">…Берсерк…</div>
  </div>
  <button class="pd-button quiet">Решу позже</button>
</section>
```

Крестика нет: закрывает окно «Решу позже». Если выбор надо подтвердить, отметьте карточку `.chosen`, а её кнопку сделайте `.primary`.

### Загрузка и ошибка соединения

```html
<main class="pd-loading" aria-busy="true">
  <div class="pd-logo">…</div>
  <div class="pd-runner" aria-hidden="true"></div>
  <div class="pd-progress" style="--v:.62" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="62"></div>
  <p class="pd-loading-text">Загрузка спрайтов… 62%</p>
  <p class="pd-loading-tip"><b>Совет:</b> …</p>
</main>

<div id="overlay" class="open">
  <section class="pd-window narrow" role="alertdialog" aria-labelledby="err">
    <div class="pd-error-icon" aria-hidden="true"></div>
    <h2 class="pd-heading center" id="err">Нет соединения</h2>
    <p class="pd-info center">…</p>
    <button class="pd-button primary">Повторить</button>
    <p class="pd-note center">Повторим сами через 5&nbsp;с · код&nbsp;1006</p>
  </section>
</div>
```

`.pd-runner` берёт кадры из `--atlas-warrior`. Чтобы бежал другой герой, переопределите переменную. Обновляйте `--v` не чаще одного раза за кадр: полоса заполняется сегментами по 8 пикселей сетки.

### Новые классы

| Класс | Что это |
| --- | --- |
| `.pd-tips`, `.pd-tips.plain`, `.pd-tip`, `.pd-tip-ico` | список справки |
| `.pd-status` + `.connecting` / `.reconnecting` / `.waiting` / `.target` / `.dead` / `.examine`, `.pd-status-text`, `.pd-dots` | строка состояния |
| `.pd-tool[aria-pressed="true"]`, `.pd-tool.active` | включённый режим «Осмотреть» |
| `.pd-choices`, `.pd-choice`, `.pd-choice-name`, `.pd-choice-desc`, `.chosen` | выбор пути |
| `.pd-loading`, `.pd-runner`, `.pd-progress`, `.pd-loading-text`, `.pd-loading-tip`, `.pd-error-icon` | загрузка и ошибка |

### Прочность

```html
<!-- ячейка: полоска последним ребёнком; у сломанной — .broken -->
<button class="pd-slot broken">
  <i class="pd-item" data-i="50"></i><span class="pd-lvl up">+1</span><span class="pd-qty">2/5</span>
  <i class="pd-dur broken" style="--v:0"></i>
</button>

<!-- окно предмета: под строкой характеристик -->
<header class="pd-window-head">… <h2 class="pd-heading">Пылающий меч <span class="pd-lvl-broken">+2</span></h2> …</header>
<p class="pd-info">Урон 6-15. Нужна сила 12.</p>
<div class="pd-durability">                    <!-- .low при ≤ 25% -->
  <p class="pd-info">Прочность: 0 из 84</p>
  <i class="pd-dur big broken" style="--v:0"></i>
</div>
<p class="pd-callout broken">Сломано: работает, как будто его не улучшали…</p>
```

`PD.durability(el, cur, max)` ставит `--v` и классы сам. Временную полоску у нижнего края и оранжевый «+2» замените этим: полоска та же по месту, но цифры поднимаются над ней, а уровень сломанной вещи гаснет и перечёркивается.

| Класс | Что это |
| --- | --- |
| `.pd-dur`, `.low`, `.broken`, `.big` | полоска прочности на ячейке и в окне |
| `.pd-slot.broken`, `.pd-tool.broken`, `.has-dur` | сломанная вещь; запасной класс вместо `:has()` |
| `.pd-lvl-broken` | перечёркнутый уровень в заголовке |
| `.pd-durability`, `.low` | строка «Прочность: …» с полоской в окне предмета |
| `.pd-callout.broken` | плашка «Сломано: …» |

### Пиксель-Март

```html
<section class="pd-window" role="dialog" aria-label="Пиксель-Март">
  <header class="pd-window-head">
    <div class="pd-portrait"><i class="keeper" style="--keeper:url(shopkeeper.png)"></i></div>
    <div class="pd-titles"><h2 class="pd-heading">Пиксель-Март</h2><span class="pd-note">Безопасная жизнь в подземелье.</span></div>
    <button class="pd-close" aria-label="Закрыть"></button>
  </header>
  <div class="pd-tabs compact" role="tablist">
    <button class="pd-tab" role="tab" aria-selected="true">Облики</button>
    <button class="pd-tab" role="tab" aria-selected="false">Эффекты</button>
    <button class="pd-tab" role="tab" aria-selected="false">Рамки</button>
    <button class="pd-tab" role="tab" aria-selected="false"><i class="pd-icon" style="background-image:var(--spr-patron)"></i>Покровитель</button>
  </div>
  <div class="pd-scroll" style="max-height:min(560px, 70vh)">
    <div class="pd-shop-grid">
      <article class="pd-offer">                      <!-- .owned / .worn / .badge / .offseason -->
        <div class="pd-offer-art"><canvas></canvas></div>  <!-- превью; чип .pd-chip / .pd-chip.season и замок .pd-offer-lock — тоже сюда -->
        <h3 class="pd-offer-name">Королевский</h3>
        <p class="pd-offer-meta"><span class="pd-stars small">75</span></p>
        <button class="pd-button small">Купить</button>
      </article>
    </div>
  </div>
</section>
```

| Состояние | `.pd-offer-meta` | Кнопка |
| --- | --- | --- |
| можно купить | `<span class="pd-stars small">75</span>` | `.pd-button.small` «Купить» |
| `.owned` | «Куплено» | «Надеть» |
| `.worn` + чип «Надето» | класс героя | `.quiet` «Снять» |
| `.badge` + `.pd-offer-lock` | `<i class="pd-offer-badge" data-i="22"></i>За значок «…»` | нет; вместо неё `<p class="pd-offer-cond">условие</p>` |
| в сезон | цена; чип `<span class="pd-chip season">до 31 дек.</span>` | «Купить» |
| `.offseason` | «Вернётся зимой»; чип `.pd-chip.season` «Зима» | `disabled` «Не в сезон» |

Окно товара: шапка с названием и «Облик воина», `.pd-offer-hero` с canvas бега, `.pd-tiers` — семь canvas уровней брони с подписями, описание, `.pd-actions` с основной «Купить за <span class="pd-stars">75</span>» и `.pd-note` «Оплата звёздами Telegram».

### Покровитель

```html
<section class="pd-window" role="dialog" aria-labelledby="pt">
  <header class="pd-window-head">
    <i class="pd-patron-big"></i>
    <div class="pd-titles"><h2 class="pd-heading" id="pt">Покровитель</h2><span class="pd-note">Подписка на месяц</span></div>   <!-- активна: <span class="pd-chip active">Активна до 12 ноября</span> -->
    <button class="pd-close" aria-label="Закрыть"></button>
  </header>
  <ul class="pd-perks">
    <li class="pd-perk"><span class="pd-perk-ico"><i class="pd-patron-mark"></i></span><p class="pd-info">Звезда у имени…</p></li>
    <li class="pd-perk"><span class="pd-perk-ico"><i class="pd-perk-frame"></i></span><p class="pd-info">Рамка портрета «Покровитель»</p></li>
    <li class="pd-perk"><span class="pd-perk-ico"><i class="pd-offer-badge patron"></i></span><p class="pd-info">Значок «Меценат» в коллекции</p></li>
  </ul>
  <div class="pd-price-row"><span class="pd-stars">99</span><span class="pd-note">в месяц</span></div>
  <div class="pd-actions"><button class="pd-button primary">Оформить за <span class="pd-stars">99</span></button></div>
  <p class="pd-note center">Оплата звёздами Telegram…</p>
</section>
```

В активном состоянии уберите `.pd-price-row` и `.pd-actions`, вместо них — `.pd-note` с датой продления и `.pd-button.quiet` «Управлять подпиской».

### Звезда, рамки, облик

```html
<!-- рекорды -->  <span class="pd-rank-name">Ёжик<i class="pd-patron-mark"></i><small>…</small></span>   <!-- строке — .pd-rank.patron -->
<!-- отряд -->    <span class="pd-mate-name"><i class="pd-patron-mark sm"></i>Лиса</span>
<!-- рамка -->    <div class="pd-avatar framed frame-gold"><i style="--av:0"></i></div>   <!-- frame-bronze | frame-gold | frame-shadow | frame-patron -->
```

Над головой на карте: `PD.fx.nameplate(ctx, 'Лиса', spriteCenterX, spriteTopY, { ally: true, patron: true })` — имя Galmuri9 15px с обводкой, звезда слева. Своему герою имя не рисуйте.

Облик героя: загрузите лист `warrior-royal.png` (и т. п.) вместо `warrior.png`; кадры и уровни брони те же, менять код анимации не нужно.

Ряд «Облик» в окне героя:

```html
<h3 class="pd-subhead">Облик</h3>
<div class="pd-looks">
  <button class="pd-look" aria-expanded="true"><span class="pd-look-art">…</span><span class="pd-look-label">Облик</span><span class="pd-look-value">Королевский</span></button>
  <div class="pd-look-picker">
    <button class="pd-look-opt" aria-label="Обычный">…</button>
    <button class="pd-look-opt on" aria-label="Королевский, надет">…</button>
    <button class="pd-look-opt shop" aria-label="Теневой, купить за 75 звёзд">…<span class="pd-stars small">75</span></button>
  </div>
  <button class="pd-look"><span class="pd-look-art">…</span><span class="pd-look-label">Эффект</span><span class="pd-look-value">Светлячки</span></button>
  <button class="pd-look"><span class="pd-look-art">…</span><span class="pd-look-label">Рамка</span><span class="pd-look-value">Золото</span></button>
</div>
```

| Класс | Что это |
| --- | --- |
| `.pd-tabs.compact` | вкладки с подписями 15px — четыре помещаются на 360 |
| `.pd-shop-grid`, `.pd-offer` + `.owned` / `.worn` / `.badge` / `.offseason`, `.pd-offer-art`, `-name`, `-meta`, `-cond`, `-lock`, `-badge` | карточка товара |
| `.pd-stars`, `.small` | цена в звёздах |
| `.pd-chip.season`, `.pd-chip.active` | сезон, активная подписка |
| `.pd-offer-hero`, `.pd-tiers` | окно товара |
| `.pd-patron-big`, `.pd-patron-mark`, `.sm`, `.pd-perks`, `.pd-perk`, `.pd-perk-ico`, `.pd-perk-frame`, `.pd-price-row` | подписка и звезда |
| `.pd-avatar.framed.frame-*` | рамки портрета |
| `.pd-subhead`, `.pd-looks`, `.pd-look`, `.pd-look-picker`, `.pd-look-opt` + `.on` / `.shop` | ряд «Облик» |
| `.keeper` | портрет лавочника из `shopkeeper.png` |

## Игровой экран

### HUD

```html
<header class="pd-hud">
  <div class="pd-hud-main">
    <div class="pd-avatar-wrap"><button class="pd-avatar" aria-label="Герой"><i style="--av:0"></i></button><span class="pd-hero-lvl">3</span></div>
    <div class="pd-hud-bars">
      <div class="pd-bar" style="--v:.75"><span class="pd-bar-text">18/24</span></div>   <!-- .low при ≤ 25%, .poisoned -->
      <div class="pd-bars-small">
        <div class="pd-bar-pair"><i class="pd-icon" style="background-image:var(--spr-star)"></i><div class="pd-bar thin xp" style="--v:.4"></div></div>
        <div class="pd-bar-pair"><i class="pd-icon" style="background-image:var(--spr-food)"></i><div class="pd-bar thin food" style="--v:.7"></div></div>  <!-- .hungry / .starving -->
      </div>
    </div>
    <div class="pd-hud-side">
      <span class="pd-stat"><i class="pd-icon" style="background-image:var(--spr-depth)"></i>1</span>
      <span class="pd-stat"><i class="pd-icon" style="width:14px;height:18px;background-image:var(--spr-key)"></i>1</span>
    </div>
    <button class="pd-menu" aria-label="Меню"></button>
  </div>
  <div class="pd-buffs"><button class="pd-buff" aria-label="Отравление"><i data-b="3"></i></button></div>
  <div class="pd-mates">   <!-- только в кооперативе -->
    <button class="pd-mate"><i class="pd-mate-face" style="--av:1"></i><span class="pd-mate-name">Лиса</span><div class="pd-bar" style="--v:.8"></div><span class="pd-mate-depth">1</span></button>
    <!-- .away — на другой глубине, .dead — погиб -->
  </div>
</header>
```

`--av` у `.pd-mate-face` и `.pd-rank-face` — номер героя в полосе `heroes` (0 — воин, 1 — маг, 2 — разбойник, 3 — охотница). У `.pd-avatar` и `.pd-class-face` — номер в `avatars.png`.

### Лог

```html
<button class="pd-log" aria-label="История сообщений">
  <div class="pd-log-line" data-age="2">…</div>
  <div class="pd-log-line good" data-age="1">…</div>
  <div class="pd-log-line bad" data-age="0">…<span class="pd-n">×2</span></div>
  <span class="pd-log-more">История</span>
</button>
```

`PD.log(box, text, type)` сам держит 4 строки, проставляет `data-age`, склеивает повторы в «×N» и гасит строку через 8 секунд. Окно истории — `.pd-window` с `.pd-scroll > .pd-history`, разделители глубин — `.pd-depth-mark`.

### Панель инструментов

```html
<nav class="pd-toolbar" aria-label="Действия">
  <button class="pd-tool" aria-label="Ждать"><i class="pd-icon" style="--w:12;--h:12;background-image:var(--spr-tool-wait)"></i></button>
  <button class="pd-tool" aria-label="Искать"><i class="pd-icon" style="--w:12;--h:12;background-image:var(--spr-tool-search)"></i></button>
  <button class="pd-tool" aria-label="Осмотреть"><i class="pd-icon" style="--w:8;--h:12;background-image:var(--spr-tool-info)"></i></button>
  <button class="pd-tool quick" aria-label="Быстрый слот"><i class="pd-item" data-i="31"></i><span class="pd-qty">8</span></button>
  <button class="pd-tool bag" aria-label="Рюкзак"><i class="pd-icon" style="--w:14;--h:15;background-image:var(--spr-tool-backpack)"></i></button>
</nav>
```

`PD.holdToRest(btn, onWait, onRest)` — короткое нажатие «Ждать» тратит ход, удержание 600 мс включает отдых (`.resting`). Состояния быстрого слота: `.empty` — пуст, `.targeting` — выбирается цель. `.bag.alert` — в рюкзаке новый предмет. Когда ходит товарищ, кнопки получают `disabled`.

### Toast

`<div id="toast" class="good"><i class="pd-item" data-i="61"></i>Зелье добавлено в быстрый слот</div>` или `PD.toast(el, html, type)`. Для нового значка — `class="badge"` с `<i class="pd-badge" data-i="…">` и `<b>` с названием.

### Кнопки карты

```html
<div class="pd-mapctl">
  <button class="pd-mapbtn hero" aria-label="К герою"></button>   <!-- только когда карту сдвинули -->
  <button class="pd-mapbtn in" aria-label="Приблизить"></button>
  <button class="pd-mapbtn out" aria-label="Отдалить" disabled></button> <!-- на пределе масштаба -->
  <button class="pd-mapbtn all" aria-label="Вся карта"></button>
</div>
```

Блок кладётся внутрь игрового экрана рядом с `.pd-log`. Отступ снизу считается от `--tool-h` и `--log-h`. Если лог в вашей вёрстке выше 120px, задайте `--log-h`. Значки берутся из `--spr-map-in/out/all/hero` в `bundle.css` (это `ui-map.png`, строка `map-buttons`). `.pressed` — то же, что `:active`, для нажатия с клавиатуры.

### Тосты находок

```html
<div class="pd-finds"></div>
```

```js
PD.find(box, 'gold', '<i class="pd-item" data-i="14"></i><span>Золото</span>');
PD.find(box, 'potion-heal', '<i class="pd-item" data-i="57"></i><span>Зелье исцеления</span>');
PD.find(box, 'ring-' + id, '<i class="pd-item" data-i="72"></i><span>Кольцо ясности</span>', { type: 'good' });
```

Ключ склеивает повторы: если та же вещь пришла снова, пока тост виден, он показывает «×N» и не уходит. Параметры: `ttl` (2400 мс), `max` (3), `type: 'good'` — для опознанной или редкой вещи. Полное название и количество по-прежнему пишутся в лог.

### Новые классы — живой мир

| Класс | Что это |
| --- | --- |
| `.pd-mapctl` | столбик кнопок карты справа над логом |
| `.pd-mapbtn.in` / `.out` / `.all` / `.hero` | кнопка 44×44 со значком 12×12 ×2; `.pressed`, `:disabled` |
| `.pd-finds` | стопка тостов находок справа под HUD |
| `.pd-find`, `.pd-find.good`, `[data-age]`, `.gone` | тост «+ иконка + название», `<b>` — счётчик «×N» |


### Кнопка настроек на титуле

```html
<div class="pd-corner"><button class="pd-iconbtn prefs" aria-label="Настройки"></button></div>
```

Блок кладётся внутрь `.pd-title-screen`, сразу перед `.pd-logo`. Кнопка «Испытания» встаёт в ряд к «Новой игре»:

```html
<div class="pd-row">
  <button class="pd-button">Новая игра</button>
  <button class="pd-button"><i class="pd-icon" style="width:24px;height:24px;background-image:var(--spr-challenge-on)"></i>Испытания<b class="pd-ch-n">2</b></button>
</div>
```

Если не включено ни одного испытания — `--spr-challenge-off` и без `.pd-ch-n`. До первой победы кнопка тоже есть: она открывает окно с замком.

### Настройки

```html
<section class="pd-window settings" role="dialog" aria-label="Настройки">
  <div class="pd-window-head"><div class="pd-titles"><h2 class="pd-heading">Настройки</h2></div><button class="pd-close" aria-label="Закрыть"></button></div>
  <div class="pd-scroll pd-settings">
    <div class="pd-col">
      <section class="pd-set-group"><h3 class="pd-set-head">Звук</h3>
        <div class="pd-set-row">
          <span class="pd-set-label"><span class="pd-info">Музыка</span><span class="pd-set-value">60%</span></span>
          <div class="pd-steps" role="slider" aria-label="Музыка" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60">
            <button class="pd-step on" aria-label="Музыка 20%"></button> … пять кнопок
          </div>
        </div>
        … «Звуки» так же
        <button class="pd-switch" role="switch" aria-checked="true"><span class="pd-set-label"><span class="pd-info">Вибрация</span><span class="pd-set-value">При ударах и находках</span></span><span class="pd-switch-box"></span></button>
      </section>
      <section class="pd-set-group"><h3 class="pd-set-head">Игра</h3>
        <div class="pd-set-row stack"><span class="pd-info">Эффекты</span>
          <div class="pd-seg" role="radiogroup"><button class="pd-seg-opt" role="radio" data-v="auto" aria-checked="true">Авто</button><button class="pd-seg-opt" role="radio" data-v="full" aria-checked="false">Полные</button><button class="pd-seg-opt" role="radio" data-v="light" aria-checked="false">Лёгкие</button></div>
          <p class="pd-note">Полные, пока телефон успевает.</p>
        </div>
        <button class="pd-switch" role="switch" aria-checked="false"><span class="pd-set-label"><span class="pd-info">Во весь экран</span></span><span class="pd-switch-box"></span></button>
        <div class="pd-set-row"><span class="pd-info">Язык</span><div class="pd-seg inline" role="radiogroup"><button class="pd-seg-opt" data-v="ru" aria-checked="true">Русский</button><button class="pd-seg-opt" data-v="en" aria-checked="false">English</button></div></div>
      </section>
    </div>
    <div class="pd-col">
      <section class="pd-set-group"><h3 class="pd-set-head">Ещё</h3>
        <button class="pd-linkrow"><span>Об игре</span></button>
        <button class="pd-linkrow ext"><span>Конфиденциальность</span></button>
        <button class="pd-linkrow ext"><span>Условия</span></button>
      </section>
      <section class="pd-set-group danger"><button class="pd-button danger">Сбросить данные</button></section>
    </div>
  </div>
</section>
```

```js
PD.steps(musicRow, () => audio.musicVolume, (v) => audio.setMusicVolume(v));   // вернёт paint() для обновления извне
PD.seg(fxSeg, quality.mode, (v) => quality.set(v));                            // 'auto' | 'full' | 'light'
PD.seg(langSeg, lang, (v) => setLanguage(v));
```

Что поменять в `screens.ts`:

- `volumeRow` с `.pd-volume`/`.pd-volume-step` (шаги 12×20 px) замените на `.pd-steps`/`.pd-step` — у каждого шага цель 44×44.
- Выключатель «Звук» больше не нужен: ноль громкости — это касание единственной горящей первой ступени.
- Переключатель «Эффекты» вкл/выкл замените на `.pd-seg` с тремя вариантами из `quality.ts`.
- `.pd-col` на телефоне — `display: contents`, колонки появляются только на широком экране.

Язык по умолчанию берётся из Telegram (как сейчас в `i18n.ts`), выбор в настройках его перекрывает. Пояснение под эффектами меняется вместе с выбором: «Полные, пока телефон успевает» / «Частицы, свет, виньетка, тряска» / «Меньше частиц, без света и виньетки».

### Сброс данных

```html
<section class="pd-window narrow" role="alertdialog" aria-labelledby="rq">
  <h2 class="pd-heading center" id="rq">Сбросить данные?</h2>
  <p class="pd-info center">С этого устройства сотрутся сохранённый забег, герои, значки, рекорды и настройки. Вернуть их нельзя.</p>
  <p class="pd-note center">Покупки Пиксель-Марта и подписка хранятся на сервере и останутся.</p>
  <div class="pd-actions"><button class="pd-button danger">Стереть всё</button><button class="pd-button quiet">Отмена</button></div>
</section>
```

Фокус при открытии — на «Отмене».

### Об игре

```html
<section class="pd-window" role="dialog" aria-label="Об игре">
  …шапка с крестиком…
  <div class="pd-scroll pd-about">
    <div class="pd-about-logo"><img src="assets/banner-title.png" alt="Pixel Dungeon"><span class="pd-logo-sub">кооперативное издание</span><span class="pd-set-value">по Pixel Dungeon 1.9.2a</span><span class="pd-build">Сборка b3882db · 12.10.2026</span></div>
    <dl class="pd-credits">
      <div class="pd-credit"><dt>Оригинальная игра, графика и звуки</dt><dd>Watabou<small>Олег Доля</small></dd></div>
      <div class="pd-credit"><dt>Музыка оригинала</dt><dd>Cube_Code</dd></div>
      <div class="pd-credit"><dt>Шрифт Galmuri</dt><dd>Minseo Lee<small>SIL OFL 1.1</small></dd></div>
      <div class="pd-credit"><dt>Порт для Telegram, кооператив, музыка регионов</dt><dd>…</dd></div>
    </dl>
    <div><a class="pd-linkrow ext" href="https://github.com/shiba-vibecoding/pixel-dungeon-telegram"><span>Исходный код (GPL-3.0)<small>github.com/shiba-vibecoding/pixel-dungeon-telegram</small></span></a>
         <a class="pd-linkrow ext" href="http://pixeldungeon.watabou.ru"><span>Сайт оригинала<small>pixeldungeon.watabou.ru</small></span></a></div>
    <p class="pd-legal">Неофициальный порт. Pixel Dungeon © Watabou, распространяется по GPL-3.0; этот порт — тоже.</p>
  </div>
</section>
```

Строку сборки задайте при сборке, например `define: { __BUILD__: … }` в Vite с хешем коммита и датой. Ссылки открывайте через `Telegram.WebApp.openLink`. Имя в строке «Порт» впишите своё.

### Испытания

```html
<div class="pd-challenges">            <!-- .locked до первой победы, тогда сверху <p class="pd-lockplate"><span>Откроются после <b>первой победы</b> …</span></p> -->
  <button class="pd-challenge" role="switch" aria-checked="true">
    <i class="pd-ch-icon" style="--c:0"></i>
    <span class="pd-ch-text"><span class="pd-ch-name">На диете</span><span class="pd-ch-desc">Еда не встречается — на её месте золото.</span></span>
    <span class="pd-switch-box"></span>
  </button>
  …
</div>
```

`--c` — номер в `challenges.png`: 0 NO_FOOD, 1 NO_ARMOR, 2 NO_HEALING, 3 NO_HERBALISM, 4 SWARM_INTELLIGENCE, 5 DARKNESS, 6 NO_SCROLLS (маски 1, 2, 4, …, 64, как в оригинале). В закрытом списке поставьте кнопкам `aria-disabled="true"`, переключатель сам заменится замком. Число включённых пишется в подзаголовке окна: «Включено: 2 из 7».

### Журнал и каталог

```html
<section class="pd-window wide" role="dialog" aria-label="Журнал">
  …шапка…
  <div class="pd-tabs" role="tablist"><button class="pd-tab" role="tab" aria-selected="true">Отметки</button><button class="pd-tab" role="tab" aria-selected="false">Каталог</button></div>
  <div class="pd-scroll">
    <div class="pd-journal">
      <button class="pd-jrow here"><i class="pd-jicon" style="--j:5"></i><span class="pd-jname">Сад</span><span class="pd-jdepth">6</span></button>
      …
    </div>
  </div>
</section>
```

Номер `--j` в `journal.png` совпадает с порядком `Journal.Feature` оригинала:

| `--j` | Отметка |
| --- | --- |
| 0 | WELL_OF_HEALTH |
| 1 | WELL_OF_AWARENESS |
| 2 | WELL_OF_TRANSMUTATION |
| 3 | SACRIFICIAL_FIRE |
| 4 | ALCHEMY |
| 5 | GARDEN |
| 6 | STATUE |
| 7 | GHOST |
| 8 | WANDMAKER |
| 9 | TROLL |
| 10 | IMP |

`.here` — отметка текущей глубины (в оригинале она тоже подсвечена), `.done` — квест выполнен. Пустой журнал — `.pd-empty`.

Каталог:

```html
<div class="pd-tabs compact" role="tablist"><button class="pd-tab" role="tab" aria-selected="true">Зелья</button>…Свитки, Кольца, Палочки</div>
<div class="pd-cat-count">Известно 6 из 12</div>
<div class="pd-grid pd-catalog" role="listbox">
  <button class="pd-slot" role="option" aria-label="Зелье Исцеления"><i class="pd-item" data-i="57"></i></button>
  <button class="pd-slot unknown" role="option" aria-label="Зелье Холода"><i class="pd-item silhouette" data-i="56"></i></button>
</div>
<div class="pd-cat-detail unknown"><i class="pd-item silhouette" data-i="56"></i><span><b>Зелье Холода</b><small>Ещё не опознано</small></span></div>
```

Опознанная вещь показана своим спрайтом из этого забега. Неопознанная — силуэтом общей формы вида (зелье — 56, свиток — 40, кольцо — 72, палочка — 68), без цвета, ведь цвет ещё ничего не значит. Касание опознанной вещи открывает окно вещи; касание неопознанной только показывает имя. Журнал открывается из меню в игре, кнопкой «Журнал» рядом со «Справкой».

### Новые классы — меню и титул

| Класс | Что это |
| --- | --- |
| `.pd-corner`, `.pd-iconbtn.prefs` | угол титула и кнопка-иконка 44×44 без подложки |
| `.pd-window.settings`, `.pd-settings`, `.pd-col` | окно настроек; две колонки от 880 px |
| `.pd-set-group`, `.pd-set-head`, `.pd-set-row(.stack)`, `.pd-set-label`, `.pd-set-value` | группы и строки настроек |
| `.pd-steps`, `.pd-step.on` | громкость пятью шагами 44×44 |
| `.pd-seg(.inline)`, `.pd-seg-opt[aria-checked]` | выбор одного из вариантов |
| `.pd-linkrow(.ext)` | строка-ссылка на всю ширину |
| `.pd-about`, `.pd-about-logo`, `.pd-build`, `.pd-credits`, `.pd-credit`, `.pd-legal` | «Об игре» |
| `.pd-challenges(.locked)`, `.pd-challenge`, `.pd-ch-icon`, `.pd-lockplate`, `.pd-ch-n` | «Испытания» |
| `.pd-window.wide`, `.pd-journal`, `.pd-jrow(.here/.done)`, `.pd-jicon`, `.pd-empty` | «Журнал» |
| `.pd-catalog`, `.pd-slot.unknown`, `.pd-item.silhouette`, `.pd-cat-detail`, `.pd-cat-count` | «Каталог» |

### Рюкзак одним окном

```html
<section class="pd-window bag" role="dialog" aria-labelledby="bag-t">          <!-- .targeting в режиме выбора цели -->
  <header class="pd-bag-head"><h2 class="pd-heading" id="bag-t">Рюкзак</h2><span class="pd-stat gold">…132</span><span class="pd-stat"><span class="pd-stat-label">Сила</span>11</span><button class="pd-close" aria-label="Закрыть"></button></header>
  <div class="pd-tabs compact pd-bag-filter" role="tablist">
    <button class="pd-tab" role="tab" aria-selected="true">Всё</button><button class="pd-tab" role="tab" aria-selected="false">Зелья</button>
    <button class="pd-tab" role="tab" aria-selected="false">Свитки</button><button class="pd-tab" role="tab" aria-selected="false">Снаряжение</button>
  </div>
  <!-- режим цели вместо фильтров: <div class="pd-bag-target" role="status"><i class="pd-item" data-i="44"></i><span>Что улучшить?</span><button class="pd-button quiet">Отмена</button></div> -->
  <div class="pd-bag-body">
    <div class="pd-bag-side">
      <div class="pd-bag-equip">
        <button class="pd-slot equipped" aria-label="Короткий меч +1"><i class="pd-item" data-i="2"></i><span class="pd-lvl up">+1</span></button>
        <button class="pd-slot equipped">…броня</button><button class="pd-slot equipped">…кольцо</button>
        <div class="pd-slot placeholder"><i class="pd-item" data-i="7"></i></div>
        <button class="pd-slot keys" aria-label="Ключи: 2"><i class="pd-icon" style="background-image:var(--spr-keyring)"></i><span class="pd-qty">2</span></button>
      </div>
      <div class="pd-bag-grid">
        <button class="pd-slot selected"><i class="pd-item" data-i="57"></i><span class="pd-qty">2</span></button>
        <button class="pd-slot dim">…</button>      <!-- не подходит под фильтр или цель -->
        <div class="pd-slot empty"></div>            <!-- всего 20 -->
      </div>
    </div>
    <div class="pd-pick" aria-live="polite">
      <div class="pd-pick-head">
        <div class="pd-slot"><i class="pd-item" data-i="57"></i></div>
        <div class="pd-titles"><h3 class="pd-heading">Зелье Исцеления</h3><!-- <span class="pd-chip">надето</span> --></div>
        <button class="pd-button danger pd-pick-dropbtn">Выбросить</button>
      </div>
      <p class="pd-info">Полностью восстанавливает здоровье и смывает слизь.</p>
      <!-- <p class="pd-callout cursed">…</p> / <p class="pd-callout bad">…</p> -->
      <div class="pd-pick-actions">
        <button class="pd-button primary stacked">Выпить<span class="pd-btn-sub">или удерживайте ячейку</span></button>
        <button class="pd-button">Метнуть</button><button class="pd-button">Быстрый слот</button>
      </div>
    </div>
  </div>
</section>
```

- **Ничего не выбрано:**

  ```html
  <div class="pd-pick empty">
    <p class="pd-info">Коснитесь предмета…</p>
    <div class="pd-hold-hint"><span class="pd-hold-demo"><span class="pd-hold-label">Выпить</span><span class="pd-slot holding"><i class="pd-item" data-i="57"></i></span></span><span><b>Удерживайте ячейку</b> — быстрое действие…</span></div>
  </div>
  ```

- **Удержание:** через 400 мс ячейка получает `.holding`, над ней появляется `.pd-hold-label` с названием действия. Отпустили — действие выполняется и окно закрывается. Если увели палец с ячейки, действие отменяется. Короткое касание только выбирает.
- **Кнопки по числу действий.** Главное действие — `.primary` на всю ширину. Остальные идут по две в ряд; если их нечётное число, последняя получает `.wide`. У известного проклятого предмета `.primary` нет.
- **Фильтр** ставит `.dim` на ячейки других типов; сетка не перестраивается. «Снаряжение» — оружие, броня, кольца, палочки, метательное. Еда, бомбы, семена и фляга видны только во «Всём».
- **Цель:** окну ставится `.targeting`, полоса `.pd-bag-target` встаёт вместо фильтров, подходящим ячейкам — `.can`, остальным — `.dim` (они не нажимаются). «Отмена» по правилам оригинала спрашивает подтверждение: свиток всё равно сгорит.
- **Подписи кнопок.** «В быстрый слот» в ряду по две на 360 px не помещается, в рюкзаке пишите «Быстрый слот». Для английского — «Quickslot».

| Класс | Что это |
| --- | --- |
| `.pd-window.bag(.targeting)` | рюкзак одним окном |
| `.pd-bag-filter`, `.pd-bag-target` | фильтры; полоса выбора цели |
| `.pd-bag-body`, `.pd-bag-side`, `.pd-bag-equip`, `.pd-bag-grid` | раскладка; ряд надетого и сетка с ячейками `--cell` |
| `.pd-slot.dim`, `.pd-slot.can`, `.pd-slot.holding`, `.pd-slot.keys` | тусклая, подходящая для цели, удерживаемая, связка ключей |
| `.pd-pick(.empty)`, `.pd-pick-head`, `.pd-pick-dropbtn`, `.pd-pick-actions` (`.wide`) | панель выбранного предмета |
| `.pd-hold-hint`, `.pd-hold-demo`, `.pd-hold-label` | подсказка и подпись удержания |

## Игровой экран на мониторе

### Когда включать

```ts
const W = innerWidth, H = innerHeight;               // CSS px
const wide = W >= 900;                                // ниже — телефонная раскладка без изменений
const ui = Math.max(1, Math.min(4, Math.floor(H / 720), Math.floor(W / 1100)));
const baseZoom = Math.max(2, Math.min(Math.round(W / 448), Math.floor(H / 208)));   // масштаб тайла
root.classList.toggle('pd-wide', wide);
layer.style.setProperty('--ui', String(wide ? ui : 1));
```

Масштаб карты, который выбрал игрок, храните как сдвиг от `baseZoom` (+1, −1), а не как число. Так при смене монитора или окна карта останется «чуть ближе обычного», а не станет крошечной или огромной. В `main.ts` это уже сделано (коммит e4c3a28), здесь только формула для базы.

### Разметка

Весь интерфейс лежит в одном слое поверх canvas. Слой рисуется в размере `W/ui × H/ui` и увеличивается `transform: scale(ui)`. Координаты мыши в слое делите на `ui`.

```html
<canvas id="game"></canvas>
<div class="pd-ui pd-wide" style="--ui:1">
  <div class="pd-dcol">
    <header class="pd-dpanel pd-dhud">
      <div class="pd-hud-main">
        <div class="pd-avatar-wrap"><button class="pd-avatar" aria-label="Герой"><i style="--av:0"></i></button><span class="pd-hero-lvl">3</span></div>
        <div class="pd-hud-bars">
          <div class="pd-bar" style="--v:.75"><span class="pd-bar-text">18/24</span></div>
          <div class="pd-bars-small">…опыт и сытость, как в HUD телефона…</div>
        </div>
        <div class="pd-hud-side"><span class="pd-stat">…глубина</span><span class="pd-stat">…ключи</span></div>
      </div>
      <div class="pd-buffs">…</div>
    </header>
    <section class="pd-party" aria-label="Отряд">
      <button class="pd-pcard turn"><i class="pd-mate-face" style="--av:1"></i><span class="pd-mate-name">Лиса</span><span class="pd-mate-depth">3</span><div class="pd-bar" style="--v:.8"></div><span class="pd-pstate">ходит…</span></button>
      <button class="pd-pcard away">…<span class="pd-pstate">на глубине 4</span></button>
    </section>
    <p class="pd-status waiting"><span class="pd-status-text">Ждём: <span class="pd-ally">Ёжик</span></span></p>
  </div>
  <div class="pd-dcorner">
    <button class="pd-mapbtn journal" aria-label="Журнал" aria-keyshortcuts="J"></button>
    <button class="pd-mapbtn prefs" aria-label="Настройки"></button>
    <button class="pd-mapbtn menu" aria-label="Меню" aria-keyshortcuts="Escape"></button>
  </div>
  <div class="pd-finds"></div>
  <button class="pd-log" aria-label="История">…строки… <span class="pd-log-more">История</span></button>
  <nav class="pd-dbar left" aria-label="Действия">
    <button class="pd-tool" aria-label="Ждать" aria-keyshortcuts="Space"><span class="pd-key">Space</span><i class="pd-icon" style="--w:12;--h:12;background-image:var(--spr-tool-wait)"></i></button>
    <button class="pd-tool" aria-label="Искать" aria-keyshortcuts="F"><span class="pd-key">F</span>…</button>
    <button class="pd-tool" aria-label="Осмотреть" aria-keyshortcuts="X"><span class="pd-key">X</span>…</button>
  </nav>
  <nav class="pd-dbar right" aria-label="Вещи">
    <button class="pd-tool quick" aria-keyshortcuts="1"><span class="pd-key">1</span><i class="pd-item" data-i="57"></i><span class="pd-qty">2</span></button>
    <button class="pd-tool quick" aria-keyshortcuts="2"><span class="pd-key">2</span>…</button>
    <button class="pd-tool" aria-label="Рюкзак" aria-keyshortcuts="I"><span class="pd-key">I</span>…</button>
  </nav>
  <div class="pd-mapctl">…attack, resume, hero, in, out, all — как на телефоне…</div>
</div>
<div class="pd-hover foe" style="left:…;top:…;width:48px;height:48px"></div>  <!-- в координатах карты, под слоем -->
```

На мониторе те же узлы, что на телефоне: `.pd-log`, `.pd-mapctl`, `.pd-finds`, `.pd-toast`, `.pd-status`, `.pd-bar`, `.pd-buff`. Меняется только раскладка, по `.pd-ui`/`.pd-wide`. Если удобнее держать одну разметку для обоих экранов:

- `.pd-hud` превращается в `.pd-dcol > .pd-dhud`;
- `.pd-mates` — в `.pd-party` с `.pd-pcard`;
- `.pd-toolbar` делится на два `.pd-dbar`;
- кнопка меню уходит из HUD в `.pd-dcorner`.

### Мышь

- **Наведение ничего не всплывает.** Ни над картой, ни над кнопками. Подсказки по наведению (`.pd-tooltip`) из системы убраны. Если они уже есть в коде (коммит 9b51cf0), уберите их.
- **Клетка под курсором** получает `.pd-hover` — тихие уголки в размер тайла, в координатах карты, под слоем `.pd-ui`. Над врагом — `.pd-hover.foe`, красные. Туман и неисследованное — без уголков.
- **ЛКМ** — как касание: идти, атаковать, взять. **ПКМ** по клетке — окно осмотра, как касание в режиме «Осмотреть». Контекстное меню браузера над картой отключите.
- **Курсор:** `cursor: url(cursor-x2.png) 0 0, default` над картой и панелью. При `--ui: 2` возьмите стрелку ×4 без сглаживания.
- **Клавиши** кнопок карты и угла (Tab, V, H, M, J, Esc) перечислены в справке, вкладка «Управление». На кнопках панели снизу клавиша подписана под значком.

### Клавиши

| Клавиша | Действие | В коде сейчас |
| --- | --- | --- |
| стрелки, WASD, Q/E/Z/C, цифровой блок | шаг и диагонали; удержание — идти дальше | есть |
| Space, Num5, «.» | ждать | есть |
| R | отдых | есть |
| F | искать | есть |
| I | рюкзак | есть |
| G | взять с пола | есть |
| T | быстрый слот 1 | есть |
| Enter | действие на своей клетке | есть |
| Esc | закрыть окно / отменить цель / меню | есть |
| + / − | масштаб | есть |
| **1, 2** | быстрые слоты 1 и 2 (T оставить как 1) | новое |
| **X** | осмотреть: режим, как кнопка | новое |
| **Tab** | атаковать врага с кнопки атаки | новое |
| **V** | идти дальше, если путь прервали | новое |
| **H** | к герою | новое |
| **M** | весь уровень | новое |
| **J** | журнал | новое |

В задании «S — искать», но S уже шаг вниз в WASD. Поэтому на кнопке подписано F — так в коде сейчас. Если WASD не нужен, верните S и поправьте подпись в одном месте.

### Новые классы — монитор

| Класс | Что это |
| --- | --- |
| `.pd-ui`, `.pd-wide`, `--ui` | слой интерфейса и его целый масштаб |
| `.pd-dcol`, `.pd-dpanel`, `.pd-dhud` | колонка сверху слева и панель героя |
| `.pd-party`, `.pd-pcard(.turn/.away/.dead)`, `.pd-pstate` | отряд |
| `.pd-dcorner`, `.pd-mapbtn.journal/.prefs/.menu` | угол справа сверху |
| `.pd-dbar.left/.right`, `.pd-key` | острова нижней панели и подпись клавиши |
| `.pd-mapbtn.attack`, `.pd-mapbtn.resume` | атака по врагу и «идти дальше» |
| `.pd-hover(.foe)`, `.pd-cursor`, `--spr-cursor` | уголки клетки под курсором и пиксельный курсор |

## Карточка обучения

```html
<section class="pd-hint" role="status">
  <div class="pd-hint-head"><span class="pd-slot"><i class="pd-item" data-i="124"></i></span><b>Бомба</b></div>
  <p>Через пару ходов после броска взорвётся. Не стойте рядом!</p>
  <div class="pd-hint-how"><i class="pd-gesture throw"></i><span><b>Бросьте</b>: положите в быстрый слот и нажмите на цель</span></div>
  <!-- на мониторе: <i class="pd-gesture click"></i><span><b>Щёлкните по лупе</b> или нажмите</span><span class="pd-keycap">F</span> -->
  <div class="pd-hint-row"><button class="pd-hint-off">Больше не подсказывать</button><button class="pd-button small">Понятно</button></div>
  <i class="pd-hint-time" style="--hint-ms:14s"></i>
</section>
```

```js
const arrow = PD.point(uiLayer, document.querySelector('.pd-tool.quick'), 'top');   // 'top' | 'bottom' | 'left' | 'right'
// при уходе карточки или первом нажатии на кнопку:
arrow.remove(); target.classList.remove('pd-spot');
```

Что поменять в `hints.ts` и `game.css`:

- Разметка та же: `.pd-hint`, `.pd-hint-head`, `p`, `.pd-hint-row`, `.pd-hint-off`. Стили из `game.css` можно убрать, они теперь в системе.
- Иконку кладите в `.pd-slot` 40 px — так портрет и предмет стоят одинаково.
- **Место.** На телефоне карточка теперь над логом, а не под HUD: `bottom` считается от `--log-h`. Обновляйте `--log-h`, когда лог растёт. На мониторе (`.pd-wide`) — над островами, как сейчас.
- **Время.** `SHOW_MS` передавайте в `--hint-ms`. На `pointerenter` ставьте таймер на паузу, на `pointerleave` — продолжайте. Черта ведёт себя так же сама.
- **Жест и стрелка.** Добавьте к тексту подсказки, если они есть, `[title, text, how, gesture, target]`. Для монитора — `howWide` и `key`. Предлагаемые соответствия:

| HintId | Жест | Стрелка на | Клавиша |
| --- | --- | --- | --- |
| monster | tap / click | `.pd-mapbtn.attack`, слева | Tab |
| attacked, lowHealth | hold / click | «Ждать», сверху | Space, R |
| floorItem, container, stairs, npc, shop | tap / click | — | — |
| secret | tap / click | «Искать», сверху | F |
| examine | tap / rclick | «Осмотреть», сверху | X |
| hungry, food | tap / click | «Рюкзак», сверху | I |
| weapon, armor, ring | drag | «Рюкзак», сверху | I |
| potion, scroll, wand | hold | «Рюкзак», сверху | I |
| missile, bomb, seed | throw | быстрый слот, сверху | 1 |
| companion | tap / click | первая карточка отряда, справа | — |

- **Снятие стрелки.** Стрелка и `.pd-spot` снимаются вместе с карточкой и по первому нажатию на кнопку-цель, а «Понятно» сразу закрывает всё. Если кнопки сейчас нет (атака без врага в поле зрения), стрелку не ставьте.

| Класс | Что это |
| --- | --- |
| `.pd-hint`, `.pd-hint-head`, `.pd-hint-row`, `.pd-hint-off` | карточка обучения |
| `.pd-hint-how`, `.pd-hint-time` (`--hint-ms`) | строка «как» и время до ухода |
| `.pd-gesture.tap/.hold/.drag/.throw/.click/.rclick` | схема жеста 16×16, 3 кадра |
| `.pd-keycap` | колпачок клавиши |
| `.pd-pointer(.up/.left/.right)`, `.pd-spot` | стрелка на кнопку и рамка цели |

## Арена волн

### Вход на титуле

```html
<!-- в .pd-actions титула, под «Играть с друзьями» -->
<button class="pd-button pd-mode-btn"><i class="pd-mode-ico"></i>
  <span class="pd-mode-text">Арена волн<small>Яма Йендора · рекорд: <b>волна 12</b></small></span></button>
```

Если рекорда нет, вместо него пишите «новый режим». Кнопка открывает окно выбора:

```html
<section class="pd-window narrow" role="dialog" aria-labelledby="ar">
  <div class="pd-window-head"><span class="pd-mode-ico" style="width:32px;height:32px"></span>
    <div class="pd-titles"><h2 class="pd-heading" id="ar">Арена волн</h2><span class="pd-sub">Яма Йендора</span></div><button class="pd-close" aria-label="Закрыть"></button></div>
  <div class="pd-arena-pick">
    <div class="pd-arena-art"><i style="background-position:0 0"></i><i style="background-position:-32px -32px"></i><i style="background-position:0 -64px"></i>…</div>  <!-- кадры arena1.png ×2 -->
    <ul class="pd-arena-rules"><li>Отряд из 1–4 героев держит волны монстров.</li><li>После волны — передышка и награда на выбор.</li><li>Каждые 5 волн арена уходит глубже…</li></ul>
    <span class="pd-record">Рекорд: волна 12</span>
    <div class="pd-actions">
      <button class="pd-button stacked">Одному<span class="pd-btn-sub">один герой</span></button>
      <button class="pd-button ally stacked">С друзьями<span class="pd-btn-sub">2–4 героя · ссылка в Telegram</span></button>
    </div>
  </div>
</section>
```

### Табло, «К бою!» и готовность

```html
<!-- телефон: сразу после .pd-hud-main внутри .pd-hud; монитор: в .pd-ui с классом .top -->
<div class="pd-waveboard" role="status"><span class="pd-wave-n">Волна 7</span><span class="pd-wave-left">осталось <b>5</b></span><div class="pd-bar" style="--v:.6"></div></div>
<!-- --v — доля убитых в волне -->
<div class="pd-waveboard rest" role="status"><span class="pd-wave-n">Передышка</span><span class="pd-wave-left">Волна 8</span><span class="pd-wave-ready">Готовы 2/3</span></div>

<div class="pd-fight"><button class="pd-button primary">К бою!</button><span class="pd-fight-note">Готовы 2/3 · ждём: <b>Ёжик</b></span></div>
```

- **Глубина.** В арене уберите `.pd-stat` глубины из HUD (на мониторе — из `.pd-dhud`) и глубину с карточек отряда.
- **Чемпионы.** Волне с чемпионами табло ставит `.champions`: красная рамка и ★ у номера.
- **Нажал «К бою!»** — кнопка получает `.waiting` (серая, остаётся нажимаемой: второе нажатие отменяет готовность). Товарищу, который готов, ставится `.ready` на `.pd-mate` (телефон) или `.pd-pcard` (монитор); на мониторе `.pd-pstate` пишет «готов», у остальных — «выбирает награду» или «в передышке».
- **Соло:** «Готовы» и подписи не нужны, кнопка сразу начинает волну.
- **Ход и ожидание.** В передышке ходы не ждут товарищей. Строка «Ждём: …» (`.pd-status.waiting`) возвращается, когда волна началась.

### Баннеры

```js
PD.fx.wave(ctx, t.waveTitle(5), 'Чемпионы!', 'champions', cy, width, now - start);   // kind: '' | 'champions' | 'boss'
PD.fx.depth(ctx, t.regionNames[1], 'Арена погружается глубже', emblems, 1, cy, width, now - start);
```

`cy` — верхняя треть свободной зоны, над героем, как у карточек региона и босса. Длительности и сетка — в `canvas-fx.md`. Если регион и волна начинаются в один ход, сначала покажите погружение (2,4 с), потом баннер.

### Награда и итоги

```html
<section class="pd-window" role="dialog" aria-labelledby="rw">
  <div class="pd-window-head"><div class="pd-titles"><h2 class="pd-heading" id="rw">Награда</h2><span class="pd-sub">за волну 5</span></div></div>
  <div class="pd-loot3" role="radiogroup">
    <button class="pd-loot" role="radio" aria-checked="false"><span class="pd-slot"><i class="pd-item" data-i="61"></i></span><span class="pd-loot-name">Зелье Опыта</span><span class="pd-rarity">обычное</span></button>
    <button class="pd-loot rare" role="radio" aria-checked="false">…<span class="pd-rarity">редкое</span></button>
    <button class="pd-loot legend" role="radio" aria-checked="true">…<span class="pd-rarity">легендарное</span></button>
  </div>
  <p class="pd-loot-note">Каждый в отряде выбирает себе сам.</p>
  <div class="pd-actions"><button class="pd-button primary">Взять</button></div>   <!-- disabled, пока ничего не выбрано -->
</section>
```

Касание карточки выбирает её, второе касание — то же, что «Взять». Окно без крестика: награду нужно взять. Удержание на карточке открывает окно предмета с описанием.

```html
<section class="pd-window pd-runend arena" role="dialog" aria-labelledby="ae">
  <h2 class="pd-display" id="ae">Отряд пал</h2><p class="pd-cause">на волне 12 · Пещеры</p>
  <span class="pd-record new">Новый рекорд!</span>              <!-- или <span class="pd-record">Рекорд: волна 14</span> -->
  <dl class="pd-stats"><div><dt>Волн</dt><dd>12</dd></div><div><dt>Убито</dt><dd>87</dd></div><div><dt>Очки</dt><dd class="gold">4 320</dd></div></dl>
  <div class="pd-arena-party">                                    <!-- только в кооперативе -->
    <div class="head"><span></span><span></span><span>Убито</span><span>Очки</span></div>
    <div class="me"><i style="--av:0"></i><span>QA</span><span>34</span><span>1820</span></div>
  </div>
  <div class="pd-actions"><button class="pd-button primary">Ещё раз</button><button class="pd-button">Поделиться</button><button class="pd-button quiet">Главное меню</button></div>
</section>
```

### Атлас арены

Атласы `arena0..4.png/.json` лежат рядом с `assets/world`, номер — регион (0 — канализация … 4 — залы), формат тот же. Предлагаемая сборка уровня:

- **Пол.** Внутри круга вместо EMPTY кладите `sand`: вариант 0–2 по хэшу клетки, 3 (кровь) и 4 (царапины) — примерно раз на 25 клеток.
- **Стена.** Кольцо стены — обычный WALL региона. Знамя (`banner`) — на каждой пятой клетке стены, обращённой к арене. Четверо ворот (`gate`) — по сторонам света.
- **Ворота.** В передышке закрыты (кадр 0). С началом волны поднимаются кадрами 0→3, монстры выходят из ворот. Под конец волны опускаются 3→0.
- **Жаровни** (`brazier`) — четыре по диагоналям внутри круга, со светом `light.png` в цвет огня.
- **Трибуны** (`crowd`) — 2–3 кольца клеток снаружи стены. После волны 2 секунды ликуют (1,2,1,2), соседние клетки идут в противофазе. В передышке изредка вспыхивает кадр 1.
- **Значки «Волна 5 / 10 / 20»** — `badges-arena.png`. Допишите их в лист значков отдельной строкой или держите отдельным листом с тем же 16×16.

| Класс | Что это |
| --- | --- |
| `.pd-mode-btn`, `.pd-mode-ico`, `.pd-mode-text` | кнопка режима на титуле |
| `.pd-arena-pick`, `.pd-arena-art`, `.pd-arena-rules`, `.pd-record(.new)` | окно выбора и рекорд |
| `.pd-waveboard(.rest/.champions/.top)`, `.pd-wave-n`, `.pd-wave-left`, `.pd-wave-ready` | табло |
| `.pd-fight`, `.pd-fight-note`, `.pd-button.primary.waiting` | «К бою!» |
| `.pd-mate.ready`, `.pd-pcard.ready`, `--spr-check` | готовность в отряде |
| `.pd-loot3`, `.pd-loot(.rare/.legend)`, `.pd-loot-name`, `.pd-rarity`, `.pd-loot-note` | награда |
| `.pd-runend.arena`, `.pd-arena-party` | итоги |

Все строки на двух языках — `docs/design/tasks/arena-strings.ts`.

## Рейтинги

В `rankui.ts` эмодзи заменяются спрайтами `.pd-tro` (`assets/Ranked`, в `bundle.css` встроены как `--atlas-troph16` и `--atlas-troph32`). Текст из строк i18n уходит: `freezes(n)` → просто `n`, у `trophy()` убрать префикс медали.

| Было | Стало |
| --- | --- |
| `🔥 ${streak}` в `.pd-streak` | `<span class="pd-streak on"><i class="pd-tro flame"></i><b>12</b></span>`; без серии — `.off` и `flame-off` |
| `.pd-freeze` «1 ❄» | `<span class="pd-counter frost"><i class="pd-tro frost"></i>1</span>` |
| `.pd-trophies` «🏆 3» | `<span class="pd-counter trophies"><i class="pd-tro gold"></i>3</span>` |
| 🥇 🥈 🥉 в `trophy()` | `.pd-tro.gold` / `.silver` / `.bronze` |
| 🏅 (неделя / арена) | `.pd-tro.week` / `.pd-tro.arena` |
| `✓ ` в `.pd-checked` | убрать: галочка рисуется `::before` |
| `★ ` перед именем | `<i class="pd-patron-mark"></i>` |
| `small` с подписью внутри `.pd-rank-name` | `<small class="pd-rank-detail">` пятым ребёнком `.pd-rank`, после очков |
| `t.depthShort(n)` в подписи | `<i class="pd-rank-depth"></i>${n}` |
| `.pd-info.center.pd-gold` (рекорд) | `<p class="pd-new-record">` |
| `.pd-note.center` (проверка, без сервера) | `<p class="pd-checked pending">`, `<p class="pd-checked off">` |

Кадры `trophies16.png`: 0 gold, 1 silver, 2 bronze, 3 week, 4 arena, 5 flame, 6 flame-off, 7 frost. `trophies32.png` — кадры 0–4 (`.pd-tro.big`). Значок трофея по записи:

```ts
export function trophyClass(board: string, place: number): string {
  const kind = board.split(':')[0];
  if (kind === 'week') return 'week';
  if (kind === 'arena') return 'arena';
  return place === 1 ? 'gold' : place === 2 ? 'silver' : 'bronze';   // daily
}
```

### Карточка игрока

```html
<button class="pd-profile" aria-label="Рейтинг">
  <span class="pd-streak on"><i class="pd-tro flame"></i><b>12</b></span>
  <span class="pd-profile-text">
    <span class="pd-profile-streak">12 дней подряд</span>
    <span class="pd-profile-facts">Рекорд <b>4 320</b> · Забегов <b>37</b> · Сегодня <b class="place">#8</b></span>
  </span>
  <span class="pd-profile-side">
    <span class="pd-counter frost"><i class="pd-tro frost"></i>1</span>
    <span class="pd-counter trophies"><i class="pd-tro gold"></i>3</span>
  </span>
</button>
```

- Без серии: `.pd-streak.off` с `flame-off`, `<b>` скрыт; текст — `streakNone`. Пустые счётчики не выводите.
- «Сегодня #N» — только если попытка дня сыграна.
- На титуле добавьте `.ranked` к `.pd-title-screen`: компактный логотип, отступы 8 px, дети не сжимаются. Тогда карточка, окно и 5 рядов кнопок помещаются в 375×812.

### Подземелье дня

```html
<!-- попытка есть -->
<div class="pd-daily">
  <div class="pd-daily-head"><i class="pd-icon" style="background-image:var(--spr-stairs)"></i><h3>Подземелье дня</h3><span class="pd-chip">1 попытка</span></div>
  <p class="pd-note">У всех одно подземелье; в таблицу идёт одна попытка.</p>
  <div class="pd-row"><button class="pd-button">Спуститься</button><button class="pd-button">Таблица дня</button></div>
</div>
<!-- сыграно -->
<div class="pd-daily done">
  <div class="pd-daily-head">…<span class="pd-chip done">сыграно</span></div>
  <div class="pd-daily-place"><i class="pd-tro gold"></i><b>#1</b><span>из 214</span></div>   <!-- кубок только для мест 1–3 -->
  <p class="pd-note">Попытка дня сыграна. Возвращайтесь завтра или тренируйтесь.</p>
  <div class="pd-row"><button class="pd-button">Тренировка</button><button class="pd-button">Таблица дня</button></div>
</div>
```

Ниже — «Продолжить» (`.primary.big.stacked`), ряд «Новая игра» + «Испытания», «Арена волн» (`.pd-mode-btn`), ряд «Рейтинг» (`<i class="pd-tro x1 gold"></i>`) + «Пиксель-Март».

### Окно «Рейтинг»

```html
<section class="pd-window pd-boards-window" role="dialog" aria-label="Рейтинг">
  <div class="pd-window-head"><div class="pd-titles"><h2 class="pd-heading">Рейтинг</h2></div><button class="pd-close" aria-label="Закрыть"></button></div>
  <div class="pd-tabs compact" role="tablist">
    <button class="pd-tab" role="tab" aria-selected="false">День</button><button class="pd-tab" role="tab" aria-selected="true">Неделя</button>
    <button class="pd-tab" role="tab">Арена</button><button class="pd-tab" role="tab">Лучшие</button><button class="pd-tab" role="tab">Мои</button>
  </div>
  <p class="pd-board-note"><i class="pd-tro week"></i>Лучший забег недели. Десятка лучших получает медаль в понедельник.</p>
  <div class="pd-scroll pd-boards">
    <div class="pd-ranks">
      <div class="pd-rank pd-medal-1">
        <span class="pd-rank-n">1</span><i class="pd-rank-face" style="--av:0"></i>
        <span class="pd-rank-name"><i class="pd-patron-mark"></i>Lumen</span>
        <span class="pd-rank-score">9 800</span>
        <small class="pd-rank-detail">Воин · ур.22 · <i class="pd-rank-depth"></i>24</small>
      </div>
      <!-- … до 50 строк; своя строка — .pd-rank.me -->
    </div>
    <div class="pd-ranks-me">                       <!-- прилипает снизу -->
      <div class="pd-ranks-gap">· · ·</div>         <!-- только если своя строка ниже списка -->
      <div class="pd-rank me">…</div>
      <div class="pd-board-place">Ваше место: 37 из 214</div>
    </div>
  </div>
</section>
```

- `--av` у портрета: 0 воин, 1 маг, 2 разбойник, 3 охотница (кадр `avatars.png`).
- Значок пояснения: День — `gold`, Неделя — `week`, Арена — `arena`, у «Лучших» и «Моих» нет.
- Арена: подпись «Класс · волна 23».
- «Мои»: перед списком `<div class="pd-trophy-shelf"><span><i class="pd-tro big gold"></i><b>#1</b>День</span>…</div>`, список — `.pd-ranks.mine` без `.pd-rank-n`, дата в начале подписи: «12.10 · Воин · ур.22 · ⛶24».
- Сейчас `.pd-ranks-me` в `rankui.ts` висит на самом списке. Вынесите его отдельным блоком после `.pd-ranks` внутри `.pd-scroll`, иначе он не прилипнет.

### Под итогами забега

```html
<div class="pd-ranking">
  <p class="pd-checked">Проверено сервером</p>
  <p class="pd-new-record">Новый личный рекорд!</p>
  <div class="pd-places">
    <span class="pd-place top"><i class="pd-tro week"></i><b>#3</b>Неделя</span>
    <span class="pd-place"><b>#12</b>Лучшие</span>
  </div>
</div>
<!-- пока сервер считает -->  <div class="pd-ranking"><p class="pd-checked pending">Сервер проверяет забег…</p></div>
<!-- без сервера -->           <div class="pd-ranking"><p class="pd-checked off">Вне рейтинга: сыграно без сервера</p></div>
```

`.top` и значок доски — для мест 1–3. Порядок плашек: сначала лучшие места.

| Класс | Что это |
| --- | --- |
| `.pd-tro` + `gold` `silver` `bronze` `week` `arena` `flame` `flame-off` `frost` | значок 16 px; `.big` — 32 px; `.x1` — ×1 |
| `.pd-profile`, `.pd-streak.on/.off`, `.pd-profile-text`, `.pd-profile-streak`, `.pd-profile-facts`, `.pd-profile-side`, `.pd-counter.frost/.trophies` | карточка игрока |
| `.pd-title-screen.ranked` | компактный титул |
| `.pd-daily(.done)`, `.pd-daily-place`, `.pd-chip.done` | подземелье дня |
| `.pd-boards-window`, `.pd-board-note`, `.pd-boards`, `.pd-ranks(.mine)`, `.pd-rank(.me)`, `.pd-medal-1/2/3`, `.pd-rank-detail`, `.pd-rank-depth`, `.pd-ranks-me`, `.pd-ranks-gap`, `.pd-board-place`, `.pd-trophy-shelf` | окно «Рейтинг» |
| `.pd-ranking`, `.pd-checked(.pending/.off)`, `.pd-new-record`, `.pd-places`, `.pd-place(.top)` | блок под итогами |


## Обновление «Shattered»

Спрайты — группа `assets/Shattered` (скопируйте в `packages/client/public/assets/`). В `bundle.css` они встроены как `--atlas-talents`, `--atlas-heroicons`, `--atlas-sitems` и `--spr-*`. Новые цвета в `tokens.json`: `energy`, `charge`, `charge-full`.

| Класс | Атлас | Кадр | В ряду |
| --- | --- | --- | --- |
| `<i class="pd-ticon" data-t="14">` | `talent_icons.png` | `Talent.icon` | 32 |
| `<i class="pd-hicon" data-h="1">` | `hero_icons.png` | `HeroIcon.*` | 8 |
| `<i class="pd-sitem" data-s="240">` | `items-shpd.png` | `ItemSpriteSheet.*` | 16 |

Размер задаёт `--u` (по умолчанию из окна; 1px — 16 px, 2px — 32 px). Без `PD.sprite()` ставьте `--ix: n % cols; --iy: floor(n / cols)` сами.

### Шесть классов

- `avatars.png` теперь 144×32 (6 ячеек по 24). Во всех правилах с `--atlas-avatars` замените `background-size`: `128 → 144` (в `--u`), `256px 64px → 288px 64px`, мобильное `192px 48px → 216px 48px`.
- `heroes6.png` 72×15 вместо 48×15: `background-size: 96px 30px → 144px 30px` у `.pd-mate-face`, `.pd-rank-face`, `.pd-pcard .pd-mate-face`.
- `AVATAR`: `duelist: 4, cleric: 5`. На титуле `<div class="pd-classes six">`; новые классы — `.pd-class.new`, в `.pd-class-info` у имени `<span class="pd-chip done">новый</span>`.
- `ui.css`: `.pd-classes { grid-template-columns: repeat(4, 1fr) }` оставьте для 4, шесть берут `.six` из бандла.

### Окно героя и таланты

```html
<section class="pd-window pd-hero-window" role="dialog" aria-label="Герой">
  <header class="pd-window-head">…<div class="pd-titles"><h2 class="pd-heading">Гладиатор</h2><span class="pd-sub">Воин · ур. 14</span></div><button class="pd-close"></button></header>
  <div class="pd-tabs compact" role="tablist">
    <button class="pd-tab" role="tab" aria-selected="false">Герой</button>
    <button class="pd-tab" role="tab" aria-selected="true">Таланты<i class="pd-tab-plus" aria-label="есть очки"></i></button>
  </div>
  <div class="pd-scroll"><div class="pd-talents">
    <section class="pd-tier">
      <header class="pd-tier-head"><h3>Ярус 2</h3><span class="pd-tier-sub">ур. 7–12</span><span class="pd-tier-points free">свободно <b>2</b></span></header>
      <div class="pd-talent-row">
        <button class="pd-talent" aria-label="Железный желудок, 1 из 2"><i class="pd-ticon" data-t="4"></i><span class="pd-pips"><i class="on"></i><i></i></span></button>
        <button class="pd-talent zero" aria-label="Жидкая воля, 0 из 2">…</button>
        <button class="pd-talent max" aria-label="Перенос рун, 2 из 2">…</button>
      </div>
    </section>
    <section class="pd-tier locked">
      <header class="pd-tier-head"><h3>Ярус 4</h3><span class="pd-tier-sub">ур. 21–30</span></header>
      <div class="pd-talent-ghosts" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <p class="pd-tier-lock">С 20 уровня: наденьте корону короля гномов и выберите способность брони.</p>
    </section>
  </div></div>
  <div class="pd-talents-foot"><span>Касание по таланту — описание</span><button class="pd-button quiet small">Наугад</button></div>
</section>
```

- Счётчик: если свободных нет — `<span class="pd-tier-points"><b>5</b>/5</span>`.
- Ярус 3 до выбора пути и ярус 4 до способности — `.locked` с текстом из `ui.talentspane.unlock_tier3/4`.
- Очки по ярусам — как в `Hero.talentPointsAvailable`: пороги 2, 7, 13, 21, 31; ярус 1 — 5 очков, 2 — 6, 3 — 8, 4 — 10.

Карточка таланта поверх окна героя:

```html
<section class="pd-window pd-talent-card narrow" role="dialog" aria-label="Рассечение">
  <header class="pd-window-head"><div class="pd-slot"><i class="pd-ticon" data-t="14"></i></div>
    <div class="pd-titles"><h2 class="pd-heading">Рассечение</h2><span class="pd-sub">Ярус 3 · Гладиатор</span></div><button class="pd-close"></button></header>
  <div class="pd-talent-progress"><span class="pd-pips"><i class="on"></i><i></i><i></i></span><span>1 из 3</span></div>
  <ol class="pd-talent-levels">
    <li class="done"><b>+1</b><span>После убийства комбо держится <em>30 ходов</em> вместо 15.</span></li>
    <li class="next"><b>+2</b><span>…<em>45 ходов</em>…</span></li>
    <li><b>+3</b><span>…<em>60 ходов</em>…</span></li>
  </ol>
  <div class="pd-actions"><button class="pd-button primary">Улучшить</button><p class="pd-talent-cost">Свободно очков яруса 3: <b>1</b></p></div>
</section>
```

Текст уровней — из `actors.hero.talent.*.desc`, разрезанного по `_+N:_`; выделение `_…_` → `<em>`. Без свободных очков кнопки нет, вместо неё `<p class="pd-note center">`. Талант изучен — все `li.done`.

«+» на кнопке героя: `<div class="pd-avatar-wrap talent">…<i class="pd-talent-badge"></i></div>`, пока сумма `talentPointsAvailable` по ярусам больше нуля.

### Путь мастерства и способность брони

```html
<section class="pd-window" role="dialog" aria-label="Путь мастерства">
  <header class="pd-window-head"><div class="pd-slot"><i class="pd-sitem" data-s="59"></i></div><div class="pd-titles"><h2 class="pd-heading">Путь мастерства</h2></div></header>
  <p class="pd-tpick-intro">Маска Тенгу ложится на лицо…</p>
  <div class="pd-tpicks two">
    <div class="pd-tpick" style="--glow:#ffcc66">
      <div class="pd-tpick-art"><i class="pd-tpick-avatar" style="--av:0"></i><i class="pd-hicon" data-h="1"></i></div>
      <span class="pd-tpick-name">Гладиатор</span>
      <p class="pd-tpick-desc">Точные удары копят <em>комбо</em>…</p>
      <div class="pd-tpick-tal"><span class="pd-tpick-talents"><i class="pd-ticon" data-t="14"></i>…</span>откроет ярус 3</div>
      <div class="pd-tpick-act"><button class="pd-button">Выбрать</button><button class="pd-button quiet">Подробнее</button></div>
    </div>
  </div>
  <button class="pd-button quiet">Решу позже</button>
</section>
```

Способность брони — то же без `.two`: `.pd-tpick-art` 72×72 со значком `data-h` (16 «Героический прыжок», 17 «Ударная волна», 18 «Выдержка»; остальные классы — `HeroIcon`), в `.pd-tpick-act` «Выбрать» и три таланта яруса 4. В шапке — корона `data-s="60"`. После «Выбрать» спросите подтверждение (`windows.wndchooseability.are_you_sure`) окном `showConfirm`.

### Алхимия

```html
<section class="pd-window pd-alch-window" role="dialog" aria-label="Алхимия">
  <header class="pd-window-head"><i class="pd-icon" style="width:32px;height:32px;background-image:var(--spr-alchemy)"></i>
    <div class="pd-titles"><h2 class="pd-heading">Алхимия</h2></div>
    <span class="pd-energy" aria-label="энергия 12"><i class="pd-sitem" data-s="19"></i>12</span><button class="pd-close"></button></header>
  <div class="pd-alch">
    <button class="pd-slot"><i class="pd-sitem" data-s="387"></i></button>
    <button class="pd-slot"><i class="pd-sitem" data-s="387"></i></button>
    <button class="pd-slot add" aria-label="Добавить"></button>
    <i class="pd-alch-arrow ready"></i>
    <div class="pd-slot out unknown"><i class="pd-sitem" data-s="352"></i></div>
  </div>
  <div class="pd-alch-out"><span class="pd-alch-name">Случайное зелье</span><span class="pd-alch-cost">Без энергии</span></div>
  <div class="pd-actions">
    <button class="pd-button primary">Сварить</button>
    <div class="pd-row"><button class="pd-button"><i class="pd-energy-ico"></i>Превратить в энергию</button></div>
    <div class="pd-row"><button class="pd-button quiet">Рецепты</button><button class="pd-button quiet">Очистить</button></div>
  </div>
</section>
```

- Нет рецепта — стрелка без `.ready`, результат `.pd-slot.out.empty`, «Сварить» `disabled`.
- Не хватает энергии — `<span class="pd-alch-cost short"><i class="pd-energy-ico x1"></i>Нужно 4, есть 2</span>` и `disabled`.
- «Превратить в энергию»: `<div class="pd-alch-pick">` из ячеек с `<span class="pd-qty energy">+6</span>`, выбранные `.picked`, у вещи без энергии `.disabled`; итог `<div class="pd-energize-sum"><span>Получите</span><b><i class="pd-energy-ico"></i> +9</b></div>`. Цена — `Item.energyVal()`.
- Учебник: `<div class="pd-guide-pages" role="tablist">` — кнопки страниц `aria-pressed`, ненайденные `.lost`; рецепт:

```html
<div class="pd-recipe">
  <span class="pd-recipe-line" aria-label="Зелье + 4 энергии → особое зелье"><i class="pd-sitem" data-s="352"></i><span class="op">+</span><span class="en"><i class="pd-energy-ico"></i>4</span><i class="pd-alch-arrow"></i><i class="pd-sitem" data-s="368"></i></span>
  <button class="pd-button">В котёл</button>   <!-- только если всё есть в рюкзаке -->
  <span class="pd-recipe-name"><b>Особое зелье</b> того же цвета</span>
</div>
```

Страницы — `Document.ALCHEMY_GUIDE`: Potions, Stones, Energy_Food, Exotic_Potions, Exotic_Scrolls, Bombs, Weapons, Brews_Elixirs, Spells.

### Артефакт

```html
<div class="pd-art-level"><span>Уровень</span><span class="pd-steps" style="--max:10"><i class="on"></i><i class="on"></i><i class="part" style="--p:.6"></i><i></i>…</span><span><b>2</b>/10</span></div>
<div class="pd-art-charge"><span>Заряд</span><div class="pd-charge-bar seg" style="--v:.7;--n:10"></div><span><b>7</b>/10</span></div>
<p class="pd-art-state">Наполняется едой, пока вы получаете опыт.</p>
```

- `--max` — `levelCap`, `--p` — доля опыта до следующего уровня, `--n` — `chargeCap` (для заряда в процентах, как у плаща, `--n:10`). Полный — `.pd-charge-bar.full` и `.pd-art-state.on`.
- Кнопки — `actions(hero)` артефакта: первая основная (`defaultAction`), остальные рядом, «Снять» — обычная.
- На значке: `<span class="pd-charge" style="--v:.7"></span>` последним ребёнком `.pd-slot` или `.pd-tool.quick`; `.full` при полном заряде. Заряды жезлов остаются `.pd-qty` «2/3».

### Зачарования и глифы

```html
<button class="pd-slot"><i class="pd-sitem" data-s="112"></i><span class="pd-lvl up">+2</span><i class="pd-mark ench" style="--ench:#ff6a33"></i></button>
<button class="pd-slot"><i class="pd-sitem" data-s="178"></i><i class="pd-mark glyph new" style="--ench:#a8a090"></i></button>
<button class="pd-slot cursed"><i class="pd-sitem" data-s="131"></i><i class="pd-mark ench" style="--ench:var(--danger)"></i><i class="pd-mark curse"></i></button>
<!-- в карточке предмета -->
<div class="pd-ench-line" style="--ench:#ff6a33"><i class="pd-mark ench"></i><span><b>Зачарование пламени</b>Удары могут поджечь врага.</span></div>
```

- `.new` — зачарование ещё не осмотрено. Неопознанное — `--ench: var(--ink-muted)`. Проклятое — `--ench: var(--danger)` и `.pd-mark.curse`; строка `.pd-ench-line.curse`.
- Метка быстрого слота с таким значком сдвигается вправо сама.

Цвета (`--ench`) — свечение `glowing()` из Shattered, поднятое до читаемого на `stone-800` (чёрное и тёмное заменено светлым тоном того же оттенка):

| Зачарование | ru | en | `--ench` | в Shattered |
| --- | --- | --- | --- | --- |
| `blazing` | пламени | blazing | `#ff6a33` | `#FF4400` |
| `blocking` | обороны | blocking | `#7c96ff` | `#0000FF` |
| `blooming` | цветения | blooming | `#4cc24c` | `#008800` |
| `chilling` | холода | chilling | `#66f0ff` | `#00FFFF` |
| `corrupting` | подчинения | corrupting | `#b878e8` | `#440066` |
| `crystal` | кристаллизации | crystal | `#4aa8ff` | `#0088FF` |
| `elastic` | упругости | elastic | `#ff66ff` | `#FF00FF` |
| `eldritch` | ужаса | eldritch | `#a9a3bf` | `#222222` |
| `grim` | погибели | grim | `#d8cfb8` | `#000000` |
| `kinetic` | инерции | kinetic | `#ffee55` | `#FFFF00` |
| `lucky` | удачи | lucky | `#66ff66` | `#00FF00` |
| `projecting` | проекции | projecting | `#a77ae0` | `#8844CC` |
| `shocking` | молний | shocking | `#ffffff` | `#FFFFFF` |
| `unstable` | хаоса | unstable | `#bbbbbb` | `#999999` |
| `vampiric` | вампиризма | vampiric | `#e8506e` | `#660022` |
| `venomous` | отравы | venomous | `#9a7cff` | `#4400AA` |
| `vorpal` | рассечения | vorpal | `#d89090` | `#AA6666` |

| Глиф | ru | en | `--ench` | в Shattered |
| --- | --- | --- | --- | --- |
| `affection` | очарования | affection | `#ff6fa8` | `#FF4488` |
| `antimagic` | антимагии | anti-magic | `#88eeff` | `#88EEFF` |
| `brimstone` | жара | brimstone | `#ff6a33` | `#FF4400` |
| `camouflage` | маскировки | camouflage | `#7cc24a` | `#448822` |
| `entanglement` | опутывания | entanglement | `#c08a4a` | `#663300` |
| `flow` | амфибии | flow | `#7c96ff` | `#0000FF` |
| `obfuscation` | темноты | obfuscation | `#a8a8a8` | `#888888` |
| `potential` | напряжения | potential | `#ffffff` | `#FFFFFF` |
| `repulsion` | отталкивания | repulsion | `#e8e2c8` | `#FFFFFF` |
| `stone` | гранита | stone | `#a8a090` | `#222222` |
| `swiftness` | скорости | swiftness | `#ffee55` | `#FFFF00` |
| `thorns` | шипов | thorns | `#e8506e` | `#660022` |
| `viscosity` | вязкости | viscosity | `#a77ae0` | `#8844CC` |

Проклятия оружия (annoying, dazzling, displacing, explosive, friendly, polarized, pressurized, sacrificial, wayward, wondrous) и брони (antientropy, bulk, corrosion, displacement, metabolism, multiplicity, overgrowth, stench) — все `--ench: var(--danger)`.

| Класс | Что это |
| --- | --- |
| `.pd-ticon`, `.pd-hicon`, `.pd-sitem` | спрайты Shattered по `data-t`, `data-h`, `data-s` |
| `.pd-hero-window`, `.pd-tab-plus`, `.pd-talent-badge`, `.pd-avatar-wrap.talent` | окно героя с вкладками и «+» |
| `.pd-talents`, `.pd-tier(.locked)`, `.pd-tier-head`, `.pd-tier-sub`, `.pd-tier-points(.free)`, `.pd-talent-row`, `.pd-talent(.zero/.max/.selected)`, `.pd-pips`, `.pd-talent-ghosts`, `.pd-tier-lock`, `.pd-talents-foot` | таланты |
| `.pd-talent-card`, `.pd-talent-progress`, `.pd-talent-levels li(.done/.next)`, `.pd-talent-cost` | карточка таланта |
| `.pd-tpicks(.two)`, `.pd-tpick(.chosen)`, `.pd-tpick-art`, `.pd-tpick-avatar`, `.pd-tpick-name`, `.pd-tpick-desc`, `.pd-tpick-tal`, `.pd-tpick-talents`, `.pd-tpick-act`, `.pd-tpick-intro` | выбор пути и способности (в v17 было `.pd-pick*` — совпадало с панелью предмета рюкзака) |
| `.pd-alch-window`, `.pd-energy`, `.pd-energy-ico`, `.pd-alch`, `.pd-slot.out(.unknown/.empty)`, `.pd-slot.add`, `.pd-alch-arrow(.ready)`, `.pd-alch-out`, `.pd-alch-name`, `.pd-alch-cost(.short)`, `.pd-alch-pick`, `.pd-energize-sum` | котёл |
| `.pd-guide-pages`, `.pd-recipes`, `.pd-recipe`, `.pd-recipe-line`, `.pd-recipe-name` | учебник алхимии |
| `.pd-art-level`, `.pd-steps`, `.pd-art-charge`, `.pd-charge-bar(.seg/.full)`, `.pd-art-state(.on)`, `.pd-charge(.full)` | артефакт |
| `.pd-mark.ench/.glyph(.new)`, `.pd-ench-line(.curse)` | зачарования и глифы |
| `.pd-classes.six`, `.pd-class.new` | 6 классов |

## Привал

Привал заменяет `showTitle`: форма с классами уходит, класс выбирают на сцене. Ассеты — группа `Camp` (в `packages/client/public/assets/camp/`), значки краёв встроены в `bundle.css` как `--spr-quests`, `--spr-mail`, `--spr-mart`.

### Разметка

```html
<main class="pd-camp" id="camp">            <!-- canvas и слой героя ставит PD.camp / ваш рантайм -->
  <div class="pd-camp-ui">
    <div class="pd-camp-top">
      <button class="pd-profile framed" aria-label="Рейтинг">
        <span class="pd-profile-face frame-gold"><i style="--av:0"></i></span>
        <span class="pd-profile-text">
          <span class="pd-profile-name">QA</span>
          <span class="pd-profile-streak"><i class="pd-tro x1 flame"></i>12 дней подряд</span>
          <span class="pd-profile-facts">Рекорд <b>4 320</b> · Забегов <b>37</b></span>
        </span>
        <span class="pd-profile-side"><span class="pd-counter frost"><i class="pd-tro frost"></i>1</span><span class="pd-counter trophies"><i class="pd-tro gold"></i>3</span></span>
      </button>
    </div>
    <div class="pd-camp-edges">
      <nav class="pd-camp-edge left">
        <button class="pd-camp-icon quests" aria-label="Задания, есть новые" title="Задания"><i></i><span class="pd-count dot"></span></button>
        <button class="pd-camp-icon mail" aria-label="Почта, 3" title="Почта"><i></i><span class="pd-count">3</span></button>
      </nav>
      <nav class="pd-camp-edge right">
        <button class="pd-camp-icon ranks" aria-label="Рейтинг" title="Рейтинг"><i></i></button>
        <button class="pd-camp-icon mart" aria-label="Пиксель-Март" title="Пиксель-Март"><i></i></button>
        <button class="pd-camp-icon prefs" aria-label="Настройки" title="Настройки"><i></i></button>
      </nav>
    </div>
    <div class="pd-camp-sheet">
      <div class="pd-daily compact">
        <div class="pd-daily-title"><h3>Подземелье дня</h3></div>
        <div class="pd-daily-rules" aria-label="Сегодня: Во тьму, Припасы — 2 зелья лечения и паёк">
          <span class="bad"><i class="pd-ch-mini" style="--c:5"></i>Во тьму</span>
          <span class="boon" title="2 зелья лечения и паёк"><i class="pd-item" data-i="56"></i>Припасы</span>
          <span class="pd-chip">1 попытка</span>
        </div>
        <button class="pd-button">Спуститься</button>
      </div>
      <div class="pd-actions">
        <button class="pd-button primary big stacked">Продолжить<span class="pd-btn-sub">Воин, уровень 7 · глубина 9</span></button>
        <div class="pd-row"><button class="pd-button">Новая игра</button><button class="pd-button pd-ch-btn"><i class="pd-icon" style="width:24px;height:24px;background-image:var(--spr-challenge-off)"></i>Испытания</button></div>
      </div>
    </div>
  </div>
</main>
```

- `--c` у `.pd-ch-mini` — номер испытания дня в `challenges.png` (как в `challengeList`), дар — значок предмета дара. Сыграно — `.pd-daily.done` с местом, как на старом титуле.
- `.pd-count.dot` — точка без числа; почта показывает число незабранных писем, 0 — без значка.
- Рамка портрета — `frame-bronze | frame-gold | frame-shadow | frame-patron` из `worn.frame`; без рамки — без класса.

### Сцена

```ts
// main.ts — вместо showTitle
const camp = PD.camp(root, { scene: worn.camp ?? 'outdoor', season: seasonOf(new Date()), hero: CLASS_INDEX[selected],
  skin: worn.skins[selected] ?? null, effect: worn.effect ?? null, lang });
// свайп и стрелки меняют класс: слушайте смену и сохраняйте 'pd-class'
```

- Холст 94×203, `image-rendering: pixelated`, CSS 376×812, по центру; слой `.pd-camp-layer` того же размера поверх — кнопка-герой `.pd-camp-hero`, облачко `.pd-camp-bubble`, имя `.pd-camp-name` со стрелками `.pd-camp-arrow.prev/.next`.
- Порядок слоёв за кадр: фон → звёзды → факелы (`torch.png`, 130 мс) → костёр (`fire.png`, 100 мс) → тень и герой → свет (`globalCompositeOperation = 'lighter'`) → частицы.
- Герой смотрит на костёр (отражён по горизонтали), обиженный — от костра.
- Сезон входа: декабрь–февраль — зима, сентябрь–ноябрь — осень, остальное — лето (как сезон снега в Пиксель-Марте).
- Платные привалы — новые товары Пиксель-Марта `kind: 'camp'`: `camp.cave`, `camp.prison`, `camp.hall`; превью товара — тот же `PD.camp` с `crop`.
- Сдвиг на низком экране: `top = min(0, sheetTop − 16 − 129 × 4)` для холста и слоя.
- Фразы касания и обиды — `CAMPT` в `bundle.js` (по три на класс, RU и EN, у Охотницы и Дуэлянтки женский род).

### Обучение по шагу

```html
<div class="pd-coach" role="dialog" aria-label="Враг">
  <div class="pd-coach-ring" style="left:72px;top:380px;width:40px;height:46px"></div>   <!-- клетка цели ± 4 px -->
  <div class="pd-coach-bubble above" style="bottom:450px;--tail:80px">
    <div class="pd-coach-head"><b>Враг</b><span class="pd-coach-step">Шаг 1 из 4</span></div>
    <p class="pd-coach-text">Это <em>крыса</em>. Коснитесь её, чтобы ударить…</p>
    <div class="pd-coach-actions"><button class="pd-button quiet">Пропустить обучение</button><button class="pd-button">Дальше</button></div>
    <div class="pd-coach-dots" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i></div>
  </div>
</div>
```

- Рамку ставьте по клетке карты (`cellRect(x, y)` из рендера) или по кнопке (`getBoundingClientRect`) и обновляйте при сдвиге камеры.
- `.below` — облачко под местом (место в верхней половине), `.above` — над ним. `--tail` — x хвостика от левого края облачка.
- Последний шаг: кнопка `.primary` «Понятно». «Пропустить обучение» сохраняет `pd-coach-done`, как и прохождение.

### Почта

```html
<section class="pd-window pd-mail-window" role="dialog" aria-label="Почта">
  <header class="pd-window-head"><i class="pd-icon" style="width:32px;height:32px;background-image:var(--spr-mail)"></i><div class="pd-titles"><h2 class="pd-heading">Почта</h2></div><button class="pd-close"></button></header>
  <div class="pd-scroll"><div class="pd-mail">
    <article class="pd-letter unread">
      <span class="pd-letter-ico"><i class="pd-tro big gold"></i></span>
      <header class="pd-letter-head"><b>Кубок дня</b><time>сегодня</time></header>
      <p class="pd-letter-text">Подземелье дня 13.10: <em>1 место из 214</em>.</p>
      <div class="pd-letter-act"><span class="pd-letter-gifts"><span class="pd-gift"><i class="pd-tro x1 gold"></i>Золотой кубок</span></span><button class="pd-button primary">Забрать</button></div>
    </article>
    <article class="pd-letter claimed">…<div class="pd-letter-act">…<span class="pd-letter-done">Получено</span></div></article>
  </div></div>
  <div class="pd-mail-foot"><span>Письма хранятся 30 дней</span><button class="pd-button quiet">Забрать всё</button></div>
</section>
```

- Значок письма: кубок дня `gold | silver | bronze`, итоги недели `week`, сезон — `--spr-season`. Награда звёздами — `<i class="pd-icon" style="background-image:var(--spr-stars)"></i><span class="price">+25</span>`, рамка — 16 px рамки из Пиксель-Марта.
- Пустая почта: `<p class="pd-mail-empty">` вместо списка и без подвала.

| Класс | Что это |
| --- | --- |
| `.pd-camp`, `.pd-camp-canvas`, `.pd-camp-layer`, `.pd-camp-hero`, `.pd-camp-name`, `.pd-camp-arrow(.prev/.next)`, `.pd-camp-bubble` | сцена и герой |
| `.pd-camp-ui`, `.pd-camp-top`, `.pd-profile.framed`, `.pd-profile-face(.frame-*)`, `.pd-profile-name` | карточка игрока |
| `.pd-camp-edges`, `.pd-camp-edge(.left/.right)`, `.pd-camp-icon(.quests/.mail/.ranks/.mart/.prefs)`, `.pd-count(.dot)` | значки по краям |
| `.pd-camp-sheet`, `.pd-daily.compact`, `.pd-daily-title`, `.pd-daily-rules span(.bad/.boon)` | нижняя панель |
| `.pd-coach`, `.pd-coach-ring`, `.pd-coach-bubble(.above/.below)`, `.pd-coach-head`, `.pd-coach-step`, `.pd-coach-text`, `.pd-coach-actions`, `.pd-coach-dots` | обучение по шагу |
| `.pd-mail-window`, `.pd-mail`, `.pd-letter(.unread/.claimed)`, `.pd-letter-ico`, `.pd-letter-head`, `.pd-letter-text`, `.pd-letter-act`, `.pd-letter-gifts`, `.pd-gift`, `.pd-letter-done`, `.pd-mail-empty`, `.pd-mail-foot` | почта |


## Обновление «Shattered», часть 2 (v19)

### Срочно: `.pd-pick` → `.pd-tpick`

В v17 выбор пути и способности брони использовал `.pd-pick*` — это имя уже было у панели предмета рюкзака (v10), и стили ломали карточку предмета. Теперь:

| v17 | v19 |
| --- | --- |
| `.pd-picks`, `.pd-picks.two` | `.pd-tpicks`, `.pd-tpicks.two` |
| `.pd-pick`, `.pd-pick.chosen` | `.pd-tpick`, `.pd-tpick.chosen` |
| `.pd-pick-art`, `-avatar`, `-name`, `-desc`, `-tal`, `-talents`, `-act`, `-intro` | `.pd-tpick-art`, `-avatar`, `-name`, `-desc`, `-tal`, `-talents`, `-act`, `-intro` |

`.pd-pick`, `.pd-pick-head`, `.pd-pick-actions`, `.pd-pick-dropbtn` остаются за рюкзаком.

### Облики новых классов

- Листы: `skins/duelist-ash|royal|shadow.png`, `skins/cleric-ash|royal|shadow.png` — как у остальных; в `shop.ts` добавьте 6 товаров `skin.duelist.*`, `skin.cleric.*`.
- Аватар облика: `avatars-skins.png`, ячейка = `(класс − 4) × 3 + [ash, royal, shadow]`; CSS: `<i class="skin" style="--av:N">` внутри `.pd-profile-face` / `.pd-avatar` (атлас `--atlas-avatar-skins`).

### Алхимия

```html
<div class="pd-alch">
  <button class="pd-slot">…</button><button class="pd-slot">…</button><button class="pd-slot add"></button>
  <canvas class="pd-alch-pot" data-mode="brew" aria-hidden="true"></canvas>      <!-- idle | brew | cata -->
  <div class="pd-slot out catalyst"><canvas class="pd-catalyst" aria-hidden="true"></canvas></div>
</div>
```

- Котёл заменяет стрелку. Состояния: `idle` — пока рецепта нет; по «Сварить» — `brew` (или `cata`), 540 мс нагрева и 440 мс «пуфа», потом результат появляется в ячейке и котёл снова кипит.
- Энергия: по «Расщепить» вызовите полёт осколков (`PD.alchEnergy`) — 3 осколка от вещи, задержка 90 мс между вещами; число на счётчике меняется, когда долетел последний.
- Кучка энергии на полу — `energy-pile.png` как предмет на клетке, блик 4 кадра.
- Выбор безделушки: `.pd-trinkets` → `.pd-trinket(.selected)` с `.pd-trinket-art`, `-name`, `-desc` и кнопкой.
- Значки окон выбора — `.pd-sitem` с кадрами из `ItemSpriteSheet` (`PD.demo.shIcons`): камни 336–347, заклинания 416–430, безделушки 272–288, пустые ячейки 13 / 15 / 7.
- Ненайденная страница: в учебнике вместо списка — `<div class="pd-guide-lost"><i class="pd-page-lost"></i><b>…</b><p>…</p><div class="pd-recipes ghost">…</div></div>`; вкладка страницы — `.lost`. Выбранную вкладку прокрутите в видимую часть (`scrollIntoView({ inline: 'nearest' })`).

### Баффы с оттенками

`<i class="pd-tbuff large" data-tb="N"></i>` (32 px) или `<i class="pd-tbuff" data-tb="N"></i>` (14 px). Листы уже окрашены, `hardlight` в коде не нужен.

| N | ключ | имя | иконка Shattered | окраска |
| --- | --- | --- | --- | --- |
| 0 | `haste` | Ускорение | 41 | тон 47°, насыщенность 0.95 |
| 1 | `stamina` | Выносливость | 41 | тон 119°, насыщенность 0.8 |
| 2 | `fireImbue` | Огненная пропитка | 55 | ×2/0.75/0 |
| 3 | `toxicImbue` | Ядовитая пропитка | 55 | ×1/1.5/0 |
| 4 | `frostImbue` | Ледяная пропитка | 55 | ×0/1.6/2.6 |
| 5 | `barrier` | Барьер | 20 | тон 191°, насыщенность 0.85 |
| 6 | `arcaneArmor` | Тайная броня | 20 | тон 281°, насыщенность 0.7 |
| 7 | `prismatic` | Призматический щит | 20 | тон 216°, насыщенность 0.28 |
| 8 | `prismaticFull` | Призматический щит, усилен | 20 | ×1.6/1.5/0.9 |
| 9 | `healing` | Лечение | 44 | как есть |
| 10 | `aquaHealing` | Водное лечение | 44 | тон 180°, насыщенность 0.85 |
| 11 | `might` | Рост здоровья | 44 | тон 29°, насыщенность 0.95 |
| 12 | `cloak` | Плащ теней | 12 | тон 277°, насыщенность 0.6 |
| 13 | `invisible` | Невидимость (зелье) | 12 | как есть |
| 14 | `hourglass` | Песочные часы: стазис | 7 | тон 29°, насыщенность 0.9 |
| 15 | `slow` | Замедление | 7 | как есть |
| 16 | `capeThorns` | Плащ шипов | 31 | тон 29°, насыщенность 0.6 |
| 17 | `talisman` | Талисман предвидения | 32 | тон 180°, насыщенность 0.65 |

### Карта

- Призматическое отражение рисуйте листом `prismatic.png` вместо листа героя: кадры те же (0–20), ряд = `floor(t / 120) % 4`.
- Союзник: `ally-heart.png` над спрайтом, на 6–7 px выше головы, кадр `floor(t / 400) % 2` (второй — на 1 px ниже).
- Призрак-спутник: `globalAlpha = 0.82`, покачивание `sin(t / 500) × 2 px`; свет — радиальный градиент r = 1,6 клетки `rgba(150,210,255,0.22 ± 0.06)`, `lighter`.
- Эфирные цепи: звено каждые 5 px вдоль линии, повёрнуто по направлению, чередуются кадры 0/1; наконечник на конце; вылет 600 мс, затем притягивание.
- Снаряды палочек: ряд `wand-bolts.png` по палочке (`PD.demo.wands`), кадр `floor(t / 90) % 2`, за снарядом 4 квадрата 2×2 цвета шлейфа с прозрачностью 0,4…0,1.
- Опасность: `<button class="pd-danger" aria-label="Видят вас: 3">3</button>` справа под HUD; касание переводит камеру на следующего врага и ставит рамку `.pd-danger-ring` на его клетку; новый враг — класс `.new` на 1,5 с.

### Панель, снаряжение, журнал

- Быстрые слоты: настройка «Быстрых слотов: 2 / 4 / 6». 4 — `.pd-toolbar.q4` (7 кнопок в ряд, осмотр — долгое касание поиска), 6 — `.pd-toolbar.q6` с `.pd-quickbar` из 6 слотов над панелью.
- Пустая ячейка «разное» — `.pd-slot.placeholder.misc`.
- «Украсть»: `<button class="pd-button primary"><i class="pd-steal"></i>Украсть</button>`.
- Новые отметки журнала: `<i class="pd-jicon2" data-j2="N">` (`journal2.png`): 0 лавка, 1 лавка беса, 2 крысиный король, 3 логово демонов, 4 потерянный рюкзак, 5 маяк возвращения, 6 дальний колодец, 7–13 особые этажи (пропасти, вода, заросли, тьма, большой, ловушки, тайники).

### Дротики и камень усиления

```html
<div class="pd-dart-seeds"><button class="pd-slot selected" aria-label="Солнцетрав"><i class="pd-sitem" data-s="387"></i><span class="pd-qty">3</span></button>…</div>
<div class="pd-dart-preview"><span class="pd-slot"><i class="pd-sitem" data-s="164"></i><span class="pd-qty">2</span></span><span class="pd-dart-text"><b>Солнцетрав → 2 исцеляющих дротика</b>Лечит того, в кого попал…</span></div>

<div class="pd-aug-opts" role="radiogroup">
  <button class="pd-aug-opt selected" role="radio" aria-checked="true"><span class="pd-aug-name">Скорость</span>
    <span class="pd-aug-row"><span>Урон</span><b class="bad">7–17</b><em class="bad">−30%</em></span>
    <span class="pd-aug-row"><span>Удар</span><b class="good">0,67 хода</b><em class="good">на треть быстрее</em></span></button>
  …
</div>
```

Семена → дротики: кадр дротика = 161 + (кадр семени − 384). Текущий вариант — чип «сейчас» в `.pd-aug-name`.

### Доски

- `.pd-rank.prize` — под номером `<i class="pd-tro x1 gold|silver|bronze|week">` (кубок дня 1–3, медаль недели 1–10).
- `<div class="pd-ranks-cut">Медали недели — места 1–10</div>` после 10-й строки недели.
- `<p class="pd-board-timer"><i></i>Доска закроется через <b>5 ч 12 мин</b> · награды придут почтой</p>` под `.pd-board-note`; обновляйте раз в минуту, в последний час — раз в секунду.
- Вкладки: День, Неделя, Лучшие, Мои.


## Релиз Shattered (v20)

### «Что нового»

```html
<section class="pd-window pd-news" role="dialog" aria-label="Что нового">
  <header class="pd-window-head"><div class="pd-titles"><h2 class="pd-heading">Что нового</h2><span class="pd-sub">Версия 2.4</span></div></header>
  <ul class="pd-news-list">
    <li><span class="pd-news-tag add">Добавлено</span><span>Обучение по шагу для новых игроков.</span></li>
    <li><span class="pd-news-tag now">Теперь</span><span>…</span></li>
    <li><span class="pd-news-tag fix">Поправлено</span><span>…</span></li>
    <li><span class="pd-news-tag bal">Баланс</span><span>…</span></li>
  </ul>
  <div class="pd-actions"><button class="pd-button primary">Играть</button><button class="pd-button quiet">Все изменения</button></div>
  <p class="pd-note center">Это окно показывается один раз после обновления</p>
</section>
```

Большое: `.pd-news.big`, первым ребёнком — `<div class="pd-news-banner" role="img" aria-label="Шесть героев у костра"><span class="pd-news-kick">Большое обновление · Версия 2.4</span><b>Shattered</b></div>`, затем `<p class="pd-news-sub">` и `<ul class="pd-news-big"><li><span class="pd-news-ico">…</span><span><b>Два новых класса</b>…</span></li>…</ul>`. Значок классов — `<span class="pd-news-faces"><i style="--av:4"></i><i style="--av:5"></i></span>`.

Показ: если `pd-seen-version` меньше текущей — окно после загрузки, до Привала; «Играть» и крестик записывают версию. Для большого релиза (`major: true` в списке изменений) — `.big`.

### «Первопроходец»

- Выдача: сервер ставит трофей `pioneer` всем, у кого есть забег раньше даты релиза, и кладёт письмо в почту. На полке «Мои» он первый.
- Значки: `.pd-tro.pioneer`, `.pd-tro.big.pioneer`; эмблема в письме — `<i class="pd-pioneer"></i>` (`--spr-pioneer`, 48×48 ×2).
- Письмо в списке: `<article class="pd-letter special unread">` с `.pd-tro.big.pioneer`; открытое: `.pd-letter-open` (эмблема, «Памятный кубок», заголовок, текст, `.pd-gift`, «Забрать», дата).

### Сообщить о проблеме

```html
<section class="pd-window pd-report" role="dialog" aria-label="Сообщить о проблеме">
  <header class="pd-window-head"><i class="pd-icon" style="width:32px;height:32px;background-image:var(--spr-report)"></i><div class="pd-titles"><h2 class="pd-heading">Сообщить о проблеме</h2></div><button class="pd-close"></button></header>
  <label class="pd-field"><span class="pd-field-label">Что случилось <small>необязательно</small></span><textarea class="pd-textarea" rows="4" placeholder="Например: после лестницы пропал рюкзак"></textarea></label>
  <button class="pd-check" role="checkbox" aria-checked="true"><i></i><span><b>Приложить журнал забега</b><small>Ходы и действия этого забега, версия игры и телефона. Без имени и переписки.</small></span></button>
  <div class="pd-actions"><button class="pd-button primary">Отправить</button><button class="pd-button quiet">Отмена</button></div>
</section>
```

- Во время отправки: `<button class="pd-button primary" disabled><span class="pd-dots"><i></i><i></i><i></i></span> Отправляем…</button>`.
- После: `.pd-report-done` — `.pd-report-check`, «Отправлено, спасибо!», текст, `.pd-badge-row` со значком «Охотник за багами», «Закрыть».
- В настройках: `<button class="pd-linkrow report"><i class="pd-icon" style="background-image:var(--spr-report)"></i><span>Сообщить о проблеме</span></button>`; на экране ошибки — обычная кнопка с тем же значком под «Перезапустить».
- Отправка — тот же канал, что `/paysupport` в чат админа: текст, `runId`, версии, при отметке — журнал забега.

### Нет связи и обновление

- Окно `.pd-offline` (`role="alertdialog"`): `.pd-offline-ico`, заголовок, два абзаца, «Повторить» (основная), «Играть без связи», «Проверим сами через 20 с».
- В игре: `<span class="pd-net-badge" role="status">Нет связи · забег засчитается позже</span>` под HUD.
- Обновление: `<div class="pd-toast update" role="status">Вышла новая версия — обновляем</div>`; значок крутится шагами 8 × 45°, при `prefers-reduced-motion` стоит.

### Правила доски

`<button class="pd-help" aria-label="Правила доски">?</button>` в шапке `.pd-boards-window`; окно:

```html
<dl class="pd-rules">
  <div><dt><span class="pd-rules-ico"><i class="pd-tro x1 gold"></i></span>Очки</dt><dd>Как в оригинале: золото + уровень × глубина × 100…</dd></div>
  …
</dl>
```

Пункты: очки (`gold`), места (`week`), когда закрывается (`--spr-hourglass`), равные очки (`<b class="pd-rules-eq">=</b>`), что засчитывается (`--spr-check`).

| Класс | Что это |
| --- | --- |
| `.pd-news(.big)`, `.pd-news-list`, `.pd-news-tag(.add/.now/.fix/.bal)`, `.pd-news-banner`, `.pd-news-kick`, `.pd-news-sub`, `.pd-news-big`, `.pd-news-ico`, `.pd-news-faces` | «Что нового» |
| `.pd-tro.pioneer`, `.pd-pioneer`, `.pd-letter.special`, `.pd-letter-open`, `.pd-letter-kind` | «Первопроходец» |
| `.pd-report`, `.pd-field-label`, `.pd-textarea`, `.pd-check`, `.pd-report-done`, `.pd-report-check`, `.pd-badge-row`, `.pd-linkrow.report` | сообщить о проблеме |
| `.pd-offline`, `.pd-offline-ico`, `.pd-net-badge`, `.pd-toast.update` | нет связи, обновление |
| `.pd-help`, `.pd-rules`, `.pd-rules-ico`, `.pd-rules-eq` | правила доски |


## Дополнения от сборки «Привала» (v20)

### Пиксель-Март: пять полок

```html
<div class="pd-tabs compact shelf" role="tablist">
  <button class="pd-tab skin" role="tab" aria-selected="false" aria-label="Облики" title="Облики"><i class="pd-tab-ico skin"></i><span>Облики</span></button>
  <button class="pd-tab camp" role="tab" aria-selected="true" aria-label="Привалы" title="Привалы"><i class="pd-tab-ico camp"></i><span>Привалы</span></button>
  <button class="pd-tab effect" …><i class="pd-tab-ico effect"></i><span>Эффекты</span></button>
  <button class="pd-tab frame" …><i class="pd-tab-ico frame"></i><span>Рамки</span></button>
  <button class="pd-tab patron" …><i class="pd-tab-ico patron"></i><span>Меценат</span></button>
</div>
```

Подпись у невыбранных скрыта CSS (`[aria-selected="false"] span { display: none }`), так что в разметке она есть всегда. Сжатие «Мецената» до значка — убрать.

Карточка привала: `<div class="pd-offer-art camp"><i class="pd-camp-card" style="--card:var(--spr-camp-card-cave)" role="img" aria-label="Пещера"></i></div>` — файлы `camp-card-*.png` (группа `Camp`), 66×48, `background-size: 132px 96px`.

Окно привала `.pd-camp-offer`: `<div class="pd-camp-peek" data-camp="cave"></div>` и `PD.camp(box, { scene: 'cave', scale: 3, crop: [0, 46, 94, 73], label: false })`; затем `.pd-info`, `<ul class="pd-camp-facts">`, `.pd-note`, кнопки по состоянию (см. README компонента). «Примерить» — 10 секунд с этим фоном на настоящем привале и обратно.

### Почта

Удалите `<br>` между наградой и «Забрать». Достаточно стилей бандла: `.pd-letter` — `"ico head" "ico text" "act act"`, `.pd-letter-act` — `flex-wrap: wrap`, кнопка `margin-left: auto`, `.pd-gift` в письме — `white-space: normal`. Числа с разделителем тысяч и «4 место» — через U+00A0.

### Лицо на «Продолжить»

Классы `.with-face`, `.pd-camp-face`, `.pd-btn-label` — разметка в README `CampFace`. Портрет — герой сохранённого забега (`run.heroClass`, облик — `run.skin`), не тот, что сейчас в сцене.

### Правила дня

```html
<div class="pd-daily-title"><h3>Подземелье дня</h3><small class="pd-daily-left">1 попытка · ещё 5 ч</small></div>
<div class="pd-daily-rules"><span class="bad"><i class="pd-ch-mini" style="--c:2"></i>Фармакофобия</span><span class="boon"><i class="pd-item" data-i="50"></i>Точильный камень</span></div>
```

Плашку `.pd-chip` «1 попытка» из строки правил — убрать. Когда попытка сыграна — «Сыграно · 12 место»; время — до 00:00 UTC.

### Широкий экран и высокие телефоны

- `PD.camp(el, { fill: true })` (в `campScreen` по умолчанию): холст больше 94×203 — `crop = [−ex, −et, 94 + 2ex, 203 + et + 24]`, где `ex = ⌈(ширина / 4 − 94) / 2⌉`, `et = ⌈высота / 4 / 2⌉`; фон дорисовывается один раз на сцену (`extBg`). `shift(y)` учитывает `et`; `cam.ext` — насколько можно опустить сцену.
- Подгонка: `shift = min(cam.ext, верх панели − 16 − 516)` — теперь и положительная (высокие экраны).
- `.pd-camp-ui { max-width: 440px; margin: 0 auto; }` — интерфейс колонкой; на телефоне ничего не меняется.
- При смене размера пересоздавайте `PD.camp` (или пересчитайте `crop` и сбросьте кэш фона).

| Класс | Что это |
| --- | --- |
| `.pd-tabs.shelf`, `.pd-tab-ico.skin/.camp/.effect/.frame/.patron` | пять полок |
| `.pd-camp-card`, `.pd-offer-art.camp`, `.pd-camp-offer`, `.pd-camp-peek`, `.pd-camp-facts` | привалы в Марте |
| `.with-face`, `.pd-camp-face`, `.pd-btn-label` | лицо на «Продолжить» |
| `.pd-daily-left` | попытки и время под заголовком |


## Монстры Shattered (v21)

### Портреты

`bestiary.png` (группа `Monsters`): ячейки 24×24, 11 в ряд. Номер — порядок в `PD.demo.best.keys`. Столбец `n % 11`, строка `⌊n / 11⌋`:

```html
<i class="pd-mob" style="--mx:8;--my:0"></i>              <!-- DM-100, ×2 = 48 px -->
<i class="pd-mob x3" style="--mx:8;--my:0"></i>           <!-- ×3 = 72 px -->
<i class="pd-mob silhouette" style="--mx:5;--my:2"></i>   <!-- не встречен -->
```

На карте этот же атлас годится для неподвижных портретов, но в игре у вас анимированные листы Shattered — атлас только для интерфейса.

### Бестиарий

```html
<div class="pd-tabs compact shelf" role="tablist">
  <button class="pd-tab" role="tab" aria-selected="false" aria-label="Зелья" title="Зелья"><i class="pd-item pd-tab-item" data-i="57"></i><span>Зелья</span></button>
  … Свитки 44, Кольца 34, Палочки 50 …
  <button class="pd-tab" role="tab" aria-selected="true" aria-label="Бестиарий" title="Бестиарий"><i class="pd-tab-ico bestiary"></i><span>Бестиарий</span></button>
</div>
<div class="pd-cat-count">Встречено 25 из 66 · убито 287</div>
<div class="pd-scroll pd-best">
  <section class="pd-best-group">
    <header class="pd-best-head"><b>Тюрьма</b><span>глубины 6–9</span><em>5/5</em></header>
    <div class="pd-best-grid" role="listbox" aria-label="Тюрьма">
      <button class="pd-best-cell selected" role="option" aria-selected="true" aria-label="DM-100, убито 11"><i class="pd-mob" style="--mx:8;--my:0"></i><span class="pd-best-n">11</span></button>
      <button class="pd-best-cell unseen" role="option" aria-selected="false" aria-label="Ещё не встречен"><i class="pd-mob silhouette" style="--mx:6;--my:1"></i></button>
    </div>
  </section>
</div>
<div class="pd-best-detail"><span class="pd-best-face"><i class="pd-mob x3" style="…"></i></span><span class="pd-best-text"><b>DM-100</b><small>Тюрьма · глубины 6–9 · Убито: 11</small><span>…</span></span></div>
```

Детали `.pd-best-detail` — вне прокрутки, под ней. Не встреченный — `.pd-best-detail.unseen`, силуэт ×3. «Убито:» — с неразрывным пробелом.

### Ауры чемпионов

На карте: за спрайтом, по центру спрайта, `globalCompositeOperation = 'lighter'`. Готовая отрисовка — `auraCanvas(цвет, лучей, радиус, шаг)` внутри `PD.demo.mobFx` в бандле. Шаг = `⌊t / 167⌋ mod 24`, угол = шаг × 15° + 45°. Кэшируйте 24 кадра на чемпиона. Цвета и лучи — в README `MobChampions`.

Окно существа:

```html
<section class="pd-window pd-mob-window" role="dialog">
  <header class="pd-window-head"><span class="pd-mob-face champ" style="--champ:#ff8800"><i class="pd-mob" …></i></span><div class="pd-titles"><h2 class="pd-heading">Гнолл-громила</h2><span class="pd-champ-tag" style="--champ:#ff8800">Огненный чемпион</span></div><button class="pd-close"></button></header>
  <div class="pd-mob-hp"><div class="pd-bar" style="--v:.8"><span class="pd-bar-text">Здоровье 32/40</span></div></div>
  <ul class="pd-mob-buffs"><li><i class="pd-mbuff large" style="--ix:4"></i><span><b style="color:#ff8800">Огненный чемпион</b>+25% урона вблизи…</span></li></ul>
</section>
```

### Снаряды и лучи

- Шар: кадр 8×8 из `mob-bolts.png` (или `wand-bolts.png` для огня и мороза) ×2, смена кадра 90 мс, полёт 600 мс, шлейф 4 квадрата 2×2 цвета снаряда.
- Молния DM-100: ломаная из 5 отрезков, поперечный сдвиг до ±9 px, каждые 66 мс новая; три прохода — `#4a7aff` 3 px, `#ffffff` 1 px, `#bcd4ff` 1 px.
- Лучи: текстура 16×8 из `mob-beams.png`, повернуть по направлению и класть подряд; прозрачность 1 → 0,66 → 0,33 за 500 мс. Смертельный взгляд — до стены за героем, световой луч грозового элементаля — на 60% дальше цели.
- Злой глаз: 1 с зарядки — 6 точек 1×1 сходятся к глазу (`#e0a0ff`, `#ffffff`), потом луч.
- Попадание: значок состояния 16×16 ×2 над героем поднимается 5 ступенями по 100 мс, гаснет; в HUD — `<button class="pd-buff"><i class="mob" style="--ix:1"></i></button>`.

### Гуль и эбеновый мимик

- `ghoul-fall.png`: 0 стоит, 1–2 падает, 3 лежит, 4 мёртв. Упавший держит кадр 3; пунктир к напарнику и точки ходов — README `MobGhoulMimic`. В окне — `<i class="pd-ghoul-fallen"></i>`, `.pd-bar.fallen`, `.pd-rise-pips`.
- `ebony-hidden.png`: 0 — спрятан, 1 — вспышка (раз в 2,4 с на 133 мс), 2 — сундук, 3 — мимик. В окне — `<i class="pd-ebony-hidden"></i>` (вспышка — CSS-анимацией).

### Состояния

`.pd-buff i.mob` (7×7 ×3) и `.pd-mbuff`, `.pd-mbuff.large` (16×16 ×2), `--ix`: 0 уязвимость, 1 порча, 2 деградация, 3 слабость, 4–9 чемпионы. Окно — `.pd-window.narrow.pd-buff-window`.

| Класс | Что это |
| --- | --- |
| `.pd-mob`, `.pd-mob.x3`, `.pd-mob.silhouette` | портрет существа |
| `.pd-best`, `.pd-best-group`, `.pd-best-head`, `.pd-best-grid`, `.pd-best-cell(.unseen/.selected)`, `.pd-best-n`, `.pd-best-detail`, `.pd-best-face`, `.pd-best-text` | бестиарий |
| `.pd-tab-item`, `.pd-tab-ico.bestiary` | значки подвкладок каталога |
| `.pd-mob-window`, `.pd-mob-face(.champ)`, `.pd-champ-tag`, `.pd-mob-hp`, `.pd-mob-buffs` | окно существа |
| `.pd-ghoul-fallen`, `.pd-bar.fallen`, `.pd-rise-pips`, `.pd-ebony-hidden` | гуль и мимик |
| `.pd-buff i.mob`, `.pd-mbuff(.large)`, `.pd-buff-window` | состояния |


## Последний пакет перед Shattered (v22)

### Священный том и Троица

```html
<section class="pd-window pd-hero-window pd-tome" role="dialog">
  <header class="pd-window-head"><div class="pd-slot"><i class="pd-sitem" style="--u:2px;--ix:7;--iy:16"></i></div><div class="pd-titles"><h2 class="pd-heading">Священный том</h2><span class="pd-sub">Жрец · уровень 14</span></div><button class="pd-close"></button></header>
  <div class="pd-tome-charge"><span>Заряд <b>6</b> из 10</span><span class="pd-charge-pips"><i class="on"></i>…<i></i></span></div>
  <div class="pd-scroll"><div class="pd-talents">
    <section class="pd-tier pd-spell-tier"><header class="pd-tier-head"><h3>Ярус 2</h3><span class="pd-tier-sub">таланты 2-го яруса</span></header>
      <div class="pd-spell">
        <button class="pd-spell-main"><span class="pd-spell-ico"><i class="pd-hicon" style="--u:2px;--ix:6;--iy:5"></i></span><span class="pd-spell-text"><span class="pd-spell-line"><b>Солнечный луч</b><span class="pd-cost"><i class="pd-cost-ico"></i>1</span></span><small>Урон издалека и слепота.</small></span></button>
        <button class="pd-quick" role="radio" aria-checked="true" aria-label="Быстрое заклинание"></button>
      </div>
    </section>
  </div></div>
</section>
```

Номер значка: `--ix = n % 8`, `--iy = ⌊n / 8⌋` в `hero_icons.png`. Бесплатно — `.pd-cost.free` с «0». Не хватает заряда — `.pd-spell.low` и `aria-disabled` на кнопке. Троица: `.pd-trinity` → `.pd-forms` → `.pd-form.body|.mind|.spirit(.selected)` с `.pd-form-head` и `.pd-form-pick`.

### Кнопка действия

```html
<div class="pd-actind-wrap"><button class="pd-actind" style="--ind:#5500bb" aria-label="Способность оружия: 2"><i class="pd-sitem" style="--u:2px;--ix:3;--iy:6"></i><span class="pd-actind-n">2</span></button></div>
<div class="pd-actind-wrap r2"><button class="pd-actind swap" style="--ind:#5500bb"><span class="pd-wslot">…</span><i class="pd-swap-ico"></i><span class="pd-wslot spare">…</span></button></div>
```

Состояния: `.charging` + `<span class="pd-actind-fill">` и `--v`; `.aiming` + `aria-pressed="true"` + `<i class="pd-actind-aim">`; `.stance(.on)`. Цвета — README `ActionStates`. Приёмы Монаха — `.pd-monk-window` → `.pd-monk-ab(.low)` с `.pd-monk-ico` и `.pd-energy-pips`.

### Состояния и листы

- HUD: `<i class="cleric" style="--ix:N">` внутри `.pd-buff` (Клирик). Окно и списки: `.pd-cbuff(.large)`, `.pd-tlbuff(.large)` (таланты), `.pd-cmbuff(.large)` (комбо), `.pd-tbuff2.large` с `--ix/--iy` (любой значок `large_buffs.png` Shattered, 16 в ряд).
- Заклинания над героем — `spell-sprites.png`, кадр N = `SpellSprite` N; 8 — «мастерство» из PD 1.9.

### Союзник света и остаточный образ

Рецепты тинта — README `ClericLooks`: союзник — плоский силуэт (255, 250, 200) × 0,85 + ореол; усиленный — `tint(1.33, 1.33, 0.83, 0.4…0.6)`; образ — прозрачность 0,6 и 5 ступеней до 0 за 3 с.

### Хранительница

`.pd-warden-window` → `.pd-warden-list` → `li` с `.pd-wplant`, `.pd-spell-text`, `.pd-weffect` (`--ix` 0–11 в порядке README `WardenPlants`). В окне растения — `<p class="pd-warden-note"><i class="pd-weffect" style="--ix:3"></i><span><b>Хранительница:</b> …</span></p>`.

### Счёт

`.pd-score` → `.pd-score-row(.max)` (`.pd-spart`, `.pd-score-name`, `.pd-score-val` с `.pd-max`), `.pd-score-mul`, `.pd-score-total`. Карточка «Мои» — `.pd-score-card` с `.pd-score-mini`. Готовая разметка — `PD.demo.scoreTable(lang, { vals, win, chal, compact })`.

### Защита от промаха

```html
<section class="pd-window narrow pd-confirm" role="alertdialog">
  <div class="pd-confirm-art"><i class="pd-confirm-ico trap"></i></div>
  <h2 class="pd-heading center">Наступить на ловушку?</h2>
  <p class="pd-info center"><b>Огненная ловушка.</b> Подожжёт вас и всё вокруг.</p>
  <button class="pd-check small" role="checkbox" aria-checked="false"><i></i><span><b>Больше не спрашивать</b></span></button>
  <div class="pd-row"><button class="pd-button quiet">Нет</button><button class="pd-button primary">Шагнуть</button></div>
</section>
```

### Бестиарий

`bestiary.png` теперь 264×168 (7 рядов): ячейки 66–68 — зловонная крыса, гнолл-трюкач, огромный краб, группа «Задания» между боссами и «Всюду». Размеры фона в `.pd-mob` — 528×336 (×3 — 792×504).

| Класс | Что это |
| --- | --- |
| `.pd-tome`, `.pd-tome-charge`, `.pd-charge-pips`, `.pd-spell-tier`, `.pd-spell(.low)`, `.pd-spell-main`, `.pd-spell-ico`, `.pd-spell-text`, `.pd-spell-line`, `.pd-cost(.free)`, `.pd-quick` | священный том |
| `.pd-trinity`, `.pd-forms`, `.pd-form`, `.pd-form-head`, `.pd-form-pick` | Троица |
| `.pd-actind(.charging/.aiming/.swap/.stance)`, `.pd-actind-wrap(.r2)`, `.pd-actind-n`, `.pd-actind-fill`, `.pd-actind-aim`, `.pd-wslot`, `.pd-swap-ico`, `.pd-aim-toast` | кнопка действия |
| `.pd-monk-window`, `.pd-monk-ab`, `.pd-monk-ico`, `.pd-energy-pips` | приёмы Монаха |
| `.pd-cbuff`, `.pd-tlbuff`, `.pd-cmbuff`, `.pd-tbuff2`, `.pd-spellspr` | значки состояний и заклинаний |
| `.pd-warden-window`, `.pd-warden-list`, `.pd-wplant`, `.pd-weffect`, `.pd-warden-note` | Хранительница |
| `.pd-score`, `.pd-score-row`, `.pd-spart`, `.pd-max`, `.pd-score-total`, `.pd-score-card`, `.pd-score-mini` | счёт |
| `.pd-confirm`, `.pd-confirm-art`, `.pd-confirm-ico`, `.pd-check.small` | защита от промаха |


## После форума (v23)

### Подтверждения

```html
<section class="pd-window narrow pd-confirm2" role="alertdialog">
  <h2 class="pd-heading center">Начать новую игру?</h2>
  <p class="pd-info center">Сохранённый забег пропадёт: <b>Воин · ур.&nbsp;7 · гл.&nbsp;9</b>.</p>
  <div class="pd-confirm-row">
    <button class="pd-button quiet">Отмена</button>
    <button class="pd-button primary hold" style="--p:0"><span class="pd-hold-fill"></span><span class="pd-hold-text">Заменить</span></button>
  </div>
  <p class="pd-hold-hint">удерживайте 1,2 с</p>
  <div class="pd-confirm-more"><button class="pd-button">Продолжить забег</button></div>
</section>
```

Удержание: на `pointerdown` — `.holding` и «Держите…», каждые 100 мс `--p += 1/12`; `pointerup` / `pointerleave` до конца — `--p: 0` и обычная подпись; 12-я ступень — `.done`, «Заменено», действие. `.pd-hold-label` занят подсказкой жестов — у кнопки `.pd-hold-text`.

Все прежние «Да/Нет» — глаголами. Пропасть: «Остаться» / «Прыгнуть».

### Панель

`.pd-toolbar.tb2` (флекс): `.pd-tool.wait`, середина (`.pd-tool.info` или `.pd-tool.quick` × n), `.pd-tool.search.gap`, `.pd-tool.bag`. С 4 слотами — `.dense`. С 6 — `.q6` с `.pd-quickbar` сверху. Значки — `--spr-tool-wait2`, `--spr-tool-search2`.

### «Памятка»

Третья вкладка журнала. Список — `.pd-guide-list > li > .pd-guide-row(.read)` с `.pd-guide-ico`, `.pd-spell-text`, `.pd-chev`. Страница — `.pd-window-head` с `.pd-back`, `.pd-guide-title`, `.pd-scroll.pd-guide-page`. Ловушки — `.pd-trap-legend li > .pd-trapc[--c] + span > b + small`. Сравнение — `.pd-compare > div > header + ul`.

### Метка забега

`<span class="pd-runtag ranked" title="Забег идёт в рейтинг"><i style="--ix:0"></i>зачёт</span>` — `--ix`: 0 зачёт, 1 повтор, 2 свой сид, 3 без зачёта.

### Испытания

`.pd-ch9(.big)[--c]` — новый лист на 9 кадров. Строка — `.pd-challenge9(.info) > .pd-challenge + .pd-ch-info`. Старый `.pd-ch-icon` / `.pd-ch-mini` (7 кадров) оставлен для v11–v22; переходите на `.pd-ch9`.

| Класс | Что это |
| --- | --- |
| `.pd-confirm2`, `.pd-confirm-row`, `.pd-confirm-more`, `.pd-button.hold(.holding/.done/.anim)`, `.pd-hold-fill`, `.pd-hold-text`, `.pd-hold-hint` | подтверждения |
| `.pd-toolbar.tb2(.dense/.q6)`, `.pd-tool.wait/.gap` | панель |
| `.pd-guide-window`, `.pd-guide-list`, `.pd-guide-row(.read)`, `.pd-guide-ico(.big)`, `.pd-guide-img`, `.pd-chev`, `.pd-back`, `.pd-guide-title`, `.pd-guide-page`, `.pd-guide-points`, `.pd-trap-legend`, `.pd-trapc`, `.pd-compare` | «Памятка» |
| `.pd-runtag(.ranked/.replay/.seed/.unranked)`, `.pd-runtag-line`, `.pd-menu-sub` | метка забега |
| `.pd-ch9(.big)`, `.pd-challenge9(.info)`, `.pd-ch-info`, `.pd-new-tag`, `.pd-boss-list` | испытания |


## Арт v24 · один Pixel Dungeon

Полный проход по арту по пакету аудита. Правила — карточка «Арт-дирекция», список несовпадений — «Аудит арта», было/стало — «Персонажи v24», «Мир v24», «Бафы и значки v24», снимки игры — «Было и стало · регионы/экраны» (полный набор в `docs/design/previews/v24/`).

**Коду ничего менять не нужно:** все листы лежат по прежним путям, того же размера и раскладки, номера кадров те же. Достаточно заменить файлы и пересобрать `ui.css`. Ниже — необязательные правки, которые убирают последние швы.

### 1. Заменить файлы

Скопируйте `packages/client/public/assets/` из архива поверх своей папки (64 файла, новых нет):

| Файл (`packages/client/public/assets/`) | Размер | Что теперь |
| --- | --- | --- |
| `avatars.png` | 144×32 | первые 144 px `avatars.png` Shattered (6 портретов 24×32) |
| `badges.png` | 128×128 | значки Shattered в рамках уровней на местах PD; 6 исчезнувших в Shattered — картинка PD в рамке |
| `blacksmith.png` | 64×16 | = `spd/blacksmith.png` (грузится, не рисуется) |
| `buffs.png` | 128×16 | иконки Shattered на местах PD (29 → 33, 30 → 38, 31 → 39) |
| `camp/camp-heroes.png` | 252×240 | ряды 0–5 = ряд 1 листов, 6–15 = ряд 1 образов |
| `ghost.png` | 32×16 | кадры 0–1 Shattered `ghost.png` (запасная фигура) |
| `heroes6.png` | 72×15 | кадр 0 ряда 1 шести листов |
| `icons.png` | 128×64 | метки Shattered: череп, занят, сон, тревога, глубина; значки классов — вещи классов |
| `imp.png` | 64×16 | Shattered `imp.png` |
| `items.png` | 256×512 | + клетка 135: зеркальный меч (по желанию) |
| `mage.png` | 256×128 | лист Shattered `mage.png` |
| `meta/banner-whatsnew.png` | 104×56 | тот же костёр, герои с новых листов |
| `meta/journal-alchemy.png` | 16×16 | исходник клетки journal.png (не грузится; можно удалить) |
| `meta/journal-garden.png` | 16×16 | исходник клетки journal.png (не грузится; можно удалить) |
| `meta/journal-statue.png` | 16×16 | исходник клетки journal.png (не грузится; можно удалить) |
| `meta/journal-well-awareness.png` | 16×16 | исходник клетки journal.png (не грузится; можно удалить) |
| `meta/journal-well-health.png` | 16×16 | исходник клетки journal.png (не грузится; можно удалить) |
| `meta/journal-well-transmutation.png` | 16×16 | исходник клетки journal.png (не грузится; можно удалить) |
| `meta/icon-update.png` | 16×16 | значок CHANGES Shattered (CSS берёт свою копию `--spr-update`) |
| `meta/journal.png` | 176×16 | колодцы, котёл, сад, статуя — тайлы Shattered |
| `ranger.png` | 256×128 | лист Shattered `huntress.png` |
| `ratKing.png` | 128×16 | ряд 0 Shattered `ratking.png` (16×16, 8 кадров) |
| `rogue.png` | 256×128 | лист Shattered `rogue.png` |
| `shattered/journal2.png` | 224×16 | торговец, бес, Крысиный король — Shattered |
| `sheep.png` | 128×16 | Shattered `sheep.png` (кадры 0–3), кадр 4 пуст, как был |
| `shopkeeper.png` | 32×16 | Shattered `shopkeeper.png` |
| `skins/mage-ash.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/mage-royal.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/mage-shadow.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/ranger-ash.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/ranger-royal.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/ranger-shadow.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/rogue-ash.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/rogue-royal.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/rogue-shadow.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/warrior-ash.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/warrior-royal.png` | 256×128 | перекраска нового листа тем же правилом |
| `skins/warrior-shadow.png` | 256×128 | перекраска нового листа тем же правилом |
| `spd/custom_tiles/prison_exit.png` | 256×512 | те же цвета пола |
| `spd/custom_tiles/prison_quest.png` | 256×256 | те же цвета пола |
| `spd/custom_tiles/rat_king_room.png` | 128×16 | те же цвета пола |
| `spd/prison_exit.png` | 256×512 | те же цвета пола |
| `spd/tiles_prison.png` | 256×256 | цвета пола → L 60, разброс 10 |
| `spd/tiles_sewers.png` | 256×256 | цвета пола → L 60, разброс 10 (стены, индексы, альфа те же) |
| `tiles0.png` | 256×128 | клетки PD = тайлы Shattered нового листа региона |
| `tiles1.png` | 256×128 | клетки PD = тайлы Shattered нового листа региона |
| `tiles2.png` | 256×128 | клетки PD = тайлы Shattered нового листа региона |
| `tiles3.png` | 256×128 | клетки PD = тайлы Shattered нового листа региона |
| `tiles4.png` | 256×128 | клетки PD = тайлы Shattered нового листа региона |
| `undead.png` | 256×16 | Shattered `undead.png` |
| `wandmaker.png` | 64×16 | = `spd/wandmaker.png` (грузится, не рисуется) |
| `warrior.png` | 256×128 | лист Shattered `warrior.png` |
| `world/chests.png` | 64×96 | кадр 0 = клетка items.png, дальше щель света, крышка, пусто |
| `world/doors0.png` | 64×48 | из RAISED_DOOR 112/113, LOCKED 114, BARRICADE 121 → EMBERS 3 |
| `world/doors1.png` | 64×48 | из RAISED_DOOR 112/113, LOCKED 114, BARRICADE 121 → EMBERS 3 |
| `world/doors2.png` | 64×48 | из RAISED_DOOR 112/113, LOCKED 114, BARRICADE 121 → EMBERS 3 |
| `world/doors3.png` | 64×48 | из RAISED_DOOR 112/113, LOCKED 114, BARRICADE 121 → EMBERS 3 |
| `world/doors4.png` | 64×48 | из RAISED_DOOR 112/113, LOCKED 114, BARRICADE 121 → EMBERS 3 |
| `world/grass0.png` | 80×40 | качание из RAISED_HIGH_GRASS (122), примятая до GRASS (2) |
| `world/grass1.png` | 80×40 | качание из RAISED_HIGH_GRASS (122), примятая до GRASS (2) |
| `world/grass2.png` | 80×40 | качание из RAISED_HIGH_GRASS (122), примятая до GRASS (2) |
| `world/grass3.png` | 80×40 | качание из RAISED_HIGH_GRASS (122), примятая до GRASS (2) |
| `world/grass4.png` | 80×40 | качание из RAISED_HIGH_GRASS (122), примятая до GRASS (2) |
| `wraith.png` | 128×16 | ряд 0 Shattered `wraith.png` (проклятие) |

### 2. Пересобрать `ui.css`

`node packages/client/scripts/build-ui-css.mjs` с новым `docs/design/system/components/bundle.css`. В нём заменены встроенные спрайты: `--atlas-avatars`, `--atlas-heroes`, `--atlas-warrior`, `--atlas-buffs`, `--atlas-badges`, `--atlas-sitems`, `--atlas-journal`, `--atlas-journal2`, `--spr-badge-locked`, `--spr-npc-blacksmith`, `--spr-skull`, `--spr-busy`, `--spr-depth`, `--spr-warn`, `--spr-update`, `--spr-banner-release`. Два правила, дописанных в `ui.css` руками (`.pd-runend > .pd-scroll`, `.pd-news-notice`), теперь лежат в `bundle.css` — собранный файл совпадает с нынешним во всём, кроме спрайтов. Классы и токены не менялись.

`docs/design/bot-cover-640x360.png` — пересобрана `packages/client/scripts/bot-cover.py` с новыми `tiles0.png` и `avatars.png` (в архиве). Подпись «Кооперативный рогалик» осталась от кооператива — поправьте в скрипте, если режим не вернётся.

### 3. Необязательно: правки кода

| Где | Что | Зачем |
| --- | --- | --- |
| `motion.ts:68` `CHEST_ANIMS` | Ключевать анимацию по виду кучи (`chest`, `mimic`, …), а не по спрайту | У мимика и сундука один спрайт `S.CHEST`, карта оставляет `mimic` — сейчас каждый сундук открывается пастью |
| `motion.ts:476` | Под качающейся и примятой травой рисовать визуал своей клетки (`FLOOR`/`FLOOR_ALT_*` по `variance`), а не `tiles[r]` `T.EMPTY` | На клетках с другим вариантом пола под травой видно пятно |
| `motion.ts` (двери) | Не играть кадры `doors*` у `DOOR_SIDEWAYS` | Кадры нарисованы фронтально; у боковой двери они не к месту |
| `motion.ts` (трава) | Брать кадры качания и для `RAISED_HIGH_GRASS_ALT` (125) с его рисунком | Сейчас альтернативная трава качается рисунком 122 |
| `sprites.ts` `loadAssets` | Убрать `water0–4` (корневые), `blacksmith`, `wandmaker`, `plants` из `names` | Грузятся и не рисуются |
| `spd-sprites.ts` / `vault-rooms.ts` | `MIRROR_SWORD = 135` для награды зеркала дуэлянтке | Своя картинка «зеркального меча» (в Shattered это двуручник; по желанию) |
| `build-ui-css.mjs` | Третья гарнитура для заголовков (`--font-title`, шрифт PD из `pixel_font.ttf` Shattered, 20.48 px) | Предложение на v25, в v24 не включено |

### 4. Можно удалить

Не грузятся (или грузятся и не рисуются), по `manifest.md` аудита:

- 30 листов PD 1.9 в корне: `bat, bee, brute, burningFist, crab, dm300, elemental, eye, gnoll, golem, goo, king, larva, mimic, monk, piranha, rat, rottingFist, scorpio, shaman, skeleton, spinner, statue, succubus, swarm, tengu, thief, warlock, yog .png`; `items-pd.png`, `item_icons.png`.
- Грузятся, не рисуются: корневые `water0–4.png` (рисуются `spd/water*`), `plants.png`, `blacksmith.png`, `wandmaker.png` (перекрыты `spd/`) — вместе со строками загрузки.
- Дубли: `spd/effects.png` (= `spd/effects/effects.png`), `spd/ghoul.png`, `spd/spawner.png` (= `spd/mobs/`).
- Исходники собранных атласов в `meta/`: `challenge-*.png`, `journal-*.png`, `trophy-*`, `medal-week*`, `streak-*`, `cursor.png`, `frost.png`, `*.json`; в `mart/` — `icon-*.svg` (CSS держит свои копии).
- Спящее (арена, кооператив) — оставить до решения о режимах.

### 5. Что проверено и не менялось

Все 31 лист монстров и 5 боссов — Shattered; цвета ловушек — 9 семейств `terrain_features.png`, легенда «Памятки» совпадает; туман `fog0–4` — в оттенках регионов; рамка окна — `chrome.png` Shattered (±3 RGB); у всех 293 видов предметов есть иконка в `items.png`; шрифт Galmuri.

### 6. Остальное в архиве

- `docs/design/system/`: `README.md` (раздел «Арт-дирекция (v24)»), этот `migration.md`, `components/bundle.css` и `bundle.js` (новые встроенные спрайты; классы прежние), 7 новых карточек `components/Art*/` (арт-дирекция, аудит, персонажи, мир, бафы и значки, было/стало по регионам и экранам), превью, где сменились ссылки на листы (`ArenaAtlas`, `ArenaBanners`, `ArenaDesk`, `ArenaEntry`, `ArenaHud`, `ArenaReward`, `MartShelves`, `WorldSprites`), `assets/*/README.md` групп, чьи листы обновлены, и новая `assets/Art-v24/README.md`.
- `docs/design/previews/v24/`: снимки игры до и после (14 сцен × RU/EN × 375×812 и 1280×800), карточки на RU и EN, `README.md` — как снято; `docs/design/previews/v24-overview.png`.
- `docs/design/bot-cover-640x360.png` — пересобрана.
- `tools/art/`: `p24_all.sh` (порядок: персонажи → тайлы → UI → сундуки → баннер → картинки системы), `p24_chars.py`, `p24_tiles.py`, `p24_ui.py`, `p24_fx.py`, `p24_dsimg.py`, `p24_cards.py`, `p24_dsjson.py`, `v24-shots.js` + `v24-shots.sh` (снимки до/после). Пути в скриптах — рабочие пути дизайнера; источники — `assets/` до v24 и листы Shattered PD 4.0.2 (`core/src/main/assets`).
