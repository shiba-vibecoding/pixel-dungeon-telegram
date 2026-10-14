# v24: the chest / tomb / mimic / bones animation (world/chests.png) starts from the very picture the heap shows
# (Shattered's items.png: CHEST 36, LOCKED_CHEST 37, CRYSTAL_CHEST 38, TOMB 34, BONES 32). Frame 0 is that cell; the
# chests then show a slit of light at the lid's seam, the lid up over a glowing hoard, the lid up over an empty box.
import os, numpy as np
from PIL import Image
O = '/home/claude/v24/orig/'
OUT = '/home/claude/v24/out9/packages/client/public/assets/'
def rgba(p): return np.array(Image.open(p).convert('RGBA')).astype(int)
ch = rgba(O + 'world/chests.png'); it = rgba(O + 'items.png')
def cell(a, i, cols=16): return a[(i // cols) * 16:(i // cols) * 16 + 16, (i % cols) * 16:(i % cols) * 16 + 16].copy()
lum = lambda c: 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]
GLOW = [(255, 250, 210), (255, 232, 140), (255, 204, 90), (214, 150, 50)]

def seam(base):
    """The lid's lower edge: the darkest full row between y 4 and 10 (the line where lid meets box)."""
    best, row = 1e9, 7
    for y in range(4, 11):
        m = base[y, :, 3] > 0
        if m.sum() < 8: continue
        v = lum(base[y][m]).mean()
        if v < best: best, row = v, y
    return row

def chest_frames(base):
    s = seam(base)
    xs = np.where(base[s, :, 3] > 0)[0]; x0, x1 = xs.min() + 1, xs.max() - 1
    f1 = base.copy()
    for x in range(x0, x1 + 1): f1[s, x] = (*GLOW[1], 255)
    def lifted(glow):
        f = np.zeros_like(base)
        lid = base[:s + 1].copy(); lift = 3
        body = base[s + 1:].copy()
        f[s + 1:] = body
        # the inside of the box between the raised lid and the body: dark, or the hoard's glow
        for y in range(s + 1 - lift, s + 2):
            for x in range(x0, x1 + 1):
                if 0 <= y < 16:
                    if glow:
                        k = min(3, abs(y - (s - 1)))
                        f[y, x] = (*GLOW[k], 255)
                    else:
                        f[y, x] = (*np.clip(base[s, x, :3] * 0.35, 0, 255).astype(int), 255)
        for y in range(lid.shape[0]):
            ty = y - lift
            if ty < 0: continue
            m = lid[y, :, 3] > 0
            f[ty][m] = lid[y][m]
        if glow:   # a few sparks over it
            for (x, y) in [(5, s - lift - 2), (9, s - lift - 3), (11, s - lift - 1)]:
                if 0 <= y < 16 and f[y, x, 3] == 0: f[y, x] = (*GLOW[0], 255)
        return f
    return [base, f1, lifted(True), lifted(False)]

def rank_map(src, dst):
    """Greys of our drawing onto the Shattered drawing's greys by brightness rank."""
    a = np.unique(src[src[..., 3] > 0][:, :3], axis=0); b = np.unique(dst[dst[..., 3] > 0][:, :3], axis=0)
    a = a[np.argsort(lum(a))]; b = b[np.argsort(lum(b))]
    return {tuple(c): tuple(b[min(len(b) - 1, int(i * len(b) / max(1, len(a))))]) for i, c in enumerate(a)}
def apply(fr, M, keep=lambda c: False):
    out = fr.copy()
    for y in range(16):
        for x in range(16):
            c = tuple(fr[y, x, :3])
            if fr[y, x, 3] and c in M and not keep(c): out[y, x, :3] = M[c]
    return out

out = ch.copy()
def put(row, f, fr): out[row * 16:row * 16 + 16, f * 16:f * 16 + 16] = fr
def old(row, f): return ch[row * 16:row * 16 + 16, f * 16:f * 16 + 16].copy()
for row, idx in [(0, 36), (1, 37), (2, 38)]:
    for f, fr in enumerate(chest_frames(cell(it, idx))): put(row, f, fr)
# tomb: Shattered's slab first, our light and open pit after it in its greys
tomb = cell(it, 34); M = rank_map(old(3, 0), tomb)
put(3, 0, tomb)
glow = lambda c: c[0] > 200 and c[1] > 150 and c[2] < 140
for f in (1, 2, 3): put(3, f, apply(old(3, f), M, glow))
# mimic: the chest it pretends to be, then its lid opening on teeth and tongue (ours)
mim = chest_frames(cell(it, 36)); put(4, 0, mim[0]); put(4, 1, mim[1])
for f in (2, 3):
    fr = mim[3].copy(); src = old(4, f)
    teeth = (src[..., 3] > 0) & ((lum(src) > 215) | ((src[..., 0] > 170) & (src[..., 1] < 90)))
    fr[teeth] = src[teeth]
    put(4, f, fr)
# bones: Shattered's bones, then ours settling in its greys
bones = cell(it, 32); M = rank_map(old(5, 0), bones)
put(5, 0, bones); put(5, 1, apply(old(5, 1), M))
Image.fromarray(out.astype('uint8'), 'RGBA').save(OUT + 'world/chests.png', optimize=True)
pad = np.zeros((96, 8, 4), int); pad[..., :3] = 60; pad[..., 3] = 255
bg = lambda a: np.where(a[..., 3:4] > 0, a, np.array([60, 60, 60, 255]))
big = Image.fromarray(np.concatenate([bg(ch), pad, bg(out)], axis=1).astype('uint8'), 'RGBA')
big.resize((big.width * 4, big.height * 4), Image.NEAREST).save('/tmp/claude-0/chests_ba.png')
print('fx done')
