#!/bin/bash
# Before/after shots of the game for docs/design/previews/v24 (design v24).
# usage: PORT=5173 OUTROOT=docs/design/previews/v24/after tools/art/v24-shots.sh
# Needs a dev server without the room server (VITE_SERVER_URL= npm run dev) and playwright (npm i -D playwright).
S=camp,camp-huntress,mart,region01,region06,region11,region16,region21,folk,king,buffs,inventory,hero,badges
for lang in en ru; do for size in "375 812" "1280 800"; do
  set -- $size
  node "$(dirname "$0")/v24-shots.js" "http://127.0.0.1:${PORT:-5173}" "$OUTROOT/$lang-${1}x${2}" $lang $1 $2 $S
done; done
