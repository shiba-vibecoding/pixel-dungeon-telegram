# v24 design-system cards: art direction, audit, before/after of the sheets, and the game's own screens before/after.
import json, os, html
P = '/home/claude/ds/project/components/'
PAL = json.load(open('/home/claude/v24/palettes.json'))
GROUP = 'Арт v24'

HEAD = '''<!doctype html>
<html>
<head><meta charset="utf-8"><title>%s</title>
<style>
  html, body { margin: 0; background: var(--void); }
  .doc { box-sizing: border-box; width: %dpx; padding: 24px 28px 40px; color: var(--ink); font: var(--text-body, 400 18px/24px var(--font-ui)); }
  .doc h1 { margin: 0 0 6px; font: var(--text-title, 400 24px/28px var(--font-ui)); color: var(--gold); }
  .doc h2 { margin: 26px 0 8px; font: var(--text-title, 400 24px/28px var(--font-ui)); color: var(--gold-deep); font-size: 20px; line-height: 24px; }
  .doc h3 { margin: 14px 0 6px; font: var(--text-body, 400 18px/24px var(--font-ui)); color: var(--gold); }
  .doc p, .doc li { margin: 0 0 6px; }
  .doc ul { margin: 0 0 6px; padding-left: 22px; }
  .doc .lead { color: var(--ink); max-width: 1000px; }
  .doc .muted, .doc small { color: var(--ink-muted); font: var(--text-caption, 400 15px/20px var(--font-small)); }
  .doc code { font: var(--text-caption, 400 15px/20px var(--font-small)); color: var(--gold); background: var(--stone-800); padding: 0 4px; }
  .doc img { image-rendering: pixelated; display: block; }
  .doc table { border-collapse: collapse; width: 100%%; table-layout: fixed; font: var(--text-caption, 400 15px/20px var(--font-small)); }
  .doc td code { white-space: normal; overflow-wrap: anywhere; }
  .doc table.audit col.c1 { width: 104px; } .doc table.audit col.c4 { width: 200px; } .doc table.audit col.c5 { width: 96px; }
  .doc table.icongrid col.c1 { width: 80px; } .doc table.icongrid col.c2 { width: 70px; } .doc table.icongrid col.c3 { width: 150px; } .doc table.icongrid col.c5 { width: 230px; }
  .doc th { text-align: left; color: var(--gold); font-weight: 400; padding: 6px 8px; border-bottom: 2px solid var(--stone-500); }
  .doc td { vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--stone-700); color: var(--ink); }
  .doc td.k { color: var(--gold); white-space: nowrap; }
  .chip { display: inline-block; padding: 0 6px; font: var(--text-caption, 400 15px/20px var(--font-small)); background: var(--stone-700); color: var(--ink); white-space: nowrap; }
  .chip.fix { background: #24401f; color: #b6f0a0; } .chip.chk { background: var(--stone-600); color: var(--ink); }
  .chip.code { background: #40311a; color: var(--gold-deep); } .chip.next { background: #2d2a44; color: #c9c3ff; } .chip.del { background: #3a2126; color: var(--bad); }
  .regions { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
  .region { background: var(--stone-800); padding: 10px; }
  .region b { color: var(--gold); font-weight: 400; display: block; margin-bottom: 4px; }
  .sw { display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }
  .sw i { width: 26px; height: 26px; display: block; box-shadow: inset 0 0 0 1px rgba(0,0,0,.4); }
  .sw-l { font: var(--text-caption, 400 15px/20px var(--font-small)); color: var(--ink-muted); margin-top: 4px; }
  .strip { margin: 6px 0 2px; overflow: hidden; }
  .ba { display: flex; flex-direction: column; gap: 4px; margin: 6px 0 14px; }
  .ba .nm { font: var(--text-caption, 400 15px/20px var(--font-small)); color: var(--gold); }
  .ba .nm small { color: var(--ink-muted); }
  .ba .pr { display: flex; gap: 8px; align-items: stretch; }
  .ba .lb { width: 46px; flex: none; display: flex; flex-direction: column; justify-content: space-around; font: var(--text-caption, 400 15px/20px var(--font-small)); color: var(--ink-muted); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; }
  .shots { display: flex; flex-wrap: wrap; gap: 18px 22px; }
  .shot { display: flex; flex-direction: column; gap: 6px; }
  .shot .cap { font: var(--text-caption, 400 15px/20px var(--font-small)); color: var(--ink-muted); }
  .shot .cap b { color: var(--gold); font-weight: 400; }
  .shot .two { display: flex; gap: 6px; }
  .shot .two > div { display: flex; flex-direction: column; gap: 4px; }
  .shot .two small { color: var(--ink-muted); }
  .shot img { image-rendering: auto; box-shadow: 0 0 0 1px var(--stone-600); }
  .shot img.px { image-rendering: pixelated; }
  .note { background: var(--stone-800); padding: 10px 12px; margin: 10px 0; }
  .icongrid td { vertical-align: middle; }
  .spr { display: inline-block; vertical-align: middle; image-rendering: pixelated; }
</style></head>
<body>
<div class="pd-root"><div class="doc" id="doc"></div></div>
<script>
  var q = new URLSearchParams(location.search), L = q.get('lang') || 'ru', en = L === 'en';
  function T(ru, enText) { return en ? enText : ru; }
  var IMG = __IMGS__;
  function img(name, k) { var u = IMG[name]; return '<img src="' + u + '" style="' + (k ? 'zoom:' + k : '') + '" alt="">'; }
  function ba(name, label, k) {
    return '<div class="ba"><div class="nm">' + label + '</div><div class="pr"><div class="lb"><span>' + T('было', 'before') + '</span><span>' + T('стало', 'after') + '</span></div>' + img('ba-' + name, k) + '</div></div>';
  }
'''
TAIL = '''
  PD.sprite(document.body);
</script>
</body>
</html>
'''

def card(name, title, sub, width, height, body_js, readme):
    os.makedirs(P + name, exist_ok=True)
    head = f'<!-- @dsCard group="{GROUP}" height={height} width={width} page subtitle="{html.escape(sub)}" -->\n'
    ids = json.load(open('/home/claude/v24/up-ids.json'))
    imgs = {k.split('/', 1)[1][:-4]: '/_blob/' + v for k, v in ids.items() if k.startswith('Art-v24')}
    open(P + name + '/preview.html', 'w').write(head + (HEAD % (title, width)).replace('__IMGS__', json.dumps(imgs)) + body_js + TAIL)
    open(P + name + '/README.md', 'w').write(readme)

