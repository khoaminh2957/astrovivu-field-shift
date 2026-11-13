import { useCallback } from 'react';
import type { Lang } from '@/contracts';
import { useMission } from '@/state/mission';

type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { en: {}, vi: {} };

/**
 * Each UI area registers its own strings under a namespace, in its own file, so parallel work
 * never collides: `registerStrings('hud', { title: 'Field telemetry' }, { title: 'Số liệu thửa ruộng' })`.
 * English is the default language; Vietnamese is one toggle away. Both are mandatory.
 */
export function registerStrings(ns: string, en: Dict, vi: Dict): void {
  for (const [k, v] of Object.entries(en)) dicts.en[`${ns}.${k}`] = v;
  for (const [k, v] of Object.entries(vi)) dicts.vi[`${ns}.${k}`] = v;
}

export function translate(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function useLang(): Lang {
  return useMission((s) => s.lang);
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => translate(key, lang, vars), [lang]);
}
