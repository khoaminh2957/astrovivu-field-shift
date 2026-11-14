/**
 * Season planner model: the farmer's year as seasons, each with one or more crops and an optional
 * sowing date. Converts to and from `GroundTruth.currentRotation` (one entry per crop, crops of one
 * season sharing a `season` number) and picks the season that is running now, whose first crop
 * becomes the field's crop.
 */
import type { CropProfile, GroundTruth, ISODate } from '@/contracts';

export type RotationEntry = NonNullable<GroundTruth['currentRotation']>[number];

export interface SeasonRow {
  start: number;
  end: number;
  crops: string[];
  sowingDate?: ISODate;
}

export type SeasonName = 'dx' | 'ht' | 'td' | 'spring' | 'autumn' | 'year' | 'custom';

export const wrap = (m: number): number => ((((m - 1) % 12) + 12) % 12) + 1;

export function monthsOf(start: number, end: number): number[] {
  const len = ((end - start + 12) % 12) + 1;
  return Array.from({ length: len }, (_, k) => wrap(start + k));
}

/** Months a crop occupies the field: the mean of its cycle for annuals, the whole year otherwise. */
export function cropMonths(crop: CropProfile | undefined): number {
  if (!crop) return 4;
  if (crop.lifeSpan !== 'annual') return 12;
  const days = (crop.cycleDays[0] + crop.cycleDays[1]) / 2;
  return Math.min(11, Math.max(2, Math.round(days / 30.4)));
}

const monthOfDate = (d?: ISODate) => (d ? Number(d.slice(5, 7)) : NaN);

/** Rows from the stored rotation; without one, a single season from the field's crop and sowing date. */
export function rowsFromRotation(rot: RotationEntry[] | undefined, fallback: { crop?: CropProfile; sowingDate?: ISODate; month: number }): SeasonRow[] {
  if (rot?.length) {
    const rows: SeasonRow[] = [];
    const bySeason = new Map<number, SeasonRow>();
    for (const e of rot) {
      if (e.cropId === 'fallow') continue;
      const existing = e.season != null ? bySeason.get(e.season) : undefined;
      if (existing) {
        if (!existing.crops.includes(e.cropId)) existing.crops.push(e.cropId);
        existing.sowingDate ??= e.sowingDate;
        continue;
      }
      const row: SeasonRow = { start: e.startMonth, end: e.endMonth, crops: [e.cropId], ...(e.sowingDate ? { sowingDate: e.sowingDate } : {}) };
      rows.push(row);
      if (e.season != null) bySeason.set(e.season, row);
    }
    return rows;
  }
  const { crop, sowingDate, month } = fallback;
  if (!crop) return [];
  const len = cropMonths(crop);
  const sm = monthOfDate(sowingDate);
  const start = len === 12 ? 1 : Number.isFinite(sm) ? sm : month;
  return [{ start, end: wrap(start + len - 1), crops: [crop.id], ...(sowingDate ? { sowingDate } : {}) }];
}

/** One entry per crop; crops of one season share its 1-based number. Seasons without crops are left out. */
export function rotationFromRows(rows: SeasonRow[]): RotationEntry[] {
  const out: RotationEntry[] = [];
  rows.forEach((r, i) => {
    for (const cropId of r.crops) {
      out.push({ cropId, startMonth: r.start, endMonth: r.end, season: i + 1, ...(r.sowingDate ? { sowingDate: r.sowingDate } : {}) });
    }
  });
  return out;
}

/** Year of each row, as the advisory reads it: a season overlapping an earlier one is the next year. */
export function rowYears(rows: SeasonRow[]): number[] {
  const years: number[] = [];
  rows.forEach((r, i) => {
    const ms = monthsOf(r.start, r.end);
    let y = i === 0 ? 0 : years[i - 1];
    while (rows.some((q, j) => j < i && years[j] === y && monthsOf(q.start, q.end).some((m) => ms.includes(m)))) y++;
    years.push(y);
  });
  return years;
}

/** The season of the first year running in `month`, else the next one to start; -1 when there is none with a crop. */
export function activeRow(rows: SeasonRow[], month: number): number {
  const years = rowYears(rows);
  const cand = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => years[i] === 0 && r.crops.length > 0);
  const now = cand.find(({ r }) => monthsOf(r.start, r.end).includes(month));
  if (now) return now.i;
  let best = -1;
  let bestGap = 99;
  for (const { r, i } of cand) {
    const gap = (r.start - month + 12) % 12;
    if (gap < bestGap) (bestGap = gap), (best = i);
  }
  return best;
}

/** A name from the months alone; the Vietnamese season names are used in the tropics. */
export function seasonName(r: SeasonRow, tropical: boolean): SeasonName {
  if (monthsOf(r.start, r.end).length === 12) return 'year';
  if (tropical) {
    if ([10, 11, 12, 1].includes(r.start)) return 'dx';
    if ([2, 3, 4, 5].includes(r.start)) return 'ht';
    return 'td';
  }
  if ([2, 3, 4, 5, 6].includes(r.start)) return 'spring';
  if ([7, 8, 9, 10, 11].includes(r.start)) return 'autumn';
  return 'custom';
}

export function presets(tropical: boolean): { name: SeasonName; start: number; end: number }[] {
  return tropical
    ? [
        { name: 'dx', start: 11, end: 2 },
        { name: 'ht', start: 3, end: 6 },
        { name: 'td', start: 7, end: 10 },
        { name: 'year', start: 1, end: 12 },
      ]
    : [
        { name: 'spring', start: 4, end: 9 },
        { name: 'autumn', start: 10, end: 6 },
        { name: 'year', start: 1, end: 12 },
      ];
}
