import { describe, expect, it } from 'vitest';
import type { BranchTelemetry, Series } from '@/contracts';
import { tx } from '@/contracts';
import { confidenceAt, freshnessFactor, levelOf, spatialFactor, staticBadge } from './confidence';
import { SOURCES } from './sources';

const parcel = { areaHa: 2 };

describe('confidence badge (ARCHITECTURE §4.3)', () => {
  it('spatial factor', () => {
    expect(spatialFactor(2, 30)).toBe(1);
    expect(spatialFactor(2, 250)).toBeCloseTo(0.3 + 0.7 * Math.sqrt(Math.sqrt(20000) / 250), 6);
    expect(spatialFactor(2, 9000)).toBeCloseTo(0.3 + 0.7 * Math.sqrt(141.42 / 9000), 3);
  });
  it('freshness is linear from cadence to 3x cadence', () => {
    expect(freshnessFactor(8, 8)).toBe(1);
    expect(freshnessFactor(16, 8)).toBeCloseTo(0.65, 6);
    expect(freshnessFactor(24, 8)).toBeCloseTo(0.3, 6);
    expect(freshnessFactor(100, 8)).toBe(0.3);
    expect(freshnessFactor(null, 8)).toBe(0.3);
    expect(freshnessFactor(999, null)).toBe(1);
  });
  it('levels', () => {
    expect(levelOf(0.7)).toBe('high');
    expect(levelOf(0.45)).toBe('medium');
    expect(levelOf(0.44)).toBe('low');
  });
  it('static badge = spatial x source', () => {
    const b = staticBadge(SOURCES.mod13q1, parcel);
    expect(b.score).toBeCloseTo(Math.round(spatialFactor(2, 250) * 100) / 100, 2);
    expect(b.level).toBe('high');
    expect(staticBadge(SOURCES.terrarium, parcel)).toMatchObject({ score: 1, level: 'high' });
    expect(staticBadge(SOURCES.forecast, parcel).level).toBe('low');
    expect(staticBadge(undefined, parcel).score).toBe(0);
  });
  it('confidenceAt multiplies freshness and sample quality', () => {
    const series: Series = {
      key: 'ndvi',
      branch: 'vegetation',
      label: tx('NDVI'),
      unit: '',
      sourceId: SOURCES.mod13q1.id,
      cadence: '16-day',
      samples: [
        { t: '2026-10-16', v: 0.8 },
        { t: '2026-11-01', v: 0.7, q: 'filled' },
      ],
    };
    const branch: BranchTelemetry = { id: 'vegetation', title: tx('V'), series: [series], facts: [], sources: [SOURCES.mod13q1.id], status: 'ok', confidence: staticBadge(SOURCES.mod13q1, parcel) };
    const sources = { [SOURCES.mod13q1.id]: SOURCES.mod13q1 };
    const fresh = confidenceAt(branch, series, '2026-10-20', parcel, sources);
    expect(fresh.score).toBe(branch.confidence.score);
    const filled = confidenceAt(branch, series, '2026-11-02', parcel, sources);
    expect(filled.score).toBeCloseTo(Math.round(branch.confidence.score * 0.7 * 100) / 100, 2);
    const stale = confidenceAt(branch, series, '2026-12-20', parcel, sources);
    expect(stale.score).toBeCloseTo(Math.round(branch.confidence.score * 0.3 * 0.7 * 100) / 100, 2);
    expect(stale.level).toBe('low');
    expect(confidenceAt(branch, series, '2026-01-01', parcel, sources).reasons.some((r) => r.en.includes('No observation'))).toBe(true);
  });
});