def swatches(r):
    p = PAL[r]
    rows = [('пол', 'floor', p['floor']), ('стена', 'wall', p['wall']), ('вода', 'water', p['water']),
            ('трава, акцент', 'grass, accent', [p['grass'][2], p['deco'][2], p['door'][1]]), ('туман', 'fog', [p['fog'][0]])]
    out = ''
    for ru, en, cols in rows:
        out += "'<div class=\"sw-l\">' + T('%s', '%s') + '</div><div class=\"sw\">%s</div>' + " % (ru, en, ''.join(f'<i style=\\"background:{c}\\" title=\\"{c}\\"></i>' for c in cols))
    return out

REG = [('sewers', 'Канализация · 1–4', 'Sewers · 1–4', 'Холодный серо-зелёный камень, мшистая вода, белёные стены. Пол L 60.', 'Cold grey-green stone, mossy water, whitewashed walls. Floor L 60.'),
       ('prison', 'Тюрьма · 6–9', 'Prison · 6–9', 'Тёплый серо-бурый камень, стоячая сине-зелёная вода, песочные стены. Пол L 60.', 'Warm grey-brown stone, still blue-green water, sandy walls. Floor L 60.'),
       ('caves', 'Пещеры · 11–14', 'Caves · 11–14', 'Почти чёрный бурый пол, серая порода, тёмная бирюза воды, мох. Пол L 40.', 'Near-black brown floor, grey rock, dark teal water, moss. Floor L 40.'),
       ('city', 'Город гномов · 16–19', 'Dwarf city · 16–19', 'Сине-сланцевая плитка, песчаник, винная вода, фонари и ковры. Пол L 55.', 'Slate-blue tiles, sandstone, wine water, lanterns and carpets. Floor L 55.'),
       ('halls', 'Чертоги · 21–24', 'Demon halls · 21–24', 'Бордовый шестигранник, пепельные стены, кровь-лава, грибница. Пол L 34.', 'Maroon hexes, ash walls, blood-lava, fungus. Floor L 34.')]

# ------------------------------------------------------------------ 1. Art direction
regions_js = "'<div class=\"regions\">' + " + " + ".join(
    "'<div class=\"region\"><b>' + T('%s', '%s') + '</b><small>' + T('%s', '%s') + '</small>' + %s '</div>'" % (ru, en, mr, me, swatches(r))
    for r, ru, en, mr, me in REG) + " + '</div>'"
strips_js = " + ".join("'<div class=\"strip\">' + img('region-%s', 1) + '</div>'" % r for r, *_ in REG)

