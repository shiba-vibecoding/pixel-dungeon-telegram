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
