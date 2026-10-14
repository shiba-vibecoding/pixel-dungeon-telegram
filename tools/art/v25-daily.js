// usage: node v25-daily.js <baseUrl> <outDir> <lang> [class]
// The day's dungeon played for real against the (local) server: a simple bot descends, fighting what stands next to it,
// until the hero falls; the end window (with its «counted» chip and the server's check) is shot as it comes.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, base, outDir, lang = 'ru', cls = 'warrior', W = '375', H = '812'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const PRESET = { 'pd-season': '2', 'pd-hints': 'off', 'pd-coach-done': '1', 'pd-moved': '1', 'pd-seen-help': '1', 'pd-intro-seen': '0,1,2,3,4',
  'pd-seen-version': '99.0', 'pd-launches': '6', 'pd-home-asked': '1', 'pd-notify-asked': '1', 'pd-name': 'Hero', 'pd-class': cls, 'pd-sound': 'off',
  'pd-zoom-screen': '1', 'pd-fx': 'full' };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.addInitScript((preset) => { if (!sessionStorage.getItem('preset')) { for (const [k, v] of Object.entries(preset)) localStorage.setItem(k, v); sessionStorage.setItem('preset', '1'); } }, PRESET);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('err', e.message));
  await page.goto(`${base}/?lang=${lang}`);
  await page.waitForFunction(() => window.__pd, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/camp-before.png` });
  await page.evaluate(() => window.__pd.startSolo('daily'));
  await page.waitForFunction(() => window.__pd?.session?.world, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  console.log('checked', await page.evaluate(() => !!window.__pd.session.checked));
  let steps = 0, lastDepth = 0;
  for (; steps < Number(process.env.STEPS || 20000); steps++) {
    const r = await page.evaluate(() => {
      const { session, core } = window.__pd; const w = session.world; const h = w.heroes[0];
      if (w.over || h.hp <= 0) return { over: true };
      const lv = w.levels[h.depth]; const fl = w.floors[h.depth]; const pass = core.passable(lv.map);
      const hx = h.pos % 64, hy = (h.pos / 64) | 0;
      const foes = fl.mobs.filter((m) => m.hp > 0 && m.alignment !== 'ally' && !['shopkeeper', 'ghost', 'wandmaker', 'blacksmith', 'imp', 'ratKing', 'sheep'].includes(m.kind) && !m.passive);
      const adj = foes.find((m) => Math.max(Math.abs(m.pos % 64 - hx), Math.abs(((m.pos / 64) | 0) - hy)) === 1);
      let action; let heapNear;
      const heap = (fl.heaps || []).find((x) => x.pos === h.pos);
      const foodIx = h.items.findIndex((it) => /food|ration|pasty|meat|berry/.test(String(it.kind)));
      const path = (goal, near) => {
        const prev = new Map([[h.pos, -1]]); const q = [h.pos]; const block = new Set(foes.map((m) => m.pos)); let hit = -1;
        while (q.length) { const c = q.shift(); if (near ? Math.max(Math.abs(c % 64 - goal % 64), Math.abs(((c / 64) | 0) - ((goal / 64) | 0))) <= 1 : c === goal) { hit = c; break; }
          for (const o of [-64, 64, -1, 1, -65, -63, 63, 65]) { const n = c + o; if (prev.has(n) || n < 0 || n >= lv.map.length) continue;
            if (!pass[n] && n !== goal) continue; if (block.has(n)) continue; prev.set(n, c); q.push(n); } }
        if (hit < 0 || hit === h.pos) return null; let c = hit; while (prev.get(c) !== h.pos) c = prev.get(c); return c;
      };
      const dist = (m) => Math.max(Math.abs(m.pos % 64 - hx), Math.abs(((m.pos / 64) | 0) - hy));
      const hunting = foes.filter((m) => m.state === 'hunting' && dist(m) <= 7).sort((a, b) => dist(a) - dist(b));
      if (adj) action = { type: 'attack', target: adj.id };
      else if (h.hunger >= 300 && foodIx >= 0) action = { type: 'use', item: foodIx };
      else if (heap && heap.items && heap.items.length) action = { type: 'pickup' };
      else if (hunting.length && h.hp > h.ht * 0.3) { const c = path(hunting[0].pos, true); action = c ? { type: 'move', to: c } : { type: 'search' }; }
      else if (h.hp < h.ht * (window.__resting ? 0.75 : 0.45)) { window.__resting = true; action = { type: 'wait' }; }
      else if ((heapNear = (fl.heaps || []).filter((x) => x.items && x.items.length && x.kind === 'heap' && Math.max(Math.abs(x.pos % 64 - hx), Math.abs(((x.pos / 64) | 0) - hy)) <= 6 && w.explored[h.depth]?.[x.pos]).map((x) => path(x.pos, false)).find((c) => c)) !== undefined) { window.__resting = false; action = { type: 'move', to: heapNear }; }
      else if (h.pos === lv.exit) { window.__resting = false; action = { type: 'descend' }; }
      else { window.__resting = false; const c = path(lv.exit, false); action = c ? { type: 'move', to: c } : { type: 'search' }; }
      session.send(action);
      return { depth: h.depth, hp: h.hp, ht: h.ht, a: action.type, turn: w.turn, hunger: h.hunger, foes: hunting.length, adj: !!adj, items: h.items.map((i) => i.kind).join(','), near: foes.filter((m) => dist(m) <= 3).map((m) => m.kind + ":" + m.state + ":" + m.hp).join(" ") };
    });
    if (r.over) break; if (process.env.TRACE) console.log(JSON.stringify(r));
    if (r.depth !== lastDepth || steps % 1000 === 0) { console.log('depth', r.depth, 'hp', r.hp, '/', r.ht, 'step', steps); lastDepth = r.depth; }
    await page.waitForTimeout(r.a === 'descend' ? 900 : 25);
    if (steps % 10 === 0) await page.evaluate(() => window.__pd.play(60));
  }
  console.log('ended after', steps);
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); if (await page.$('.pd-runend')) break; }
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outDir}/end.png` });
  const sc = await page.$('.pd-runend .pd-scroll');
  if (sc) { await sc.evaluate((n) => { n.scrollTop = n.scrollHeight; }); await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/end-bottom.png` }); await sc.evaluate((n) => { n.scrollTop = 0; }); }
  fs.writeFileSync(`${outDir}/storage.json`, JSON.stringify(await page.evaluate(() => ({ ...localStorage }))));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/end-checked.png` });
  // The boards, as the server has them now.
  const boards = await page.$$('.pd-runend button');
  for (const bt of boards) { const tx = await bt.textContent(); if (/Доски|Boards|Рейтинг|Leader/i.test(tx)) { await bt.click(); await page.waitForTimeout(2500); await page.screenshot({ path: `${outDir}/boards.png` }); break; } }
  // Back to the camp: the profile now has the run, the day's panel the attempt spent.
  await page.evaluate(() => { document.querySelectorAll('.pd-window .pd-close, .pd-window button[aria-label]').forEach(() => {}); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  const menu = await page.$$('.pd-runend button'); for (const bt of menu) { const tx = await bt.textContent(); if (/Главное меню|Main menu|Menu/i.test(tx)) { await bt.click(); break; } }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/camp-after.png` });
  await b.close();
})();
