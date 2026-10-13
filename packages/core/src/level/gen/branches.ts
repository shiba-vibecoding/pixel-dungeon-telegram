import type { GenLevel } from './genlevel';

/*
 * Dungeon.newLevel's branch 1: the quests' side levels — the blacksmith's mine (MiningLevel, depths
 * 11-14) and the vault (VaultLevel, depths 16-19). Their modules register a maker for each depth.
 */
export const BRANCH_LEVELS = new Map<number, () => GenLevel>();
