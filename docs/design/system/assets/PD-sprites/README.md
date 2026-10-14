Оригинальные спрайты Pixel Dungeon 1.9 (Watabou, GPL-3.0) — без изменений, как в репозитории watabou/pixel-dungeon.

- `items.png` — предметы 16×16, 8 в ряд; номер кадра = константа из `ItemSpriteSheet` (5, 6, 7 — силуэты пустой экипировки, 127 — «что-то»).
- `buffs.png` — состояния 7×7, 18 в ряд; номер = константа из `BuffIndicator`.
- `badges.png` — значки 16×16, 8 в ряд; `locked_badge.png` — замок.
- `ui-window.png` — рамка окна 22×22, срез 7 (= `chrome.png` 0,0). В `chrome.png` также toast (22,0, 18×18, срез 5) и красная кнопка (58,0, 6×6, срез 2).
- `icons.png` — иконки классов (16×16), крестик, череп, «!», глубина, сумки; координаты — в `Icons.java`.
- `toolbar.png` — кнопки панели; глифы для `.pd-tool` вырезаны из него.
- `status_pane.png` — старая верхняя панель: иконки глубины, ключа и меню взяты отсюда.
- `avatars.png` — портреты героев 24×32; `warrior/mage/rogue/ranger.png` — листы героев 12×15 (ряд = уровень брони).
- `ghost/wandmaker/shopkeeper/blacksmith/demon.png` — NPC для портретов, `rat.png` — пример монстра.
- `dashboard.png` — иконки титула 32×32, `banners.png` — логотип и баннеры, `tiles0.png` — тайлы канализации (только для макетов), `hp_bar.png`/`exp_bar.png` — цвета полосок.


**v24:** раскладки те же, пиксели — Shattered, как в игре: `warrior/mage/rogue/ranger.png` (листы Shattered warrior, mage, rogue, huntress), `avatars.png` (портреты Shattered), `buffs.png`, `badges.png` (рамки уровней), `icons.png` (метки), `shopkeeper.png`, `demon.png` (= `imp.png` Shattered), `ghost.png`, `wandmaker.png`, `blacksmith.png`, `tiles0–4.png` (клетки PD = тайлы Shattered региона). `items.png` здесь по-прежнему лист PD для макетов (8 в ряд); игра берёт `items.png` Shattered.
