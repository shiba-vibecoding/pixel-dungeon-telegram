/*
 * Packages the Pixel Dungeon web build into a Telegram-Mini-App-ready folder.
 *
 *   1. copies the built webapp            ->  dist-telegram/
 *   2. drops in the Telegram UI and per-user persistence bridge
 *   3. patches index.html so cloud saves restore before the GWT game starts
 *
 * Source of the game files (first match wins, or pass a path as argv[2]):
 *   - <arg>                         explicit path
 *   - ../pd-gdx-web                 the gh-pages build checked out next to this repo
 *   - ../html/build/dist            output of `gradlew html:dist` (from source)
 *
 * Run:  node telegram/build-telegram.mjs
 * Re-running is safe (idempotent) and always starts from a clean dist-telegram.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const candidates = [
  process.argv[2] && path.resolve(process.argv[2]),
  path.resolve(repoRoot, '..', 'pd-gdx-web-clean'),  // pure-LF extract (see git-autocrlf note in TELEGRAM-MINIAPP.md)
  path.resolve(repoRoot, '..', 'pd-gdx-web'),
  path.join(repoRoot, 'html', 'build', 'dist'),
].filter(Boolean);

const SRC = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
const DEST = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoRoot, 'dist-telegram');
const MARKER = 'telegram-mini-app-overlay';

const HEAD_INJECT = `
    <!-- ${MARKER} -->
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="stylesheet" href="telegram.css">
`;

const BODY_INJECT = `
    <!-- ${MARKER} -->
    <script src="telegram-storage.js"></script>
    <script src="telegram-bootstrap.js"></script>
`;

if (!SRC) {
  console.error('ERROR: no web build found. Looked in:\n  ' + candidates.join('\n  '));
  console.error('Check out the gh-pages build to ../pd-gdx-web, or build from source with gradlew html:dist.');
  process.exit(1);
}

// 1. Clean copy of the game build.
fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

// Gradle's WAR output contains server-only classes and GWT compiler metadata.
// GitHub Pages is purely static, so publishing WEB-INF only bloats the artifact.
fs.rmSync(path.join(DEST, 'WEB-INF'), { recursive: true, force: true });

// 2. Telegram overlay assets.
for (const f of [
  'telegram.css',
  'telegram-storage.js',
  'telegram-init.js',
  'telegram-bootstrap.js',
  'privacy.html',
]) {
  fs.copyFileSync(path.join(here, f), path.join(DEST, f));
}

// 3. Patch index.html.
const indexPath = path.join(DEST, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

if (!html.includes(MARKER)) {
  // Bootstrap is reinserted after Telegram CloudStorage has restored the
  // current user's data. Relative paths keep GitHub project pages working.
  html = html.replace(
    /\s*<script[^>]+src=["']html\/html\.nocache\.js["'][^>]*><\/script>\s*/i,
    '\n');
  html = html.replace(/\s*<a\s+class=["']superdev["'][\s\S]*?<\/a>\s*/i, '\n');
  html = html.includes('</head>') ? html.replace('</head>', `${HEAD_INJECT}</head>`) : HEAD_INJECT + html;
  html = html.includes('</body>') ? html.replace('</body>', `${BODY_INJECT}</body>`) : html + BODY_INJECT;
  fs.writeFileSync(indexPath, html, 'utf8');
}

// GitHub Pages must serve GWT's generated files verbatim, without Jekyll.
fs.writeFileSync(path.join(DEST, '.nojekyll'), '', 'utf8');

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(p) : fs.statSync(p).size;
  }
  return total;
}

console.log('Source build : ' + SRC);
console.log('Telegram bundle ready:');
console.log('  ' + DEST + '  (' + (dirSizeBytes(DEST) / (1024 * 1024)).toFixed(1) + ' MB)');
console.log('Serve that folder over HTTPS and point your BotFather Mini App URL at it.');
