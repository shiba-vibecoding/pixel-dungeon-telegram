# v24 effects and UI: the PD 1.9 sheets the game still shows (buffs, badges, map marks) redrawn at their own
# layouts from Shattered's art; journal marks and the design system's small copies of PD sprites brought along.
import os, numpy as np
from PIL import Image
O = '/home/claude/v24/orig/'
SH = '/home/claude/sh/spd/core/src/main/assets/'
OUT = '/home/claude/v24/out9/packages/client/public/assets/'
SPR = '/home/claude/v24/spr/'            # new copies for the design system's work/spr (build.py VARS)
os.makedirs(SPR, exist_ok=True)
def rgba(p): return Image.open(p).convert('RGBA')
def save(im, rel):
    p = OUT + rel; os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, optimize=True); return im
def spr(im, name): im.save(SPR + name, optimize=True); return im
def new(rel): return rgba(OUT + rel) if os.path.exists(OUT + rel) else rgba(O + rel)

# ---------------------------------------------------------------- 1. buffs.png (PD layout, 18 a row of 7 px)
# Shattered kept PD's first 29 indices for the same states; PD's VERTIGO (29), RAGE (30) and SACRIFICE (31) are 33, 38, 39 there.
PD_TO_SH = {i: i for i in range(29)}; PD_TO_SH.update({29: 33, 30: 38, 31: 39})
pdb = rgba(O + 'buffs.png'); shb = rgba(SH + 'interfaces/buffs.png')
out = Image.new('RGBA', pdb.size)
def cell7(i): return ((i % 18) * 7, (i // 18) * 7, (i % 18) * 7 + 7, (i // 18) * 7 + 7)
for i in range((pdb.width // 7) * (pdb.height // 7)):
    if i in PD_TO_SH: out.paste(shb.crop(cell7(PD_TO_SH[i])), cell7(i)[:2])
save(out, 'buffs.png'); spr(out, 'sheet-buffs.png')

# ---------------------------------------------------------------- 2. badges.png (PD layout 8 x 8 of 16 px)
# Each picture the game names (badges.ts image) now holds Shattered's badge for the same feat, in Shattered's tier
# frames (bronze, silver, gold, platinum). Feats Shattered dropped (all scrolls / rings / wands identified, the haggler's
# and thorns rings, all items) keep their PD picture, re-framed in the tier frame their row should have.
B = {0: 6, 1: 7, 2: 34, 3: 35, 4: 8, 5: 9, 6: 36, 7: 37, 8: 11, 9: 40, 10: 41, 11: 72, 12: 15, 13: 48, 14: 49, 15: 79,
     16: 50, 22: 82, 23: 67, 24: 17, 25: 18, 26: 19, 27: 20, 29: 66, 30: 65, 32: 54, 33: 105, 34: 104, 36: 103, 37: 80,
     38: 99, 39: 111, 40: 12, 41: 42, 42: 43, 43: 73, 44: 13, 45: 44, 46: 45, 47: 75, 48: 10, 49: 38, 50: 39, 51: 71,
     52: 14, 53: 46, 54: 47, 55: 77, 56: 68, 57: 52, 59: 21, 60: 23, 61: 56, 62: 86, 63: 109}
REFRAME = {17: 16, 18: 16, 19: 16, 20: 38, 21: 38, 35: 82}   # PD picture -> Shattered badge whose frame it borrows
pdg = np.array(rgba(O + 'badges.png')).astype(int); shg = np.array(rgba(SH + 'interfaces/badges.png')).astype(int)
def c16(a, i, cols=8): return a[(i // cols) * 16:(i // cols) * 16 + 16, (i % cols) * 16:(i % cols) * 16 + 16].copy()
res = pdg.copy()
def put(i, t): res[(i // 8) * 16:(i // 8) * 16 + 16, (i % 8) * 16:(i % 8) * 16 + 16] = t
for pd, sh in B.items(): put(pd, c16(shg, sh))
for pd, sh in REFRAME.items():
    frame = c16(shg, sh); pic = c16(pdg, pd)
    # The frame is what both share in alpha in the outer ring (2 px); inside, the PD picture on Shattered's patterned field.
    t = frame.copy()
    inner = np.zeros((16, 16), bool); inner[3:13, 3:13] = True
    # PD glyph pixels: those that differ from the PD field colour (most common inner colour).
    cols, cnt = np.unique(pic[inner][:, :3], axis=0, return_counts=True); field = cols[cnt.argmax()]
    glyph = inner & (np.abs(pic[..., :3] - field).sum(axis=2) > 30) & (pic[..., 3] > 0)
    # Clear Shattered's own glyph to its field colour first.
    scols, scnt = np.unique(frame[inner][:, :3], axis=0, return_counts=True)
    sfield = scols[np.argsort(-scnt)[:2]]
    for y in range(3, 13):
        for x in range(3, 13):
            if not any((np.abs(frame[y, x, :3] - f).sum() < 8) for f in sfield):
                t[y, x, :3] = sfield[(x + y) % len(sfield)]
    t[glyph] = pic[glyph]
    put(pd, t)
bad = Image.fromarray(res.astype('uint8'), 'RGBA')
save(bad, 'badges.png'); spr(bad, 'sheet-badges.png')
spr(rgba(SH + 'interfaces/locked_badge.png'), 'badge-locked.png')

# ---------------------------------------------------------------- 3. icons.png (PD layout): the marks the map draws
ic = rgba(O + 'icons.png'); shi = rgba(SH + 'interfaces/icons.png'); items = rgba(O + 'items.png')
def blit(dst, src, sbox, dpos, clear=None):
    if clear: dst.paste(Image.new('RGBA', (clear[2], clear[3])), (clear[0], clear[1]))
    dst.alpha_composite(src.crop(sbox), dpos)
blit(ic, shi, (0, 80, 8, 88), (0, 0), (0, 0, 8, 8))          # skull
blit(ic, shi, (8, 80, 16, 88), (8, 0), (8, 0, 8, 8))         # busy
blit(ic, shi, (7, 88, 16, 96), (13, 45), (13, 45, 9, 8))     # sleep (render.ts over sleeping monsters)
blit(ic, shi, (16, 80, 24, 88), (22, 45), (22, 45, 8, 8))    # alert
blit(ic, shi, (32, 80, 38, 87), (46, 12), (45, 12, 9, 8))    # depth
def item(i): return (i % 16 * 16, i // 16 * 16, i % 16 * 16 + 16, i // 16 * 16 + 16)
for k, idx in enumerate([50, 101, 240, 144]):                 # class icons: Shattered draws them as the class items
    blit(ic, items, item(idx), (k * 16, 29), (k * 16, 29, 16, 16))
save(ic, 'icons.png')
spr(shi.crop((0, 80, 8, 88)), 'icon-skull.png'); spr(shi.crop((8, 80, 16, 88)), 'icon-busy.png')
spr(shi.crop((7, 88, 16, 96)), 'icon-sleep.png'); spr(shi.crop((16, 80, 24, 88)), 'icon-alert.png')
d = Image.new('RGBA', (8, 8)); d.alpha_composite(shi.crop((32, 80, 38, 87)), (1, 1)); spr(d, 'icon-depth-hud.png')
for n, idx in zip(['warrior', 'mage', 'rogue', 'huntress'], [50, 101, 240, 144]): spr(items.crop(item(idx)), f'class-{n}.png')
spr(shi.crop((80, 0, 96, 16)), 'icon-update.png')              # Shattered's CHANGES icon for «update»

# ---------------------------------------------------------------- 4. journal marks: characters and places from Shattered
SP = SH + 'sprites/'
def frame(path, w, h, f=0, cols=None):
    im = rgba(path); cols = cols or im.width // w
    return im.crop(((f % cols) * w, (f // cols) * h, (f % cols) * w + w, (f // cols) * h + h))
def cell(fr):
    c = Image.new('RGBA', (16, 16)); c.alpha_composite(fr, ((16 - fr.width) // 2, 16 - fr.height)); return c
def tile(sheet, i):
    im = rgba(sheet); return im.crop(((i % 16) * 16, (i // 16) * 16, (i % 16) * 16 + 16, (i // 16) * 16 + 16))
SEW = OUT + 'spd/tiles_sewers.png' if os.path.exists(OUT + 'spd/tiles_sewers.png') else O + 'spd/tiles_sewers.png'
def well(tint):
    t = np.array(tile(SEW, 18)).astype(int)
    hole = (t[..., :3].sum(axis=2) < 140) & (t[..., 3] > 0)
    ys, xs = np.where(hole)
    for y, x in zip(ys, xs):
        if 4 <= y <= 12 and 3 <= x <= 12:
            l = t[y, x, :3].mean() / 70
            t[y, x, :3] = np.clip(np.array(tint) * (0.55 + 0.6 * l), 0, 255)
    return Image.fromarray(t.astype('uint8'), 'RGBA')
j = rgba(O + 'meta/journal.png')
marks = [well((200, 40, 40)), well((230, 180, 40)), well((150, 60, 210))]
for k, m in enumerate(marks): j.paste(m, (k * 16, 0))
j.paste(tile(SEW, 64), (4 * 16, 0))                          # alchemy pot
j.paste(tile(SEW, 122), (5 * 16, 0))                         # garden: the sewers' tall grass
j.paste(tile(SEW, 72), (6 * 16, 0))                          # statue
for k, fr in [(7, frame(SP + 'ghost.png', 14, 15)), (8, frame(SP + 'wandmaker.png', 12, 14)), (9, frame(SP + 'blacksmith.png', 13, 16)),
              (10, frame(SP + 'imp.png', 12, 14))]:
    j.paste(Image.new('RGBA', (16, 16)), (k * 16, 0)); j.alpha_composite(cell(fr), (k * 16, 0))
save(j, 'meta/journal.png'); spr(j, 'sheet-journal.png')
j2 = rgba(O + 'shattered/journal2.png')
for k, fr in [(0, frame(SP + 'shopkeeper.png', 14, 14, 1)), (1, frame(SP + 'imp.png', 12, 14)), (2, frame(SP + 'ratking.png', 16, 16))]:
    j2.paste(Image.new('RGBA', (16, 16)), (k * 16, 0)); j2.alpha_composite(cell(fr), (k * 16, 0))
save(j2, 'shattered/journal2.png'); spr(j2, 'journal2.png')

# ---------------------------------------------------------------- 5. the design system's own copies of characters
for n, sh in [('warrior', 'warrior'), ('mage', 'mage'), ('rogue', 'rogue'), ('ranger', 'huntress')]:
    spr(frame(SP + sh + '.png', 12, 15, 21), f'hero-{n}.png')   # first armour, idle (row 1)
av = rgba(SP + 'avatars.png')
for k, n in enumerate(['warrior', 'mage', 'rogue', 'huntress']): spr(av.crop((k * 24, 0, k * 24 + 24, 32)), f'avatar-{n}.png')
spr(av.crop((0, 0, 144, 32)), 'sh-avatars.png')
spr(new('heroes6.png'), 'sh-heroes6.png'); spr(new('warrior.png'), 'sheet-warrior.png')
spr(frame(SP + 'shopkeeper.png', 14, 14, 1), 'npc-shopkeeper.png'); spr(frame(SP + 'imp.png', 12, 14), 'npc-imp.png')
spr(frame(SP + 'ghost.png', 14, 15), 'npc-ghost.png'); spr(frame(SP + 'wandmaker.png', 12, 14), 'npc-wandmaker.png')
spr(frame(SP + 'blacksmith.png', 13, 16), 'npc-blacksmith.png')
spr(frame(SP + 'rat.png', 16, 15), 'mob-rat.png'); spr(frame(SP + 'crab.png', 16, 16), 'mob-crab.png')

# ---------------------------------------------------------------- 6. the mirror sword (vault reward): a cell of its own
# items.png 135 (free, the tier-5 weapons' row): the greatsword's blade in mirror glass. Optional: the code draws the
# greatsword (Shattered does too) unless it maps the vault's sword to MIRROR_SWORD = 135.
it = np.array(rgba(O + 'items.png')).astype(int)
gs = it[128 // 16 * 16:128 // 16 * 16 + 16, 128 % 16 * 16:128 % 16 * 16 + 16].copy()
blade = (gs[..., 3] > 0) & (np.abs(gs[..., 0] - gs[..., 2]) < 40) & (gs[..., :3].mean(axis=2) > 70)
GLASS = np.array([(47, 95, 122), (95, 169, 204), (168, 228, 247), (242, 253, 255)])
lv = gs[..., :3].mean(axis=2)
bl = lv[blade]; qs = np.quantile(bl, [0.25, 0.5, 0.8]) if len(bl) else [0, 0, 0]
for y, x in zip(*np.where(blade)):
    k = int(np.searchsorted(qs, lv[y, x]))
    if (x - y) % 5 == 0 and k >= 2: k = 3          # a glint running down the mirror
    gs[y, x, :3] = GLASS[min(3, k)]
it[8 * 16:8 * 16 + 16, 7 * 16:7 * 16 + 16] = gs
save(Image.fromarray(it.astype('uint8'), 'RGBA'), 'items.png'); spr(rgba(OUT + 'items.png'), 'sh-items-shpd.png')
print('ui done')

# ---------------------------------------------------------------- 7. the loose journal pieces (meta/journal-*.png) cut from the new sheet
names = ['well-health', 'well-awareness', 'well-transmutation', 'sacrifice', 'alchemy', 'garden', 'statue', 'ghost', 'wandmaker', 'blacksmith', 'imp']
jj = rgba(OUT + 'meta/journal.png')
for k, n in enumerate(names): save(jj.crop((k * 16, 0, k * 16 + 16, 16)), f'meta/journal-{n}.png')
print('journal pieces done')
