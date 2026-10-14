# v25: docs/github art — header, social preview, the four cards and their strip, the «what's new» card, the camp GIF.
import os
import sys, json, numpy as np
sys.path.insert(0, 'tools/art')
from PIL import Image, ImageDraw, ImageFont
from p25_scene import scene
OUT = 'docs/github/'
GAL = os.environ.get('GALMURI', 'Galmuri11.ttf')
F = lambda n: ImageFont.truetype(GAL, n)
INK, MUTED, GOLD, GOLD2, VOID = '#e8e2c8', '#b0b5a3', '#ffeba4', '#ffcc66', '#0b0b09'
LOGO = Image.open('tools/art/sprites/banner-logo.png').convert('RGBA')
SUB = {'ru': ('Shattered 4.0.2', ' · в Telegram'), 'en': ('Shattered 4.0.2', ' · in Telegram')}

def text(d, xy, s, font, fill, shadow=3, anchor='la'):
    d.fontmode = '1'
    if shadow: d.text((xy[0], xy[1] + shadow), s, font=font, fill=VOID, anchor=anchor)
    d.text(xy, s, font=font, fill=fill, anchor=anchor)

def subtitle(d, x, y, lang, size=36):
    f = F(size); a, b = SUB[lang]
    text(d, (x, y), a, f, GOLD, shadow=size // 12)
    text(d, (x + f.getlength(a), y), b, f, INK, shadow=size // 12)

def logo(img, x, y, k):
    l = LOGO.resize((LOGO.width * k, LOGO.height * k), Image.NEAREST)
    img.alpha_composite(l, (x - 10 * k, y - 4 * k))      # (x, y): the letters' top-left

for lang in ('ru', 'en'):
    # Social preview 1280x640: art 160x80 x8; the title, its subtitle and «Play in Telegram» on the left.
    art, _ = scene(160, 80, cx=112, gh=18, moon=(140, 4), stones=[(.06, .3), (.33, .7), (.58, .85), (.96, .5)])
    img = art.resize((1280, 640), Image.NEAREST)
    logo(img, 56, 40, 4)
    d = ImageDraw.Draw(img)
    # Two lines at 48 px, so the subtitle still reads in a small link preview (the line break stands for the « · »).
    a, b = SUB[lang]; f = F(48)
    text(d, (56, 334), a, f, GOLD, shadow=4); text(d, (56, 392), b.replace(' · ', ''), f, INK, shadow=4)
    btn = Image.open(OUT + f'badge-play-{lang}.png').convert('RGBA')
    img.alpha_composite(btn, (56, 478))
    img.convert('RGB').save(OUT + f'social-preview-{lang}.png', optimize=True)
    # Header 1200x400: art 200x67 x6 (one row cut off), the title and subtitle on the left.
    art, _ = scene(200, 67, cx=154, gh=15, moon=(118, 4), stones=[(.05, .4), (.4, .75), (.97, .55)])
    img = art.resize((1200, 402), Image.NEAREST).crop((0, 1, 1200, 401))
    logo(img, 64, 44, 3)
    d = ImageDraw.Draw(img)
    subtitle(d, 64, 268, lang)
    img.convert('RGB').save(OUT + f'header-{lang}.png', optimize=True)
print('banners ok')

# «What's new» card 1280x640 (to pin in the Telegram channel): the camp art, the release's four main items with the game's own icons.
SPR = 'tools/art/sprites/'
WN = {
    'ru': ('Что нового · v2.4', 'Shattered 4.0.2', ['Два новых класса', 'Таланты', 'Алхимия', 'Новые боссы и уровни']),
    'en': ('What’s new · v2.4', 'Shattered 4.0.2', ['Two new classes', 'Talents', 'Alchemy', 'New bosses and levels']),
}
def icon(n, k):
    im = Image.open(SPR + n).convert('RGBA'); return im.resize((im.width * k, im.height * k), Image.NEAREST)
av = Image.open(SPR + 'sh-avatars.png').convert('RGBA')
ICONS = [
    [av.crop((4 * 24, 0, 5 * 24, 32)).resize((48, 64), Image.NEAREST), av.crop((5 * 24, 0, 6 * 24, 32)).resize((48, 64), Image.NEAREST)],
    [icon('sh-icon-talent.png', 4)], [icon('sh-icon-alchemy.png', 3)], [icon('icon-skull.png', 6)],
]
for lang in ('ru', 'en'):
    art, _ = scene(160, 80, cx=121, gh=18, moon=(147, 4), stones=[(.06, .3), (.33, .7), (.6, .85), (.97, .5)], seed=9, spread=0.88)
    img = art.resize((1280, 640), Image.NEAREST)
    # a quiet panel under the text, the window's stone, so the list reads over the hill
    a = np.array(img).astype(np.int32)
    a[24:604, 24:628, :3] = (a[24:604, 24:628, :3] * 0.35 + np.array([0x1f, 0x21, 0x1c]) * 0.65).astype(np.int32)
    img = Image.fromarray(a.astype(np.uint8), 'RGBA'); d = ImageDraw.Draw(img)
    d.rectangle((24, 24, 627, 603), outline='#62665b', width=2); d.rectangle((20, 20, 631, 607), outline=VOID, width=2)
    kick, title, items = WN[lang]
    text(d, (56, 52), kick, F(24), '#ffcc66', shadow=2)
    text(d, (56, 88), title, F(48), GOLD, shadow=4)
    for i, (t, ics) in enumerate(zip(items, ICONS)):
        y = 172 + i * 76; x = 56
        w = sum(ic.width for ic in ics); h = max(ic.height for ic in ics)
        xx = x + (96 - w) // 2
        for ic in ics: img.alpha_composite(ic, (xx, y + (64 - ic.height) // 2)); xx += ic.width
        text(d, (164, y + 14), t, F(36), INK, shadow=3)
    btn = Image.open(OUT + f'badge-play-{lang}.png').convert('RGBA')
    img.alpha_composite(btn, (56, 506))
    img.convert('RGB').save(f'docs/github/whatsnew-{lang}.png', optimize=True)
    print('whatsnew', lang, F(36).getlength(items[3]))
