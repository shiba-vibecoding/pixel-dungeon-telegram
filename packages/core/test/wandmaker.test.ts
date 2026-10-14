import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createWorld, F, floorAt, generateLevel, hasFlag, heroById, LENGTH, type Level,
  levelAt, type Mob, NEIGHBOURS4, NEIGHBOURS8, passable, RoomType, T, WIDTH, type World,
} from '../src/index';
import { forceWandmakerType, WANDMAKER_WANTS, type WandmakerType } from '../src/wandmaker';
import { MassGraveRoom, RitualSiteRoom, RotGardenRoom } from '../src/level/gen/rooms/quest/wandmaker-rooms';
import { DoorType } from '../src/level/gen/room';
import { paintRoomAlone } from './levelgen-helpers';

/** Each errand's room, by Wandmaker.Quest.type. */
const ROOMS: Record<WandmakerType, string> = { 1: 'MassGraveRoom', 2: 'RitualSiteRoom', 3: 'RotGardenRoom' };

/** A run whose wandmaker's errand is `type`, his level made (depth 6, the first prison level, as the type is chosen already). */
function questWorld(type: WandmakerType, seed = 1): { world: World; depth: number; wandmaker: Mob } {
  const world = createWorld(seed);
  forceWandmakerType(world, type);
  for (let d = 1; d <= 6; d++) levelAt(world, d);
  const quest = world.wandQuest!;
  expect(quest.spawned).toBe(true);
  const floor = floorAt(world, quest.depth);
  const wandmaker = floor.mobs.find((m) => m.kind === 'wandmaker')!;
  floor.respawn = 1e9;
  addHero(world, { id: 'p', name: 'Pat', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  hero.depth = quest.depth;
  hero.time = floor.now;
  Object.assign(hero, { hp: 500, ht: 500 });
  hero.pos = beside(world, quest.depth, wandmaker.pos);
  return { world, depth: quest.depth, wandmaker };
}

/** A free cell next to `pos`. */
function beside(world: World, depth: number, pos: number): number {
  const level = levelAt(world, depth);
  return NEIGHBOURS8.map((n) => pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
}

/** Cells a hero can eventually walk through: locked doors open with their key, barricades (and bookshelves) burn, secrets are found. */
function walkable(level: Level): boolean[] {
  const open = passable(level.map);
  return level.map.map((t, i) => open[i]! || t === T.SECRET_DOOR || t === T.LOCKED_DOOR || t === T.CRYSTAL_DOOR || t === T.BARRICADE || t === T.BOOKSHELF ||
    t === T.CHASM || (hasFlag(t, F.AVOID) && !hasFlag(t, F.PIT)));
}

function reachable(level: Level, from: number): boolean[] {
  const ok = walkable(level);
  const seen = new Array<boolean>(LENGTH).fill(false);
  seen[from] = true;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const n of NEIGHBOURS8) {
      const next = queue[head]! + n;
      if (next >= 0 && next < LENGTH && !seen[next] && ok[next]) {
        seen[next] = true;
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('the old wandmaker (Wandmaker, Wandmaker.Quest)', () => {
  it('appears once a run, on depth 7, 8 or 9 (always by 9), in the entrance room, with his room and two different wands', () => {
    const depths = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const world = createWorld(seed);
      for (let d = 1; d <= 9; d++) levelAt(world, d);
      const quest = world.wandQuest!;
      expect(quest?.spawned, `seed ${seed}`).toBe(true);
      expect(quest.depth).toBeGreaterThanOrEqual(7);
      depths.add(quest.depth);
      for (let d = 1; d <= 9; d++) {
        const makers = floorAt(world, d).mobs.filter((m) => m.kind === 'wandmaker');
        expect(makers.length, `depth ${d}`).toBe(d === quest.depth ? 1 : 0);
      }
      const level = levelAt(world, quest.depth);
      const wandmaker = floorAt(world, quest.depth).mobs.find((m) => m.kind === 'wandmaker')!;
      const entrance = level.rooms.find((r) => r.type === RoomType.ENTRANCE)!;
      const x = wandmaker.pos % WIDTH;
      const y = Math.trunc(wandmaker.pos / WIDTH);
      expect(x > entrance.left && x < entrance.right && y > entrance.top && y < entrance.bottom).toBe(true);
      expect(wandmaker.pos).not.toBe(level.entrance);
      expect(wandmaker.state).toBe('passive');
      for (const n of NEIGHBOURS4) expect(level.map[wandmaker.pos + n]).not.toBe(T.DOOR);
      // His errand's room is on his level, and on no other.
      for (let d = 6; d <= 9; d++) {
        expect(levelAt(world, d).rooms.some((r) => r.kind === ROOMS[quest.type]), `depth ${d}`).toBe(d === quest.depth);
      }
      expect(quest.wand1!.kind.startsWith('wand.')).toBe(true);
      expect(quest.wand2!.kind.startsWith('wand.')).toBe(true);
      expect(quest.wand1!.kind).not.toBe(quest.wand2!.kind);
      for (const wand of [quest.wand1!, quest.wand2!]) {
        expect(wand.level).toBeGreaterThanOrEqual(1);
        expect(wand.cursed).toBeFalsy();
      }
    }
    expect([...depths].sort()).toEqual([7, 8, 9]);
  });
});

describe('talking to him, and his reward (WndWandmaker)', () => {
  for (const type of [1, 2, 3] as const) {
    it(`tells his errand once (${ROOMS[type]}), then reminds; for the ${WANDMAKER_WANTS[type]}, gives the wand chosen and is gone`, () => {
      const { world, depth, wandmaker } = questWorld(type);
      const floor = floorAt(world, depth);
      floor.mobs = [wandmaker];
      const hero = heroById(world, 'p')!;
      const quest = world.wandQuest!;
      const talk = () => act(world, 'p', { type: 'attack', target: wandmaker.id });
      const intro = talk();
      expect(intro.ok && intro.effects).toEqual([{ type: 'wandmaker', hero: 'p', line: 'intro', questType: type }]);
      expect(quest.given).toBe(true);
      expect(wandmaker.hp).toBe(wandmaker.ht);
      const again = talk();
      expect(again.ok && again.effects).toEqual([{ type: 'wandmaker', hero: 'p', line: 'reminder', questType: type }]);
      expect(act(world, 'p', { type: 'wandReward', choice: 1 })).toEqual({ ok: false, reason: 'nothing to give' });

      hero.items.push(createItem(WANDMAKER_WANTS[type]));
      const offer = talk();
      expect(offer.ok && offer.effects).toEqual([{ type: 'wandmaker', hero: 'p', line: 'reward', questType: type }]);
      expect(act(world, 'p', { type: 'wandReward', choice: 3 as never })).toEqual({ ok: false, reason: 'bad choice' });
      const wand = quest.wand2!;
      const given = act(world, 'p', { type: 'wandReward', choice: 2 });
      expect(given.ok && given.effects).toContainEqual({ type: 'wandmaker', hero: 'p', line: 'farewell', questType: type });
      expect(hero.items.some((i) => i.kind === wand.kind && i.level === wand.level)).toBe(true);
      expect(hero.items.some((i) => i.kind === WANDMAKER_WANTS[type])).toBe(false);
      expect(world.known).toContain(wand.kind);
      expect(floor.mobs.some((m) => m.kind === 'wandmaker')).toBe(false);
      expect(quest.wand1).toBeNull();
      // Quest.complete scores the dust's errand; the others score as their foe falls.
      expect(world.questScores?.[1] ?? 0).toBe(type === 1 ? 2000 : 0);
      expect(act(world, 'p', { type: 'wandReward', choice: 1 })).toEqual({ ok: false, reason: 'nothing to give' });
    });
  }
});

describe('the corpse dust (MassGraveRoom, CorpseDust)', () => {
  it('lies in haunted remains in a barricaded grave, with one or two skeletons and a potion of liquid flame about the level', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { level, room } = paintRoomAlone(() => new MassGraveRoom(), 7, ['bottom'], seed);
      expect(room.doors()[0]!.type).toBe(DoorType.BARRICADE);
      expect(level.itemsToSpawn.map((i) => i.kind)).toContain('potion.liquidFlame');
      const heaps = [...level.heaps.values()];
      expect(heaps.every((h) => h.kind === 'skeleton' && Math.trunc(h.pos / level.width) <= room.top + 5)).toBe(true);
      const dust = heaps.filter((h) => h.items.some((i) => i.kind === 'quest.dust'));
      expect(dust).toHaveLength(1);
      expect(dust[0]!.haunted).toBe(true);
      expect(heaps.flatMap((h) => h.items).filter((i) => i.kind === 'gold').length).toBeGreaterThanOrEqual(2);
      const skeletons = level.mobs.filter((m) => m.kind === 'skeleton');
      expect(skeletons.length).toBeGreaterThanOrEqual(1);
      expect(skeletons.length).toBeLessThanOrEqual(2);
      expect(skeletons.every((m) => Math.trunc(m.pos / level.width) <= room.top + 3)).toBe(true);
      expect(level.customTiles.map((c) => c.kind)).toContain('MassGraveRoom$MassGraveDeco');
    }
  });

  it('cannot be dropped; its curse raises wraiths round its carrier until he takes it, when they all fall', () => {
    const { world, depth, wandmaker } = questWorld(1);
    const floor = floorAt(world, depth);
    floor.mobs = [wandmaker];
    const hero = heroById(world, 'p')!;
    const quest = world.wandQuest!;
    const heap = floor.heaps.find((h) => h.items.some((i) => i.kind === 'quest.dust'))!;
    expect(heap.kind).toBe('skeleton');
    hero.pos = heap.pos;
    const picked = act(world, 'p', { type: 'pickup' });
    expect(picked.ok && picked.effects).toContainEqual({ type: 'corpseDust', hero: 'p' });
    const slot = hero.items.findIndex((i) => i.kind === 'quest.dust');
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(quest.spawners?.p).toBe(0);
    expect(act(world, 'p', { type: 'drop', item: slot })).toEqual({ ok: false, reason: 'you cannot drop that' });
    expect(act(world, 'p', { type: 'throw', item: slot, target: hero.pos + 1 }).ok).toBe(false);

    // The curse at work: wraiths rise, out of reach, ever more slowly (1, 4, 9 ... turns of power).
    Object.assign(hero, { hp: 5000, ht: 5000 });
    let risen = 0;
    for (let i = 0; i < 40; i++) {
      const r = act(world, 'p', { type: 'wait' });
      if (r.ok) risen += r.effects.filter((e) => e.type === 'dustWraith').length;
    }
    const wraiths = floor.mobs.filter((m) => m.dust !== undefined);
    expect(risen).toBeGreaterThanOrEqual(2);
    expect(wraiths.length).toBeGreaterThanOrEqual(1);
    expect(wraiths.every((m) => m.kind === 'wraith')).toBe(true);

    // Back to the wandmaker with it: the curse is lifted and the wraiths fall.
    hero.pos = beside(world, depth, wandmaker.pos);
    act(world, 'p', { type: 'attack', target: wandmaker.id });
    const given = act(world, 'p', { type: 'wandReward', choice: 1 });
    expect(given.ok).toBe(true);
    expect(floor.mobs.some((m) => m.dust !== undefined)).toBe(false);
    expect(quest.spawners?.p).toBeUndefined();
  });
});

describe('the embers (RitualSiteRoom, CeremonialCandle, Elemental.NewbornFireElemental)', () => {
  it('a 10x10 room of cages and tables round a ritual marker, four candles about the level', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { level, room } = paintRoomAlone(() => new RitualSiteRoom(), 7, ['left', 'right'], seed);
      const site = room as RitualSiteRoom;
      expect(room.width()).toBe(10);
      expect(room.height()).toBe(10);
      const c = site.ritualPoint!;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) expect(level.map[c.x + dx + (c.y + dy) * level.width]).toBe(T.CUSTOM_DECO_EMPTY);
      }
      expect(level.itemsToSpawn.filter((i) => i.kind === 'quest.candle')).toHaveLength(4);
      expect(level.customTiles.map((t) => t.kind)).toContain('RitualSiteRoom$RitualMarker');
      for (const x of [room.left + 3, room.left + 6]) {
        expect(level.map[x + (room.top + 1) * level.width]).toBe(T.WALL);
        expect(level.map[x + (room.top + 2) * level.width]).toBe(T.WALL);
      }
      // Its cages, and nothing put next to the marker's middle.
      expect(level.map.filter((t) => t === T.REGION_DECO).length).toBeGreaterThanOrEqual(2);
      expect(room.canPlaceItem(c, level)).toBe(false);
      expect(room.canPlaceCharacter(c.clone().offset(1, 1), level)).toBe(false);
    }
  });

  it('four candles round the marker summon the newborn elemental, which charges blasts of fire, fears the cold and leaves its embers', () => {
    const { world, depth, wandmaker } = questWorld(2);
    const floor = floorAt(world, depth);
    floor.mobs = [wandmaker];
    const level = levelAt(world, depth);
    const hero = heroById(world, 'p')!;
    const quest = world.wandQuest!;
    const ritual = quest.ritualPos!;
    expect(level.map[ritual]).toBe(T.CUSTOM_DECO_EMPTY);
    expect(floor.heaps.flatMap((h) => h.items).filter((i) => i.kind === 'quest.candle').reduce((n, i) => n + i.qty, 0)).toBe(4);

    const spots = [ritual - WIDTH, ritual + 1, ritual + WIDTH, ritual - 1];
    let elemental: Mob | undefined;
    spots.forEach((spot, i) => {
      hero.items.push(createItem('quest.candle'));
      hero.pos = spot;
      const r = act(world, 'p', { type: 'drop', item: hero.items.length - 1 });
      expect(r.ok).toBe(true);
      elemental = floor.mobs.find((m) => m.kind === 'newbornElemental');
      expect(!!elemental, `after ${i + 1} candles`).toBe(i === 3);
      if (r.ok) expect(r.effects.some((e) => e.type === 'ritual')).toBe(true);
    });
    expect(elemental!.state).toBe('hunting');
    expect(elemental!.pos).toBe(ritual);
    for (const spot of spots) expect(floor.heaps.some((h) => h.pos === spot && h.items.some((i) => i.kind === 'quest.candle'))).toBe(false);

    // A blast charged up, then let go round the hero.
    hero.pos = ritual + 3;
    elemental!.rangedCooldown = 0;
    const seen: string[] = [];
    for (let i = 0; i < 12 && !seen.includes('elementalBlast'); i++) {
      const r = act(world, 'p', { type: 'wait' });
      if (r.ok) seen.push(...r.effects.map((e) => e.type));
    }
    expect(seen).toContain('elementalCharge');
    expect(seen).toContain('elementalBlast');
    expect(seen.indexOf('elementalCharge')).toBeLessThan(seen.indexOf('elementalBlast'));

    // The cold hurts it badly, and does not freeze it.
    elemental!.hp = elemental!.ht;
    const hp = elemental!.hp;
    hero.pos = ritual + 3;
    hero.items.push(createItem('potion.frost'));
    act(world, 'p', { type: 'throw', item: hero.items.length - 1, target: elemental!.pos });
    expect(elemental!.hp).toBeLessThanOrEqual(hp - 30);
    expect(elemental!.paralysed ?? 0).toBe(0);

    // Slain, it leaves its embers (and 2000 points to the quest).
    const before = world.questScores?.[1] ?? 0;
    Object.assign(hero, { attackSkill: 1000 });
    elemental!.hp = 1;
    for (let i = 0; i < 20 && floor.mobs.includes(elemental!); i++) {
      if (!NEIGHBOURS8.some((n) => hero.pos + n === elemental!.pos)) hero.pos = beside(world, depth, elemental!.pos);
      act(world, 'p', { type: 'attack', target: elemental!.id });
    }
    expect(floor.mobs.includes(elemental!)).toBe(false);
    expect(floor.heaps.some((h) => h.pos === elemental!.pos && h.items.some((i) => i.kind === 'quest.embers'))).toBe(true);
    expect((world.questScores?.[1] ?? 0) - before).toBe(2000);
  });
});

