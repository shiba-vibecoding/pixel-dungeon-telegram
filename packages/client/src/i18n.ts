import { capitalize, fmt, language } from './i18n-util';
import type { Strings } from './i18n-en';

/*
 * Interface text in Russian and English; the language follows Telegram or the browser. The texts of each language are a chunk of their own
 * (i18n-en.ts, i18n-ru.ts, and the tables of Shattered's own words beside them): only the language shown is fetched, and the page waits
 * for it here, before anything that says a word starts.
 */

export const lang = language();
const loaded = lang === 'ru' ? await import('./i18n-ru') : await import('./i18n-en');
export const t: Strings = 'ru' in loaded ? loaded.ru : loaded.en;
/** Shattered's own texts, keyed as there (the artifacts, abilities, classes, talents and levels), in the language shown. */
export const tables = loaded.tables;
/** For dates and numbers in the language of the text around them. */
export const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
if (typeof document !== 'undefined') document.documentElement.lang = lang;
export { capitalize, fmt };

/** Messages.format: a Shattered template's %s, %d, %.1f and %1$d filled in order (or by number), %% a percent sign. */
export function fill(template: string, ...args: Array<string | number>): string {
  let next = 0;
  return template.replace(/%(?:(\d+)\$)?([-0-9.]*)([sdf%])/g, (_whole, at: string | undefined, _flags: string, conv: string) => {
    if (conv === '%') return '%';
    const value = args[at ? Number(at) - 1 : next++];
    if (value === undefined) return '';
    if (conv === 'd' && typeof value === 'number') return String(Math.trunc(value));
    return String(value);
  });
}
