<p align="center">
  <img src="html/webapp/telegram-pixel-dungeon-logo.png" width="520" alt="Telegram Pixel Dungeon">
</p>

<h1 align="center">Telegram Pixel Dungeon</h1>

<p align="center">
  A classic turn-based roguelike, carefully adapted for Telegram Mini Apps.
</p>

<p align="center">
  <a href="https://t.me/pixel_dungeon_gamebot/pixel_dungeon">
    <img alt="Play Telegram Pixel Dungeon" src="https://img.shields.io/badge/Play_in_Telegram-@pixel__dungeon__gamebot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white">
  </a>
</p>

<p align="center">
  <a href="https://github.com/shiba-vibecoding/pixel-dungeon-telegram/actions/workflows/deploy-pages.yml"><img alt="Build and deploy" src="https://github.com/shiba-vibecoding/pixel-dungeon-telegram/actions/workflows/deploy-pages.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg"></a>
  <img alt="15 languages" src="https://img.shields.io/badge/languages-15-8a9a5b.svg">
  <img alt="Pixel Dungeon 1.9.2a" src="https://img.shields.io/badge/Pixel_Dungeon-1.9.2a-8b0000.svg">
</p>

---

## About

**Telegram Pixel Dungeon** is an open-source Telegram Mini App and web port of
[Watabou's Pixel Dungeon 1.9.2a](https://github.com/watabou/pixel-dungeon),
built on the libGDX/GWT port by
[gnojus](https://github.com/gnojus/pixel-dungeon-gdx) and Arcnor.

It preserves the atmosphere and rules of the original: procedurally generated
dungeons, deliberate turn-based combat, four heroes, unpredictable items,
traps, bosses, challenges and permanent consequences.

[Launch Telegram Pixel Dungeon](https://t.me/pixel_dungeon_gamebot/pixel_dungeon)
directly in Telegram. No separate installation is required.

## Highlights

- **Mobile-first Telegram experience.** Fullscreen safe areas, resilient touch
  handling, pinch zoom and protection against accidentally closing an active run.
- **15 selectable languages.** Every locale is checked for missing runtime
  strings, broken placeholders and unsupported font glyphs before deployment.
- **Careful Vanilla+ improvements.** Contextual loading tips, exact enemy stats
  on inspection and immediate seed activation make the game easier to understand
  without changing item numbers, level generation or vanilla loot tables.
- **Personal progress.** Saves and settings are separated by Telegram user on
  the device and mirrored through Telegram CloudStorage when the client supports it.
- **Interruption-safe cloud saves.** A new cloud generation becomes active only
  after every chunk has uploaded, so a dropped connection cannot replace the
  previous working save with an incomplete snapshot.
- **Touch, mouse and keyboard controls.** The same build works in Telegram and
  in a regular desktop browser.
- **Free static hosting.** The client is deployed automatically through GitHub
  Pages and does not require a custom game backend.
- **No ads, analytics or payments.** The port does not add pay-to-win mechanics
  or collect its own gameplay analytics.

## Supported languages

| | | |
|---|---|---|
| English | Русский | Español |
| Français | Deutsch | Português (Brasil) |
| Polski | Italiano | Türkçe |
| Українська | Bahasa Indonesia | 日本語 |
| 한국어 | 简体中文 | 繁體中文 |

The language can be changed in the game settings. Localization uses UTF-8 TSV
catalogues and international pixel fonts. See [LOCALIZATION.md](LOCALIZATION.md)
for the catalogue format and validation workflow.

## Controls

On a phone:

- tap a tile or object to move and interact;
- drag the dungeon with one finger;
- pinch with two fingers to zoom;
- use the bottom toolbar for waiting, searching, examining, inventory and
  quick-slot actions.

Mouse and keyboard controls are available on desktop:

| Action | Default keys |
|---|---|
| Move | Arrow keys or numeric keypad |
| Wait | `Space` |
| Search | `S` |
| Inventory | `I` |
| Quick slot | `Q` |
| Examine tile | `V` |
| Hero / catalogue / journal | `H` / `C` / `J` |
| Zoom | `+` / `-` / `/` |

## Saves and privacy

The game writes a local save after gameplay changes. Inside Telegram, local data
is namespaced by the current Telegram user. On supported clients it is also
mirrored to Telegram CloudStorage and can be restored on another device.

Avoid continuing the same run on two devices at once. The synchronizer keeps a
last-common snapshot: a change from one device can advance it, while a
two-device divergence preserves both copies, keeps the local run playable and
pauses cloud writes instead of silently overwriting progress. A regular browser
opened outside a Telegram launch context has access only to its own local copy.

The project has no custom analytics, advertising, payments or server-side user
database. Read the complete policy in [PRIVACY.md](PRIVACY.md).

## Local development

JDK 8, Node.js and Python 3 are required. On Windows, use `gradlew.bat` in
place of `./gradlew`.

```bash
# Run the desktop version
./gradlew desktop:run

# Validate localization and Telegram persistence
python tools/validate_localization.py
node --test telegram/test-*.mjs

# Optional, dormant bot-worker reference tests (the worker is not deployed)
node --test telegram-worker/test/*.mjs

# Build and package the production Mini App
./gradlew --no-daemon html:dist
node telegram/build-telegram.mjs html/build/dist dist-telegram

# Serve the production package locally
node telegram/serve.mjs dist-telegram 8080
```

Open `http://127.0.0.1:8080/`. Telegram CloudStorage requires the published HTTPS
Mini App launched through the bot.

## Deployment

The [GitHub Pages workflow](.github/workflows/deploy-pages.yml) validates all
translations and Telegram integration tests, builds the GWT client, packages the
Mini App and deploys it after every push to `main`.

The repository must use **Settings → Pages → Source → GitHub Actions**.

Detailed guides:

- [GitHub Pages deployment](DEPLOY-GITHUB.md)
- [Telegram Mini App integration](TELEGRAM-MINIAPP.md)
- [Dormant bot-worker reference](telegram-worker/README.md) (not deployed)
- [Localization system](LOCALIZATION.md)

## Project layout

| Path | Purpose |
|---|---|
| `core/` | Pixel Dungeon gameplay and interface |
| `PD-classes/` | Noosa engine and shared classes |
| `android/assets/` | Art, audio, fonts and localization catalogues |
| `html/` | GWT/libGDX web backend |
| `telegram/` | Mini Apps integration, saves and production packaging |
| `telegram-worker/` | Dormant webhook reference implementation; not deployed |
| `tools/` | Localization and font generation/auditing |
| `.github/workflows/` | Automated validation, build and deployment |

## Credits and license

- **Original game, design and assets:** [Watabou](https://github.com/watabou/pixel-dungeon)
- **libGDX port:** Arcnor and [gnojus](https://github.com/gnojus/pixel-dungeon-gdx)
- **Community localization sources:** [Pixel Dungeon ML](https://github.com/rodriformiga/pixel-dungeon) and [Remixed Dungeon](https://github.com/NYRDS/remixed-dungeon)
- **Telegram port:** [@barboskich](https://t.me/barboskich)

The project is distributed under the
[GNU General Public License v3.0 or later](LICENSE). Please preserve the original
authors' attribution and keep the corresponding source code available when
redistributing modified builds.
