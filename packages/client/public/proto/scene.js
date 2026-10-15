/*
 * Pixel Dungeon TS - rendering-engine prototypes: the scene both demos share (pixi.html, hd2d.html).
 * A plain script, no build step: it exposes window.PDScene. It holds the room, the actors and their
 * little brains, the particles, the torch, the input gestures and the HUD; the pages only draw it.
 *
 * World units are cells (1 cell = 16 art pixels). x grows east, y grows south ("down the screen").
 * Art is the game's own (../assets): the sewers tilemap, the warrior sheet, rat and gnoll, the prison torch.
 */
(function () {
  'use strict';

  var W = 12, H = 10, T = 16;
  var ASSETS = '../assets/';

  // '#' wall, '.' floor, '~' puddle, 'D' door, 'P' wall with a pipe, 'T' wall with the torch.
  var ROWS = [
    '###P#D##T###',
    '#..~~......#',
    '#.~~~~.....#',
    '#..~~.#....#',
    '#.....#....#',
    '#..........#',
    '#...##.....#',
    '#..........#',
    '#..........#',
    '############',
  ];

  var S = { W: W, H: H, T: T, ROWS: ROWS, time: 0 };

  /* ---------------------------------------------------------------- terrain */

  function kind(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return '#';
    return ROWS[y].charAt(x);
  }
  S.kind = kind;
  var isWallCh = function (c) { return c === '#' || c === 'P' || c === 'T'; };
  S.isWall = function (x, y) { return isWallCh(kind(x, y)); };
  S.walkable = function (x, y) {
    if (S.chest && x === S.chest.x && y === S.chest.y) return false;
    var c = kind(x, y);
    return c === '.' || c === '~' || c === 'D';
  };
  S.isWater = function (x, y) { return kind(x, y) === '~'; };
  S.doorCell = { x: 5, y: 0 };
  S.doorOpen = false;
  // Light is stopped by walls and by a shut door.
  function opaque(x, y) { var c = kind(x, y); return isWallCh(c) || (c === 'D' && !S.doorOpen); }

  // Sewers tile indices (tiles_sewers.png, 16 per row), from DungeonTileSheet.
  var TILE = { FLOOR: 0, FLOOR_DECO: 1, FLOOR_ALT: 6, FLOOR_DECO_ALT: 7, WATER: 32, FLAT_WALL: 48, DOOR: 56, DOOR_OPEN: 57, FACE: 80, FACE_PIPE: 84 };
  S.TILE = TILE;

  var hash = function (x, y) { var h = (x * 73856093) ^ (y * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  /** The picture of a wall cell: the face of a wall with floor below it, the flat top of any other. */
  S.wallTile = function (x, y) {
    var c = kind(x, y);
    var faced = !S.isWall(x, y + 1) && y + 1 < H;
    if (c === 'P') return TILE.FACE_PIPE;
    if (!faced && c !== 'D') return TILE.FLAT_WALL;
    return TILE.FACE;
  };

  /** Floor tile of a floor cell, varied the way Shattered varies them (by a fixed number from the cell). */
  S.floorTile = function (x, y) {
    var r = hash(x, y);
    return r < 0.62 ? TILE.FLOOR : r < 0.78 ? TILE.FLOOR_DECO : r < 0.9 ? TILE.FLOOR_ALT : TILE.FLOOR_DECO_ALT;
  };

  // Decorations from terrain_features.png (plants), drawn on the floor.
  S.decor = [{ x: 10, y: 8, tile: 112 }, { x: 1, y: 7, tile: 126 }, { x: 9, y: 1, tile: 119 }];

  /* ----------------------------------------------------------------- assets */

  S.img = {};
  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var i = new Image();
      i.onload = function () { resolve(i); };
      i.onerror = function () { reject(new Error('cannot load ' + src)); };
      i.src = src;
    });
  }

  var FILES = {
    tiles: 'spd/tiles_sewers.png', features: 'spd/terrain_features.png', water: 'spd/water0.png',
    warrior: 'warrior.png', rat: 'spd/rat.png', gnoll: 'spd/gnoll.png', ambient: 'world/ambient1.png',
  };

  var anim = function (fps, frames, loop) { return { fps: fps, frames: frames, loop: !!loop }; };
  // Frame sizes and animations as the game plays them (mobsprites.ts RAT / GNOLL, sprites.ts HERO_ANIMS).
  S.SHEETS = {
    hero: { img: 'warrior', w: 12, h: 15, row: 2, anims: { idle: anim(1, [0, 0, 0, 1, 0, 0, 1, 1], true), run: anim(20, [2, 3, 4, 5, 6, 7], true), attack: anim(15, [13, 14, 15, 0]) } },
    rat: { img: 'rat', w: 16, h: 15, row: 0, anims: { idle: anim(2, [0, 0, 0, 1], true), run: anim(10, [6, 7, 8, 9, 10], true), attack: anim(15, [2, 3, 4, 5, 0]), die: anim(10, [11, 12, 13, 14]) } },
    gnoll: { img: 'gnoll', w: 12, h: 15, row: 0, anims: { idle: anim(2, [0, 0, 0, 1, 0, 0, 1, 1], true), run: anim(12, [4, 5, 6, 7], true), attack: anim(12, [2, 3, 0]), die: anim(12, [8, 9, 10]) } },
  };
  // The prison torch (world/ambient1.json "torch"): six 16x16 frames in the sheet's first row.
  S.TORCH_FRAMES = 6;

  /** Source rectangle of a frame in a sheet. */
  S.frameRect = function (sheetKey, frame) {
    var sh = S.SHEETS[sheetKey], img = S.img[sh.img];
    var cols = Math.floor(img.width / sh.w);
    return { sx: (frame % cols) * sh.w, sy: (Math.floor(frame / cols) + sh.row) * sh.h, w: sh.w, h: sh.h, img: img };
  };

  var canvasCache = {};
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /** One 16x16 tile of the sewers sheet as its own canvas. */
  S.tileCanvas = function (idx) {
    var k = 't' + idx;
    if (canvasCache[k]) return canvasCache[k];
    var c = mk(T, T);
    c.getContext('2d').drawImage(S.img.tiles, (idx % 16) * T, Math.floor(idx / 16) * T, T, T, 0, 0, T, T);
    return (canvasCache[k] = c);
  };

  /** A sheet with every opaque pixel white: what a hit flash is drawn from. */
  S.whiteCanvas = function (imgKey) {
    var k = 'w' + imgKey;
    if (canvasCache[k]) return canvasCache[k];
    var img = S.img[imgKey], c = mk(img.width, img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    return (canvasCache[k] = c);
  };

  /** A radial falloff texture. stops: [[pos 0..1, 'css colour'], ...]. */
  S.radialCanvas = function (size, stops) {
    var c = mk(size, size), g = c.getContext('2d'), r = size / 2;
    var gr = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  };

  /** The room's floor, water edges, plants and walls baked flat: 192 x 160 art pixels. Water cells are left clear (the water shows through). */
  S.bakeGround = function () {
    var c = mk(W * T, H * T), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    var tile = function (idx, x, y) { g.drawImage(S.img.tiles, (idx % 16) * T, Math.floor(idx / 16) * T, T, T, x * T, y * T, T, T); };
    var ground = function (x, y) { var ch = kind(x, y); return ch === '.' || ch === 'D'; };
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var ch = kind(x, y);
        if (isWallCh(ch) || ch === 'D') tile(S.wallTile(x, y), x, y);
        else if (ch === '~') {
          // DungeonTileSheet.stitchWaterTile: +1 ground above, +2 right, +4 below, +8 left.
          var m = (ground(x, y - 1) ? 1 : 0) + (ground(x + 1, y) ? 2 : 0) + (ground(x, y + 1) ? 4 : 0) + (ground(x - 1, y) ? 8 : 0);
          tile(TILE.WATER + m, x, y);
        } else tile(S.floorTile(x, y), x, y);
      }
    }
    S.decor.forEach(function (d) {
      g.drawImage(S.img.features, (d.tile % 16) * T, Math.floor(d.tile / 16) * T, T, T, d.x * T, d.y * T, T, T);
    });
    S.groundCanvas = c;
    return c;
  };

  /** Pictures only the HD-2D demo needs: the chest and the item sheet. */
  S.loadExtras = function () {
    return Promise.all([loadImg(ASSETS + 'world/chests.png'), loadImg(ASSETS + 'items.png')]).then(function (r) { S.img.chests = r[0]; S.img.items = r[1]; });
  };

  S.load = function () {
    var keys = Object.keys(FILES);
    return Promise.all(keys.map(function (k) { return loadImg(ASSETS + FILES[k]); })).then(function (imgs) {
      keys.forEach(function (k, i) { S.img[k] = imgs[i]; });
      S.bakeGround();
      S.reset();
    });
  };

  /* --------------------------------------------------------- pathing (grid) */

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  /** Breadth-first over the walkable cells, 8 ways, never cutting a wall's corner. Returns dist and prev maps. */
  function flood(sx, sy, maxDist) {
    var dist = new Int16Array(W * H).fill(-1), prev = new Int16Array(W * H).fill(-1);
    var q = [sx + sy * W];
    dist[q[0]] = 0;
    for (var qi = 0; qi < q.length; qi++) {
      var cur = q[qi], cx = cur % W, cy = (cur / W) | 0;
      if (dist[cur] >= maxDist) continue;
      for (var d = 0; d < 8; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!S.walkable(nx, ny)) continue;
        if (d >= 4 && (!S.walkable(cx + DIRS[d][0], cy) || !S.walkable(cx, cy + DIRS[d][1]))) continue;
        var ni = nx + ny * W;
        if (dist[ni] >= 0) continue;
        dist[ni] = dist[cur] + 1;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    return { dist: dist, prev: prev };
  }

  /** The cells from (sx, sy) to (gx, gy), the start left out; null if unreachable. */
  S.path = function (sx, sy, gx, gy) {
    if (!S.walkable(gx, gy)) return null;
    var f = flood(sx, sy, 99), gi = gx + gy * W;
    if (f.dist[gi] < 0) return null;
    var out = [];
    for (var i = gi; i !== sx + sy * W; i = f.prev[i]) out.push({ x: i % W, y: (i / W) | 0 });
    return out.reverse();
  };

  /* ----------------------------------------------------------------- actors */

  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var dur = function (a) { return (a.frames.length / a.fps) * 1000; };
  var frameOf = function (a, t) {
    var i = Math.floor((t / 1000) * a.fps);
    return a.loop ? a.frames[i % a.frames.length] : a.frames[Math.min(i, a.frames.length - 1)];
  };

  function mkActor(name, sheet, cx, cy, speed) {
    return {
      name: name, sheet: sheet, def: S.SHEETS[sheet], x: cx + 0.5, y: cy + 0.5, cx: cx, cy: cy, next: null, path: [], speed: speed,
      anim: 'idle', t: Math.random() * 800, frame: 0, flip: false, flash: 0, moving: false, attacking: false, hitDone: true, hitAt: 0, target: null,
      hp: 2, dead: false, respawnIn: 0, castTarget: null, openChest: false, blocked: 0, ai: { state: 'wander', wait: rand(600, 1800), cooldown: 3500, hits: 0, atkCd: 0, repath: 0 },
    };
  }

  S.reset = function () {
    S.hero = mkActor('hero', 'hero', 6, 5, 7);
    S.rat = mkActor('rat', 'rat', 9, 2, 4.2);
    S.gnoll = mkActor('gnoll', 'gnoll', 2, 7, 3.6);
    S.actors = [S.hero, S.rat, S.gnoll];
    S.mobs = [S.rat, S.gnoll];
    S.floaters = [];
    S.ripples = [];
    S.drops = [];
    S.sparks = [];
    S.mist = [];
    for (var i = 0; i < 14; i++) S.mist.push({ x: rand(0, W), y: rand(0.6, H - 1), r: rand(1.1, 2.2), vx: rand(-0.12, 0.12), vy: rand(-0.05, 0.05), ph: rand(0, 6.28), a: rand(0.6, 1) });
    S.torch = { x: 8.5, y: 0.78, lx: 8.5, ly: 1.25, flicker: 1, frame: 0, nextFrame: 0, noise: 1 };
    S.events = [];
    S.item = null; S.fire = null; S.fireCd = 0; S.slowLeft = 0; S.timeScale = 1;
    S.chest = S.extras ? { x: 9, y: 7, open: false, t: 0, resetIn: 0 } : null;
    S.dripIn = 600;
    S.sparkIn = 100;
    S.time = 0;
  };

  function occupied(x, y, except) {
    for (var i = 0; i < S.actors.length; i++) {
      var a = S.actors[i];
      if (a === except || a.dead) continue;
      if ((a.cx === x && a.cy === y) || (a.next && a.next.x === x && a.next.y === y)) return true;
    }
    return false;
  }

  function stepMove(e, dt) {
    var n = e.path[0];
    if (occupied(n.x, n.y, e)) {
      e.blocked += dt;
      if (e.blocked > 500) { e.path = []; e.next = null; e.blocked = 0; }
      return false;
    }
    e.blocked = 0;
    e.next = n;
    var tx = n.x + 0.5, ty = n.y + 0.5, dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy), mv = (e.speed * dt) / 1000;
    if (Math.abs(dx) > 0.02) e.flip = dx < 0;
    if (d <= mv) {
      e.x = tx; e.y = ty; e.cx = n.x; e.cy = n.y;
      waterRipple(e);
      e.path.shift();
      e.next = e.path.length ? e.path[0] : null;
    } else {
      e.x += (dx / d) * mv;
      e.y += (dy / d) * mv;
    }
    return true;
  }

  /** Stepping into water, or onto a cell beside it, sends rings across the puddle. */
  function waterRipple(e) {
    if (S.ripples.length > 11) return;
    if (S.isWater(e.cx, e.cy)) {
      S.ripples.push({ x: e.cx + 0.5, y: e.cy + 0.5, age: 0, life: 1200, tap: false, big: true });
      S.ripples.push({ x: e.cx + 0.5, y: e.cy + 0.5, age: -180, life: 1200, tap: false, big: true });
      return;
    }
    for (var d = 0; d < 8; d++) {
      var nx = e.cx + DIRS[d][0], ny = e.cy + DIRS[d][1];
      if (S.isWater(nx, ny)) { S.ripples.push({ x: nx + 0.5, y: ny + 0.5, age: 0, life: 900, tap: false }); return; }
    }
  }

  var adjacent = function (a, b) { return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy)) <= 1; };
  var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };

  function startAttack(e, target) {
    e.attacking = true;
    e.path = []; e.next = null;
    e.anim = 'attack'; e.t = 0; e.hitDone = false;
    e.hitAt = dur(e.def.anims.attack) * 0.5;
    e.target = target;
    if (Math.abs(target.x - e.x) > 0.1) e.flip = target.x < e.x;
  }

  function floater(x, y, text, color, big) { S.floaters.push({ x: x, y: y, text: text, color: color, age: 0, life: big ? 1300 : 1000, big: !!big }); }
  function ev(o) { if (S.extras) S.events.push(o); }

  function onHit(e) {
    if (e.castTarget) { launchFire(e, e.castTarget); e.castTarget = null; return; }
    var tg = e.target;
    if (!tg || tg.dead) return;
    var dmg = e === S.hero ? 2 + ((Math.random() * 5) | 0) : 1 + ((Math.random() * 3) | 0);
    tg.flash = 1;
    floater(tg.x + rand(-0.15, 0.15), tg.y - 0.6, '-' + dmg, tg === S.hero ? '#ff5a4a' : '#ffd24a');
    if (tg === S.hero) S.hero.counterIn = 260;
  }

  function mobAI(m, dt) {
    var ai = m.ai, h = S.hero;
    ai.cooldown -= dt; ai.atkCd -= dt; ai.repath -= dt;
    if (m.dead || m.attacking) return;
    if (ai.state === 'wander') {
      if (!m.path.length) {
        ai.wait -= dt;
        if (ai.wait <= 0) {
          ai.wait = rand(900, 2400);
          var f = flood(m.cx, m.cy, 4), picks = [];
          for (var i = 0; i < f.dist.length; i++) if (f.dist[i] >= 2) picks.push(i);
          if (picks.length) {
            var pi = picks[(Math.random() * picks.length) | 0];
            var p = S.path(m.cx, m.cy, pi % W, (pi / W) | 0);
            if (p) m.path = p;
          }
        }
      }
      if (ai.cooldown <= 0 && dist(m, h) < 4.2) { ai.state = 'chase'; ai.repath = 0; }
    } else if (ai.state === 'chase') {
      if (adjacent(m, h)) { ai.state = 'fight'; m.path = []; m.next = null; return; }
      if (dist(m, h) > 8) { ai.state = 'wander'; ai.cooldown = 3000; return; }
      if (ai.repath <= 0) {
        ai.repath = 350;
        var p2 = S.path(m.next ? m.next.x : m.cx, m.next ? m.next.y : m.cy, h.cx, h.cy);
        if (p2 && p2.length) { p2.pop(); m.path = (m.next ? [m.next] : []).concat(p2); if (m.next && m.path.length > 1 && m.path[0] === m.path[1]) m.path.shift(); }
      }
    } else if (ai.state === 'fight') {
      if (!adjacent(m, h)) { ai.state = 'chase'; ai.repath = 0; return; }
      if (Math.abs(h.x - m.x) > 0.1) m.flip = h.x < m.x;
      if (ai.atkCd <= 0) {
        startAttack(m, h);
        ai.atkCd = rand(1100, 1600);
        if (++ai.hits >= 3) { ai.hits = 0; ai.state = 'wander'; ai.cooldown = 6500; ai.wait = 300; }
      }
    }
  }

  function updateActor(e, dt) {
    if (e.dead) {
      e.t += dt;
      e.anim = 'die';
      e.frame = frameOf(e.def.anims.die, e.t);
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt / 220);
      e.respawnIn -= dt;
      if (e.respawnIn <= 0) respawn(e);
      return;
    }
    var moving = false;
    if (!e.attacking && e.path.length) moving = stepMove(e, dt);
    e.moving = moving;
    var want = e.attacking ? 'attack' : moving ? 'run' : 'idle';
    if (want !== e.anim) { e.anim = want; e.t = 0; } else e.t += dt;
    var a = e.def.anims[e.anim];
    if (e.attacking) {
      if (!e.hitDone && e.t >= e.hitAt) { e.hitDone = true; onHit(e); }
      if (e.t >= dur(a)) { e.attacking = false; e.anim = 'idle'; e.t = 0; a = e.def.anims.idle; }
    }
    e.frame = frameOf(a, e.t);
    if (e.flash > 0) e.flash = Math.max(0, e.flash - dt / 220);
  }

  /** The hero walks to a floor cell (a tap). Returns false if it can't be reached. */
  S.tapCell = function (cx, cy) {
    var h = S.hero;
    if (!S.walkable(cx, cy)) return false;
    if (h.attacking) return false;
    var sx = h.next ? h.next.x : h.cx, sy = h.next ? h.next.y : h.cy;
    var p = sx === cx && sy === cy ? [] : S.path(sx, sy, cx, cy);
    if (!p) return false;
    h.path = (h.next ? [h.next] : []).concat(p);
    h.counterIn = -1;
    h.openChest = false;
    S.ripples.push({ x: cx + 0.5, y: cy + 0.5, age: 0, life: 520, tap: true });
    return true;
  };

  /* ------------------------------------------------ extras (the HD-2D demo): chest, loot, fireball, kills */

  /** Turns on the chest, the fireball and mobs that can die; the Pixi demo leaves them off. */
  S.extras = false;
  S.enableExtras = function () { S.extras = true; S.chest = { x: 9, y: 7, open: false, t: 0, resetIn: 0 }; };

  var nearCell = function (a, c) { return Math.max(Math.abs(a.cx - c.x), Math.abs(a.cy - c.y)) <= 1; };

  /** A tap on the chest: opens it if the hero stands beside it, else walks there first. */
  S.tapChest = function () {
    var c = S.chest, h = S.hero;
    if (!c || c.open || h.attacking) return false;
    if (nearCell(h, c) && !h.moving) { openChest(); return true; }
    var best = null;
    for (var d = 0; d < 8; d++) {
      var nx = c.x + DIRS[d][0], ny = c.y + DIRS[d][1];
      if (!S.walkable(nx, ny)) continue;
      var p = S.path(h.next ? h.next.x : h.cx, h.next ? h.next.y : h.cy, nx, ny);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best) return false;
    h.path = (h.next ? [h.next] : []).concat(best);
    h.openChest = true;
    return true;
  };

  function openChest() {
    var c = S.chest, h = S.hero;
    c.open = true; c.t = 0;
    var spots = [];
    for (var d = 0; d < 8; d++) {
      var nx = c.x + DIRS[d][0], ny = c.y + DIRS[d][1];
      if (S.walkable(nx, ny) && !S.isWater(nx, ny) && !(nx === h.cx && ny === h.cy)) spots.push([nx, ny]);
    }
    // Prefer the cells in front of the chest (south, towards the camera).
    spots.sort(function (a, b) { return b[1] - a[1] + (Math.random() - 0.5); });
    var to = spots[0] || [c.x, c.y + 1];
    S.item = { state: 'arc', t: 0, fx: c.x + 0.5, fy: c.y + 0.5, tx: to[0] + 0.5, ty: to[1] + 0.5, cx: to[0], cy: to[1], x: c.x + 0.5, y: c.y + 0.5, h: 0.5, rare: true, takenT: 0 };
    ev({ type: 'chestOpen', x: c.x + 0.5, y: c.y + 0.5 });
  }

  /** The hero casts a fireball at the nearest mob it can see. 1: cast, 0: busy, -1: no target. */
  S.castFireball = function () {
    var h = S.hero;
    if (h.attacking || S.fire || S.fireCd > 0) return 0;
    var best = null, bd = 99;
    S.mobs.forEach(function (m) {
      if (m.dead) return;
      var d = dist(h, m);
      if (d < bd && sees(h, m)) { bd = d; best = m; }
    });
    if (!best) { floater(h.x, h.y - 0.7, 'нет целей', '#9fd0ff'); return -1; }
    h.path = []; h.next = null; h.openChest = false;
    startAttack(h, best);
    h.castTarget = best;
    S.fireCd = 900;
    ev({ type: 'cast', x: h.x, y: h.y });
    return 1;
  };

  /** A straight look from a to b: no wall in the way. */
  function sees(a, b) {
    var n = Math.ceil(dist(a, b) / 0.25);
    for (var i = 1; i < n; i++) {
      var t = i / n;
      if (S.isWall(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t))) return false;
    }
    return true;
  }

  function launchFire(h, target) {
    S.fire = { x: h.x + (h.flip ? -0.3 : 0.3), y: h.y - 0.1, target: target, age: 0, dx: h.flip ? -1 : 1, dy: 0 };
    ev({ type: 'fireLaunch', x: S.fire.x, y: S.fire.y });
  }

  function impact(f) {
    var t = f.target, dmg = 4 + ((Math.random() * 4) | 0);
    S.fire = null;
    t.flash = 1;
    t.hp -= 1;
    floater(t.x + rand(-0.1, 0.1), t.y - 0.7, '-' + dmg, '#ff8a3a', true);
    S.slowLeft = 150;
    ev({ type: 'impact', x: t.x, y: t.y, target: t, killed: t.hp <= 0 });
    if (t.hp <= 0) {
      t.dead = true; t.path = []; t.next = null; t.attacking = false; t.respawnIn = 7500; t.t = 0; t.anim = 'die';
      ev({ type: 'mobDie', x: t.x, y: t.y });
    }
  }

  function respawn(m) {
    var f = flood(S.hero.cx, S.hero.cy, 99), picks = [];
    for (var i = 0; i < f.dist.length; i++) {
      var x = i % W, y = (i / W) | 0;
      if (f.dist[i] >= 5 && S.walkable(x, y) && !S.isWater(x, y) && !occupied(x, y, m)) picks.push(i);
    }
    var pi = picks.length ? picks[(Math.random() * picks.length) | 0] : 1 + W;
    m.cx = pi % W; m.cy = (pi / W) | 0; m.x = m.cx + 0.5; m.y = m.cy + 0.5;
    m.dead = false; m.hp = 2; m.anim = 'idle'; m.t = 0; m.path = []; m.next = null;
    m.ai.state = 'wander'; m.ai.cooldown = 3500; m.ai.hits = 0;
    ev({ type: 'respawn', x: m.x, y: m.y });
  }

  function updateExtras(dt) {
    var h = S.hero, c = S.chest, it = S.item, f = S.fire;
    if (S.fireCd > 0) S.fireCd -= dt;
    if (h.openChest && !h.moving && !h.path.length && !h.attacking) {
      h.openChest = false;
      if (c && !c.open && nearCell(h, c)) openChest();
    }
    if (c && c.open) c.t += dt;
    if (f) {
      f.age += dt;
      var t = f.target, dx = t.x - f.x, dy = t.y - f.y, d = Math.sqrt(dx * dx + dy * dy), mv = 13 * dt / 1000;
      if (d <= mv + 0.3 || f.age > 3000) impact(f);
      else { f.x += dx / d * mv; f.y += dy / d * mv; f.dx = dx / d; f.dy = dy / d; }
    }
    if (it) {
      it.t += dt;
      if (it.state === 'arc') {
        var s = Math.min(1, it.t / 800);
        it.x = it.fx + (it.tx - it.fx) * s; it.y = it.fy + (it.ty - it.fy) * s;
        it.h = 0.5 + 1.7 * 4 * s * (1 - s);
        if (s >= 1) { it.state = 'ground'; it.t = 0; ev({ type: 'itemLand', x: it.tx, y: it.ty }); }
      } else if (it.state === 'ground') {
        it.x = it.tx; it.y = it.ty; it.h = 0.42;
        if (h.cx === it.cx && h.cy === it.cy) {
          it.state = 'taken'; it.takenT = 0;
          floater(h.x, h.y - 0.8, 'Редкий предмет!', '#d49bff', true);
          ev({ type: 'pickup', x: it.tx, y: it.ty });
          c.resetIn = 6500;
        }
      } else if (it.state === 'taken') {
        it.takenT += dt;
      }
    }
    if (c && c.open && it && it.state === 'taken' && c.resetIn > 0) {
      c.resetIn -= dt;
      if (c.resetIn <= 0) { c.open = false; c.t = 0; S.item = null; ev({ type: 'chestClose', x: c.x + 0.5, y: c.y + 0.5 }); }
    }
  }

  /* -------------------------------------------------------------- the update */

  S.update = function (dt) {
    dt = Math.min(dt, 100);
    S.time += dt;
    var h = S.hero, i;
    // The hero hits back a moment after being hit.
    if (h.counterIn > 0) {
      h.counterIn -= dt;
      if (h.counterIn <= 0 && !h.attacking && !h.moving) {
        for (i = 0; i < S.mobs.length; i++) if (!S.mobs[i].dead && adjacent(h, S.mobs[i])) { startAttack(h, S.mobs[i]); break; }
      }
    }
    for (i = 0; i < S.mobs.length; i++) mobAI(S.mobs[i], dt);
    for (i = 0; i < S.actors.length; i++) updateActor(S.actors[i], dt);

    var open = false;
    for (i = 0; i < S.actors.length; i++) if (Math.hypot(S.actors[i].x - 5.5, S.actors[i].y - 0.5) < 1.6) open = true;
    S.doorOpen = open;
    if (S.extras) updateExtras(dt);

    // The torch: a flame never twice the same.
    var t = S.torch;
    t.nextFrame -= dt;
    if (t.nextFrame <= 0) { t.nextFrame = rand(70, 130); t.frame = (Math.random() * S.TORCH_FRAMES) | 0; t.noise = rand(0.88, 1.12); }
    t.flicker += (t.noise - t.flicker) * Math.min(1, dt / 60);
    var ts = S.time / 1000;
    t.f = t.flicker * (1 + 0.04 * Math.sin(ts * 9.1) + 0.03 * Math.sin(ts * 17.3));

    // Floating numbers, ripples.
    for (i = S.floaters.length - 1; i >= 0; i--) { S.floaters[i].age += dt; if (S.floaters[i].age > S.floaters[i].life) S.floaters.splice(i, 1); }
    for (i = S.ripples.length - 1; i >= 0; i--) { S.ripples[i].age += dt; if (S.ripples[i].age > S.ripples[i].life) S.ripples.splice(i, 1); }

    // Water dripping from the pipe at (3, 0) into the puddle below it.
    S.dripIn -= dt;
    if (S.dripIn <= 0) { S.dripIn = rand(900, 2000); S.drops.push({ x: 3.5, y: 1.1, h: 0.62, v: 0 }); }
    for (i = S.drops.length - 1; i >= 0; i--) {
      var d = S.drops[i];
      d.v += 9 * (dt / 1000);
      d.h -= d.v * (dt / 1000);
      if (d.h <= 0) { S.ripples.push({ x: d.x, y: d.y, age: 0, life: 700, tap: false }); S.drops.splice(i, 1); }
    }
    // Sparks off the torch.
    S.sparkIn -= dt;
    if (S.sparkIn <= 0) { S.sparkIn = rand(90, 260); S.sparks.push({ x: 8.5 + rand(-0.1, 0.1), y: 1.02, h: 0.78, vx: rand(-0.25, 0.25), vh: rand(0.5, 0.9), age: 0, life: rand(500, 1000) }); }
    for (i = S.sparks.length - 1; i >= 0; i--) {
      var s = S.sparks[i];
      s.age += dt; s.x += s.vx * (dt / 1000); s.h += s.vh * (dt / 1000);
      if (s.age > s.life) S.sparks.splice(i, 1);
    }
    // Mist drifting over the floor.
    for (i = 0; i < S.mist.length; i++) {
      var m = S.mist[i];
      m.x += m.vx * (dt / 1000); m.y += m.vy * (dt / 1000);
      if (m.x < -1) m.x = W + 1; else if (m.x > W + 1) m.x = -1;
      if (m.y < 0.5) m.vy = Math.abs(m.vy); else if (m.y > H - 0.5) m.vy = -Math.abs(m.vy);
    }
  };

  /* -------------------------------------------------------- light raycasting */

  /**
   * Casts `n` rays from (x, y) in cell coordinates and writes how far each goes into `out` (a Float32Array of n):
   * as far as `radius`, or into the first wall - past the wall's edge by 0.9, so the wall's own face is lit.
   */
  S.castLight = function (x, y, radius, n, out) {
    for (var k = 0; k < n; k++) {
      var a = (k / n) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      var cx = Math.floor(x), cy = Math.floor(y);
      var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      var tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
      var tmx = dx > 0 ? (cx + 1 - x) * tdx : dx < 0 ? (x - cx) * tdx : Infinity;
      var tmy = dy > 0 ? (cy + 1 - y) * tdy : dy < 0 ? (y - cy) * tdy : Infinity;
      var t = 0, res = radius;
      while (t < radius) {
        if (tmx < tmy) { t = tmx; tmx += tdx; cx += sx; } else { t = tmy; tmy += tdy; cy += sy; }
        if (t >= radius) break;
        if (opaque(cx, cy)) { res = Math.min(radius, t + 0.9); break; }
      }
      out[k] = res;
    }
  };

  /* -------------------------------------------------------------------- HUD */

  var CSS = [
    'html,body{margin:0;height:100%;background:#0a0c13;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#dfe6ff}',
    'canvas.pd-view{position:fixed;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;image-rendering:pixelated;image-rendering:crisp-edges}',
    '.pd-top{position:fixed;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:max(8px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) 0 max(10px,env(safe-area-inset-left));pointer-events:none;z-index:5}',
    '.pd-pill{background:rgba(9,11,19,.74);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:6px 12px;font-size:13px;line-height:1.25;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '.pd-pill b{color:#ffc857;letter-spacing:.04em}',
    'a.pd-pill{pointer-events:auto;color:#9fd0ff;text-decoration:none;white-space:nowrap}',
    'a.pd-pill:active{background:rgba(40,60,100,.8)}',
    '.pd-hint{position:fixed;left:0;right:0;top:calc(max(8px,env(safe-area-inset-top)) + 40px);text-align:center;font-size:11px;color:rgba(223,230,255,.62);pointer-events:none;z-index:4;text-shadow:0 1px 2px #000}',
    '.pd-fps{position:fixed;left:max(10px,env(safe-area-inset-left));bottom:max(10px,env(safe-area-inset-bottom));font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;background:rgba(9,11,19,.74);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:5px 8px;white-space:pre;pointer-events:none;z-index:5;min-width:92px}',
    '.pd-dock{position:fixed;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100vw - 132px);z-index:5}',
    '.pd-bar,.pd-acts{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}',
    'button.pd-act{min-height:48px;font-size:14px;border-color:rgba(255,160,70,.6);background:rgba(60,26,8,.85);color:#ffd9b0}',
    '.pd-photo .pd-top,.pd-photo .pd-hint,.pd-photo .pd-fps,.pd-photo .pd-dock{display:none}',
    '.pd-toast{position:fixed;left:50%;top:calc(max(8px,env(safe-area-inset-top)) + 76px);transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:rgba(9,11,19,.8);border:1px solid rgba(255,255,255,.2);font-size:13px;z-index:6;pointer-events:none;opacity:0;transition:opacity .25s;white-space:nowrap}',
    'button.pd-btn{font:600 13px system-ui,sans-serif;min-height:44px;min-width:64px;padding:0 12px;color:#dfe6ff;background:rgba(9,11,19,.82);border:1px solid rgba(255,255,255,.22);border-radius:12px;cursor:pointer;touch-action:manipulation}',
    'button.pd-btn[aria-pressed=true]{background:rgba(255,200,87,.18);border-color:#ffc857;color:#ffe3a3}',
    'button.pd-btn:active{transform:translateY(1px)}',
    '.pd-msg{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 14px;background:rgba(9,11,19,.9);border:1px solid #ff6b6b;border-radius:10px;font-size:13px;max-width:80vw;z-index:9}',
  ].join('\n');

  /**
   * opts: {title, hint, other: {href, label}, toggles: [{id, on, off, value, change(v)}]}.
   * Returns {setInfo(text)}; the FPS box is updated by S.run / S.advance.
   */
  S.hud = function (opts) {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var top = document.createElement('div');
    top.className = 'pd-top';
    top.innerHTML = '<div class="pd-pill"><b>Демо</b> · ' + opts.title + '</div>';
    var a = document.createElement('a');
    a.className = 'pd-pill';
    a.href = opts.other.href;
    a.textContent = opts.other.label;
    top.appendChild(a);
    document.body.appendChild(top);
    var hint = document.createElement('div');
    hint.className = 'pd-hint';
    hint.textContent = opts.hint || 'тап — идти · драг — сдвиг · щипок / колесо — зум';
    document.body.appendChild(hint);
    var fps = document.createElement('div');
    fps.className = 'pd-fps';
    fps.textContent = 'FPS —';
    document.body.appendChild(fps);
    S.fpsEl = fps;
    var dock = document.createElement('div');
    dock.className = 'pd-dock';
    var acts = document.createElement('div');
    acts.className = 'pd-acts';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'pd-btn pd-act';
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', function () { a.click(b); });
      acts.appendChild(b);
    });
    if (opts.actions) dock.appendChild(acts);
    var bar = document.createElement('div');
    bar.className = 'pd-bar';
    (opts.toggles || []).forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'pd-btn';
      b.type = 'button';
      var set = function (v) { t.value = v; b.textContent = v ? t.on : t.off; b.setAttribute('aria-pressed', v ? 'true' : 'false'); };
      set(t.value);
      b.addEventListener('click', function () { set(!t.value); t.change(t.value); });
      bar.appendChild(b);
    });
    dock.appendChild(bar);
    document.body.appendChild(dock);
    var toast = document.createElement('div');
    toast.className = 'pd-toast';
    document.body.appendChild(toast);
    var toastT = 0;
    S.info = '';
    return {
      setInfo: function (text) { S.info = text; },
      toast: function (text, color) { toast.textContent = text; toast.style.color = color || '#dfe6ff'; toast.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(function () { toast.style.opacity = 0; }, 2200); },
    };
  };

  S.fatal = function (err) {
    var d = document.createElement('div');
    d.className = 'pd-msg';
    d.textContent = 'Ошибка: ' + (err && err.message ? err.message : err);
    document.body.appendChild(d);
    if (window.console) console.error(err);
  };

  /* ---------------------------------------------------- frame loop and stats */

  S.stats = { frames: 0, dtSum: 0, cpuSum: 0, shown: 0 };
  S.paused = false;
  S.advance = function (dt, render, real) {
    if (!S.paused) {
      var sd = dt;
      if (S.slowLeft > 0) { S.slowLeft -= dt; sd = dt * 0.3; S.timeScale = 0.3; } else S.timeScale = 1;
      S.update(sd);
    }
    var t0 = performance.now();
    render(dt);
    var cpu = performance.now() - t0, st = S.stats;
    st.frames++; st.cpuSum += cpu; st.dtSum += dt; st.lastCpu = cpu;
    var now = performance.now();
    if (real && now - st.shown > 500 && S.fpsEl) {
      st.shown = now;
      var ms = st.dtSum / st.frames;
      S.fpsEl.textContent = 'FPS ' + Math.round(1000 / ms) + '\nкадр ' + ms.toFixed(1) + ' мс\nCPU  ' + (st.cpuSum / st.frames).toFixed(1) + ' мс' + (S.info ? '\n' + S.info : '');
      st.frames = 0; st.dtSum = 0; st.cpuSum = 0;
    }
  };

  /** Runs `render(dt)` every animation frame; also window.__step(n, dt) to step by hand (the frame loop sleeps when the page is hidden). */
  S.run = function (render) {
    var last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = now - last;
      last = now;
      if (dt <= 0) return;
      S.advance(Math.min(dt, 100), render, true);
    }
    requestAnimationFrame(frame);
    window.__step = function (n, dt) {
      n = n || 1; dt = dt || 16;
      for (var i = 0; i < n; i++) S.advance(dt, render, false);
      return { time: Math.round(S.time), cpu: S.stats.lastCpu };
    };
  };

  /* ---------------------------------------------------------------- gestures */

  /**
   * One finger: tap(x, y) or drag(x, y, dx, dy) (dragStart(x, y) first); two fingers: pinch(ratio, cx, cy, dcx, dcy);
   * the wheel: pinch too; a mouse moving over the page: hover(x, y).
   */
  S.gestures = function (el, h) {
    var ptrs = new Map(), moved = false, start = null, pd = 0, pc = null, last = null;
    var two = function () { var v = Array.from(ptrs.values()); return { d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1, c: { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 } }; };
    el.addEventListener('pointerdown', function (e) {
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) { moved = false; start = { x: e.clientX, y: e.clientY }; last = { x: e.clientX, y: e.clientY }; if (h.dragStart) h.dragStart(e.clientX, e.clientY); if (h.press) h.press(); }
      else if (ptrs.size === 2) { moved = true; var t = two(); pd = t.d; pc = t.c; }
    });
    el.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) { if (h.hover) h.hover(e.clientX, e.clientY); return; }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) { moved = true; last = { x: start.x, y: start.y }; }
        if (moved) { h.drag(e.clientX, e.clientY, e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY }; }
      } else if (ptrs.size === 2) {
        var t = two();
        h.pinch(t.d / pd, t.c.x, t.c.y, t.c.x - pc.x, t.c.y - pc.y);
        pd = t.d; pc = t.c;
      }
    });
    var up = function (e) {
      if (!ptrs.has(e.pointerId)) return;
      var wasOne = ptrs.size === 1;
      ptrs.delete(e.pointerId);
      if (wasOne && !moved && e.type === 'pointerup') h.tap(e.clientX, e.clientY);
      if (ptrs.size === 1) { var r = Array.from(ptrs.values())[0]; last = { x: r.x, y: r.y }; moved = true; if (h.dragStart) h.dragStart(r.x, r.y); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) { e.preventDefault(); h.pinch(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY, 0, 0); }, { passive: false });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  window.PDScene = S;
})();
