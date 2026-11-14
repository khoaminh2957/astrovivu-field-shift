import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getCrop } from '@/core/crops';
import { buildRotations } from '@/core/advisory/rotation';
import { getSampleParcel } from '@/data/samples';
import { activeRow, rotationFromRows, rowYears, rowsFromRotation, seasonName, type SeasonRow } from './seasons';

const RICE3: SeasonRow[] = [
  { start: 11, end: 2, crops: ['oryza-sativa'], sowingDate: '2026-11-20' },
  { start: 3, end: 6, crops: ['oryza-sativa'] },
  { start: 7, end: 10, crops: ['zea-mays', 'vigna-radiata'] },
];

describe('season planner model', () => {
  it('round-trips seasons through currentRotation, crops of one season sharing its number', () => {
    const rot = rotationFromRows(RICE3);
    expect(rot).toHaveLength(4);
    expect(rot.filter((e) => e.season === 3).map((e) => e.cropId)).toEqual(['zea-mays', 'vigna-radiata']);
    expect(rot[0].sowingDate).toBe('2026-11-20');
    expect(rowsFromRotation(rot, { month: 11 })).toEqual(RICE3);
  });

  it('reads an old rotation without season numbers as one season per entry', () => {
    const rows = rowsFromRotation(
      [
        { cropId: 'zea-mays', startMonth: 5, endMonth: 10 },
        { cropId: 'glycine-max', startMonth: 5, endMonth: 10 },
      ],
      { month: 11 },
    );
    expect(rows.map((r) => r.crops)).toEqual([['zea-mays'], ['glycine-max']]);
    // Same months: the second is next year, as the advisory reads it.
    expect(rowYears(rows)).toEqual([0, 1]);
  });

  it('falls back to one season from the crop and sowing date', () => {
    const rows = rowsFromRotation(undefined, { crop: getCrop('zea-mays'), sowingDate: '2026-05-02', month: 11 });
    expect(rows).toHaveLength(1);
    expect(rows[0].start).toBe(5);
    expect(rows[0].crops).toEqual(['zea-mays']);
    expect(rowsFromRotation(undefined, { crop: getCrop('coffea-canephora'), month: 11 })[0]).toMatchObject({ start: 1, end: 12 });
  });

  it('picks the season running now, else the next one', () => {
    expect(activeRow(RICE3, 11)).toBe(0);
    expect(activeRow(RICE3, 8)).toBe(2);
    expect(activeRow([{ start: 5, end: 9, crops: ['zea-mays'] }], 11)).toBe(0);
    expect(activeRow([{ start: 5, end: 9, crops: [] }], 6)).toBe(-1);
  });

  it('names seasons from their months', () => {
    expect(RICE3.map((r) => seasonName(r, true))).toEqual(['dx', 'ht', 'td']);
    expect(seasonName({ start: 1, end: 12, crops: [] }, false)).toBe('year');
    expect(seasonName({ start: 4, end: 9, crops: [] }, false)).toBe('spring');
  });
});

describe('advisory reads a season with several crops as side by side, not as next year', () => {
  it('cantho-rice: the third season with maize + mung bean stays in year 1 with half the area each', () => {
    const p = getSampleParcel('cantho-rice')!;
    const input: ModelInput = {
      parcel: p,
      telemetry: JSON.parse(readFileSync('public/data/samples/cantho-rice.json', 'utf8')) as FieldTelemetry,
      cropId: 'oryza-sativa',
      groundTruth: { irrigation: 'full', currentRotation: rotationFromRows(RICE3) },
      priorities: ['profit', 'water', 'soil'],
      today: '2026-11-14',
    };
    const current = buildRotations(input).find((r) => r.kind === 'current')!;
    expect(current.years).toBe(1);
    const third = current.seasons.filter((s) => s.startMonth === 7);
    expect(third.map((s) => s.cropId).sort()).toEqual(['vigna-radiata', 'zea-mays']);
    for (const s of third) expect(s.share).toBeCloseTo(0.5, 5);
  });
});
