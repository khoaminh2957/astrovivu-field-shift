import { describe, expect, it } from 'vitest';
import { COMMONNESS, LEVEL, commonnessFor, latestMean, levelFor, rankOf } from './levels';

describe('latestMean', () => {
  const series: [number, number][] = [
    [2019, 10],
    [2020, 20],
    [2021, 30],
    [2022, 40],
    [2024, 60],
  ];

  it('averages the latest three years that have a value and reports which', () => {
    expect(latestMean(series, 2015)).toEqual({ mean: (30 + 40 + 60) / 3, yearFrom: 2021, yearTo: 2024, years: [2021, 2022, 2024] });
  });

  it('uses fewer years when fewer exist in the window, and none when the series is too old', () => {
    expect(latestMean(series, 2022)).toEqual({ mean: 50, yearFrom: 2022, yearTo: 2024, years: [2022, 2024] });
    expect(latestMean(series, 2025)).toBeNull();
    expect(latestMean([], 2015)).toBeNull();
  });

  it('keeps an explicit zero as an observation and skips non-numbers', () => {
    expect(latestMean([[2023, 0], [2024, 0]], 2015)?.mean).toBe(0);
    expect(latestMean([[2023, Number.NaN], [2024, 8]], 2015)).toEqual({ mean: 8, yearFrom: 2024, yearTo: 2024, years: [2024] });
  });

  it('accepts a Map, as the FAOSTAT reader stores its series', () => {
    expect(latestMean(new Map(series), 2015)?.years).toEqual([2021, 2022, 2024]);
  });
});

describe('levelFor', () => {
  it('applies the share thresholds at their boundaries', () => {
    expect(levelFor(1000, LEVEL.majorPct, 1)).toBe('major');
    expect(levelFor(1000, LEVEL.majorPct - 0.001, 1)).toBe('common');
    expect(levelFor(1000, LEVEL.commonPct, 1)).toBe('common');
    expect(levelFor(1000, LEVEL.commonPct - 0.001, 1)).toBe('minor');
    expect(levelFor(1, 0.0001, null)).toBe('minor');
  });

  it('says present when only production is known and absent when nothing is above zero', () => {
    expect(levelFor(null, null, 120)).toBe('present');
    expect(levelFor(0, 0, 120)).toBe('present');
    expect(levelFor(0, 0, 0)).toBe('absent');
    expect(levelFor(null, null, null)).toBe('absent');
  });
});

describe('commonnessFor', () => {
  it('needs both the countries and the area of a tier', () => {
    expect(commonnessFor(COMMONNESS.global.countries, COMMONNESS.global.areaHa)).toBe('global');
    expect(commonnessFor(COMMONNESS.global.countries, COMMONNESS.global.areaHa - 1)).toBe('widespread');
    expect(commonnessFor(COMMONNESS.global.countries - 1, 5e7)).toBe('widespread');
    expect(commonnessFor(19, 5e7)).toBe('regional');
    expect(commonnessFor(5, 10_000)).toBe('regional');
    expect(commonnessFor(4, 5e7)).toBe('local');
    expect(commonnessFor(100, 9_999)).toBe('local');
  });
});

describe('rankOf', () => {
  it('ranks by strictly larger values, ties sharing a rank', () => {
    expect(rankOf(50, [100, 50, 50, 10])).toBe(2);
    expect(rankOf(100, [100, 50])).toBe(1);
    expect(rankOf(5, [])).toBe(1);
  });
});
