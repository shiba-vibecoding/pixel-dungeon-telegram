#!/bin/sh
# v25 GitHub page shots, from current main at 375x812 (RU and EN).
#   offline client:  VITE_SERVER_URL= npx vite --port 5176 packages/client
#   server client:   (cd packages/server && npx wrangler dev --port 8787) and npx vite --port 5175 packages/client
# 1. The day's dungeon, played for real by a bot against the local server; the end window («counts» chip, checked)
#    and the camp after it (streak, today's place). The run is deterministic: RU and EN fall the same way.
for L in ru en; do
  node tools/art/v25-daily.js http://127.0.0.1:5175 shots/v25/daily/$L-w $L warrior
  node tools/art/v25-daily.js http://127.0.0.1:5175 shots/v25/daily/$L-h $L huntress
done
# 2. The Dwarven City with champions, and the talents window (offline: a level-13 berserker).
for L in ru en; do
  DEPTH=17 MOBS=ghoul,elemental,warlock,monk CHAMP_KIND=monk node tools/art/v25-shots.js http://127.0.0.1:5176 shots/v25/$L $L 375 812 depth,talents
done
# 3. The camp GIF (virtual clock, 80 frames of 100 ms).
Y0=0 CH=384 FRAMES=80 node tools/art/v25-campgif.js http://127.0.0.1:5176 shots/v25/gif warrior
