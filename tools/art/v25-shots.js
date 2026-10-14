// usage: node game-shots.js <baseUrl> <outDir> <lang> <w> <h> [scene,scene...]
// Drives the real client (vite dev server) into scenes and takes screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const [,, base, outDir, lang = 'en', W = '375', H = '812', only = ''] = process.argv;
fs.mkdirSync(outDir, { recursive: true });

const PRESET = {
  'pd-season': '2', 'pd-hints': 'off', 'pd-coach-done': '1', 'pd-moved': '1', 'pd-seen-help': '1',
  'pd-intro-seen': '0,1,2,3,4', 'pd-seen-version': '99.0', 'pd-launches': '1', 'pd-home-asked': '1', 'pd-notify-asked': '1',
  'pd-name': 'Hero', 'pd-quickslots': JSON.stringify({ run: '1922768126:me:warrior', slots: ['missile.throwingStone', 'potion.healing', 'wand.lightning', 'missile.javelin', null, null] }), 'pd-class': 'warrior', 'pd-sound': 'off', 'pd-zoom-screen': '1', 'pd-fx': 'full',
  'pd-badges': JSON.stringify({ earned: ["slain1", "slain2", "slain3", "slain4", "gold1", "gold2", "gold3", "gold4", "level1", "level2", "level3", "level4", "boss1", "boss2", "boss3", "boss4", "potions", "scrolls", "rings", "wands", "haggler", "thorns", "victory", "bags", "deathFire", "deathPoison", "deathGas", "deathHunger", "grim", "piranhas", "boss1AllClasses", "boss3AllSubclasses", "allItems", "happyEnd", "str1", "str2", "str3", "food1", "food2", "food3", "item1", "item2", "item3", "cooked1", "cooked2", "cooked3", "combo", "deathGlyph", "deathFalling", "games1", "games2", "games3", "champion"], seen: ["slain1", "slain2", "slain3", "slain4", "gold1", "gold2", "gold3", "gold4", "level1", "level2", "level3", "level4", "boss1", "boss2", "boss3", "boss4", "potions", "scrolls", "rings", "wands", "haggler", "thorns", "victory", "bags", "deathFire", "deathPoison", "deathGas", "deathHunger", "grim", "piranhas", "boss1AllClasses", "boss3AllSubclasses", "allItems", "happyEnd", "str1", "str2", "str3", "food1", "food2", "food3", "item1", "item2", "item3", "cooked1", "cooked2", "cooked3", "combo", "deathGlyph", "deathFalling", "games1", "games2", "games3", "champion"], rare: [], boss1: [], boss3: [], victories: [], deaths: [], games: 120 }),
};

// Region monsters for the "-mobs" shots (Shattered kinds).
const REGION_MOBS = {
  1: ['rat', 'gnoll', 'snake', 'crab'], 6: ['skeleton', 'thief', 'dm100', 'guard'], 11: ['bat', 'brute', 'shaman', 'spinner'],
  16: ['ghoul', 'elemental', 'warlock', 'monk'], 21: ['succubus', 'eye', 'scorpio', 'ripper'],
};

async function startRun(page, cls = 'warrior') {
  await page.evaluate(async (cls) => {
    localStorage.setItem('pd-class', cls);
  }, cls);
  await page.evaluate(() => window.__pd.startSolo('new'));
  await page.waitForFunction(() => window.__pd?.session?.world, null, { timeout: 15000 });
  await page.waitForTimeout(600);
}

async function toDepth(page, depth, mobs) {
  await page.evaluate(({ depth, mobs }) => {
    const { session, core } = window.__pd;
    const w = session.world; const h = w.heroes[0];
    if (h.depth !== depth) core.moveToDepth(w, h, depth);
    const floor = w.floors[h.depth];
    // Calm level: put its monsters to sleep far away (remove those in view).
    floor.mobs = floor.mobs.filter((m) => Math.abs((m.pos % 64) - (h.pos % 64)) > 9 || Math.abs(Math.floor(m.pos / 64) - Math.floor(h.pos / 64)) > 9);
    for (const m of floor.mobs) m.state = 'sleeping';
    if (mobs && mobs.length) {
      const lv = w.levels[h.depth]; const pass = core.passable(lv.map);
      const taken = new Set([h.pos, ...floor.mobs.map((m) => m.pos)]);
      const ring = [];
      for (let r = 2; r <= 4 && ring.length < mobs.length; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const c = h.pos + dx + dy * 64; if (pass[c] && !taken.has(c) && ring.length < mobs.length) { ring.push(c); taken.add(c); }
        }
      }
      mobs.forEach((kind, i) => { if (ring[i] !== undefined) { const m = core.createMob('shot' + i, kind, ring[i], 'sleeping', floor.now); floor.mobs.push(m); } });
    }
    session.generation++;
  }, { depth, mobs });
  await page.evaluate(() => window.__pd.session.send({ type: 'wait' }));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__pd.play(1200));
}

