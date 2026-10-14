# v25 badges: «Shattered 4.0.2 · v2.4» (new), GPL re-tinted to ink; play (Telegram blue) and daily (blood + gold) kept.
import os
import numpy as np, shutil
from PIL import Image, ImageDraw, ImageFont
G = 'docs/github/'; OUT = 'docs/github/'
FONT = ImageFont.truetype(os.environ.get('GALMURI', 'Galmuri11.ttf'), 36)
INK, SHADOW = (0xe8, 0xe2, 0xc8), (0x0a, 0x0b, 0x09)
def stone_badge(text, base='badge-gpl-ru.png', color=INK):
    src = np.array(Image.open(G + base).convert('RGB'))
    tw = FONT.getbbox(text)[2]; W = tw + 49
    a = np.zeros((68, W, 3), np.uint8)
    a[:, :6] = src[:, :6]; a[:, W - 6:] = src[:, -6:]; a[:, 6:W - 6] = src[:, 6:7]
    im = Image.fromarray(a); d = ImageDraw.Draw(im); d.fontmode = '1'
    d.text((20, 15), text, font=FONT, fill=SHADOW, anchor='lt'); d.text((20, 12), text, font=FONT, fill=color, anchor='lt')
    return im
for lang in ('ru', 'en'):
    stone_badge('Shattered 4.0.2 · v2.4').save(OUT + f'badge-ver-{lang}.png', optimize=True)
    stone_badge('GPL-3.0').save(OUT + f'badge-gpl-{lang}.png', optimize=True)
    # badge-play and badge-daily stay as they are (Telegram blue; blood and gold are already v24 tokens).
# check: old gpl vs new gpl differ only in the text colour
o = np.array(Image.open(G + 'badge-gpl-ru.png').convert('RGB')).astype(int); n = np.array(Image.open(OUT + 'badge-gpl-ru.png').convert('RGB')).astype(int)
print('gpl size', o.shape, n.shape)