AD = '''
  var d = document.getElementById('doc'), h = '';
  h += '<h1>' + T('Арт-дирекция v24 · один Pixel Dungeon', 'Art direction v24 · one Pixel Dungeon') + '</h1>';
  h += '<p class="lead">' + T('Игра рисуется листами Shattered PD 4.0.2. Всё, что рисуем мы (привал, Пиксель-Март, мета, окна, v17–v23), берёт пиксели и палитру из этих листов. От PD 1.9 остаются только раскладки кадров — где лежит кадр, — а не пиксели: код меняет файлы, а не номера кадров.', 'The game is drawn with Shattered PD 4.0.2 sheets. Everything we draw (camp, Pixel-Mart, meta, windows, v17–v23) takes its pixels and palette from those sheets. PD 1.9 survives only as frame layouts — where a frame lies — not as pixels: the code swaps files, not frame numbers.') + '</p>';
  h += '<h2>1 · ' + T('Источник', 'Source') + '</h2><ul>';
  h += '<li>' + T('Спрайт есть в Shattered — берём его (герои, жители, бафы, значки, метки на карте, тайлы).', 'If Shattered has the sprite, use it (heroes, folk, buffs, badges, map marks, tiles).') + '</li>';
  h += '<li>' + T('Нет в Shattered — рисуем по его листу: тот же кадр, тот же контур, 3–4 тона на материал, свет сверху-слева.', 'If it does not, draw it after its sheet: same frame, same outline, 3–4 tones per material, light from the top left.') + '</li>';
  h += '<li>' + T('Наш лист поверх тайла (трава, двери, сундуки, подложка) режется из тайла того же региона: первый кадр анимации — то, что уже лежит на карте.', 'Our sheets over a tile (grass, doors, chests, the underlay) are cut from that region\\'s tile: an animation\\'s first frame is what is already on the map.') + '</li></ul>';
  h += '<h2>2 · ' + T('Палитра регионов', 'Region palettes') + '</h2>';
  h += ''' + regions_js + ''';
  h += ''' + strips_js + ''';
  h += '<p class="muted">' + T('Полоса: пол ×3 · трава низкая и высокая · вода · грань стены · стена с декором · дверь закрыта/открыта · вход/выход · колодец · декор · ловушка.', 'Strip: floor ×3 · low and tall grass · water · wall face · decorated wall · door shut/open · stairs up/down · well · decoration · trap.') + '</p>';
  h += '<ul><li>' + T('Пол держит светлоту L 34–62 и разброс текстуры не больше 10; стена светлее пола на 40 L и больше. Тогда предметы и монстры с чёрным контуром читаются на полу. В v24 полы канализации и тюрьмы опущены с L 70 до 60, разброс — с 14 до 10; стены не тронуты.', 'Floors keep lightness L 34–62 and texture spread at most 10; walls are 40+ L lighter. Then items and monsters with their black outline read on the floor. v24 brings the sewers\\' and prison\\'s floors from L 70 to 60 and the spread from 14 to 10; walls untouched.') + '</li>';
  h += '<li>' + T('Цвета UI (золото, кровь, камень окна) не совпадают с цветом пола ни в одном регионе — интерфейс не теряется на карте.', 'UI colours (gold, blood, window stone) never equal a region\\'s floor, so the interface never melts into the map.') + '</li></ul>';
  h += '<h2>3 · ' + T('Контур и тени', 'Outline and shading') + '</h2><ul>';
  h += '<li>' + T('Контур 1 px, тёмный тон своего материала; у монстров и предметов Shattered — почти чёрный. Снаружи силуэта — прозрачность, без ореолов и полупрозрачных пикселей (кроме эффектов).', 'A 1 px outline in the material\\'s dark tone; near-black on Shattered\\'s monsters and items. Outside the silhouette, transparency: no halos, no half-alpha pixels (effects excepted).') + '</li>';
  h += '<li>' + T('3–4 тона на материал: тень, основной, свет, блик. Свет сверху-слева. Ни сглаживания, ни градиентов.', '3–4 tones per material: shadow, base, light, glint. Light from the top left. No anti-aliasing, no gradients.') + '</li>';
  h += '<li>' + T('Герой 12×15, монстры 12–16 px высотой (боссы крупнее), предмет 16×16 с полем 1 px, бафы 7×7 и 16×16 — плоские, без контура, цвета Shattered.', 'Heroes 12×15, monsters 12–16 px tall (bosses bigger), items 16×16 with a 1 px margin, buffs 7×7 and 16×16 — flat, no outline, Shattered\\'s colours.') + '</li>';
  h += '<li>' + T('Масштаб только целый: ×2 на телефоне, ×3–4 на мониторе (<code>--px</code>).', 'Whole-number scale only: ×2 on phones, ×3–4 on monitors (<code>--px</code>).') + '</li></ul>';
  h += '<h2>4 · ' + T('Свет и тень на тайлах', 'Light and shadow on tiles') + '</h2><ul>';
  h += '<li>' + T('Стены «подняты» (raised walls): светлая кромка сверху, грань, тень окклюзии на полу под стеной (<code>occlusion_shadows.png</code>).', 'Walls are raised: a light lip on top, the face, an occlusion shadow on the floor below (<code>occlusion_shadows.png</code>).') + '</li>';
  h += '<li>' + T('Вода темнее пола; двери, лестницы и ловушки — из листа региона. Ловушки — 9 семейств <code>terrain_features.png</code>: красный, оранжевый, жёлтый, зелёный, бирюзовый, фиолетовый, белый, серый, чёрный; легенда «Памятки» совпадает с ними пиксель в пиксель.', 'Water is darker than floor; doors, stairs and traps come from the region\\'s sheet. Traps: the 9 families of <code>terrain_features.png</code> — red, orange, yellow, green, teal, violet, white, grey, black; the guide\\'s legend matches them pixel for pixel.') + '</li>';
  h += '<li>' + T('Туман глубины — воздух региона (зелень канализации, тёплая пыль тюрьмы, бурая пещера, холодный город, жар чертогов), альфа ≤ 70/255, дизеринг 8×8.', 'Depth fog is the region\\'s air (sewer green, prison dust, cave brown, cold city, hall heat), alpha ≤ 70/255, 8×8 dither.') + '</li>';
  h += '<li>' + T('Свет — только ореолы светильников и героя (<code>light.png</code>), тёплые, на тёмном не ярче 0.5.', 'Light is only the halos of lamps and the hero (<code>light.png</code>), warm, no brighter than 0.5 over dark.') + '</li></ul>';
  h += '<h2>5 · ' + T('Рамка интерфейса', 'UI frame') + '</h2><ul>';
  h += '<li>' + T('Окно — камень <code>chrome.png</code> Shattered: заливка <code>stone-700</code>, фаска <code>stone-200</code>/<code>stone-300</code>, заклёпки по углам, 9-slice 22 px; toast — 18 px.', 'A window is Shattered\\'s <code>chrome.png</code> stone: <code>stone-700</code> fill, <code>stone-200</code>/<code>stone-300</code> bevel, corner rivets, 22 px 9-slice; a toast, 18 px.') + '</li>';
  h += '<li>' + T('Вдавленное (ячейки, карточки) — <code>stone-800</code>; выпуклое — <code>stone-600</code> с фаской. Основная кнопка — <code>blood</code> с подписью <code>gold</code>.', 'Sunken (slots, cards) is <code>stone-800</code>; raised is <code>stone-600</code> with a bevel. The primary button is <code>blood</code> with a <code>gold</code> label.') + '</li>';
  h += '<li>' + T('Ни скруглений, ни размытых теней: угол — вырезанный пиксель (<code>--notch</code>), тень — жёсткий сдвиг <code>void</code>.', 'No rounding, no blurred shadows: a corner is a cut pixel (<code>--notch</code>), a shadow a hard <code>void</code> offset.') + '</li></ul>';
  h += '<h2>6 · ' + T('Сетка иконок', 'Icon grid') + '</h2>';
  h += '<table class="icongrid"><col class="c1"><col class="c2"><col class="c3"><col><col class="c5"><tr><th>' + T('Кадр', 'Cell') + '</th><th>' + T('Глиф', 'Glyph') + '</th><th>' + T('Контур', 'Outline') + '</th><th>' + T('Где', 'Where') + '</th><th>' + T('Пример', 'Example') + '</th></tr>';
  var IG = [['7×7', '7', T('нет', 'none'), T('бафы в строке HUD', 'buffs in the HUD row'), '<i class="spr" style="width:21px;height:21px;background:var(--atlas-buffs);background-size:384px 48px;background-position:-63px 0"></i> <i class="spr" style="width:21px;height:21px;background:var(--atlas-buffs);background-size:384px 48px;background-position:-21px 0"></i>'],
            ['8×8', '7', T('нет, на плашке', 'none, on a plate'), T('метки HUD: череп, глубина, ключ, сон, тревога', 'HUD marks: skull, depth, key, sleep, alert'), '<i class="spr" style="width:24px;height:24px;background:var(--spr-skull);background-size:24px 24px"></i> <i class="spr" style="width:24px;height:24px;background:var(--spr-depth);background-size:24px 24px"></i>'],
            ['12×12', '10', '1 px', T('инструменты панели, кнопки карты', 'toolbar tools, map buttons'), '<i class="spr" style="width:36px;height:36px;background:var(--spr-tool-wait2);background-size:36px 36px"></i> <i class="spr" style="width:36px;height:36px;background:var(--spr-tool-search2);background-size:36px 36px"></i>'],
            ['16×16', '14', '1 px', T('предметы, значки, вкладки, иконки окон, журнал', 'items, badges, tabs, window icons, journal'), '<i class="spr" style="width:48px;height:48px;background:var(--atlas-sitems);background-size:768px 1536px;background-position:0 -144px"></i> <i class="spr" style="width:48px;height:48px;background:var(--atlas-badges);background-size:384px 384px;background-position:0 0"></i> <i class="spr" style="width:48px;height:48px;background:var(--spr-mail);background-size:48px 48px"></i>'],
            ['24×32', '22×30', '1 px', T('портрет класса', 'class portrait'), '<i class="spr" style="width:48px;height:64px;background:var(--atlas-avatars);background-size:288px 64px;background-position:-96px 0"></i>'],
            ['32×32', '30', '1 px', T('крупные значки, кубки, плитки дашборда', 'large badges, cups, dashboard tiles'), '<i class="spr" style="width:64px;height:64px;background:var(--atlas-troph32);background-size:384px 64px"></i>']];
  IG.forEach(function (r) { h += '<tr><td class="k">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td></tr>'; });
  h += '</table><p class="muted">' + T('Иконки UI — в тонах предметов: металл серо-голубой, золото #ffcc66 → #ffeba4, дерево бурое, бумага кремовая. Линейные глифы (плюс, минус, шеврон) — только у элементов управления, не у предметов.', 'UI icons take the items\\' tones: grey-blue metal, gold #ffcc66 → #ffeba4, brown wood, cream paper. Line glyphs (plus, minus, chevron) only on controls, never on objects.') + '</p>';
  h += '<h2>7 · ' + T('Интерфейс над тёмной картой', 'Chrome over the dark map') + '</h2><ul>';
  h += '<li>' + T('Карта всегда на <code>void</code>; HUD и панель — острова камня, между ними видно подземелье.', 'The map always sits on <code>void</code>; the HUD and toolbar are stone islands with the dungeon showing between them.') + '</li>';
  h += '<li>' + T('Окно ложится на <code>scrim</code> (void 72%); карту под ним не размываем.', 'A window lies on <code>scrim</code> (void 72%); the map below is never blurred.') + '</li>';
  h += '<li>' + T('Текст на карте (лог, числа урона) — с обводкой <code>void</code> 1 u, без подложки.', 'Text on the map (log, damage numbers) has a 1 u <code>void</code> outline and no plate.') + '</li>';
  h += '<li>' + T('Ничего стеклянного-полупрозрачного: затемняют только scrim и туман.', 'Nothing glassy: only the scrim and the fog darken.') + '</li></ul>';
  h += '<h2>8 · ' + T('Шрифт', 'Font') + '</h2><ul>';
  h += '<li>' + T('Galmuri11 (текст) и Galmuri9 (мелкий текст, цифры): кириллица и латиница одной сеткой, только кратные размеры (×1.5, ×2, ×3).', 'Galmuri11 (text) and Galmuri9 (small text, digits): Cyrillic and Latin on one grid, whole multiples only (×1.5, ×2, ×3).') + '</li>';
  h += '<li>' + T('Шрифт PD — буквы Watabou в <code>pixel_font.ttf</code> Shattered — ближе всего к «тому самому» Pixel Dungeon и держит кириллицу; чёткий на 20.48 px. Предлагается для заголовков в v25 (нужна третья гарнитура в <code>build-ui-css.mjs</code>); в v24 не включён, чтобы не трогать вёрстку.', 'The PD font — Watabou\\'s letters in Shattered\\'s <code>pixel_font.ttf</code> — is the closest to the Pixel Dungeon everyone knows and covers Cyrillic; it is crisp at 20.48 px. Proposed for titles in v25 (a third family in <code>build-ui-css.mjs</code>); left out of v24 so no layout moves.') + '</li></ul>';
  d.innerHTML = h;
'''
card('ArtDirection', 'Арт-дирекция', 'Одна страница правил v24: источник (Shattered, раскладки PD), палитры пяти регионов, контур и тени, свет на тайлах, рамка UI, сетка иконок, интерфейс над тёмной картой, шрифт', 1158, 2830, AD,
     '''Арт-дирекция v24. Источник всех пикселей — листы Shattered PD 4.0.2; от PD 1.9 остаются только раскладки кадров (пути и номера кадров не меняются).

- Палитры регионов сняты с листов `spd/tiles_*.png` (пол, стена, вода, трава/акцент, туман).
- Пол: L 34–62, разброс текстуры ≤ 10, стена светлее пола на 40 L.
- Контур 1 px тёмным тоном материала, 3–4 тона, свет сверху-слева, без сглаживания.
- Сетка иконок: 7, 8, 12, 16, 24×32, 32 px — таблица на странице.
- Рамка UI — `chrome.png` Shattered, токены `stone-*`.
- Шрифт: Galmuri; шрифт PD предложен для заголовков в v25.
''')

