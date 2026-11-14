/**
 * Thresholds of the atlas, in one place. Pure. Every number here is a proposal documented in
 * docs/CROP_DATA.md; change it here and rebuild.
 */

export const WINDOW = {
  /** Mean of the latest N years that have a value... */
  years: 3,
  /** ...taken from the last M years of the file only, so a series that stopped long ago is not shown as current. */
  span: 10,
} as const;

export interface Mean {
  mean: number;
  yearFrom: number;
  yearTo: number;
  years: number[];
}

/** Mean of the latest `n` years with a value, looking no further back than `minYear`. */
export function latestMean(points: Iterable<readonly [number, number]>, minYear: number, n: number = WINDOW.years): Mean | null {
  const usable = [...points].filter(([y, v]) => y >= minYear && Number.isFinite(v)).sort((a, b) => b[0] - a[0]);
  const top = usable.slice(0, n);
  if (!top.length) return null;
  const years = top.map(([y]) => y).sort((a, b) => a - b);
  return { mean: top.reduce((s, [, v]) => s + v, 0) / top.length, yearFrom: years[0], yearTo: years[years.length - 1], years };
}

export const LEVEL = {
  /** Share of the country's harvested area (all FAOSTAT crop items) from which a crop is `major`. */
  majorPct: 5,
  /** ...and from which it is `common`; below, with any area or production, it is `minor`. */
  commonPct: 0.5,
} as const;

export type Level = 'major' | 'common' | 'minor' | 'present' | 'absent';

/**
 * `present` is used when the source reports production but no harvested area, so no share can be
 * computed; `absent` when both are zero or missing.
 */
export function levelFor(areaHa: number | null, sharePct: number | null, productionT: number | null): Level {
  if (areaHa != null && areaHa > 0 && sharePct != null) {
    if (sharePct >= LEVEL.majorPct) return 'major';
    if (sharePct >= LEVEL.commonPct) return 'common';
    return 'minor';
  }
  if ((productionT ?? 0) > 0 || (areaHa ?? 0) > 0) return 'present';
  return 'absent';
}

export const COMMONNESS = {
  global: { countries: 50, areaHa: 1_000_000 },
  widespread: { countries: 20, areaHa: 100_000 },
  regional: { countries: 5, areaHa: 10_000 },
} as const;

export type Commonness = 'global' | 'widespread' | 'regional' | 'local';

/** Tier of a crop with its own FAOSTAT item, from the number of producing countries and the world harvested area. */
export function commonnessFor(countries: number, worldAreaHa: number): Commonness {
  for (const tier of ['global', 'widespread', 'regional'] as const) {
    if (countries >= COMMONNESS[tier].countries && worldAreaHa >= COMMONNESS[tier].areaHa) return tier;
  }
  return 'local';
}

/** Competition ranking: 1 + the number of entries with a strictly larger value. */
export function rankOf(value: number, all: readonly number[]): number {
  let r = 1;
  for (const v of all) if (v > value) r++;
  return r;
}
