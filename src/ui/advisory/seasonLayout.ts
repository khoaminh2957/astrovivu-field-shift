/**
 * Places the seasons of a rotation on a calendar: one row of twelve months per rotation year.
 * Pure. The engine plans each year as a closed twelve-month frame, so a season that runs past
 * December comes back in January of its own row (rice sown in November and cut in February is one
 * block at each end of the year), and a twelve-month season stands across the whole row.
 */
import type { RotationSeason } from '@/contracts';

export interface Segment {
  /** Index of the season in `RotationStrategy.seasons`. */
  index: number;
  season: RotationSeason;
  /** 0-based first month column and number of columns, inside one year row. */
  col: number;
  span: number;
  /** The season goes on past December (it continues at the left of the row). */
  openEnd: boolean;
  /** This part is the continuation that started before January. */
  openStart: boolean;
  /** Months in the other part of a season that wraps the year end; null for a season in one piece. */
  otherSpan: number | null;
}

export interface YearRow {
  /** 0-based year of the rotation. */
  year: number;
  /** Lanes top to bottom; concurrent crops (an inter-row cover under a tree crop) stack. */
  lanes: Segment[][];
}

/** Months a season covers, 1..12; start and end are inclusive and may wrap the year end. */
export const seasonMonths = (s: Pick<RotationSeason, 'startMonth' | 'endMonth'>): number => ((((s.endMonth - s.startMonth) % 12) + 12) % 12) + 1;

function segmentsOf(season: RotationSeason, index: number): Segment[] {
  const len = seasonMonths(season);
  const col = (((season.startMonth - 1) % 12) + 12) % 12;
  if (len >= 12) return [{ index, season, col: 0, span: 12, openEnd: false, openStart: false, otherSpan: null }];
  if (col + len <= 12) return [{ index, season, col, span: len, openEnd: false, openStart: false, otherSpan: null }];
  return [
    { index, season, col: 0, span: col + len - 12, openEnd: false, openStart: true, otherSpan: 12 - col },
    { index, season, col, span: 12 - col, openEnd: true, openStart: false, otherSpan: col + len - 12 },
  ];
}

const overlaps = (a: Segment, b: Segment) => a.col < b.col + b.span && b.col < a.col + a.span;

/** Longest first, so a standing crop takes the top lane and what grows under it sits below. */
function toLanes(segments: Segment[]): Segment[][] {
  // A season is placed whole: both parts of one that wraps the year end stay in the same lane.
  const units = new Map<number, Segment[]>();
  for (const s of segments) units.set(s.index, [...(units.get(s.index) ?? []), s]);
  const months = (u: Segment[]) => u.reduce((a, s) => a + s.span, 0);
  const sorted = [...units.values()].sort((a, b) => months(b) - months(a) || a[0].index - b[0].index);
  const lanes: Segment[][] = [];
  for (const unit of sorted) {
    const lane = lanes.find((l) => l.every((x) => unit.every((s) => !overlaps(x, s))));
    if (lane) lane.push(...unit);
    else lanes.push([...unit]);
  }
  return lanes.map((l) => l.sort((a, b) => a.col - b.col));
}

/**
 * One row per rotation year. A season with `year` sits in that row. Without `year`, a twelve-month
 * season stands in every row (a perennial) and the others follow one another in order, moving to
 * the next row when their months are already taken.
 */
export function layoutRotation(seasons: readonly RotationSeason[], years: number): YearRow[] {
  const n = Math.max(1, Math.round(years) || 1, ...seasons.map((s) => (s.year ?? 0) + 1));
  const rows: Segment[][] = Array.from({ length: n }, () => []);
  let cursor = 0;
  seasons.forEach((season, index) => {
    const parts = segmentsOf(season, index);
    if (season.year != null) {
      rows[Math.min(n - 1, Math.max(0, season.year))].push(...parts);
    } else if (parts[0].span === 12) {
      for (const row of rows) row.push(...parts);
    } else {
      while (cursor < n - 1 && rows[cursor].some((x) => x.span < 12 && parts.some((p) => overlaps(x, p)))) cursor++;
      rows[cursor].push(...parts);
    }
  });
  return rows.map((segments, year) => ({ year, lanes: toLanes(segments) }));
}

/** Months of one year row that carry no season at all: bare ground the plan says nothing about. */
export function emptyMonths(row: YearRow): number[] {
  const used = new Set<number>();
  for (const lane of row.lanes) for (const s of lane) for (let c = s.col; c < s.col + s.span; c++) used.add(c);
  return Array.from({ length: 12 }, (_, c) => c).filter((c) => !used.has(c));
}