# ------------------------------------------------------------------ 2. Audit
AUDIT = [
 # (area, before RU, before EN, decision RU, decision EN, files, status)
 ('Герои · Heroes', 'Воин, маг, разбойник, охотница — листы PD 1.9, дуэлянтка и клирик — Shattered: альфа та же, тона другие (борода, лица, броня).', 'Warrior, mage, rogue, huntress were PD 1.9 sheets, the duelist and cleric Shattered: same alpha, different shading (beards, faces, armour).',
  'Листы Shattered (warrior, mage, rogue, huntress) по тем же путям.', 'Shattered\'s sheets (warrior, mage, rogue, huntress) at the same paths.', 'warrior.png, mage.png, rogue.png, ranger.png', 'fix'),
 ('Герои · Heroes', '12 образов Пиксель-Марта запечены на листах PD 1.9.', '12 Pixel-Mart looks were baked onto the PD 1.9 sheets.',
  'Пересобраны на листах Shattered тем же правилом цвета (пепел, королевский, тень).', 'Rebuilt on Shattered\'s sheets with the same colour rule (ash, royal, shadow).', 'skins/{warrior,mage,rogue,ranger}-*.png', 'fix'),
 ('Портреты · Portraits', 'Портреты 4 классов — PD 1.9, 2 — Shattered; фигуры привала 0–3 перерисованы с PD; полоса героев — PD.', 'Four portraits were PD 1.9, two Shattered; camp figures 0–3 were retouched PD; the hero strip was PD.',
  'avatars.png = первые 144 px avatars.png Shattered; ряды привала = ряд 1 листа; heroes6 = кадр 0 ряда 1.', 'avatars.png = the first 144 px of Shattered\'s avatars.png; camp rows = row 1 of each sheet; heroes6 = frame 0 of row 1.', 'avatars.png, camp/camp-heroes.png, heroes6.png, meta/banner-whatsnew.png', 'fix'),
 ('Жители · Folk', 'PD 1.9 среди монстров Shattered: торговец (и хозяин Марта), бес (demon.png PD), Крысиный король, овца, нежить короля, проклятие (wraith), запасной призрак; копии кузнеца и волшебника.', 'PD 1.9 among Shattered\'s monsters: shopkeeper (and the Mart\'s keeper), imp (PD demon.png), Rat King, sheep, the King\'s undead, the curse (wraith), the fallback ghost; copies of the blacksmith and wandmaker.',
  'Рисунки Shattered, обрезанные до размера листа PD — кадры на тех же местах.', 'Shattered\'s drawings cut to the PD sheet\'s size — frames where they were.', 'shopkeeper, imp, ratKing, sheep, undead, wraith, ghost, blacksmith, wandmaker .png', 'fix'),
 ('Монстры · Monsters', 'Все 31 лист монстров и 5 боссов — Shattered; портреты бестиария сняты с них.', 'All 31 monster sheets and 5 bosses are Shattered; the bestiary portraits are cut from them.', 'Проверено, без изменений.', 'Checked, unchanged.', 'spd/mobs/*, mobs/bestiary.png', 'chk'),
 ('Мир · World', 'Пол под высокой и примятой травой, запасные двери и фон карточки «Поделиться» читают tiles0–4 (раскладка PD; пиксели — плоские тайлы Shattered). На полу с вариантом FLOOR_ALT под травой проступает пятно другого варианта.', 'The floor under tall and trampled grass, the door fallbacks and the share card read tiles0–4 (PD layout; the pixels are Shattered\'s flat tiles). On a FLOOR_ALT cell the grass shows a patch of the other variant.',
  'tiles0–4 пересобраны из новых листов регионов (полы спокойнее, как на карте); каждая клетка PD сверена с тайлом Shattered. Пятно на вариантах — в коде: рисовать под травой визуал своей клетки.', 'tiles0–4 rebuilt from the regions\' new sheets (calmer floors, as on the map); every PD cell matched to its Shattered tile. The patch on variants is code: draw the cell\'s own visual under the grass.', 'tiles0.png … tiles4.png, motion.ts:476', 'fix'),
 ('Мир · World', 'Высокая трава на земле — наши стебли старой палитры, а верхушки сверху — Shattered.', 'Tall grass on the ground layer was our blades in the old palette while its tops above were Shattered\'s.',
  'Кадры качания — тайл RAISED_HIGH_GRASS (122) региона со сдвигом от корней; примятая кончается на GRASS (2). Листья — в цветах травы региона.', 'Sway frames are the region\'s RAISED_HIGH_GRASS (122) sheared from the roots; trampling ends on GRASS (2). Leaves take the region\'s grass colours.', 'world/grass0–4.png', 'fix'),
 ('Мир · World', 'Анимация дверей — наша, в старой палитре: первый кадр не совпадал с дверью на карте.', 'Door animations were ours in the old palette: frame 0 did not match the door on the map.',
  'Кадры из RAISED_DOOR 112 → OPEN 113, LOCKED 114, BARRICADE 121 → EMBERS 3 листа региона; створка сжимается к петле.', 'Frames from the region\'s RAISED_DOOR 112 → OPEN 113, LOCKED 114, BARRICADE 121 → EMBERS 3; the leaf narrows to its hinge.', 'world/doors0–4.png', 'fix'),
 ('Мир · World', 'Полы канализации и тюрьмы — самые светлые и пёстрые (L 70, разброс 14): серые крысы, скелеты, камни и свитки тонут.', 'The sewers\' and prison\'s floors were the brightest and busiest (L 70, spread 14): grey rats, skeletons, stones and scrolls sank into them.',
  'Цвета пола (не стен) к L 60 и разбросу 10 — во всех тайлах на полу и в особых тайлах этих регионов. Индексы те же.', 'Floor colours (not walls) toward L 60 and spread 10 — in every tile standing on that floor and in those regions\' custom tiles. Same indexes.', 'spd/tiles_sewers.png, spd/tiles_prison.png, spd/custom_tiles/{rat_king_room,prison_quest,prison_exit}.png, spd/prison_exit.png', 'fix'),
 ('Мир · World', 'Цвета ловушек и легенда «Памятки».', 'Trap colours and the guide\'s legend.', 'Совпадают пиксель в пиксель (9 семейств, ряд 5 terrain_features).', 'Match pixel for pixel (9 families, row 5 of terrain_features).', 'ui/trap-colours.png', 'chk'),
 ('Мир · World', 'Туман глубины.', 'Depth fog.', 'Оттенки совпадают с регионами — оставлен.', 'Its hues match the regions — kept.', 'world/fog0–4.png', 'chk'),
 ('Мир · World', 'Сундук, гробница, мимик, кости: первый кадр — золотой сундук PD, а на полу лежит сундук Shattered.', 'Chest, tomb, mimic, bones: frame 0 was a gold PD chest while the heap showed Shattered\'s chest.',
  'Кадр 0 — клетка items.png (CHEST 36, LOCKED 37, CRYSTAL 38, TOMB 34, BONES 32); дальше щель света, крышка над кладом, пустой сундук.', 'Frame 0 is the items.png cell (CHEST 36, LOCKED 37, CRYSTAL 38, TOMB 34, BONES 32); then a slit of light, the lid over the hoard, the empty box.', 'world/chests.png', 'fix'),
 ('Код · Code', 'CHEST_ANIMS: мимик и сундук на одной картинке (S.CHEST), карта оставляет «mimic» — каждый сундук открывается пастью.', 'CHEST_ANIMS: the mimic and the chest share S.CHEST, the map keeps «mimic» — every chest opens with teeth.',
  'Ключевать анимацию по виду кучи, а не по спрайту (motion.ts:68).', 'Key the animation by the heap\'s kind, not its sprite (motion.ts:68).', 'motion.ts', 'code'),
 ('Предметы · Items', 'Все 293 вида предметов.', 'All 293 item kinds.', 'У всех есть иконка в items.png Shattered: 17 безделушек, алхимия (6 отваров, 8 эликсиров, 11 заклинаний, катализаторы), 13 семян, вещи классов, задания. Зеркальный меч — двуручник, как в Shattered; своя клетка 135 — по желанию.', 'Every one has an icon in Shattered\'s items.png: 17 trinkets, alchemy (6 brews, 8 elixirs, 11 spells, catalysts), 13 seeds, class items, quest items. The mirror sword is the greatsword, as in Shattered; its own cell 135 is optional.', 'items.png (+135)', 'chk'),
 ('Бафы · Buffs', 'buffs.png PD 1.9 (id < 1000) рядом с Shattered (id ≥ 1000) в одной строке.', 'PD 1.9 buffs.png (ids < 1000) beside Shattered\'s (ids ≥ 1000) in one row.',
  'Лист в раскладке PD перерисован иконками Shattered (головокружение 33, ярость 38, жертва 39).', 'The PD-layout sheet repainted with Shattered\'s icons (vertigo 33, rage 38, sacrifice 39).', 'buffs.png', 'fix'),
 ('Значки · Badges', 'badges.png PD 1.9: одна рамка на все уровни, картинки PD для значков Shattered.', 'PD 1.9 badges.png: one frame for every tier, PD pictures for Shattered\'s badges.',
  'Значки Shattered в рамках уровней (бронза, серебро, золото, платина) на местах PD; 6 значков, которых нет в Shattered, — картинка PD в рамке своего уровня.', 'Shattered\'s badges in tier frames (bronze, silver, gold, platinum) at the PD places; the 6 Shattered dropped keep their PD picture in their tier\'s frame.', 'badges.png', 'fix'),
 ('Метки · Marks', 'icons.png PD 1.9: сон и тревога над монстрами, череп, глубина, значки классов.', 'PD 1.9 icons.png: sleep and alert over monsters, skull, depth, class icons.',
  'Метки Shattered; значки классов — вещи классов, как в Shattered.', 'Shattered\'s marks; class icons are the class items, as in Shattered.', 'icons.png', 'fix'),
 ('Журнал · Journal', 'Колодцы, котёл, сад, статуя в журнале и торговец, бес, Крысиный король в его метках — рисунки PD.', 'The journal\'s wells, pot, garden and statue, and the shopkeeper, imp and Rat King in its marks were PD drawings.',
  'Тайлы канализации Shattered (колодец, котёл, трава, статуя) и спрайты Shattered; призрак, волшебник, кузнец уже были Shattered.', 'Shattered\'s sewer tiles (well, pot, grass, statue) and sprites; the ghost, wandmaker and blacksmith already were Shattered\'s.', 'meta/journal.png, meta/journal-{well-*,alchemy,garden,statue}.png, shattered/journal2.png', 'fix'),
 ('Иконки · Icons', 'Три диалекта: Shattered, PD 1.9 и наши. Наши — на сетке, кроме «обновления» (кольцо 1 px без контура).', 'Three dialects: Shattered, PD 1.9 and ours. Ours sit on the grid except «update» (a 1 px ring, no outline).',
  'PD 1.9 ушёл (бафы, значки, метки); «обновление» — значок CHANGES Shattered; копии PD в системе (портреты, кадры героев, жители, метки HUD, значки классов) заменены.', 'PD 1.9 is gone (buffs, badges, marks); «update» is Shattered\'s CHANGES icon; the system\'s PD copies (portraits, hero frames, folk, HUD marks, class icons) replaced.', 'bundle.css (data URI)', 'fix'),
 ('Рамка · Chrome', 'Наша рамка окна — chrome.png Shattered с отклонением ±3 RGB.', 'Our window frame is Shattered\'s chrome.png within ±3 RGB.', 'Оставлена; токены stone-* описаны в арт-дирекции.', 'Kept; the stone-* tokens are written down in the art direction.', 'ui-window.png, ui-toast.png', 'chk'),
 ('Логотип · Logo', 'Логотип в стиле PD (наш) и фон карточки «Поделиться» из tiles0 PD.', 'A PD-style logo (ours) and the share card\'s background from PD tiles0.', 'Фон карточки теперь пол Shattered (через tiles0); логотип — имя игры, оставлен.', 'The card\'s background is now Shattered\'s floor (via tiles0); the logo is the game\'s name, kept.', 'tiles0.png, banner-title.png', 'chk'),
 ('Шрифт · Font', 'Galmuri11/9 против шрифта PD.', 'Galmuri11/9 versus the PD font.', 'Galmuri оставлен; шрифт PD для заголовков — в v25.', 'Galmuri stays; the PD font for titles — v25.', 'tokens.json', 'next'),
 ('Код · Code', 'Боковые двери анимируются фронтальным кадром; альтернативная трава (125) качается как 122.', 'Sideways doors animate with a front-facing frame; alternate tall grass (125) sways as 122.', 'Пропускать анимацию у DOOR_SIDEWAYS; брать кадры по визуалу клетки.', 'Skip the animation for DOOR_SIDEWAYS; pick frames by the cell\'s visual.', 'motion.ts', 'code'),
 ('Груз · Dead weight', '30 листов PD 1.9 в корне не грузятся; items-pd, item_icons, plants (грузится, не рисуется), корневые water0–4 (грузятся, не рисуются), дубли spd/effects, spd/ghoul, spd/spawner, тайлы боссов дважды, ~30 исходников meta/.', '30 PD 1.9 sheets in the root never load; items-pd, item_icons, plants (loaded, never drawn), root water0–4 (loaded, never drawn), duplicates spd/effects, spd/ghoul, spd/spawner, boss tiles twice, ~30 meta/ sources.',
  'Список в migration.md; удалить по желанию, строки загрузки — тоже.', 'Listed in migration.md; delete at will, with their loader lines.', 'migration.md', 'del'),
]
CH = {'fix': ('исправлено', 'fixed'), 'chk': ('проверено', 'checked'), 'code': ('в коде', 'in code'), 'next': ('v25', 'v25'), 'del': ('удалить', 'delete')}
rows = json.dumps([[a, b, c, d, e, f, g] for a, b, c, d, e, f, g in AUDIT], ensure_ascii=False)
AU = '''
  var d = document.getElementById('doc'), h = '', R = ''' + rows + ''', CH = ''' + json.dumps(CH, ensure_ascii=False) + ''';
  h += '<h1>' + T('Аудит v24 · где смешивались три источника', 'Audit v24 · where three sources mixed') + '</h1>';
  h += '<p class="lead">' + T('По manifest.md, 18 листам и 87 снимкам пакета: PD 1.9, Shattered и наш рисунок на одном экране. В каждой строке — что было, решение и файлы. Пути и раскладки не менялись.', 'From manifest.md, the 18 sheets and 87 screens of the pack: PD 1.9, Shattered and our art on one screen. Each row: what it was, the decision and the files. Paths and layouts unchanged.') + '</p>';
  h += '<table class="audit"><col class="c1"><col><col><col class="c4"><col class="c5"><tr><th>' + T('Где', 'Where') + '</th><th>' + T('Было', 'Was') + '</th><th>' + T('Решение', 'Decision') + '</th><th>' + T('Файлы', 'Files') + '</th><th></th></tr>';
  R.forEach(function (r) { var c = CH[r[6]]; h += '<tr><td class="k">' + r[0].split(' · ')[en ? 1 : 0] + '</td><td>' + (en ? r[2] : r[1]) + '</td><td>' + (en ? r[4] : r[3]) + '</td><td><code>' + r[5] + '</code></td><td><span class="chip ' + r[6] + '">' + (en ? c[1] : c[0]) + '</span></td></tr>'; });
  h += '</table>';
  d.innerHTML = h;
'''
card('ArtAudit', 'Аудит арта', 'Каждое место, где на экране встречались PD 1.9, Shattered и наш рисунок: было → решение → файлы, со статусом (исправлено, проверено, в коде, v25, удалить)', 1158, 2480, AU,
     'Аудит v24: таблица несовпадений источников арта (по manifest.md пакета аудита) и что с каждым сделано. Статусы: исправлено, проверено, в коде (нужна правка кода), v25, удалить.\n')

