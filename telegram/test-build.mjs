import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packager = path.join(here, 'build-telegram.mjs');

function fakeBuild(root) {
  fs.mkdirSync(path.join(root, 'html'), { recursive: true });
  fs.mkdirSync(path.join(root, 'html', 'gwt', 'chrome'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'WEB-INF'), { recursive: true });
  fs.writeFileSync(path.join(root, 'html', 'html.nocache.js'), '/* fake GWT */');
  fs.writeFileSync(path.join(root, 'html', 'html.devmode.js'), '/* dev mode */');
  fs.writeFileSync(path.join(root, 'html', 'compilation-mappings.txt'), 'dev mappings');
  fs.writeFileSync(path.join(root, 'html', 'gwt', 'chrome', 'chrome.css'), 'dev chrome');
  fs.writeFileSync(path.join(root, 'assets', 'assets.txt'), 'fake assets');
  fs.writeFileSync(path.join(root, 'WEB-INF', 'server-only.txt'), 'remove me');
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html>
<html lang="en"><head><title>Old name</title></head><body>
<a class="superdev">SuperDev Refresh</a>
<div id="embed-html"></div>
<script src="./html/html.nocache.js?old=1"></script>
</body></html>`);
}

test('packager validates, safely replaces and idempotently repacks a build', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-packager-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const first = path.join(temp, 'first');
  const second = path.join(temp, 'second');
  fakeBuild(source);

  execFileSync(process.execPath, [packager, source, first], { stdio: 'pipe' });
  assert(fs.existsSync(path.join(first, '.nojekyll')));
  assert(!fs.existsSync(path.join(first, 'WEB-INF')));
  assert(!fs.existsSync(path.join(first, 'html', 'gwt')));
  assert(!fs.existsSync(path.join(first, 'html', 'html.devmode.js')));
  assert(!fs.existsSync(path.join(first, 'html', 'compilation-mappings.txt')));

  let html = fs.readFileSync(path.join(first, 'index.html'), 'utf8');
  assert.match(html, /<title>Telegram Pixel Dungeon<\/title>/);
  assert.equal((html.match(/telegram-bootstrap\.js/g) || []).length, 1);
  assert.doesNotMatch(html, /src=["'](?:\.\/)?html\/html\.nocache\.js/i);

  execFileSync(process.execPath, [packager, first, second], { stdio: 'pipe' });
  html = fs.readFileSync(path.join(second, 'index.html'), 'utf8');
  assert.equal((html.match(/telegram-bootstrap\.js/g) || []).length, 1);
  assert.doesNotMatch(html, /src=["'](?:\.\/)?html\/html\.nocache\.js/i);

  const unsafe = spawnSync(process.execPath, [packager, source, source], {
    encoding: 'utf8',
  });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /unsafe output directory/);
  assert(fs.existsSync(path.join(source, 'index.html')),
    'unsafe output validation ran after deleting the source');
});

test('packager rejects a source that only contains index.html', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-incomplete-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const output = path.join(temp, 'output');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html>');

  const result = spawnSync(process.execPath, [packager, source, output], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source web build is incomplete/);
  assert(!fs.existsSync(output));
});
