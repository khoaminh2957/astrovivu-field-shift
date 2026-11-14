import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RotationStrategy } from '@/contracts';
import { tx } from '@/contracts';
import { CROP_GROUP_HEX } from '@/ui/design/tokens';
import { GROUP_ORDER, cropGroup, groupOfCategory } from './cropGroups';
import { METRICS, bestStrategyId, defaultSelection, goodness, metricAxis, orderStrategies, topDifferences, tradeOffRows } from './metrics';

function strategy(id: string, kind: RotationStrategy['kind'], score: number, m: Partial<RotationStrategy['metrics']>, costUsd: number): RotationStrategy {
  return {
    id,
    kind,
    name: tx(id),
    years: 1,
    seasons: [],
    metrics: { suitability: 80, soilHealth: 40, waterUseMm: 1600, waterFit: 100, marginUsdPerHaYr: 1600, risk: 25, nitrogenKgHaYr: 0, groundCoverPct: 100, pestBreak: 0, ...m },
    economics: { perYear: { revenueUsd: costUsd * 1.5, costUsd, marginUsd: costUsd * 0.5 }, perHaMarginUsd: 0, seasons: [] },
    score,
    why: [],
    evidence: [],
    benefits: [],
    gaps: [],
    risks: [],
  };
}

const current = strategy('current', 'current', 60, {}, 3500);
const income = strategy('income', 'income', 77, { marginUsdPerHaYr: 2253, waterUseMm: 1422, soilHealth: 63, pestBreak: 100, risk: 8 }, 8500);
const saver = strategy('saver', 'water-saver', 42, { marginUsdPerHaYr: 200, waterUseMm: 400, soilHealth: 40.2 }, 1100);
const all = [saver, income, current];
const metric = (key: string) => METRICS.find((m) => m.key === key)!;

describe('strategy order and selection', () => {
  it('puts the current practice first and opens on the best alternative', () => {
    expect(orderStrategies(all).map((r) => r.id)).toEqual(['current', 'income', 'saver']);
    expect(defaultSelection(all)).toBe('income');
    expect(bestStrategyId(all)).toBe('income');
    expect(defaultSelection([current])).toBe('current');
    expect(defaultSelection([])).toBeNull();
  });
});

describe('trade-off axis', () => {
  it('puts right at better whichever way the number goes', () => {
    const water = metric('waterUse');
    const axis = metricAxis(water, all);
    expect(axis).toEqual([0, 1600]);
    expect(goodness(water, 400, axis)).toBeGreaterThan(goodness(water, 1600, axis));
    expect(goodness(water, 1600, axis)).toBe(0);
    expect(goodness(metric('soilHealth'), 63, [0, 100])).toBeCloseTo(0.63);
    expect(goodness(metric('risk'), 8, [0, 100])).toBeCloseTo(0.92);
  });

  it('keeps a zero baseline for money and survives equal or negative values', () => {
    expect(metricAxis(metric('margin'), all)).toEqual([0, 2253]);
    expect(metricAxis(metric('margin'), [strategy('loss', 'income', 1, { marginUsdPerHaYr: -300 }, 1)])).toEqual([-300, 0]);
    expect(metricAxis(metric('nitrogen'), [current])).toEqual([0, 1]);
  });
});

describe('trade-off rows', () => {
  it('signs the difference in the criterion unit and says which way is better', () => {
    const rows = tradeOffRows(current, income, all, []);
    const by = (key: string) => rows.find((r) => r.def.key === key)!;
    expect(by('margin')).toMatchObject({ delta: 653, verdict: 'better' });
    expect(by('waterUse')).toMatchObject({ delta: -178, verdict: 'better' });
    expect(by('cost')).toMatchObject({ delta: 5000, verdict: 'worse' });
    expect(by('waterFit')).toMatchObject({ delta: 0, verdict: 'same' });
    expect(by('waterUse').selectedPos!).toBeGreaterThan(by('waterUse').currentPos!);
    expect(by('cost').selectedPos!).toBeLessThan(by('cost').currentPos!);
  });

  it('calls a difference under half a unit the same', () => {
    expect(tradeOffRows(current, saver, all, []).find((r) => r.def.key === 'soilHealth')!.verdict).toBe('same');
  });

  it('orders the rows by the priorities of the farmer, then the fixed order', () => {
    const keys = tradeOffRows(current, income, all, ['water', 'risk']).map((r) => r.def.key);
    expect(keys.slice(0, 4)).toEqual(['waterUse', 'waterFit', 'pestBreak', 'risk']);
    expect(keys.slice(4)).toEqual(['margin', 'soilHealth', 'cost', 'nitrogen', 'groundCover', 'suitability']);
    expect(tradeOffRows(current, income, all, []).map((r) => r.def.key)).toEqual(METRICS.map((m) => m.key));
  });

  it('gives no verdict without a baseline or for the baseline itself', () => {
    expect(tradeOffRows(null, income, all, []).every((r) => r.verdict === null && r.delta === null)).toBe(true);
    expect(tradeOffRows(current, current, all, []).every((r) => r.verdict === null)).toBe(true);
  });

  it('picks the largest moves either way for the card', () => {
    const top = topDifferences(tradeOffRows(current, income, all, []));
    expect(top).toHaveLength(3);
    expect(top[0].def.key).toBe('pestBreak');
    expect(top.map((r) => r.def.key)).toContain('cost');
    expect(topDifferences(tradeOffRows(current, current, all, []))).toEqual([]);
  });
});

describe('crop groups', () => {
  const css = readFileSync(fileURLToPath(new URL('../design/tokens.css', import.meta.url)), 'utf8');

  it('folds the catalogue categories into the groups of the legend', () => {
    expect(groupOfCategory('pulse')).toBe('legume');
    expect(groupOfCategory('vegetable')).toBe('root');
    expect(groupOfCategory('industrial')).toBe('tree');
    expect(groupOfCategory(undefined)).toBe('other');
    expect(cropGroup('fallow')).toBe('fallow');
    expect(cropGroup('oryza-sativa')).toBe('cereal');
    expect(cropGroup('not-a-crop')).toBe('other');
  });

  it('has one token per coloured group, mirrored in tokens.ts, in the legend order', () => {
    const coloured = GROUP_ORDER.filter((g) => g !== 'other' && g !== 'fallow');
    expect(coloured).toEqual(Object.keys(CROP_GROUP_HEX));
    for (const g of coloured) expect(new RegExp(`--color-crop-${g}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1], g).toBe(CROP_GROUP_HEX[g as keyof typeof CROP_GROUP_HEX]);
  });
});
