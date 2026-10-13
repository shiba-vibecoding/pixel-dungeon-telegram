/*
 * Shattered's traps (levels/traps/*) as data: what each looks like and how it may be placed.
 * What each one does is in traps.ts.
 */

export type TrapKind =
  | 'alarm' | 'blazing' | 'burning' | 'chilling' | 'confusion' | 'corrosion' | 'cursing' | 'disarming' | 'disintegration'
  | 'distortion' | 'explosive' | 'flashing' | 'flock' | 'frost' | 'gateway' | 'geyser' | 'gnollRockfall' | 'grim' | 'gripping'
  | 'guardian' | 'ooze' | 'pitfall' | 'poisonDart' | 'rockfall' | 'shocking' | 'storm' | 'summoning' | 'teleportation'
  | 'tenguDart' | 'toxic' | 'warping' | 'weakening' | 'wornDart';

/** Trap colours (Trap.RED ... Trap.BLACK): the column in terrain_features.png. */
export const TRAP_COLOR = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3, TEAL: 4, VIOLET: 5, WHITE: 6, GREY: 7, BLACK: 8 } as const;
/** Trap shapes (Trap.DOTS ... Trap.LARGE_DOT): the row in terrain_features.png. */
export const TRAP_SHAPE = { DOTS: 0, WAVES: 1, GRILL: 2, STARS: 3, DIAMOND: 4, CROSSHAIR: 5, LARGE_DOT: 6 } as const;

export interface TrapDef {
  color: number;
  shape: number;
  /** Trap.canBeHidden: false for traps that always lie in plain sight. */
  canBeHidden: boolean;
  /** Trap.canBeSearched: false for Tengu's darts, which no search finds. */
  canBeSearched: boolean;
  /** Trap.avoidsClosedSpaces: placed in the open rather than in corridors. */
  avoidsClosedSpaces: boolean;
  /** Trap.disarmedByActivation: false for traps that go on working after they are set off. */
  disarmedByActivation: boolean;
}

const { RED, ORANGE, YELLOW, GREEN, TEAL, VIOLET, WHITE, GREY } = TRAP_COLOR;
const { DOTS, WAVES, GRILL, STARS, DIAMOND, CROSSHAIR, LARGE_DOT } = TRAP_SHAPE;

const def = (color: number, shape: number, extra: Partial<TrapDef> = {}): TrapDef => ({
  color, shape, canBeHidden: true, canBeSearched: true, avoidsClosedSpaces: false, disarmedByActivation: true, ...extra,
});
const inSight = { canBeHidden: false, avoidsClosedSpaces: true };

export const TRAPS: Readonly<Record<TrapKind, TrapDef>> = {
  alarm: def(RED, DOTS),
  blazing: def(ORANGE, STARS),
  burning: def(ORANGE, DOTS),
  chilling: def(WHITE, DOTS),
  confusion: def(TEAL, GRILL),
  corrosion: def(GREY, GRILL),
  cursing: def(VIOLET, WAVES),
  disarming: def(RED, LARGE_DOT),
  disintegration: def(VIOLET, CROSSHAIR, inSight),
  distortion: def(TEAL, LARGE_DOT),
  explosive: def(ORANGE, DIAMOND),
  flashing: def(GREY, STARS, { disarmedByActivation: false, avoidsClosedSpaces: true }),
  flock: def(WHITE, WAVES),
  frost: def(WHITE, STARS),
  gateway: def(TEAL, CROSSHAIR, { disarmedByActivation: false, avoidsClosedSpaces: true }),
  geyser: def(TEAL, DIAMOND),
  // GnollRockfallTrap extends RockfallTrap.
  gnollRockfall: def(GREY, DIAMOND, inSight),
  grim: def(GREY, LARGE_DOT, inSight),
  gripping: def(GREY, DOTS, { disarmedByActivation: false, avoidsClosedSpaces: true }),
  guardian: def(RED, STARS),
  ooze: def(GREEN, DOTS),
  pitfall: def(RED, DIAMOND),
  poisonDart: def(GREEN, CROSSHAIR, inSight),
  rockfall: def(GREY, DIAMOND, inSight),
  shocking: def(YELLOW, DOTS),
  storm: def(YELLOW, STARS),
  summoning: def(TEAL, WAVES),
  teleportation: def(TEAL, DOTS),
  // TenguDartTrap extends PoisonDartTrap, but hides, and no search finds it.
  tenguDart: def(GREEN, CROSSHAIR, { avoidsClosedSpaces: true, canBeSearched: false }),
  toxic: def(GREEN, GRILL),
  warping: def(TEAL, STARS),
  weakening: def(GREEN, WAVES),
  wornDart: def(GREY, CROSSHAIR, inSight),
};

/** A trap as it lies on a level (Trap: pos, visible, active). */
export interface TrapInfo {
  pos: number;
  kind: TrapKind;
  visible: boolean;
  active: boolean;
  /** GatewayTrap.telePos: where it sends everything, once it has first sent someone or something away. */
  telePos?: number;
  /** PitfallTrap.DelayedPit: the cells that give way at `at` (the depth's clock), a turn after it went off. */
  pit?: { at: number; cells: number[] };
}

/** The index of a trap's picture in terrain_features.png: its colour (black once spent) and shape. */
export const trapVisual = (trap: TrapInfo): number => (trap.active ? TRAPS[trap.kind].color : TRAP_COLOR.BLACK) + TRAPS[trap.kind].shape * 16;