describe('the rotberry seed (RotGardenRoom, RotHeart, RotLasher)', () => {
  it('a locked garden of tall grass, the heart well inside, up to six lashers that always leave a safe way to it', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { level, room } = paintRoomAlone(() => new RotGardenRoom(), 7, ['left'], seed);
      const door = room.doors()[0]!;
      expect(door.type).toBe(DoorType.LOCKED);
      expect(level.itemsToSpawn.some((i) => i.kind === 'key.iron' && i.depth === 7)).toBe(true);
      const hearts = level.mobs.filter((m) => m.kind === 'rotHeart');
      const lashers = level.mobs.filter((m) => m.kind === 'rotLasher');
      expect(hearts).toHaveLength(1);
      expect(lashers.length).toBeLessThanOrEqual(6);
      for (const m of [...hearts, ...lashers]) expect(level.map[m.pos]).toBe(T.GRASS);
      const heart = hearts[0]!.pos;
      // The lashers' reach (their sides; all round them near the heart) leaves a way from the door to the heart.
      const blocked = new Set<number>();
      for (const l of lashers) {
        blocked.add(l.pos);
        for (const n of level.distance(l.pos, heart) > 2 ? level.neighbours4 : level.neighbours8) blocked.add(l.pos + n);
      }
      const from = level.pointToCell(door);
      const seen = new Set([from]);
      const queue = [from];
      for (let head = 0; head < queue.length; head++) {
        for (const n of level.neighbours8) {
          const next = queue[head]! + n;
          if (!seen.has(next) && level.map[next] !== T.WALL && !blocked.has(next) && room.inside(level.cellToPoint(next))) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(seen.has(heart), `seed ${seed}`).toBe(true);
      expect(level.distance(from, heart)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the heart lets out gas when struck (the plants do not mind), burns away at a touch of fire, and slain leaves the seed', () => {
    const { world, depth, wandmaker } = questWorld(3);
    const floor = floorAt(world, depth);
    const heart = floor.mobs.find((m) => m.kind === 'rotHeart')!;
    const lashers = floor.mobs.filter((m) => m.kind === 'rotLasher');
    expect(heart.state).not.toBe('passive');
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { attackSkill: 1000 });
    floor.mobs = [wandmaker, heart];
    hero.pos = beside(world, depth, heart.pos);
    const struck = act(world, 'p', { type: 'attack', target: heart.id });
    // Its evasion is nothing: every blow lands (its bark may take it all).
    expect(struck.ok && struck.effects).toContainEqual(expect.objectContaining({ type: 'attack', target: heart.id, hit: true }));
    expect(floor.gas?.toxic?.length ?? 0).toBeGreaterThan(0);
    // It never moves, never strikes back, and breathes its own gas unharmed.
    const pos = heart.pos;
    const after = heart.hp;
    hero.pos = beside(world, depth, wandmaker.pos);
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(heart.pos).toBe(pos);
    expect(heart.hp).toBe(after);

    // Burnt, it is simply gone, its lashers with it, and no seed.
    const burnt = structuredClone(world);
    const bfloor = floorAt(burnt, depth);
    bfloor.mobs.push(...structuredClone(lashers));
    bfloor.mobs.find((m) => m.kind === 'rotHeart')!.burning = 5;
    for (let i = 0; i < 4; i++) act(burnt, 'p', { type: 'wait' });
    expect(bfloor.mobs.some((m) => m.kind === 'rotHeart' || m.kind === 'rotLasher')).toBe(false);
    expect(bfloor.heaps.some((h) => h.items.some((i) => i.kind === 'seed.rotberry'))).toBe(false);

    // Slain, its lashers die with it and it leaves the seed (2000 points to the quest).
    floor.mobs.push(...lashers);
    heart.hp = 1;
    hero.pos = beside(world, depth, heart.pos);
    const before = world.questScores?.[1] ?? 0;
    // (Its bark may take a blow: strike until it falls.)
    for (let i = 0; i < 20 && floor.mobs.includes(heart); i++) act(world, 'p', { type: 'attack', target: heart.id });
    expect(floor.mobs.some((m) => m.kind === 'rotHeart' || m.kind === 'rotLasher')).toBe(false);
    expect(floor.heaps.some((h) => h.pos === heart.pos && h.items.some((i) => i.kind === 'seed.rotberry'))).toBe(true);
    expect((world.questScores?.[1] ?? 0) - before).toBe(2000);
  });

  it('a lasher lashes out at whoever is beside it (crippling, and costing the quest), and mends with nobody near', () => {
    const { world, depth, wandmaker } = questWorld(3);
    const floor = floorAt(world, depth);
    const lasher = floor.mobs.find((m) => m.kind === 'rotLasher')!;
    expect(lasher).toBeDefined();
    floor.mobs = [wandmaker, lasher];
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { defenseSkill: 0 });
    const pos = lasher.pos;
    hero.pos = beside(world, depth, lasher.pos);
    let lashed = 0;
    let crippled = false;
    for (let i = 0; i < 6; i++) {
      const r = act(world, 'p', { type: 'wait' });
      if (r.ok) lashed += r.effects.filter((e) => e.type === 'attack' && e.attacker === lasher.id).length;
      crippled ||= hero.crippled > 0;
    }
    expect(lasher.state).toBe('hunting');
    expect(lashed).toBeGreaterThan(0);
    expect(crippled).toBe(true);
    expect(lasher.pos).toBe(pos);
    expect(world.questScores?.[1]).toBe(-100 * lashed);
    // Away from it, it waits again, and mends.
    hero.pos = beside(world, depth, wandmaker.pos);
    lasher.hp = 50;
    for (let i = 0; i < 3; i++) act(world, 'p', { type: 'wait' });
    expect(lasher.hp).toBeGreaterThan(50);
    expect(lasher.state).toBe('wandering');
  });
});

