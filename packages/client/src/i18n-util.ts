import type { ItemKind } from '@pd/core';

/* What both languages' texts share: plural forms, genders, templates, and the choice of the language. */

export function ordinal(n: number): string {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const RU_GENDERS: Partial<Record<ItemKind, 1 | 2>> = { 'weapon.mace': 1, 'weapon.glaive': 1, 'weapon.spear': 2, 'weapon.sai': 2, 'weapon.whip': 2 };

/** The Russian gender of a wearable's name, plural included: «палочка», «кольцо», «доспехи воина». */
export function brokenGender(kind: ItemKind): 0 | 1 | 2 | 3 {
  // (The class armours are «латная броня», «мантия», «одежда» героя, and «плащ».)
  if (kind.startsWith('wand.') || kind === 'armor.mage' || kind === 'armor.rogue' || kind === 'armor.warrior') return 1;
  if (kind.startsWith('ring.')) return 2;
  return RU_GENDERS[kind] ?? 0;
}
/** String.format for Shattered's texts: %s and %d in turn, or %1$d, %2$s by number. */
export function fmt(pattern: string, ...args: Array<string | number>): string {
  let next = 0;
  return pattern.replace(/%(\d+\$)?[sd]/g, (_, n: string | undefined) => String(args[n ? Number(n.slice(0, -1)) - 1 : next++] ?? ''));
}

/** Russian plural forms: 1 день, 2 дня, 5 дней. */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  return ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}


/** The names of the talents' and subclasses' buffs, from Shattered's own texts (i18n-talents.ts). */
export const talentBuffNames = (table: Record<string, string>) => ({
  berserk: table['actors.buffs.berserk.angered']!, berserking: table['actors.buffs.berserk.berserk']!, exhausted: table['actors.buffs.berserk.recovering']!,
  comboChain: table['actors.buffs.combo.name']!, momentum: table['actors.buffs.momentum.momentum']!, freerunning: table['actors.buffs.momentum.running']!,
  preparation: table['actors.buffs.preparation.name']!, sniperMark: table['actors.buffs.snipersmark.name']!, holdFast: table['actors.buffs.holdfast.name']!,
  trackerBlow: table['actors.hero.talent$provokedangertracker.name']!,
  wandEmpower: table['actors.buffs.wandempower.name']!, enhancedRings: table['actors.hero.talent.enhanced_rings.title']!,
  surge: table['actors.hero.talent.strongman.title']!, revealedArea: table['actors.hero.talent.seer_shot.title']!,
  parry: table['actors.buffs.combo$combomove.parry.name']!,
});

/** The artifacts' names, from Shattered's own texts (i18n-artifacts.ts). */
export const artNames = (table: Record<string, string>) => ({
  cloak: table['cloakofshadows.name']!, horn: table['hornofplenty.name']!, chalice: table['chaliceofblood.name']!,
  hourglass: table['timekeepershourglass.name']!, talisman: table['talismanofforesight.name']!, spellbook: table['unstablespellbook.name']!,
  chains: table['etherealchains.name']!, rose: table['driedrose.name']!, armband: table['masterthievesarmband.name']!,
  sandals: table['sandalsofnature.name']!, cape: table['capeofthorns.name']!, toolkit: table['alchemiststoolkit.name']!,
  beacon: table['lloydsbeacon.name']!, sandbag: table['timekeepershourglass$sandbag.name']!, petal: table['driedrose$petal.name']!,
});

export function language(): 'ru' | 'en' {
  const telegram = (globalThis as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } })
    .Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  let chosen: string | null = null;
  try {
    // Chosen in the settings; otherwise as in Telegram, or the browser.
    chosen = localStorage.getItem('pd-lang');
  } catch {
    // Storage blocked: go by Telegram.
  }
  const code = new URLSearchParams(location.search).get('lang') ?? chosen ?? telegram ?? navigator.language ?? 'en';
  return /^(ru|uk|be|kk)/i.test(code) ? 'ru' : 'en';
}

