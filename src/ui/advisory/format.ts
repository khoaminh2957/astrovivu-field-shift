/**
 * Number, money and date formatting shared by the advisory and urban screens.
 * Missing values render as `--`, never as zero (DESIGN.md, Typography).
 */
import type { ISODate, Lang } from '@/contracts';
import { getCurrency } from '@/core/economics';

export type CurrencyCode = 'USD' | 'VND';

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  vi: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
};
const MONTHS_LONG: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  vi: Array.from({ length: 12 }, (_, i) => `Tháng ${i + 1}`),
};

/** Short month label, 1-12. Vietnamese uses T1..T12, which is how calendars there print them. */
export const monthShort = (m: number, lang: Lang): string => MONTHS[lang][(((m - 1) % 12) + 12) % 12];
export const monthLong = (m: number, lang: Lang): string => MONTHS_LONG[lang][(((m - 1) % 12) + 12) % 12];

const locale = (lang: Lang) => (lang === 'vi' ? 'vi-VN' : 'en-GB');

export function fmtNum(n: number | null | undefined, lang: Lang, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '--';
  // A true minus sign, as in the signed deltas beside it.
  return new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n).replace('-', '−');
}

/** Signed number with a true minus sign, for deltas against the current rotation. */
export function fmtSigned(n: number | null | undefined, lang: Lang, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '--';
  const r = Number(n.toFixed(digits));
  if (r === 0) return fmtNum(0, lang, digits);
  return `${r > 0 ? '+' : '−'}${fmtNum(Math.abs(r), lang, digits)}`;
}

/** Day-month-year in both languages: `14 Nov 2026` / `14/11/2026`. */
export function fmtDate(t: ISODate | null | undefined, lang: Lang): string {
  if (!t) return '--';
  const [y, m, d] = t.split('-').map(Number);
  return lang === 'vi' ? `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}` : `${d} ${monthShort(m, 'en')} ${y}`;
}

export function fmtDayMonth(t: ISODate, lang: Lang): string {
  const [, m, d] = t.split('-').map(Number);
  return lang === 'vi' ? `${d}/${m}` : `${d} ${monthShort(m, 'en')}`;
}

export interface Money {
  value: string;
  unit: string;
}

/**
 * Money in the chosen currency. VND amounts are large, so `compact` shows millions (`tr` / `M`),
 * which is how Vietnamese farm budgets are usually written.
 */
export function money(usd: number | null | undefined, cur: CurrencyCode, lang: Lang, opts: { compact?: boolean; signed?: boolean } = {}): Money {
  if (usd == null || !Number.isFinite(usd)) return { value: '--', unit: cur === 'USD' ? 'USD' : '₫' };
  const fmt = opts.signed ? fmtSigned : fmtNum;
  if (cur === 'USD') return { value: fmt(usd, lang, 0), unit: 'USD' };
  const vnd = usd * getCurrency('VND').perUsd;
  if (opts.compact) return { value: fmt(vnd / 1e6, lang, Math.abs(vnd) >= 1e8 ? 0 : 1), unit: lang === 'vi' ? 'tr ₫' : 'M ₫' };
  return { value: fmt(Math.round(vnd / 1000) * 1000, lang, 0), unit: '₫' };
}

export const moneyText = (usd: number | null | undefined, cur: CurrencyCode, lang: Lang, opts?: { compact?: boolean; signed?: boolean }): string => {
  const m = money(usd, cur, lang, opts);
  return `${m.value} ${m.unit}`;
};

/** `Sesbania (cover crop)` to `Sesbania`: the name alone, for a block too small to carry the role. */
export const cropNameOnly = (label: string): string => label.replace(/\s*\([^)]*\)\s*$/, '') || label;

/** `Nov-Feb`, or one month name when the season is a single month. */
export const monthSpan = (start: number, end: number, lang: Lang): string => (start === end ? monthShort(start, lang) : `${monthShort(start, lang)}-${monthShort(end, lang)}`);

export const clamp =(v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