# ------------------------------------------------------------------ 3. Characters
CHJ = '''
  var d = document.getElementById('doc'), h = '';
  h += '<h1>' + T('Персонажи · один стиль', 'Characters · one style') + '</h1>';
  h += '<p class="lead">' + T('Где были оба рисунка, взят Shattered: листы той же раскладки (21 кадр 12×15 на 7 рядов брони), альфа совпадает с PD — анимации не меняются. Образы Марта пересобраны тем же правилом цвета.', 'Where both drawings existed, Shattered\\'s is used: sheets of the same layout (21 frames of 12×15 on 7 armour rows), alpha identical to PD — no animation changes. The Mart\\'s looks are rebuilt with the same colour rule.') + '</p>';
  h += '<div class="grid2">';
  [['warrior', T('Воин', 'Warrior')], ['mage', T('Маг', 'Mage')], ['rogue', T('Разбойник', 'Rogue')], ['ranger', T('Охотница', 'Huntress')]].forEach(function (c) { h += '<div>' + ba('hero-' + c[0], c[1] + ' <small>' + T('· 7 рядов брони', '· 7 armour rows') + '</small>') + '</div>'; });
  h += '</div><h2>' + T('Образы Пиксель-Марта', 'Pixel-Mart looks') + '</h2><p class="muted">' + T('пепел · королевский · тень, 7 рядов брони каждый', 'ash · royal · shadow, 7 armour rows each') + '</p>';
  [['warrior', T('Воин', 'Warrior')], ['mage', T('Маг', 'Mage')], ['rogue', T('Разбойник', 'Rogue')], ['ranger', T('Охотница', 'Huntress')]].forEach(function (c) { h += ba('skins-' + c[0], c[1]); });
  h += '<h2>' + T('Портреты и полоса героев', 'Portraits and the hero strip') + '</h2><div class="grid2"><div>' + ba('avatars', T('Портреты 24×32', 'Portraits 24×32')) + '</div><div>' + ba('heroes6', T('Полоса 12×15', 'Strip 12×15')) + '</div></div>';
  h += '<h2>' + T('Жители', 'Folk') + '</h2><p class="muted">' + T('торговец · бес · Крысиный король · овца · нежить · проклятие · призрак', 'shopkeeper · imp · Rat King · sheep · undead · curse · ghost') + '</p>' + ba('npcs', T('Кадры 0 и 1', 'Frames 0 and 1'));
  d.innerHTML = h;
'''
card('ArtCharacters', 'Персонажи v24', 'Воин, маг, разбойник, охотница — листы Shattered вместо PD 1.9; 12 образов Марта на них же; портреты Shattered; торговец, бес, Крысиный король, овца, нежить, проклятие, призрак — Shattered', 1158, 1700, CHJ,
     'Персонажи v24: было/стало для листов героев, образов Пиксель-Марта, портретов, полосы героев и жителей. Раскладки и анимации прежние.\n')

