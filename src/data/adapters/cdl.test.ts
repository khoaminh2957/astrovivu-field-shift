import { describe, expect, it } from 'vitest';
import { makeParcel, circlePolygon } from '@/lib/geo';
import { cdlSamplePoints, majorityYear } from './cdl';

describe('CDL multi-point sampling', () => {
  it('samples the centroid plus four interior points of a pivot', () => {
    const p = makeParcel({ id: 'p', name: 'p', polygon: circlePolygon([-115.97, 39.72], 400), source: 'quad' });
    expect(cdlSamplePoints(p)).toHaveLength(5);
  });
  it('takes the majority per year and says how many points agreed', () => {
    const alf = { code: 36, crop: 'Alfalfa' };
    const shrub = { code: 152, crop: 'Shrubland' };
    const y = majorityYear(2024, [shrub, alf, alf, alf, null])!;
    expect(y.crop).toBe('Alfalfa');
    expect(y.note?.en).toBe('3 of 4 points inside the field agree');
    expect(majorityYear(2024, [shrub, alf])!.crop).toBe('Shrubland');
    expect(majorityYear(2024, [null])).toBeNull();
  });
});