async function giveItems(page) {
  await page.evaluate(() => {
    const { session, core } = window.__pd; const h = session.world.heroes[0];
    const kinds = ['potion.healing', 'potion.strength', 'scroll.upgrade', 'scroll.identify', 'wand.magicMissile', 'wand.fireblast', 'ring.haste',
      'food.ration', 'food.pasty', 'bomb', 'seed.sungrass', 'stone.blink', 'weapon.longsword', 'armor.mail', 'artifact.hornOfPlenty',
      'trinket.ratSkull', 'potion.exotic.cleansing', 'spell.phaseShift', 'missile.dart', 'ingot.energy'];
    for (const k of kinds) { try { h.items.push(core.createItem(k)); } catch (e) { /* unknown kind */ } }
    h.gold = 1234;
    session.generation++;
  });
}


// Puts the hero beside the densest patch of tall grass on the level (when there is one), on a free floor cell.
async function nearGrass(page) {
  await page.evaluate(() => {
    const { session, core } = window.__pd; const w = session.world; const h = w.heroes[0];
    const lv = w.levels[h.depth]; const pass = core.passable(lv.map); const floor = w.floors[h.depth];
    const taken = new Set(floor.mobs.map((m) => m.pos));
    let best = -1, score = 0;
    for (let c = 64 * 3; c < lv.map.length - 64 * 3; c++) {
      if (!pass[c] || taken.has(c) || lv.map[c] === 15 || lv.map[c] === 29) continue;
      let n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (lv.map[c + dx + dy * 64] === 15) n++;
      if (n > score) { score = n; best = c; }
    }
    if (best >= 0 && score >= 3) { window.__grass = best; }
    session.generation++;
  });
}
async function openSpot(page) {
  await page.evaluate(() => {
    const { session, core } = window.__pd; const w = session.world; const h = w.heroes[0];
    const lv = w.levels[h.depth]; const pass = core.passable(lv.map); const floor = w.floors[h.depth];
    const taken = new Set(floor.mobs.map((m) => m.pos));
    let best = -1, bd = 1e9;
    for (let c = 64 * 4; c < lv.map.length - 64 * 4; c++) {
      let ok = true;
      for (let dy = -1; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) { const q = c + dx + dy * 64; if (!pass[q] || taken.has(q) || lv.map[q] === 29 || lv.map[q] === 15 || lv.map[q] === 30) ok = false; }
      if (!ok) continue;
      const g = window.__grass ?? h.pos; const d = Math.abs((c % 64) - (g % 64)) + Math.abs(Math.floor(c / 64) - Math.floor(g / 64));
      if (d < bd) { bd = d; best = c; }
    }
    if (best >= 0) h.pos = best;
    session.generation++;
  });
}
async function settle(page, ms = 1200) {
  await page.evaluate(() => window.__pd.session.send({ type: 'wait' }));
  await page.waitForTimeout(300);
  await page.evaluate((ms) => window.__pd.play(ms), ms);
}
async function spawnAround(page, kinds, extra) {
  await page.evaluate(({ kinds, extra }) => {
    const { session, core } = window.__pd; const w = session.world; const h = w.heroes[0];
    const floor = w.floors[h.depth]; const lv = w.levels[h.depth]; const pass = core.passable(lv.map);
    const taken = new Set([h.pos, ...floor.mobs.map((m) => m.pos)]); const ring = [];
    for (let r = 1; r <= 4 && ring.length < kinds.length; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || (r === 1 && dy !== 0)) continue;
      const c = h.pos + dx + dy * 64; if (pass[c] && !taken.has(c) && ring.length < kinds.length) { ring.push(c); taken.add(c); }
    }
    kinds.forEach((kind, i) => { if (ring[i] === undefined) return; try { const m = core.createMob('v24' + i, kind, ring[i], extra || 'sleeping', floor.now); floor.mobs.push(m); } catch (e) { console.log('mob', kind, e.message); } });
    session.generation++;
  }, { kinds, extra });
}
async function region(p, depth) {
  await startRun(p); await toDepth(p, depth); await nearGrass(p); await openSpot(p); await settle(p, 300);
  await spawnAround(p, REGION_MOBS[depth]); await settle(p, 6200);
}

