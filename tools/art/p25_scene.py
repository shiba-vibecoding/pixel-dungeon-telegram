# v25: the GitHub art's scene, cut from the live camp's own art (camp-outdoor-<season>.png, torch, fire, camp-heroes):
# the stone hill and its arch widened to the banner, six Shattered heroes (first armour, as the camp shows them) at the fire.
import math, random, numpy as np
from PIL import Image, ImageOps
A = 'packages/client/public/assets/camp/'
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
SKY = {(0x07, 0x08, 0x1a), (0x14, 0x14, 0x33), (0x2b, 0x27, 0x52)}
GROUND_Y = 99

def load(season):
    return np.array(Image.open(A + f'camp-outdoor-{season}.png').convert('RGBA')).astype(np.int32)

def srctop(src):
    """Per column, the first row of the hill (below the sky and the ridges)."""
    top = []
    for x in range(src.shape[1]):
        y = 30
        while y < GROUND_Y and (tuple(src[y, x, :3]) in SKY or tuple(src[y, x, :3]) in {(0x19, 0x17, 0x30), (0x14, 0x13, 0x2a)} or src[y, x, :3].sum() > 300): y += 1
        top.append(y)
    return top

def mapcol(s, lo=(2, 27), hi=(67, 92)):
    if 0 <= s <= 93: return s
    if s < 0:
        a, b = lo; n = b - a; k = (-s) % (2 * n); return a + (k if k < n else 2 * n - 1 - k)
    a, b = hi; n = b - a; k = (s - 94) % (2 * n); return b - (k if k < n else 2 * n - 1 - k)

def light(a, cx, cy, r, col, k=1.0):
    c = np.array(col)
    for y in range(max(0, cy - r), min(a.shape[0], cy + r + 1)):
        for x in range(max(0, cx - r), min(a.shape[1], cx + r + 1)):
            d = math.sqrt((x - cx) ** 2 + ((y - cy) ** 2) * 1.25) / r; th = (BAYER[y % 4][x % 4] + .5) / 16
            v = .26 if d < .34 else (.26 if th < .5 else .15) if d < .40 else .15 if d < .62 else (.15 if th < .5 else .07) if d < .70 else .07 if d < .94 else (.07 if th < .4 else 0) if d < 1 else 0
            if v: a[y, x, :3] = np.minimum(255, a[y, x, :3] + c * v * k)

