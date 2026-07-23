/*
 * Packages the Telegram Pixel Dungeon web build into a Telegram-Mini-App-ready folder.
 *
 *   1. copies the built webapp            ->  dist-telegram/
 *   2. drops in the Telegram UI and per-user persistence bridge
 *   3. patches index.html so cloud saves restore before the GWT game starts
 *
 * Source of the game files (first match wins, or pass a path as argv[2]):
 *   - <arg>                         explicit path
 *   - ../html/build/dist            current output of `gradlew html:dist`
 *   - ../pd-gdx-web-clean           optional pure-LF compatibility build
 *   - ../pd-gdx-web                 optional checked-out web build
 *
 * Run:  node telegram/build-telegram.mjs
 * Re-running is safe (idempotent) and always starts from a clean dist-telegram.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const candidates = [
  process.argv[2] && path.resolve(process.argv[2]),
  path.join(repoRoot, 'html', 'build', 'dist'),       // current local source build
  path.resolve(repoRoot, '..', 'pd-gdx-web-clean'),  // pure-LF extract (see git-autocrlf note in TELEGRAM-MINIAPP.md)
  path.resolve(repoRoot, '..', 'pd-gdx-web'),
].filter(Boolean);

const SRC = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
const DEST = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoRoot, 'dist-telegram');
const MARKER = 'telegram-mini-app-overlay';
const BRAND_NAME = 'Telegram Pixel Dungeon';
const REQUIRED_BUILD_FILES = [
  'index.html',
  'html/html.nocache.js',
  'assets/assets.txt',
];

if (!SRC) {
  console.error('ERROR: no web build found. Looked in:\n  ' + candidates.join('\n  '));
  console.error('Check out the gh-pages build to ../pd-gdx-web, or build from source with gradlew html:dist.');
  process.exit(1);
}

for (const relativePath of REQUIRED_BUILD_FILES) {
  if (!fs.existsSync(path.join(SRC, relativePath))) {
    console.error(`ERROR: source web build is incomplete (missing ${relativePath}):\n  ${SRC}`);
    process.exit(1);
  }
}

function overlaps(left, right) {
  const relative = path.relative(left, right);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// The destination is recursively replaced below. Refuse every project/source
// tree (and their parents/children) that could turn a typo such as "." into a
// destructive source deletion.
const protectedTrees = [
  SRC,
  ...[
    '.git', '.github', 'PD-classes', 'android', 'core', 'desktop',
    'gradle', 'html', 'telegram', 'telegram-worker', 'tools',
  ].map((name) => path.join(repoRoot, name)),
];
if (DEST === path.parse(DEST).root ||
    overlaps(DEST, repoRoot) ||
    protectedTrees.some((protectedPath) =>
      overlaps(DEST, protectedPath) || overlaps(protectedPath, DEST))) {
  console.error('ERROR: refusing to replace an unsafe output directory:\n  ' + DEST);
  process.exit(1);
}

// Tie every wrapper resource to the exact generated game build. This prevents
// Telegram's WebView cache from combining a new glyph atlas with stale code.
const releaseHash = createHash('sha256');
for (const relativePath of REQUIRED_BUILD_FILES) {
  const sourcePath = path.join(SRC, relativePath);
  releaseHash.update(relativePath);
  releaseHash.update(fs.readFileSync(sourcePath));
}
for (const wrapperFile of ['telegram.css', 'telegram-storage.js', 'telegram-init.js', 'telegram-bootstrap.js']) {
  releaseHash.update(wrapperFile);
  releaseHash.update(fs.readFileSync(path.join(here, wrapperFile)));
}
const RELEASE_ID = releaseHash.digest('hex').slice(0, 12);

const HEAD_INJECT = `
    <!-- ${MARKER} -->
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="stylesheet" href="telegram.css?v=${RELEASE_ID}">
`;

const BODY_INJECT = `
    <!-- ${MARKER} -->
    <script src="telegram-storage.js?v=${RELEASE_ID}"></script>
    <script src="telegram-bootstrap.js?v=${RELEASE_ID}"></script>
`;

// 1. Clean copy of the game build.
fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

// Gradle's WAR output contains server-only classes and GWT compiler metadata.
// GitHub Pages is purely static, so publishing WEB-INF only bloats the artifact.
fs.rmSync(path.join(DEST, 'WEB-INF'), { recursive: true, force: true });
// Super Dev Mode support is not used by the production bootstrap.
fs.rmSync(path.join(DEST, 'html', 'gwt'), { recursive: true, force: true });
fs.rmSync(path.join(DEST, 'html', 'html.devmode.js'), { force: true });
fs.rmSync(path.join(DEST, 'html', 'compilation-mappings.txt'), { force: true });

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

// Keep the public browser/PWA identity canonical even when an older compatible
// web build is supplied explicitly to the packager.
html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${BRAND_NAME}</title>`);
html = html.replace(
  /<meta\s+name=["']application-name["'][^>]*>/gi,
  `<meta name="application-name" content="${BRAND_NAME}">`);
html = html.replace(
  /<meta\s+name=["']apple-mobile-web-app-title["'][^>]*>/gi,
  `<meta name="apple-mobile-web-app-title" content="${BRAND_NAME}">`);
if (!/<meta\s+name=["']application-name["']/i.test(html)) {
  html = html.replace('</head>', `    <meta name="application-name" content="${BRAND_NAME}">\n</head>`);
}
if (!/<meta\s+name=["']apple-mobile-web-app-title["']/i.test(html)) {
  html = html.replace('</head>', `    <meta name="apple-mobile-web-app-title" content="${BRAND_NAME}">\n</head>`);
}

// Strip both an original GWT boot and any previous overlay. The freshly
// generated release id must win even when an already packaged build is used as
// an explicit source.
html = html.replace(new RegExp(`\\s*<!--\\s*${MARKER}\\s*-->\\s*`, 'gi'), '\n');
html = html.replace(
  /\s*<script[^>]+src=["'](?:\.\/)?html\/html\.nocache\.js(?:\?[^"']*)?["'][^>]*><\/script>\s*/gi,
  '\n');
html = html.replace(
  /\s*<script[^>]+src=["']telegram-(?:storage|bootstrap)\.js(?:\?[^"']*)?["'][^>]*><\/script>\s*/gi,
  '\n');
html = html.replace(
  /\s*<link[^>]+href=["']telegram\.css(?:\?[^"']*)?["'][^>]*>\s*/gi,
  '\n');
html = html.replace(/\s*<a\s+class=["']superdev["'][\s\S]*?<\/a>\s*/gi, '\n');
html = html.replace(
  /\s*<meta\s+(?:http-equiv=["'](?:Cache-Control|Pragma|Expires)["']|name=["'](?:viewport|mobile-web-app-capable|apple-mobile-web-app-capable|apple-mobile-web-app-status-bar-style)["'])[^>]*>\s*/gi,
  '\n');

html = html.includes('</head>') ? html.replace('</head>', `${HEAD_INJECT}</head>`) : HEAD_INJECT + html;
html = html.includes('</body>') ? html.replace('</body>', `${BODY_INJECT}</body>`) : html + BODY_INJECT;

if ((html.match(/telegram-bootstrap\.js/g) || []).length !== 1 ||
    /src=["'](?:\.\/)?html\/html\.nocache\.js/i.test(html)) {
  console.error('ERROR: generated index.html contains an unsafe or duplicate game bootstrap');
  process.exit(1);
}
fs.writeFileSync(indexPath, html, 'utf8');

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