# ------------------------------------------------------------------ 4. World sheets
WJ = '''
  var d = document.getElementById('doc'), h = '';
  h += '<h1>' + T('Мир · листы поверх тайлов', 'World · sheets over the tiles') + '</h1>';
  h += '<p class="lead">' + T('Подложка в раскладке PD (её читают трава, двери и карточка «Поделиться»), высокая трава и двери вырезаны из листа Shattered своего региона. Первый кадр — то, что уже на карте.', 'The PD-layout underlay (read by grass, doors and the share card), tall grass and doors are cut from the region\\'s own Shattered sheet. Frame 0 is what is already on the map.') + '</p>';
  var R = [[0, T('Канализация', 'Sewers')], [1, T('Тюрьма', 'Prison')], [2, T('Пещеры', 'Caves')], [3, T('Город', 'City')], [4, T('Чертоги', 'Halls')]];
  h += '<h2>' + T('Подложка tiles0–4', 'Underlay tiles0–4') + '</h2><p class="muted">' + T('id PD: пол · трава · высокая трава · дверь · открытая · запертая · баррикада · угли · стена · декор стены · колодец', 'PD ids: floor · grass · tall grass · door · open · locked · barricade · embers · wall · wall deco · well') + '</p>';
  R.forEach(function (r) { h += ba('under' + r[0], r[1]); });
  h += '<h2>' + T('Высокая трава и двери', 'Tall grass and doors') + '</h2><div class="grid2">';
  R.forEach(function (r) { h += '<div style="display:flex;gap:18px">' + ba('grass' + r[0], r[1] + ' <small>' + T('· трава', '· grass') + '</small>') + ba('doors' + r[0], '<small>' + T('двери: створка, замок, баррикада', 'doors: leaf, lock, barricade') + '</small>') + '</div>'; });
  h += '</div><h2>' + T('Сундуки, гробница, мимик, кости', 'Chests, tomb, mimic, bones') + '</h2>' + ba('chests', T('Кадр 0 = куча на полу', 'Frame 0 = the heap'));
  d.innerHTML = h;
'''
card('ArtWorld', 'Мир v24', 'Подложка tiles0–4 из листов Shattered своего региона, высокая трава из RAISED_HIGH_GRASS, двери из RAISED_DOOR, сундуки с первого кадра кучи — было/стало по пяти регионам', 1158, 2990, WJ,
     'Мир v24: подложка в раскладке PD, трава, двери, сундуки — было/стало. Пол канализации и тюрьмы спокойнее (L 70 → 60).\n')

