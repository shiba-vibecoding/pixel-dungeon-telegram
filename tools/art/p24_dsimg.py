# v24: before/after strips for the design-system cards (the zip has the full sheets).
import os, json
from PIL import Image
V = '/home/claude/v24/'; N = V + 'out9/packages/client/public/assets/'; O = V + 'orig/'; D = V + 'ds-img/'
os.makedirs(D, exist_ok=True)
def im(p): return Image.open(p).convert('RGBA')
def new(rel): return im(N + rel) if os.path.exists(N + rel) else im(O + rel)
def up(i, k): return i.resize((i.width * k, i.height * k), Image.NEAREST)
def row(parts, gap=4):
    w = sum(p.width for p in parts) + gap * (len(parts) - 1); h = max(p.height for p in parts)
    g = Image.new('RGBA', (w, h)); x = 0
    for p in parts: g.alpha_composite(p, (x, h - p.height)); x += p.width + gap
    return g
def col(parts, gap=8):
    w = max(p.width for p in parts); h = sum(p.height for p in parts) + gap * (len(parts) - 1)
    g = Image.new('RGBA', (w, h)); y = 0
    for p in parts: g.alpha_composite(p, (0, y)); y += p.height + gap
    return g
def pair(name, before, after, k):
    col([up(before, k), up(after, k)]).save(D + f'ba-{name}.png')
def frames(sheet, w, h, idx, row_=0):
    cols = sheet.width // w
    return row([sheet.crop(((i % cols) * w, (i // cols + row_) * h, (i % cols) * w + w, (i // cols + row_) * h + h)) for i in idx], 2)
# heroes: the first frame of each of the 7 armour tiers, the four classes that changed
def tiers(sheet): return row([sheet.crop((0, t * 15, 12, t * 15 + 15)) for t in range(7)], 2)
for c in ['warrior', 'mage', 'rogue', 'ranger']:
    pair('hero-' + c, tiers(im(O + c + '.png')), tiers(new(c + '.png')), 4)
    pair('skins-' + c, row([tiers(im(O + f'skins/{c}-{l}.png')) for l in ('ash', 'royal', 'shadow')], 10),
         row([tiers(new(f'skins/{c}-{l}.png')) for l in ('ash', 'royal', 'shadow')], 10), 3)
pair('avatars', im(O + 'avatars.png'), new('avatars.png'), 3)
pair('heroes6', im(O + 'heroes6.png'), new('heroes6.png'), 4)
NPC = [('shopkeeper.png', 14, 14, [1, 0]), ('imp.png', 12, 14, [0, 4]), ('ratKing.png', 16, 16, [0, 2]),
       ('sheep.png', 16, 15, [0, 2]), ('undead.png', 12, 16, [0, 14]), ('wraith.png', 14, 15, [0, 2]), ('ghost.png', 14, 15, [0, 1])]
pair('npcs', row([frames(im(O + f), w, h, ix) for f, w, h, ix in NPC], 12), row([frames(new(f), w, h, ix) for f, w, h, ix in NPC], 12), 3)
pair('buffs', im(O + 'buffs.png'), new('buffs.png'), 5)
pair('badges', im(O + 'badges.png'), new('badges.png'), 2)
pair('icons', im(O + 'icons.png').crop((0, 0, 64, 64)), new('icons.png').crop((0, 0, 64, 64)), 4)
pair('journal', row([im(O + 'meta/journal.png'), im(O + 'shattered/journal2.png').crop((0, 0, 48, 16))], 8),
     row([new('meta/journal.png'), new('shattered/journal2.png').crop((0, 0, 48, 16))], 8), 3)
pair('chests', im(O + 'world/chests.png'), new('world/chests.png'), 4)
it = new('items.png'); pair('mirror', it.crop((128 % 16 * 16, 128 // 16 * 16, 128 % 16 * 16 + 16, 128 // 16 * 16 + 16)), it.crop((7 * 16, 8 * 16, 8 * 16, 9 * 16)), 5)
# world: per region the PD-layout underlay cells the code reads, the grass and the doors
UNDER = [1, 2, 15, 5, 6, 10, 13, 9, 4, 12, 24]
def under(sheet): return row([sheet.crop(((i % 16) * 16, (i // 16) * 16, (i % 16) * 16 + 16, (i // 16) * 16 + 16)) for i in UNDER], 2)
for r in range(5):
    pair(f'under{r}', under(im(O + f'tiles{r}.png')), under(new(f'tiles{r}.png')), 3)
    pair(f'grass{r}', im(O + f'world/grass{r}.png').crop((0, 0, 80, 32)), new(f'world/grass{r}.png').crop((0, 0, 80, 32)), 3)
    pair(f'doors{r}', im(O + f'world/doors{r}.png'), new(f'world/doors{r}.png'), 3)
print('ds images', len(os.listdir(D)))
