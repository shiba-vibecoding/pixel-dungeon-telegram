#!/bin/bash
# v24: every sheet, in order (characters first: the UI and the camp read the new hero sheets; tiles before the journal marks).
set -e
cd /home/claude/world
python3 p24_chars.py
python3 p24_tiles.py
python3 p24_ui.py
python3 p24_fx.py
python3 - <<'PY'
import sys; sys.path.insert(0, '/home/claude/world')
import banner
im = banner.scene(104, 56)
im.save('/home/claude/v24/out9/packages/client/public/assets/meta/banner-whatsnew.png'); im.save('/home/claude/v24/spr/banner-whatsnew.png')
PY
python3 p24_dsimg.py
cp /home/claude/v24/spr/* /home/claude/ds/work/spr/
cp /home/claude/v24/out9/packages/client/public/assets/camp/camp-heroes.png /home/claude/ds/work/spr/camp-heroes.png
echo all done
python3 - <<'PY'
import os, numpy as np
from PIL import Image
N = '/home/claude/v24/out9/packages/client/public/assets/'; O = '/home/claude/v24/orig/'
for root, _, fs in os.walk(N):
    for f in fs:
        p = os.path.join(root, f); rel = p[len(N):]
        if (np.array(Image.open(p).convert('RGBA')) == np.array(Image.open(O + rel).convert('RGBA'))).all(): os.remove(p); print('unchanged, dropped:', rel)
PY