// v25: the GitHub page's four cards, natural play states.
// A warrior of the caves: level 13, berserker since Tengu, +2 sword and scale, talents spent as a player would.
async function veteran(p, depth) {
  await startRun(p, 'warrior'); await toDepth(p, depth);
  await p.evaluate((depth) => {
    const { session, core } = window.__pd; const h = session.world.heroes[0];
    h.lvl = 13; h.exp = 40; h.ht = 20 + 5 * 12; h.hp = Math.round(h.ht * 0.72); h.str = 13; h.attackSkill = 10 + 12; h.defenseSkill = 5 + 12;
    h.subclass = 'berserker';
    try { h.weapon = core.createItem('weapon.sword', 1, 2); } catch (e) { console.log('w', e.message); }
    try { h.armor = core.createItem('armor.scale', 1, 2); } catch (e) { console.log('a', e.message); }
    try { h.ring = core.createItem('ring.haste', 1, 1); } catch (e) {}
    h.gold = 1870;
    const add = (k, q = 1, l = 0) => { try { h.items.push(core.createItem(k, q, l)); } catch (e) { console.log('item', k, e.message); } };
    add('potion.healing', 2); add('wand.lightning', 1, 2); add('missile.javelin', 3); add('food.ration', 1); add('scroll.upgrade', 1); add('potion.strength', 1);
    add('wand.frost', 1, 1); add('scroll.teleportation', 2); add('missile.throwingStone', 2);
    const w = session.world; for (const k of ['potion.healing', 'wand.lightning', 'wand.frost', 'scroll.upgrade', 'scroll.teleportation', 'potion.strength']) if (!w.known.includes(k)) w.known.push(k);
    h.kills = 214;
    const pts = [['hearty_meal', 1], ['veterans_intuition', 2], ['provoked_anger', 0], ['iron_will', 2],
      ['iron_stomach', 1], ['liquid_willpower', 1], ['runic_transference', 2], ['lethal_momentum', 2], ['improvised_projectiles', 0],
      ['endless_rage', 1], ['deathless_fury', 0], ['enraged_catalyst', 0]];
    const book = core.talentBook ? core.talentBook(h) : h.talents;
    for (const [id, n] of pts) for (const tier of book.tiers) if (tier[id] !== undefined) tier[id] = n;
    session.generation++;
  }, depth);
}
async function explore(p, radius = 15) {
  await p.evaluate((radius) => {
    const { session, core, view } = window.__pd; const w = session.world; const h = w.heroes[0]; const lv = w.levels[h.depth];
    const pass = core.passable(lv.map); const ex = w.explored[h.depth] ?? (w.explored[h.depth] = new Array(lv.map.length).fill(false));
    const dist = new Map([[h.pos, 0]]); const q = [h.pos];
    while (q.length) { const c = q.shift(); const d = dist.get(c); ex[c] = true;
      for (const o of [-65, -64, -63, -1, 1, 63, 64, 65]) { const n = c + o; if (n < 0 || n >= lv.map.length) continue; ex[n] = true;
        if (pass[n] && !dist.has(n) && d + 1 <= radius) { dist.set(n, d + 1); q.push(n); } } }
    if (view && view.log) view.log.length = 0;
    session.generation++;
  }, radius);
}
async function championsFar(p, kinds, champ) {
  await p.evaluate(({ kinds, champ, r0 }) => {
    const { session, core } = window.__pd; const w = session.world; const h = w.heroes[0];
    const floor = w.floors[h.depth]; const lv = w.levels[h.depth]; const pass = core.passable(lv.map);
    const taken = new Set([h.pos, ...floor.mobs.map((m) => m.pos)]); const ring = [];
    for (let r = r0; r <= 6 && ring.length < kinds.length; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const c = h.pos + dx + dy * 64; if (pass[c] && !taken.has(c) && ring.length < kinds.length && (ring.length === 0 || ring.every((o) => Math.abs((o % 64) - (c % 64)) + Math.abs(((o / 64) | 0) - ((c / 64) | 0)) >= 2))) { ring.push(c); taken.add(c); }
    }
    kinds.forEach((kind, i) => { if (ring[i] === undefined) return; try { const m = core.createMob('v25' + i, kind, ring[i], 'hunting', floor.now); if (i === champ.i) m.champion = champ.kind; floor.mobs.push(m); } catch (e) { console.log('mob', kind, e.message); } });
    session.generation++;
  }, { kinds, champ, r0: Number(process.env.R0 || 3) });
}
async function champions(p, kinds, champ) {
  await spawnAround(p, kinds, 'hunting');
  await p.evaluate((champ) => { const { session } = window.__pd; const w = session.world; const fl = w.floors[w.heroes[0].depth];
    const m = fl.mobs.find((m) => m.id === 'v24' + champ.i); if (m) m.champion = champ.kind; session.generation++; }, champ);
}
const SCENES = {
  camp: async (page) => { await page.waitForTimeout(2500); },
  depth: async (p) => {
    await veteran(p, Number(process.env.DEPTH || 13)); await nearGrass(p); await openSpot(p); await explore(p, Number(process.env.EXPLORE || 15)); await settle(p, 300);
    await p.evaluate(() => { const v = window.__pd.view; if (v && v.log) v.log.length = 0; });
    for (let i = 0; i < Number(process.env.ZOOM || 0); i++) { await p.click('.pd-mapbtn.in'); await p.waitForTimeout(250); }
    await championsFar(p, (process.env.MOBS || 'brute,shaman,bat,spinner').split(','), { i: Number(process.env.CHAMP_I || 0), kind: process.env.CHAMP || 'blazing' });
    for (let i = 0; i < Number(process.env.TURNS || 1); i++) await settle(p, 500);
    await p.evaluate((want) => { const { session } = window.__pd; const w = session.world; const h = w.heroes[0]; h.hp = Math.max(h.hp, Math.round(h.ht * 0.7)); h.burning = 0;
      const d = (m) => Math.max(Math.abs(m.pos % 64 - h.pos % 64), Math.abs(((m.pos / 64) | 0) - ((h.pos / 64) | 0)));
      const near = w.floors[h.depth].mobs.filter((m) => d(m) <= 5 && m.id.startsWith('v25')); for (const m of near) m.champion = null;
      const pick = near.filter((m) => m.kind === want.kind).sort((a, b) => d(a) - d(b))[0] ?? near.sort((a, b) => d(a) - d(b))[0];
      if (pick) pick.champion = want.champ; session.generation++; }, { kind: process.env.CHAMP_KIND || 'brute', champ: process.env.CHAMP || 'blazing' });
    await p.waitForTimeout(Number(process.env.HOLD || 400));
    console.log(JSON.stringify(await p.evaluate(() => { const w = window.__pd.session.world; const h = w.heroes[0]; return w.floors[h.depth].mobs.filter((m) => Math.abs(m.pos % 64 - h.pos % 64) < 8 && Math.abs(((m.pos / 64) | 0) - ((h.pos / 64) | 0)) < 10).map((m) => [m.id, m.kind, m.champion, m.state, m.pos - h.pos]); })));
  },
  talents: async (p) => {
    await veteran(p, 13); await settle(p, 600);
    await p.evaluate(() => window.__pd.openHero()); await p.waitForTimeout(500);
    const tabs = await p.$$('.pd-tab'); if (tabs[1]) await tabs[1].click(); await p.waitForTimeout(700);
  },
};
const CLASS_OF = {};