describe('prison levels with his rooms', () => {
  it('stay whole: every walkable cell reachable from the entrance, his room and him there', () => {
    for (const type of [1, 2, 3] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        const world = createWorld(seed * 31 + type);
        forceWandmakerType(world, type);
        const level = generateLevel(world.run, 7, undefined, false, world);
        const where = `type ${type} seed ${seed}`;
        expect(level.rooms.filter((r) => r.kind === ROOMS[type]), where).toHaveLength(1);
        expect(level.spawn!.mobs.filter((m) => m.kind === 'wandmaker'), where).toHaveLength(1);
        if (type === 2) {
          const ritual = world.wandQuest!.ritualPos!;
          const site = level.rooms.find((r) => r.kind === 'RitualSiteRoom')!;
          expect(ritual % WIDTH > site.left && ritual % WIDTH < site.right, where).toBe(true);
          expect(level.map[ritual], where).toBe(T.CUSTOM_DECO_EMPTY);
        }
        const seen = reachable(level, level.entrance);
        const ok = walkable(level);
        const lost = ok.flatMap((w, i) => (w && !seen[i] && level.map[i] !== T.CHASM ? [i] : []));
        expect(seen[level.exit], where).toBe(true);
        expect(lost, where).toEqual([]);
      }
    }
  });
});
