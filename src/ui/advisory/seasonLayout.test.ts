import { describe, expect, it } from 'vitest';
import type { RotationSeason } from '@/contracts';
import { tx } from '@/contracts';
import { emptyMonths, layoutRotation, seasonMonths } from './seasonLayout';

const season = (cropId: string, startMonth: number, endMonth: number, year?: number): RotationSeason => ({ cropId, label: tx(cropId), startMonth, endMonth, year });
const flat = (rows: ReturnType<typeof layoutRotation>) => rows.map((r) => r.lanes.map((l) => l.map((s) => `${s.season.cropId}@${s.col}+${s.span}`)));

describe('season calendar layout', () => {
  it('counts months inclusively and across the year end', () => {
    expect(seasonMonths({ startMonth: 3, endMonth: 6 })).toBe(4);
    expect(seasonMonths({ startMonth: 11, endMonth: 2 })).toBe(4);
    expect(seasonMonths({ startMonth: 1, endMonth: 12 })).toBe(12);
    expect(seasonMonths({ startMonth: 5, endMonth: 5 })).toBe(1);
  });

  it('brings a season that runs past December back to January of its own row', () => {
    const rows = layoutRotation([season('rice', 11, 2, 0), season('rice', 3, 6, 0), season('rice', 7, 10, 0)], 1);
    expect(rows).toHaveLength(1);
    expect(flat(rows)[0]).toEqual([['rice@0+2', 'rice@2+4', 'rice@6+4', 'rice@10+2']]);
    const [tail, , , head] = rows[0].lanes[0];
    expect([tail.openStart, tail.openEnd, head.openStart, head.openEnd]).toEqual([true, false, false, true]);
    expect(emptyMonths(rows[0])).toEqual([]);
  });

  it('gives each rotation year its own row, whatever order the seasons come in', () => {
    const rows = layoutRotation([season('fallow', 9, 12, 1), season('soy', 1, 4, 1), season('rice', 11, 2, 0), season('sesbania', 3, 4, 0)], 2);
    expect(flat(rows)).toEqual([[['rice@0+2', 'sesbania@2+2', 'rice@10+2']], [['soy@0+4', 'fallow@8+4']]]);
    expect(emptyMonths(rows[0])).toEqual([4, 5, 6, 7, 8, 9]);
    expect(emptyMonths(rows[1])).toEqual([4, 5, 6, 7]);
  });

  it('stacks seasons that share months in lanes instead of drawing one over the other', () => {
    const rows = layoutRotation([season('rye', 9, 11, 0), season('alfalfa', 1, 12, 0)], 1);
    expect(flat(rows)[0]).toEqual([['alfalfa@0+12'], ['rye@8+3']]);
    for (const lane of rows[0].lanes) for (const a of lane) for (const b of lane) if (a !== b) expect(a.col + a.span <= b.col || b.col + b.span <= a.col).toBe(true);
  });

  it('keeps both parts of a wrapped season in one lane', () => {
    const rows = layoutRotation([season('coffee', 1, 12, 0), season('mulch', 11, 3, 0), season('bean', 5, 7, 0)], 1);
    expect(flat(rows)[0]).toEqual([['coffee@0+12'], ['mulch@0+3', 'bean@4+3', 'mulch@10+2']]);
  });

  it('stands a perennial without a year across every row and adds rows the seasons ask for', () => {
    const rows = layoutRotation([season('coffee', 1, 12), season('bean', 5, 7, 2)], 2);
    expect(rows).toHaveLength(3);
    expect(flat(rows)).toEqual([[['coffee@0+12']], [['coffee@0+12']], [['coffee@0+12'], ['bean@4+3']]]);
  });

  it('lays seasons without a year one after another, moving on when the months are taken', () => {
    const rows = layoutRotation([season('corn', 5, 10), season('soy', 5, 10)], 2);
    expect(flat(rows)).toEqual([[['corn@4+6']], [['soy@4+6']]]);
  });

  it('draws an empty row rather than nothing for a strategy with no seasons', () => {
    const rows = layoutRotation([], 1);
    expect(rows).toEqual([{ year: 0, lanes: [] }]);
    expect(emptyMonths(rows[0])).toHaveLength(12);
  });
});
