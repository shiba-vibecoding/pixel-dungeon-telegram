pixel-dungeon-gdx
=================

GDX port of the awesome [Pixel Dungeon](https://github.com/watabou/pixel-dungeon)

This is a fork of Arcnor's GDX port pushed to *Pixel Dungeon* 1.9.2a. In addition, it has a working html backend. You can play it on https://gnojus.github.io/pixel-dungeon-gdx.

This fork is focused on the desktop/html versions, therefore I don't intend to maintain the mobile versions and those are likely to be removed in future.

Telegram / GitHub Pages
-----------------------

This fork includes a production Telegram Mini App wrapper, 15 languages,
per-Telegram-user local saves, optional Telegram CloudStorage synchronization,
mobile-safe Telegram fullscreen layout and an automatic GitHub Pages deployment workflow.

See [DEPLOY-GITHUB.md](DEPLOY-GITHUB.md) for the complete publishing guide and
[TELEGRAM-MINIAPP.md](TELEGRAM-MINIAPP.md) for implementation details.
Privacy details are in [PRIVACY.md](PRIVACY.md) and are also published as
`privacy.html` with the game. The project is distributed under
[GPL-3.0-only](LICENSE).

Quickstart
----------
Download the [latest jar](https://github.com/gnojus/pixel-dungeon-gdx/releases) or build it yourself. 

**Building**
 - `./gradlew desktop:run` to run.
 - `./gradlew desktop:dist` to compile a jar file (located in `desktop/build/libs/` folder).
 - `./gradlew html:dist` to compile a webapp (located in `html/build/dist/`). You may want to remove the super-dev button directly from html.

For more info about gradle tasks: https://github.com/libgdx/libgdx/wiki/Gradle-on-the-Commandline