(async () => {
  const b = await chromium.launch();
  const names = only ? only.split(',') : Object.keys(SCENES);
  for (const name of names) {
    const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 2, hasTouch: +W < 800 });
    await ctx.addInitScript(() => { let a = 20261014; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
    await ctx.addInitScript((preset) => { if (!sessionStorage.getItem('preset')) { for (const [k, v] of Object.entries(preset)) localStorage.setItem(k, v); sessionStorage.setItem('preset', '1'); } }, { ...PRESET, 'pd-class': CLASS_OF[name] || 'warrior' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}/?lang=${lang}`);
    await page.waitForFunction(() => window.__pd, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    try {
      await SCENES[name](page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${outDir}/${name}.png` });
      const pos = await page.evaluate(() => { try { const { session, camera } = window.__pd; const h = session.world.heroes[0]; const c = document.querySelector('canvas');
        const r = c.width / c.clientWidth; return { x: ((h.pos % 64) * 16 + 8 - camera.x) * camera.zoom / r, y: (Math.floor(h.pos / 64) * 16 + 8 - camera.y) * camera.zoom / r, zoom: camera.zoom / r }; } catch (e) { return null; } });
      fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify(pos));
      console.log('ok', name, errs.length ? errs.slice(0, 2).join(' | ') : '');
    } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); }
    await ctx.close();
  }
  await b.close();
})();
