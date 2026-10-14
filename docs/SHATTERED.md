# Shattered update

The game moves from Pixel Dungeon 1.9 to the content of **Shattered Pixel Dungeon v4.0.2**
(Evan Debenham, GPL-3.0; source for reference in `C:\pixel_dungeon\spd-src`, never built or run).
Everything lands on the branch `shattered` and ships as one update.

## Streams

| Stream | Scope | Branch |
| --- | --- | --- |
| 0 foundation | Shattered's item atlas for every item; sprite constants; credits | `shattered` |
| talents | talents tiers 1–3 for the four classes (tier 3 by subclass), talent points, the talents window | `shattered-talents` |
| artifacts | every artifact of the four classes' runs, the rogue's cloak, artifacts among finds | `shattered-artifacts` |
| alchemy | alchemical energy, the alchemy window, exotic potions and scrolls, runestones, spells, brews, elixirs, trinkets | `shattered-alchemy` |
| wands | Shattered's wands, the mage's staff | `shattered-wands` |
| gear | Shattered's weapons, armour, thrown weapons with durability, enchantments and glyphs (v4's new ones too) | `shattered-gear` |
| abilities | armour abilities and tier 4 talents | `shattered-abilities` |
| mobs | Shattered's monster roster, champions, rare variants | `shattered-mobs` |
| bosses | Goo, Tengu, DM-300, the Dwarf King, Yog-Dzewa as Shattered fights them | `shattered-bosses` |
| levels | Shattered's level builders and rooms, traps, quests (v4's new quest) | `shattered-levels` |
| classes | the Duelist and the Cleric | `shattered-classes` |

## Rules for every stream

- Work in your own git worktree (`git worktree add ../pd-ts-<stream> -b shattered-<stream> shattered`); commit there, never push.
- Port Shattered's rules faithfully into the deterministic core (`packages/core`): plain JSON state, no `Math.random`
  or clocks (use the `Rng` streams and `ctx.rng`), everything an action does comes back as effects.
- Names and descriptions come from Shattered's own texts: `core/src/main/assets/messages/**/<file>.properties`
  (English) and `<file>_ru.properties` (Russian), into the client's `i18n.ts`.
- Item sprites are Shattered's `items.png` (`packages/client/public/assets/items.png`, 16 per row); use the
  constants in `packages/core/src/spd-sprites.ts` (generated from `ItemSpriteSheet.java`).
- Tests with vitest next to the existing ones; `npm run typecheck` and `npx vitest run` pass before every commit.
  Update `RULES_HASH` in `core/src/version.ts` to keep the version test passing; leave `RULES_VERSION` alone.
- Client screens for new things work with the design system's existing markup; what a designer should draw
  goes into the stream's report.
- The browser pane is shared: if you check the client, run Vite on a port of your own and use your own tab.

## Release checklist (from the Tonmons community review)
- Announce the reset at least a week ahead, in RU and EN, in the channel and in the game. **Decision (owner): a full wipe, «весь мир с чистого листа».** Unfinished runs, every board, records, run history, streaks and freezes, badges and trophies all start fresh; the only carry-over is the commemorative «Первопроходец» cup, which every profile that played before the update gets. **Done (ship):** `RULES_VERSION` 18; `SAVE_VERSION`, `STATE_FORMAT` and `RUN_FORMAT` 32 (old saves, rooms and runs dropped cleanly); boards live in Durable Objects named `s2:<board>` (`SEASON`, `boards.ts`), so old boards are never read; a Player profile of an earlier season is reset on first contact (`server/src/season.ts`: identity, tutorial and news seen, honours kept; pioneer letter if anything had been played; tests in `server/test/season.test.ts`); the client clears saves, local badges, rankings, bones, arena best and the Telegram cloud's copies of the badges and rankings once (`client/src/season.ts`); «Что нового» says it in RU and EN (`notice` of release 2.4). Still to do by hand: the announcement itself (the week's notice in the channel and the game).
- A «Что нового» window on the first launch after the update: 5–8 lines in the micro-update template.
- A «Сообщить о проблеме» button in settings and on error screens, sending the version, run id and last actions to the admin chat through the bot. A «Охотник за багами» badge for confirmed reports.
- The board rules window must show what scores, what each place wins, when the board closes, and the tie-break (who finished first).
- Replace float math in core rules (`Math.hypot` ×4, `Math.cos` in fov.ts) with integer maths, so iOS and the server cannot round differently. **Done (polish):** `core/src/fmath.ts` (`ipow`, `dpow`, `dexp`, `dlog` from + − × ÷ only), `trueDistance`/`squaredDistance` in `level/geometry.ts`, the field-of-view table computed in integers (pinned by `test/fmath.test.ts`), the cone in `ray.ts` on `ballistica.ts`'s hand-made trigonometry; no `Math.hypot/pow/exp/log/sin/cos/atan2` or `**` with an inexact result is left in core.
- Measure the first-screen weight after the update (target ≤ 3 MB; audio stays lazy). **Done (ship), `vite build` + headless Chromium to the camp, no audio loaded:** 146 requests, JS 3.28 MB raw / 0.95 MB gzip, CSS 0.44 MB raw / 0.19 MB gzip, 139 PNG sheets 0.75 MB, fonts 14 KB; about 4.5 MB raw and about 1.9 MB on the wire (gzip of the text; Telegram's own script, ~120 KB, not counted). The target holds on the wire, not raw: the JS is the single big piece (both languages' texts and all the content tables), and splitting it is not an easy fix. **Performance pass (branch `polish-perf`):** each language's texts are a chunk of their own (`i18n-en.ts`, `i18n-ru.ts` and the `*.ru.ts` tables beside the English ones; `i18n.ts` loads the one shown, and `vite.config.ts` preloads it from the page), the settings/journal/challenges/guide windows (`meta.ts`), the arena and the co-op marks are lazy chunks, the old PD 1.9 tile sheets and the boss tiles' duplicates are no longer fetched at start. Camp reached, 129 requests (135 before): JS 2.28 MB raw / 0.71 MB gzip in English (2.67 MB / 0.77 MB in Russian) against 3.30 MB / 0.96 MB, PNG 0.52 MB against 0.72 MB; about 1.47 MB on the wire in English and 1.53 MB in Russian against 1.91 MB. What is left in the first screen is the rules (core, about 1 MB raw) and the client in one module graph (`main.ts`), the generated `ui.css` (0.22 MB gzip) and the sprite sheets all loaded before the title.
- Pause and restore rendering on `visibilitychange` (Telegram Desktop for Windows runs the app in Edge WebView). **Done (polish):** `client/src/lifecycle.ts`: the frame loop, the animated canvases and CSS animations stop out of sight (also on Telegram's `deactivated` and on `pagehide`), restart on return with the clocks and the canvas size reset, and a watchdog asks for frames again if they stop while the game is in view.
- Server outages must neither break a streak nor spend a freeze.
- Make a weekly backup of boards and profiles, and test a restore once.
