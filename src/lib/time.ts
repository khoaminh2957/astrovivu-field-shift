import type { ISODate } from '@/contracts';

const DAY_MS = 86_400_000;

export const toISO = (d: Date): ISODate => d.toISOString().slice(0, 10);
export const fromISO = (s: ISODate): Date => new Date(`${s}T00:00:00Z`);
export const todayISO = (): ISODate => toISO(new Date());

export const addDays = (s: ISODate, n: number): ISODate => toISO(new Date(fromISO(s).getTime() + n * DAY_MS));

/** Whole days from `b` to `a` (positive when `a` is later). */
export const diffDays = (a: ISODate, b: ISODate): number =>
  Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / DAY_MS);

export function dayOfYear(s: ISODate): number {
  const d = fromISO(s);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY_MS);
}

export function eachDay(start: ISODate, end: ISODate, step = 1): ISODate[] {
  const out: ISODate[] = [];
  for (let t = start; t <= end; t = addDays(t, step)) out.push(t);
  return out;
}

export const clampDate = (t: ISODate, lo: ISODate, hi: ISODate): ISODate => (t < lo ? lo : t > hi ? hi : t);
export const monthOf = (s: ISODate): number => Number(s.slice(5, 7));