# ------------------------------------------------------------------ 5. UI sheets
UJ = '''
  var d = document.getElementById('doc'), h = '';
  h += '<h1>' + T('Бафы, значки, метки, журнал', 'Buffs, badges, marks, journal') + '</h1>';
  h += '<p class="lead">' + T('Листы PD 1.9, которые игра ещё показывала, перерисованы в своей раскладке картинками Shattered: hud.ts, badges.ts и render.ts читают те же номера.', 'The PD 1.9 sheets the game still showed are repainted in their own layout with Shattered\\'s pictures: hud.ts, badges.ts and render.ts read the same numbers.') + '</p>';
  h += ba('buffs', T('buffs.png <small>· 7×7, 18 в ряд</small>', 'buffs.png <small>· 7×7, 18 a row</small>'));
  h += '<div class="grid2"><div>' + ba('badges', T('badges.png <small>· рамки уровней</small>', 'badges.png <small>· tier frames</small>')) + '</div><div>' + ba('icons', T('icons.png <small>· метки, классы</small>', 'icons.png <small>· marks, classes</small>')) + ba('mirror', T('Зеркальный меч <small>· клетка 135, по желанию</small>', 'Mirror sword <small>· cell 135, optional</small>')) + '</div></div>';
  h += ba('journal', T('Журнал <small>· journal.png, journal2</small>', 'Journal <small>· journal.png, journal2</small>'));
  d.innerHTML = h;
'''
card('ArtUiSheets', 'Бафы и значки v24', 'buffs.png, badges.png, icons.png и метки журнала — листы PD 1.9 в своей раскладке, перерисованные картинками Shattered; клетка зеркального меча', 1158, 1296, UJ,
     'Бафы, значки, метки, журнал: было/стало. Номера кадров прежние.\n')

