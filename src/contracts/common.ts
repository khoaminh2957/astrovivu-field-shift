/** Shared primitives. Contracts are the single source of truth every layer codes against. */

export type Lang = 'en' | 'vi';

/** Every user-facing string produced by data or model code carries both languages. */
export interface I18nText {
  en: string;
  vi: string;
}

/** Calendar date `YYYY-MM-DD` (UTC). Lexicographic order equals chronological order. */
export type ISODate = string;

/** EcoCrop-style tolerance window: outside abs = 0, inside opt = 1, linear in between. */
export type Quad = [absMin: number, optMin: number, optMax: number, absMax: number];

export function tx(en: string, vi?: string): I18nText {
  return { en, vi: vi ?? en };
}

export function pick(text: I18nText | string | null | undefined, lang: Lang): string {
  if (text == null) return '';
  return typeof text === 'string' ? text : (text[lang] ?? text.en);
}
