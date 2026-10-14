# v25: the four cards (332x718) and their strip (1440x768): real 375x812 screenshots of current main, a title and a caption each.
import os
from PIL import Image, ImageDraw, ImageFont
OUT = 'docs/github/'
GAL = os.environ.get('GALMURI', 'Galmuri11.ttf')
INK, MUTED, GOLD, VOID = '#e8e2c8', '#b0b5a3', '#ffeba4', '#0b0b09'
S900, S800, S700, S400 = '#1f211c', '#282a24', '#3b3e36', '#62665b'
SHOTS = {
    1: 'shots/v25/daily/{L}-w/camp-after.png',
    2: 'shots/v25/{L}/depth.png',
    3: 'shots/v25/{L}/talents.png',
    4: 'shots/v25/daily/{L}-h/end-checked.png',
}
TEXT = {
    'ru': {
        1: ('Привал', 'Герой у костра у входа в подземелье; правила дня свёрнуты под «?».'),
        2: ('Подземелье', 'Город дворфов: чемпионы в ауре, вурдалаки и монахи. Бои Shattered 4.0.2.'),
        3: ('Таланты', 'Четыре яруса: путь мастерства после Тенгу и способность брони.'),
        4: ('Подземелье дня', 'Одно на всех: первая попытка — в зачёт, забег проверяет сервер.'),
    },
    'en': {
        1: ('The camp', 'Your hero by the fire at the dungeon door; the day’s rules fold under the “?”.'),
        2: ('The dungeon', 'The Dwarven City: champions in auras, ghouls and monks. Shattered 4.0.2 fights.'),
        3: ('Talents', 'Four tiers: a subclass after Tengu, then an armour ability.'),
        4: ('Daily dungeon', 'One for everyone: the first attempt counts, the server checks the run.'),
    },
}
def wrap(d, s, font, width):
    words, lines, cur = s.split(' '), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    lines.append(cur); return lines

def card(lang, i, cap_size=12, cap_mode='1'):
    W, H = 332, 718
    im = Image.new('RGB', (W, H), S900); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W - 1, H - 1), outline=S400); d.rectangle((1, 1, W - 2, H - 2), outline=S700)
    shot = Image.open(SHOTS[i].format(L=lang)).convert('RGB')
    sw, sh = 276, 598
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x0, y0 = (W - sw) // 2, 22
    d.rectangle((x0 - 4, y0 - 4, x0 + sw + 3, y0 + sh + 3), fill=VOID); d.rectangle((x0 - 2, y0 - 2, x0 + sw + 1, y0 + sh + 1), outline=S400)
    im.paste(shot, (x0, y0))
    title, cap = TEXT[lang][i]
    d.fontmode = '1'
    ft = ImageFont.truetype(GAL, 24)
    d.text((x0 - 2, y0 + sh + 18 + 2), title, font=ft, fill=VOID); d.text((x0 - 2, y0 + sh + 18), title, font=ft, fill=GOLD)
    d.fontmode = cap_mode
    fc = ImageFont.truetype(GAL, cap_size)
    lines = wrap(d, cap, fc, sw + 4)
    for k, line in enumerate(lines[:3]):
        d.text((x0 - 2, y0 + sh + 52 + k * (cap_size + 5)), line, font=fc, fill=MUTED)
    return im, len(lines)

if __name__ == '__main__':
    import sys
    for lang in ('ru', 'en'):
        cards = []
        for i in (1, 2, 3, 4):
            c, n = card(lang, i)
            if n > 2: print('3 lines', lang, i)
            c.save(OUT + f'screen-{i}-{lang}.png', optimize=True); cards.append(c)
        strip = Image.new('RGB', (1440, 768), VOID)
        for k, c in enumerate(cards): strip.paste(c, (20 + k * (332 + 24), 25))
        strip.save(OUT + f'screens-{lang}.png', optimize=True)
    print('cards ok')