# ------------------------------------------------------------------ 6/7. Showcase
def showcase(name, title, sub, scenes, height):
    js = '''
  var d = document.getElementById('doc'), h = '', S = ''' + json.dumps(scenes, ensure_ascii=False) + ''';
  h += '<h1>' + T(%s, %s) + '</h1>';
  h += '<p class="lead">' + T('Снимки самой игры (Vite, локальный забег без сервера, один и тот же сид): слева до v24, справа после. Полный набор 375×812 и 1280×800, RU и EN — в docs/design/previews/v24/.', 'Shots of the game itself (Vite, a local run without the server, the same seed): before v24 left, after right. The full set at 375×812 and 1280×800, RU and EN, is in docs/design/previews/v24/.') + '</p>';
  h += '<div class="shots">';
  S.forEach(function (s) {
    var z = IMG['z-' + L + '-' + s[0] + '-b'];
    h += '<div class="shot"><div class="cap"><b>' + (en ? s[2] : s[1]) + '</b> · 375×812' + (z ? ' · ' + T('и крупно', 'and up close') : '') + '</div><div class="two"><div><small>' + T('было', 'before') + '</small><img src="' + IMG['p-' + L + '-' + s[0] + '-b'] + '" width="250"></div><div><small>' + T('стало', 'after') + '</small><img src="' + IMG['p-' + L + '-' + s[0] + '-a'] + '" width="250"></div>' +
      (z ? '<div><small>' + T('было', 'before') + '</small><img class="px" src="' + z + '" width="270"></div><div><small>' + T('стало', 'after') + '</small><img class="px" src="' + IMG['z-' + L + '-' + s[0] + '-a'] + '" width="270"></div>' : '') + '</div></div>';
  });
  h += '</div><h2>1280×800</h2><div class="shots">';
  S.forEach(function (s) {
    if (!s[3]) return;
    h += '<div class="shot"><div class="cap"><b>' + (en ? s[2] : s[1]) + '</b></div><div class="two"><div><small>' + T('было', 'before') + '</small><img src="' + IMG['d-' + L + '-' + s[0] + '-b'] + '" width="540"></div><div><small>' + T('стало', 'after') + '</small><img src="' + IMG['d-' + L + '-' + s[0] + '-a'] + '" width="540"></div></div></div>';
  });
  h += '</div>';
  d.innerHTML = h;
''' % (json.dumps(title[0], ensure_ascii=False), json.dumps(title[1], ensure_ascii=False))
    card(name, title[0], sub, 1158, height, js, sub + '\n')

REGS = [['region01', 'Канализация, гл. 1', 'Sewers, depth 1', 1], ['region06', 'Тюрьма, гл. 6', 'Prison, depth 6', 1], ['region11', 'Пещеры, гл. 11', 'Caves, depth 11', 1],
        ['region16', 'Город, гл. 16', 'City, depth 16', 1], ['region21', 'Чертоги, гл. 21', 'Halls, depth 21', 1]]
SCR = [['camp', 'Привал', 'Camp', 1], ['camp-huntress', 'Привал · охотница', 'Camp · huntress', 0], ['mart', 'Пиксель-Март', 'Pixel-Mart', 1],
       ['folk', 'Жители', 'Folk', 0], ['king', 'Король гномов и нежить', 'Dwarf King and undead', 1], ['buffs', 'Бафы в HUD', 'Buffs in the HUD', 0],
       ['inventory', 'Рюкзак', 'Backpack', 1], ['hero', 'Окно героя', 'Hero window', 0], ['badges', 'Значки', 'Badges', 1]]
showcase('ArtShowcaseRegions', ('Было и стало · регионы', 'Before and after · regions'), 'Снимки игры до и после v24 по пяти регионам: телефон 375×812 и монитор 1280×800, язык по переключателю RU/EN', REGS, 5270)
showcase('ArtShowcaseScreens', ('Было и стало · экраны', 'Before and after · screens'), 'Снимки игры до и после v24: привал, Пиксель-Март, жители, Король гномов, бафы, рюкзак, окно героя, значки', SCR, 6490)
print('cards written')
