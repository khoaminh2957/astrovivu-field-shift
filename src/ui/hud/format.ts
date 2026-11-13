/**
 * Display helpers shared by the mission screens (HUD, timeline, override, dock). Pure: they turn
 * contract values into the strings a farmer reads. Nothing here scores or fetches.
 */
import type { ISODate, Lang, SourceRef } from '@/contracts';

export const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  vi: ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'],
};

/** "14 Nov 2026" / "14 Th11 2026": day-month-year in both languages (DESIGN.md, Typography). */
export function fmtDate(t: ISODate | null | undefined, lang: Lang, withYear = true): string {
  if (!t) return '--';
  const [y, m, d] = t.split('-').map(Number);
  return withYear ? `${d} ${MONTHS[lang][m - 1]} ${y}` : `${d} ${MONTHS[lang][m - 1]}`;
}

/** Decimals that suit a unit: volumetric water and indices need two, temperatures one. */
export function digitsFor(unit: string, key?: string): number {
  if (key === 'ndvi' || key === 'evi' || unit === 'm³/m³' || unit === '' || unit === 'σ') return 2;
  if (unit === '%' || unit === 'm' || unit === 'mm') return 0;
  return 1;
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '--';
  // Typographic minus: the hyphen reads as a dash next to monospaced digits.
  return v.toFixed(digits).replace('-', '−');
}

/** Native pixel size, the way the source strings write it: `250 m`, `9 km`. */
export function fmtRes(m: number | null | undefined): string | null {
  if (m == null) return null;
  return m >= 1000 ? `${Math.round(m / 100) / 10} km` : `${Math.round(m)} m`;
}

/** Short dataset name for a provenance line: `SMAP L4 · 9 km`. */
export function sourceLine(src: SourceRef | undefined, extra?: (string | null | undefined)[]): string {
  if (!src) return '';
  return [fmtRes(src.resolutionM), ...(extra ?? [])].filter(Boolean).join(' · ');
}

/** Unit as displayed next to a value; NDVI has no unit but needs a name. */
export function unitFor(unit: string, key: string): string {
  if (key === 'ndvi') return 'NDVI';
  if (key === 'evi') return 'EVI';
  return unit;
}

/** Crop names carry an optional Vietnamese form; fall back to English. */
export const cropName = (names: { en: string; vi?: string }, lang: Lang): string => (lang === 'vi' ? (names.vi ?? names.en) : names.en);
