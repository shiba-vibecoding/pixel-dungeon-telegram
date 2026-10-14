// usage: node v25-campgif.js <baseUrl> <outDir> [class]
// The live camp on a virtual clock: requestAnimationFrame and performance.now are driven by the script, so each frame is
// exactly 100 ms of the game's own animation (fire 6x100 ms, the hero's 8 s idle); the HUD hidden, the canvas shot.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, base, outDir, cls = 'warrior'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((cls) => {
    for (const [k, v] of Object.entries({ 'pd-season': '2', 'pd-hints': 'off', 'pd-coach-done': '1', 'pd-moved': '1', 'pd-seen-help': '1', 'pd-seen-version': '99.0', 'pd-launches': '5', 'pd-home-asked': '1', 'pd-notify-asked': '1', 'pd-class': cls, 'pd-sound': 'off', 'pd-fx': 'full' })) localStorage.setItem(k, v);
    let vt = 0; const q = [];
    window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
    window.cancelAnimationFrame = () => {};
    performance.now = () => vt;
    window.__step = (ms) => { vt += ms; const cbs = q.splice(0); for (const cb of cbs) { try { cb(vt); } catch (e) { console.log('raf', e.message); } } };
  }, cls);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('err', e.message));
  await p.goto(`${base}/?lang=en`);
  for (let i = 0; i < 150; i++) { await p.evaluate(() => window.__step(16)); await p.waitForTimeout(10); }
  await p.waitForTimeout(1500);
  for (let i = 0; i < 30; i++) await p.evaluate(() => window.__step(16));
  await p.evaluate(() => {
    for (const e of document.querySelectorAll('body *')) if (e.tagName !== 'CANVAS' && !e.querySelector('canvas')) e.style.visibility = 'hidden';
  });
  // to a whole 8 s from the camp's start, so frame 0 is the idle cycle's first
  const n = Number(process.env.FRAMES || 80);
  for (let i = 0; i < n; i++) {
    await p.evaluate(() => window.__step(100));
    await p.screenshot({ path: `${outDir}/f${String(i).padStart(3, '0')}.png`, clip: { x: 0, y: Number(process.env.Y0 || 96), width: 375, height: Number(process.env.CH || 320) } });
  }
  await p.screenshot({ path: `${outDir}/full.png` });
  await b.close();
})();
