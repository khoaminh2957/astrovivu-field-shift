/**
 * Pure helpers behind the Urban Grower's pictures: sowing calendar, month order and chart scales.
 * Nothing here invents a value; they only arrange what `recommendUrban` and `UrbanClimate` hold.
 */
import type { UrbanClimateMonth } from '@/contracts';

/** A month is a sowing month when the crop's temperature fit over its growing window reaches this. */
export const SOW_FIT = 0.6;
/** Below the sowing threshold but above this, the crop grows, slowly: shown as a marginal month. */
export const MARGINAL_FIT = 0.3;

export type SowLevel = 'good' | 'marginal' | 'no';

export const sowLevel = (fit: number): SowLevel => (fit >= SOW_FIT ? 'good' : fit >= MARGINAL_FIT ? 'marginal' : 'no');

/**
 * Sowing level of each calendar month, January first. Without per-month fits (older data, fixtures)
 * only the sowing months are known, so nothing is marked marginal.
 */
export function sowLevels(sowMonths: number[], sowFit?: number[]): SowLevel[] {
  return Array.from({ length: 12 }, (_, i) => {
    if (sowMonths.includes(i + 1)) return 'good';
    // `sowMonths` decides what is good: a rounded fit of 0.60 outside it is still marginal.
    return sowFit?.length === 12 && sowFit[i] >= MARGINAL_FIT ? 'marginal' : 'no';
  });
}

/** The next sowing month counting from `month` (1-12): `wait` 0 means this month. Null when there is none. */
export function nextSow(sowMonths: number[], month: number): { month: number; wait: number } | null {
  for (let wait = 0; wait < 12; wait++) {
    const m = ((month - 1 + wait) % 12) + 1;
    if (sowMonths.includes(m)) return { month: m, wait };
  }
  return null;
}

/** The twelve months in order starting at `month`, so a calendar can read "from now". */
export function yearFrom<T extends { month: number }>(items: T[], month: number): T[] {
  const sorted = [...items].sort((a, b) => a.month - b.month);
  const at = sorted.findIndex((x) => x.month >= month);
  return at <= 0 ? sorted : [...sorted.slice(at), ...sorted.slice(0, at)];
}

export interface ClimateScale {
  /** Temperature axis, rounded outwards to 5 °C. */
  tLo: number;
  tHi: number;
  /** Rain axis top, mm per month, rounded up to 50 (at least 50 so a dry place does not look wet). */
  rainMax: number;
  /** Light axis top, MJ/m² per day, or null when no month carries PAR. */
  parMax: number | null;
}

/** Axis ranges for the 12-month climate strip. Bars are drawn against these, never rescaled per month. */
export function climateScale(months: UrbanClimateMonth[]): ClimateScale | null {
  if (!months.length) return null;
  const tLo = Math.floor(Math.min(...months.map((m) => m.tMin)) / 5) * 5;
  const tHi = Math.max(tLo + 5, Math.ceil(Math.max(...months.map((m) => m.tMax)) / 5) * 5);
  const rainMax = Math.max(50, Math.ceil(Math.max(...months.map((m) => m.rainMm)) / 50) * 50);
  const pars = months.map((m) => m.par).filter((p): p is number => p != null);
  return { tLo, tHi, rainMax, parMax: pars.length ? Math.max(1, Math.ceil(Math.max(...pars))) : null };
}
