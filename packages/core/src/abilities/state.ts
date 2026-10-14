/*
 * What the armour abilities keep on the hero between turns (their trackers): Endure's, the leap's double jump,
 * Nature's Power, the warp beacon and the flavour buffs that last a moment. Times are on the depth's clock
 * (`ctx.floor.now`, or the hero's own `time` while it is their turn).
 */
export interface AbilityState {
  /**
   * Endure.EndureTracker: lasts until `until`. While `enduring` the hero takes half of every blow and stores
   * half again (`damageBonus`); once they act it ends, and the next `hitsLeft` blows hit that much harder.
   */
  endure?: { until: number; enduring: boolean; damageBonus: number; hitsLeft: number };
  /** HeroicLeap.DoubleJumpTracker: the next leap is cheaper until this time. */
  doubleJump?: number;
  /** Talent.StrikingWaveTracker and SpiritBladesTracker: set while a shockwave's or a blade's blow lands. */
  strikingWave?: boolean;
  spiritBlades?: boolean;
  /** WildMagic.WildMagicTracker: the wands are firing wild; the level bonus the shot is rolled (`bonus` of 4 + wild power, halved). */
  wild?: { bonus: number };
  /** NaturesPower.naturesPowerTracker: until, and the extensions left (a kill with Wild Momentum lengthens it). */
  nature?: { until: number; extensionsLeft: number };
  /** DeathMark.DoubleMarkTracker: set at this hero time (it ends when time has passed). */
  doubleMark?: number;
  /** WarpBeacon.WarpBeaconTracker: where the beacon is. */
  beacon?: { depth: number; pos: number };
}
