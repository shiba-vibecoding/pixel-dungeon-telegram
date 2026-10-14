# v24 tiles: Shattered's region sheets calmed where the floor fights the sprites, and every sheet of ours
# that is drawn over them (PD-layout underlay, doors, tall grass, fog) cut from those same sheets.
import os, json, numpy as np
from PIL import Image
O = '/home/claude/v24/orig/'
OUT = '/home/claude/v24/out9/packages/client/public/assets/'
REG = ['sewers', 'prison', 'caves', 'city', 'halls']
def rgba(p): return Image.open(p).convert('RGBA')
def arr(im): return np.array(im).astype(np.int32)
def img(a): return Image.fromarray(np.clip(a, 0, 255).astype('uint8'), 'RGBA')
def save(im, rel):
    p = OUT + rel; os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, optimize=True); return im
def tile(a, i, cols=16): return a[(i // cols) * 16:(i // cols) * 16 + 16, (i % cols) * 16:(i % cols) * 16 + 16].copy()

# ---------------------------------------------------------------- 1. floor polish
# Sewers and prison floors are the brightest and busiest of the five (mean L 70-72, texture sd 10-12): grey rats,
# skeletons, stones and scrolls sink into them. Their own colours are moved toward a darker, quieter version;
# the same colour map runs over every tile of the sheet (doors, grass, wells stand on that floor too) and over the
# region's custom tiles, so nothing shows a patch. Colours the walls use are left alone.
FLOOR_TILES = [0, 1, 4, 6, 7, 10, 12]
WALL_TILES = list(range(48, 64)) + list(range(80, 112)) + list(range(144, 256))
POLISH = {0: (0.86, 0.70), 1: (0.87, 0.72)}       # region: (mean scale, contrast of the texture around its mean)
CUSTOM = {0: ['sewer_boss', 'rat_king_room', 'weak_floor'], 1: ['prison_quest', 'prison_exit']}
BOSS_COPY = {0: 'sewer_boss', 1: 'prison_exit'}     # spd/<name>.png duplicates of custom tiles that sprites.ts loads too

def colour_map(sheet, region):
    k_mean, k_con = POLISH[region]
    fl = np.concatenate([tile(sheet, i).reshape(-1, 4) for i in FLOOR_TILES])
    fl = fl[fl[:, 3] > 0][:, :3]
    mean = fl.mean(axis=0)
    M = {}
    for c in set(map(tuple, fl)):
        c = np.array(c, float)
        n = mean * k_mean + (c - mean) * k_con
        M[tuple(int(v) for v in c)] = tuple(int(round(v)) for v in np.clip(n, 0, 255))
    return M

# Tiles that stand on the floor (ground rows 0-2, the flat-mode others of row 4, the raised doors, grass and statues of
# rows 7-8): the floor's colours move there. The walls' rows (3, 5-6, 9-15) keep theirs, shared colours included.
GROUND_ROWS = [0, 1, 2, 4, 7, 8]
def apply_map(a, M, rows=None):
    out = a.copy()
    for r in (rows if rows is not None else range(a.shape[0] // 16)):
        blk = out[r * 16:r * 16 + 16]
        flat = blk.reshape(-1, 4)
        keys = flat[:, 0] * 65536 + flat[:, 1] * 256 + flat[:, 2]
        for c, n in M.items():
            sel = (keys == c[0] * 65536 + c[1] * 256 + c[2]) & (flat[:, 3] > 0)
            flat[sel, :3] = n
        out[r * 16:r * 16 + 16] = flat.reshape(blk.shape)
    return out

sheets = []
for r, name in enumerate(REG):
    a = arr(rgba(O + f'spd/tiles_{name}.png'))
    if r in POLISH:
        M = colour_map(a, r)
        a = apply_map(a, M, GROUND_ROWS)
        save(img(a), f'spd/tiles_{name}.png')
        for c in CUSTOM[r]:
            p = O + f'spd/custom_tiles/{c}.png'
            if os.path.exists(p): save(img(apply_map(arr(rgba(p)), M)), f'spd/custom_tiles/{c}.png')
        b = BOSS_COPY[r]
        if os.path.exists(O + f'spd/{b}.png'): save(img(apply_map(arr(rgba(O + f'spd/{b}.png')), M)), f'spd/{b}.png')
        print(name, 'floor colours moved:', len(M))
    sheets.append(a)

# ---------------------------------------------------------------- 2. the PD-layout underlay (tiles0-4.png)
# motion.ts and share.ts read these by PD id (index in a 16-wide sheet). Each PD cell that is a picture of a Shattered tile
# (all the ones the code reads: floor 1, grass 2, tall grass 15, doors 5/6/10, barricade 13, embers 9, walls 4/12, floor deco 24)
# is taken again from the region's new Shattered sheet, so the floor under swaying grass, the door fallbacks and the share card
# are the map's own tiles; the PD-only cells (old trap plates, unused) keep their picture, with the floor colours moved likewise.
def cells(a, n):
    cols = a.shape[1] // 16
    return [a[(k // cols) * 16:(k // cols) * 16 + 16, (k % cols) * 16:(k % cols) * 16 + 16] for k in range(n)]
for r, a in enumerate(sheets):
    pd0 = arr(rgba(O + f'tiles{r}.png')); sh0 = cells(arr(rgba(O + f'spd/tiles_{REG[r]}.png')), 256)
    out = pd0.copy() if r not in POLISH else apply_map(pd0, colour_map(arr(rgba(O + f'spd/tiles_{REG[r]}.png')), r))
    for k, c in enumerate(cells(pd0, 128)):
        if c[..., 3].sum() == 0: continue
        dist = [np.abs(c - t).sum() / 256 for t in sh0]; m = int(np.argmin(dist))
        if dist[m] <= 25:
            out[(k // 16) * 16:(k // 16) * 16 + 16, (k % 16) * 16:(k % 16) * 16 + 16] = tile(a, m)
    save(img(out), f'tiles{r}.png')

# ---------------------------------------------------------------- 3. tall grass (world/grass0-4.png, 80x40)
# The sway is Shattered's own tall-grass tile (RAISED_HIGH_GRASS, 122), sheared from the roots up; the trample
# ends on its low grass (GRASS, 2). Both drawn as what differs from the floor, as before (motion draws the floor first).
def overlay(t, floor):
    o = t.copy(); same = (np.abs(t - floor).sum(axis=2) == 0); o[same] = 0; return o
def shear(o, k):
    out = np.zeros_like(o)
    for y in range(16):
        dx = int(round(k * (15 - y) / 15 * 1.6))
        for x in range(16):
            sx = x - dx
            if 0 <= sx < 16: out[y, x] = o[y, sx]
    return out
def squash(o, h):
    out = np.zeros_like(o)
    for y in range(16 - h, 16):
        sy = int((y - (16 - h)) * 16 / h); out[y] = o[min(15, sy)]
    return out
for r, a in enumerate(sheets):
    floor = tile(a, 0)
    tall = overlay(tile(a, 122), floor); low = overlay(tile(a, 2), floor)
    g = np.zeros((40, 80, 4), np.int32)
    for i, k in enumerate([-2, -1, 0, 1, 2]): g[0:16, i * 16:i * 16 + 16] = shear(tall, k)
    g[16:32, 0:16] = squash(tall, 11)
    half = squash(tall, 6); m = low[..., 3] > 0; half[m] = low[m]
    g[16:32, 16:32] = half
    g[16:32, 32:48] = low
    # The leaves row (16x8): blades flying when trampled, in this region's grass colours (rects as grass0.json says).
    old = arr(rgba(O + f'world/grass{r}.png'))[32:40, 0:16]
    pal = tall[tall[..., 3] > 0][:, :3]
    sat = pal.max(axis=1) - pal.min(axis=1); pal = pal[(sat > 25) & (pal.max(axis=1) < 235)] if ((sat > 25) & (pal.max(axis=1) < 235)).sum() > 3 else pal
    if len(pal):
        lum = pal @ np.array([0.299, 0.587, 0.114]); order = np.argsort(lum); pal = pal[order]
        for y in range(8):
            for x in range(16):
                if old[y, x, 3]:
                    l = (old[y, x, :3] @ np.array([0.299, 0.587, 0.114])) / 255
                    old[y, x, :3] = pal[min(len(pal) - 1, int(l * (len(pal) - 1)))]
    g[32:40, 0:16] = old
    save(img(g), f'world/grass{r}.png')

# ---------------------------------------------------------------- 4. doors (world/doors0-4.png, 64x48)
# Row 0: Shattered's closed door (112) swinging to its open door (113): the leaf narrows to its hinge.
# Row 1: locked door (114), the lock lit as the key turns, open. Row 2: barricade (121) catching fire, charred, embers (3).
def narrow(closed, opened, k):
    diff = np.abs(closed - opened).sum(axis=2) > 0
    ys, xs = np.where(diff)
    if not len(xs): return closed
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    out = opened.copy(); w = x1 - x0; nw = max(1, int(round(w * k)))
    for y in range(y0, y1):
        for x in range(nw):
            sx = x0 + int(x * w / nw)
            if diff[y, sx]: out[y, x0 + x] = closed[y, sx]
    # A dark line where the leaf's edge meets the room behind it.
    if nw < w:
        for y in range(y0, y1):
            if diff[y, x0 + nw - 1]: out[y, x0 + nw - 1, :3] = (out[y, x0 + nw - 1, :3] * 0.55).astype(np.int32)
    return out
FIRE = lambda p: p[3] > 0 and p[0] > 170 and p[0] - p[2] > 90
for r, a in enumerate(sheets):
    d = np.zeros((48, 64, 4), np.int32)
    closed, opened, locked = tile(a, 112), tile(a, 113), tile(a, 114)
    for i, k in enumerate([1.0, 0.62, 0.3]): d[0:16, i * 16:i * 16 + 16] = narrow(closed, opened, k)
    d[0:16, 48:64] = opened
    lit = locked.copy(); grey = (np.abs(locked[..., :3] - locked[..., :3].mean(axis=2, keepdims=True)).sum(axis=2) < 24) & (locked[..., :3].mean(axis=2) > 110)
    lit[grey, :3] = np.minimum(255, lit[grey, :3] + 60)
    d[16:32, 0:16] = locked; d[16:32, 16:32] = lit; d[16:32, 32:48] = opened
    old = arr(rgba(O + f'world/doors{r}.png'))
    bar = tile(a, 121); embers = tile(a, 3)
    for i in range(4):
        if i == 3: d[32:48, 48:64] = embers; continue
        base = bar.copy() if i < 2 else (bar * [0.45, 0.42, 0.40, 1]).astype(np.int32)
        if i == 2: base[..., 3] = 255
        f = old[32:48, i * 16:i * 16 + 16]
        for y in range(16):
            for x in range(16):
                if i > 0 and FIRE(f[y, x]): base[y, x] = f[y, x]
        d[32:48, i * 16:i * 16 + 16] = base
    save(img(d), f'world/doors{r}.png')

# 5. fog (world/fog0-4.png): checked against the region palettes and kept: the sewers' green, the prison's warm dust,
# the caves' brown, the city's cold blue and the halls' ember haze are the hues of those regions' own floors, water and light.
print('tiles done')
