# v24 characters: one hero style (Shattered sheets), skins rebuilt on them, Shattered NPCs at the PD paths.
import os, numpy as np
from PIL import Image
O = '/home/claude/v24/orig/'                      # the game's assets as they are
S = '/home/claude/sh/spd/core/src/main/assets/sprites/'
OUT = '/home/claude/v24/out9/packages/client/public/assets/'
def save(im, rel):
    p = OUT + rel; os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, optimize=True); return im
def rgba(p): return Image.open(p).convert('RGBA')

# 1. Hero sheets: Shattered's at the PD paths (layout 21 x 12 px by 7 tiers x 15 px is the same, alpha identical).
HERO = {'warrior': 'warrior', 'mage': 'mage', 'rogue': 'rogue', 'ranger': 'huntress'}
for ours, sh in HERO.items():
    save(rgba(S + sh + '.png'), ours + '.png')

# 2. Pixel-Mart looks of those four: the old look's colour rule, moved onto the new sheet.
def lum(c): return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] + 1e-3
def transfer(pd, skin, new):
    a, b, c = (np.array(x).astype(int) for x in (pd, skin, new))
    votes = {}
    m = a[..., 3] > 0
    for p, s in zip(map(tuple, a[m][:, :3]), map(tuple, b[m][:, :3])):
        votes.setdefault(p, {}).setdefault(s, 0); votes[p][s] += 1
    M = {p: max(v, key=v.get) for p, v in votes.items()}
    out = c.copy(); cache = {}
    H, W = a.shape[:2]
    for y in range(H):
        for x in range(W):
            if c[y, x, 3] == 0: continue
            p = tuple(a[y, x, :3]); s = tuple(c[y, x, :3])
            key = (p, s)
            if key not in cache:
                t = M.get(p, p)
                if t == p: n = s                      # colour the look leaves alone (skin, outline): the new sheet's
                elif s == p: n = t
                else:
                    k = lum(s) / lum(p)
                    n = tuple(int(max(0, min(255, round(v * k)))) for v in t)
                cache[key] = n
            out[y, x, :3] = cache[key]
    return Image.fromarray(out.astype('uint8'), 'RGBA')

for ours in HERO:
    for look in ('ash', 'royal', 'shadow'):
        im = transfer(rgba(O + ours + '.png'), rgba(O + f'skins/{ours}-{look}.png'), rgba(OUT + ours + '.png'))
        save(im, f'skins/{ours}-{look}.png')

# 3. Camp figures: each class's first-armour row (TIER_ROW 1) of its sheet, then the looks the camp keeps.
ORDER = ['warrior', 'mage', 'rogue', 'ranger', 'duelist', 'cleric']
LOOK_ROWS = {6: 'warrior-royal', 7: 'mage-shadow', 8: 'rogue-ash', 9: 'ranger-royal', 10: 'duelist-ash', 11: 'duelist-royal',
             12: 'duelist-shadow', 13: 'cleric-ash', 14: 'cleric-royal', 15: 'cleric-shadow'}
camp = Image.new('RGBA', (252, 240))
def sheet(name): return rgba(OUT + name + '.png') if os.path.exists(OUT + name + '.png') else rgba(O + name + '.png')
for i, n in enumerate(ORDER): camp.paste(sheet(n).crop((0, 15, 252, 30)), (0, i * 15))
for r, n in LOOK_ROWS.items(): camp.paste(sheet('skins/' + n).crop((0, 15, 252, 30)), (0, r * 15))
save(camp, 'camp/camp-heroes.png')

# 4. Small strip (first frame of the first armour) and the class portraits (Shattered avatars.png, first 144 px).
strip = Image.new('RGBA', (72, 15))
for i, n in enumerate(ORDER): strip.paste(sheet(n).crop((0, 15, 12, 30)), (i * 12, 0))
save(strip, 'heroes6.png')
save(rgba(S + 'avatars.png').crop((0, 0, 144, 32)), 'avatars.png')

# 5. NPCs still drawn from PD 1.9 sheets: Shattered's drawings, cut to the PD sheet's size so frames stay where they were.
def fit(src, size, box=None):
    im = rgba(src); im = im.crop(box) if box else im
    out = Image.new('RGBA', size); out.paste(im.crop((0, 0, min(size[0], im.width), min(size[1], im.height))), (0, 0)); return out
save(fit(S + 'shopkeeper.png', (32, 16)), 'shopkeeper.png')
save(fit(S + 'imp.png', (64, 16)), 'imp.png')
save(fit(S + 'ratking.png', (128, 16)), 'ratKing.png')
save(fit(S + 'sheep.png', (128, 16)), 'sheep.png')          # frames 0-3 drawn, 4 (the puff on death) stays empty as before
save(fit(S + 'undead.png', (256, 16)), 'undead.png')
save(fit(S + 'wraith.png', (128, 16)), 'wraith.png')        # the curse: the wraith's first row
save(fit(S + 'ghost.png', (32, 16)), 'ghost.png')           # fallback figure: the quest ghost's first two frames
save(rgba(O + 'spd/blacksmith.png'), 'blacksmith.png')      # loaded, shadowed by spd/: the same picture now
save(rgba(O + 'spd/wandmaker.png'), 'wandmaker.png')
print('chars done')