def scene(W, H, cx, gh=16, season='autumn', seed=5, heroes=(0, 1, 2, 3, 4, 5), fire_frame=2, torch_frames=(1, 3), hero_frames=None, moon=None, embers=True, stones=None, drop=18, spread=1.0):
    rnd = random.Random(seed)
    src = load(season); top = srctop(src)
    y0 = GROUND_Y + gh - H                      # the source row at the banner's top
    out = np.zeros((H, W, 4), np.int32); out[..., 3] = 255
    # The ground: the source's dirt below the hill, its props and stones taken out (each such pixel from the dirt a row lower down).
    dirt = src[GROUND_Y:GROUND_Y + 60].copy()
    STONE = {(0x38, 0x3e, 0x57), (0x4b, 0x53, 0x74), (0x06, 0x07, 0x07), (0x41, 0x38, 0x31), (0x55, 0x5e, 0x81), (0x2a, 0x2f, 0x45)}
    bad = np.zeros(dirt.shape[:2], bool)
    for yy in range(2, dirt.shape[0]):
        for xx in range(dirt.shape[1]):
            if tuple(dirt[yy, xx, :3]) in STONE or dirt[yy, xx, :3].max() > 120 and yy > 2: bad[yy, xx] = True
    # props: the ring, the bench, the stump (rows 13-23 of the dirt)
    bad[12:24, 14:34] = True; bad[8:24, 60:92] = True
    from scipy import ndimage
    bad = ndimage.binary_dilation(bad, iterations=1); bad[:2] = False
    for yy in range(dirt.shape[0]):
        for xx in range(dirt.shape[1]):
            if bad[yy, xx]:
                for k in range(1, 40):
                    for cand in ((yy + 10 + k) % 58 + 2, (yy + k) % 58 + 2):
                        if not bad[cand, xx]: dirt[yy, xx] = dirt[cand, xx]; break
                    else: continue
                    break
    # The sky: the source's own dithered rows, star-free columns, then stars of its colours.
    band = src[:48, 0:16].copy()
    for yy in range(48):
        for xx in range(16):
            if tuple(band[yy, xx, :3]) not in SKY:
                for k in (2, 4, -2, -4, 6, 8):
                    q = src[yy, (xx + k) % 16] if 0 <= yy else None
                    if tuple(q[:3]) in SKY: band[yy, xx] = q; break
                else: band[yy, xx] = band[yy - 1, xx] if yy else band[yy, xx]
    def skypx(x, y):
        return band[y if y < 46 else 46 + (y - 46) % 2, (x - cx + 47) % 16]
    ext_top = []
    for x in range(W):
        s = x - cx + 47
        if 0 <= s <= 93: ext_top.append(top[s]); continue
        d = (-s if s < 0 else s - 93)
        edge = top[0] if s < 0 else top[93]
        ext_top.append(min(GROUND_Y - 22, int(round(edge + drop * (1 - math.exp(-d / 30))))))
    for y in range(H):
        sy = y0 + y
        for x in range(W):
            s = x - cx + 47
            if sy >= GROUND_Y:
                out[y, x] = dirt[min(dirt.shape[0] - 1, sy - GROUND_Y), mapcol(s)]
            elif 0 <= s <= 93:
                out[y, x] = src[sy, s] if sy >= 0 else skypx(x, 0)
            elif sy >= ext_top[x]:
                if sy == ext_top[x]: out[y, x, :3] = (0x0b, 0x0b, 0x09)
                else:
                    sc = mapcol(s); ty = max(sy, top[sc] + 2); out[y, x] = src[min(GROUND_Y - 1, ty), sc]
            else:
                out[y, x] = skypx(x, max(0, sy))
    # Ridges far behind, in the source's ridge colours, at the sides.
    for x in range(W):
        s = x - cx + 47
        if 0 <= s <= 93: continue
        for col, base, amp, per in (((0x19, 0x17, 0x30), 6, 2, 13.0),):
            ry = ext_top[x] - base - int(round(amp * (math.sin(x / per) + 0.5 * math.sin(x / (per / 2.3) + 1))))
            for yy in range(max(0, ry - y0), max(0, ext_top[x] - y0)):
                if yy < H and tuple(out[yy, x, :3]) in SKY: out[yy, x, :3] = col
    # Stars on the new sky.
    for _ in range(W * H // 55):
        x, y = rnd.randrange(W), rnd.randrange(H)
        s = x - cx + 47
        if (0 <= s <= 93) and y0 + y >= 0: continue
        if tuple(out[y, x, :3]) in SKY:
            out[y, x, :3] = rnd.choice([(0x9a, 0xa4, 0xd8), (0x5c, 0x62, 0x8f), (0x5c, 0x62, 0x8f), (0xe8, 0xe2, 0xc8)])
    # The moon (cut from the source), where the banner wants it.
    if moon:
        m = src[24:39, 59:74].copy(); mx, my = moon
        for yy in range(15):
            for xx in range(15):
                p = m[yy, xx]
                if p[:3].sum() > 330 and 0 <= my + yy < H and 0 <= mx + xx < W: out[my + yy, mx + xx] = p
    stone = src[110:116, 4:11].copy()
    for (sxf, syf) in stones or []:
        gx, gy2 = int(W * sxf), H - gh + int(gh * syf)
        for yy in range(stone.shape[0]):
            for xx in range(stone.shape[1]):
                p = stone[yy, xx]
                if tuple(p[:3]) in {(0x38, 0x3e, 0x57), (0x4b, 0x53, 0x74), (0x06, 0x07, 0x07)} and 0 <= gy2 + yy < H and 0 <= gx + xx < W: out[gy2 + yy, gx + xx] = p
    img = Image.fromarray(out.astype(np.uint8), 'RGBA')
    # Torches on the arch's sconces.
    torch = Image.open(A + 'torch.png').convert('RGBA')
    for i, (tx, ty) in enumerate([(33, 75), (61, 75)]):
        f = torch_frames[i % len(torch_frames)]
        img.alpha_composite(torch.crop((f * 5, 0, f * 5 + 5, 7)), (cx - 47 + tx - 2, ty - 7 - y0))
    # The fire before the door, in the camp's stone ring.
    fx, fy = cx, H - gh + int(gh * 0.62)
    pit = Image.fromarray(src[113:122, 16:33].astype(np.uint8), 'RGBA')
    pm = np.array(pit); ground = src[113:122, 16:33]
    ring = Image.fromarray(np.where((np.abs(pm[..., :3].astype(int) - src[150:159, 40:57, :3]).sum(axis=2, keepdims=True) > 40), pm, 0).astype(np.uint8), 'RGBA')
    img.alpha_composite(ring, (fx - 8, fy - 5))
    fire = Image.open(A + 'fire.png').convert('RGBA')
    img.alpha_composite(fire.crop((fire_frame * 13, 0, fire_frame * 13 + 13, 17)), (fx - 6, fy - 17))
    # Six heroes, facing the fire.
    sheet = Image.open(A + 'camp-heroes.png').convert('RGBA')
    pos = [(int(round(x * spread)), y) for x, y in [(-13, -2), (-25, 1), (-37, -3), (13, -2), (25, 1), (37, -3)]]
    a = np.array(img).astype(np.int32)
    for i, hc in enumerate(heroes):
        dx, dy = pos[i]; x = fx + dx - 6; y = fy + dy - 14
        for k in range(2, 10):
            if 0 <= x + k < W and 0 <= y + 14 < H: a[y + 14, x + k, :3] //= 2
    img = Image.fromarray(a.astype(np.uint8), 'RGBA')
    for i, hc in enumerate(heroes):
        dx, dy = pos[i]; x = fx + dx - 6; y = fy + dy - 14
        f = hero_frames[i] if hero_frames else 0
        fr = sheet.crop((f * 12, hc * 15, f * 12 + 12, hc * 15 + 15))
        if dx > 0: fr = ImageOps.mirror(fr)
        img.alpha_composite(fr, (x, y))
    a = np.array(img).astype(np.int32)
    light(a, fx, fy - 6, 36, (0xff, 0x9a, 0x3a))
    for tx in (33, 61): light(a, cx - 47 + tx, 75 - 10 - y0, 9, (0xff, 0xb0, 0x50))
    if embers:
        for _ in range(4):
            ex, ey = fx + rnd.randint(-4, 4), fy - 19 - rnd.randint(0, 9)
            if 0 <= ey < H: a[ey, ex, :3] = rnd.choice([(0xff, 0xcc, 0x66), (0xff, 0x9a, 0x3a), (0xdb, 0x4f, 0x35)])
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA'), (fx, fy)

if __name__ == '__main__':
    im, _ = scene(160, 80, cx=112, gh=18, moon=(140, 4), stones=[(.06, .3), (.33, .7), (.58, .85), (.96, .5)])
    im.resize((1280, 640), Image.NEAREST).save('scene-social.png')
    im, _ = scene(200, 67, cx=146, gh=15, moon=(182, 3), stones=[(.05, .4), (.4, .75), (.97, .55)])
    im.resize((1200, 402), Image.NEAREST).save('scene-header.png')
