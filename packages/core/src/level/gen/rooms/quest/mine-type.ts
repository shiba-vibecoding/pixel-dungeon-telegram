import { Dungeon } from '../../dungeon';

/*
 * Blacksmith.Quest.Type() as the mine's rooms read it while the mine is made: 1 crystal, 2 gnoll,
 * 3 fungi; 0 (no quest) paints plain caves. Tests without a world may force a type.
 */

export const CRYSTAL = 1;
export const GNOLL = 2;
export const FUNGI = 3;

export const MineGen = {
  /** A type for levels made without a world (tests); null: the world's quest decides. */
  forced: null as number | null,
};

export function mineQuestType(): number {
  return MineGen.forced ?? Dungeon.world?.smithQuest?.type ?? 0;
}
