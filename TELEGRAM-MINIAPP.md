# Pixel Dungeon → Telegram Mini App

Packages the original **Pixel Dungeon** (Watabou, v1.9.2a) — the libGDX/GWT web
build from [gnojus/pixel-dungeon-gdx](https://github.com/gnojus/pixel-dungeon-gdx)
(same one at <https://gnojus.github.io/pixel-dungeon-gdx>) — as a Telegram Mini App.

The public release is built from source and published automatically by
[`deploy-pages.yml`](.github/workflows/deploy-pages.yml). For a local build, the
deployable output is the generated, Git-ignored `dist-telegram/` folder.

---

## ⚠️ 0. The one gotcha that cost hours: git autocrlf

The prebuilt web files were taken from the project's `gh-pages` branch. On Windows
with `git config core.autocrlf=true` (the common default), git **rewrites LF→CRLF
inside the compiled `html/*.cache.js` game code**. GWT inlines binary resources
(textures/data) into that JS, so the injected `\r` bytes **corrupt the embedded
data** — the game boots and shows the loading bar, then renders a **black screen**
(broken textures). No console error; nothing wrong with the server, CSS, or overlay.

**Always extract the game files with line-ending conversion OFF:**

```bash
mkdir pd-gdx-web-clean
git -C pd-gdx -c core.autocrlf=false -c core.eol=lf archive --worktree-attributes \
    origin/gh-pages | tar -x -C pd-gdx-web-clean
# verify: every html/*.cache.js must have ZERO carriage returns
for f in pd-gdx-web-clean/html/*.cache.js; do printf '%s CR=%s\n' "$f" "$(tr -cd '\r' < "$f" | wc -c)"; done
```

`pd-gdx-web-clean/` is byte-for-byte identical to the live deployed site (verified
by md5). The corrupted `pd-gdx-web/` is kept only for reference — do not ship it.

---

## 1. What the Telegram layer adds

A small, self-contained overlay in [`telegram/`](telegram/) around the localized
game build.

| File | Purpose |
|------|---------|
| `telegram/telegram-init.js` | Boots the Telegram WebApp SDK: `ready()`+`expand()`, fullscreen + portrait lock, disable swipe-to-close, closing confirmation and dark theme; keeps libGDX below Telegram's floating mobile controls. |
| `telegram/telegram-storage.js` | Migrates legacy browser saves, namespaces local data by Telegram user ID, restores Telegram CloudStorage before game boot and keeps it synchronized. |
| `telegram/telegram-bootstrap.js` | Loads the Telegram SDK only for real Mini App launches, waits for cloud restore, then starts GWT; includes a timeout fallback so CDN/API failure cannot brick the game. |
| `telegram/telegram.css` | Dark background, touch hardening and Telegram/device safe-area bounds so the top HUD never sits under fullscreen controls or a phone cutout. |
| `telegram/privacy.html` | Public bilingual privacy page suitable for the Mini App's BotFather privacy URL. |
| `telegram/build-telegram.mjs` | Copies the clean web build into `dist-telegram/`, removes server-only GWT metadata and patches `index.html` (SDK + overlay). The SDK `<script>` goes at the end of `<body>`, never in `<head>` (a `<head>` script from telegram.org would block the game wherever telegram.org is slow/blocked). |
| `telegram/serve.mjs` | A tiny HTTP/1.1 static server for local testing (see §3). |

---

## 2. (Re)build the package

Requires Node.js.

```bash
node telegram/build-telegram.mjs
# or explicitly: node telegram/build-telegram.mjs <src-dir> <out-dir>
```

It auto-picks the source: an explicit arg, else `../pd-gdx-web-clean`, else
`../pd-gdx-web`, else a from-source `html/build/dist`. Output → `dist-telegram/`
(a static folder ready to upload). Re-running is safe.

---

## 3. Test locally — use serve.mjs, NOT `python -m http.server`

`python -m http.server` serves HTTP/1.0 without keep-alive; under this game's ~150
parallel asset requests it can misbehave. Use the bundled HTTP/1.1 server:

```bash
node telegram/serve.mjs dist-telegram 8080
# open http://127.0.0.1:8080/
```

Outside Telegram the overlay is inert, so it plays as a normal web page. Keep the
tab focused — this game renders via `requestAnimationFrame`, which browsers pause
in hidden/background tabs (you'd see a black canvas even though it loaded fine).

---

## 4. Saves and settings

The normal GWT preferences remain the immediate source of truth. Inside
Telegram, both `pd-prefs` and `pd-files` are namespaced as `tg-<user_id>`, so two
accounts using the same web origin never share a run or settings. Existing
unscoped saves are claimed and migrated once.

On clients supporting Bot API 6.9+, the wrapper mirrors those stores to the
current bot user's `Telegram.WebApp.CloudStorage`. Data is serialized into
3,600-character chunks, integrity-checked, restored before the game starts and
synced every two seconds. CloudStorage errors fall back to local data without
clearing it. The direct browser build remains local-only.

Telegram CloudStorage is last-write-wins. Avoid playing the same active run on
two devices at once.

---

## 5. Host it over HTTPS

A Mini App must load from an **HTTPS** URL. The game remains fully static and
saves go into the WebView's local storage and optional Telegram CloudStorage.
Two hosting routes:

### Recommended — free static hosting (no server, no domain to buy)

- **GitHub Pages** — use the included workflow; every push to `main` is checked,
  built and published automatically at a free HTTPS `*.github.io` URL.
- **Cloudflare Pages** or **Netlify** — drag-and-drop `dist-telegram/`, get an
  HTTPS `*.pages.dev` / `*.netlify.app` URL in a minute. Use that URL directly as the
  Mini App URL.

### VPS route (only if you want your own server)

For static files the **cheapest tier is plenty**: 1 core / 1 GB RAM / 10 GB / 1 TB,
Ubuntu LTS, automatic backup OFF. The current uncompressed release is about 26 MB;
normal HTTP compression reduces transferred JavaScript and text assets.
You additionally need a **domain** pointed at the VPS, then auto-HTTPS via **Caddy**:

```
# /etc/caddy/Caddyfile
game.example.com {
    root * /var/www/pixel-dungeon
    file_server
    encode gzip
}
```

`sudo caddy reload` — Caddy fetches a Let's Encrypt cert automatically. Upload the
contents of `dist-telegram/` into `/var/www/pixel-dungeon`.

---

## 6. Register the Mini App with BotFather

1. Open [@BotFather](https://t.me/BotFather) → `/newbot` (or reuse a bot).
2. Attach your HTTPS URL, either way:
   - **Menu button:** `/mybots` → bot → *Bot Settings* → *Menu Button* → send the URL.
   - **Named Mini App:** `/newapp` → pick the bot → title, short name, description,
     640×360 image → set the URL. Gives a shareable link `https://t.me/<bot>/<app>`.
3. Open the bot in Telegram (mobile is the best test surface) and launch it.

To launch from your own bot's inline/reply keyboard, use a `web_app` button with the
same URL.

---

## 7. Notes & limits

- **Saves** are local-first and isolated per Telegram user; supported clients
  additionally restore/sync them through the bot user's Telegram CloudStorage.
- **Audio** starts after the first tap (browser autoplay policy).
- **Best on mobile Telegram clients.**

## Credits & license

Pixel Dungeon — Watabou. libGDX/Web port — gnojus (fork of Arcnor's). Telegram
port — [@barboskich](https://t.me/barboskich). Distributed under
[GPL-3.0-only](LICENSE); keep attribution and source available when redistributing.
