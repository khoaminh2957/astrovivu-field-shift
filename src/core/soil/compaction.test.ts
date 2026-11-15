import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { assessSoilCompaction, USDA_COMPACTION_THRESHOLDS } from './compaction';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, gt = true): ModelInput {
  const p = getSampleParcel(id)!;
  const dgt = (p as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: p.defaultCropId,
    groundTruth: gt ? { ...(dgt ?? {}) } : {},
    priorities: ['profit', 'water', 'soil'],
    today: '2026-11-14',
  };
}

function without(input: ModelInput, ...keys: string[]): ModelInput {
  const telemetry = structuredClone(input.telemetry);
  for (const b of Object.values(telemetry.branches)) {
    if (b) b.facts = b.facts.filter((f) => !keys.includes(f.key));
  }
  return { ...input, telemetry };
}

describe('Soil compaction & bulk density evaluation (Issue #51 / S10)', () => {
  it('evaluates Iowa corn-soy parcel correctly (medium texture, bd = 1.56 g/cm³)', () => {
    const input = inputFor('iowa-corn-soy');
    const diag = assessSoilCompaction(input);

    expect(diag.bulkDensityGPerCm3).toBeCloseTo(1.56, 2);
    expect(diag.textureClass).toBe('medium');
    expect(diag.thresholds).toEqual(USDA_COMPACTION_THRESHOLDS.medium);
    // 1.56 is between affectsGrowth (1.55) and restrictsRoot (1.65)
    expect(diag.risk).toBe('moderate');
    expect(diag.isRestricting).toBe(false);
    expect(diag.recommendations.some((r) => r.type === 'biological')).toBe(true);
    expect(diag.recommendations.some((r) => r.type === 'mechanical')).toBe(true);
    expect(diag.fieldTestProtocol.testName.en).toContain('Wire flag');
    expect(diag.fieldTestProtocol.testName.vi).toContain('que cờ');
  });

  it('evaluates Nevada alfalfa parcel correctly (light texture, bd = 1.43 g/cm³)', () => {
    const input = inputFor('nevada-alfalfa');
    const diag = assessSoilCompaction(input);

    expect(diag.bulkDensityGPerCm3).toBeCloseTo(1.43, 2);
    expect(diag.textureClass).toBe('light');
    // 1.43 is well under idealMax (1.60)
    expect(diag.risk).toBe('ideal');
    expect(diag.isRestricting).toBe(false);
    expect(diag.summary.en).toContain('ideal for root growth');
    expect(diag.summary.vi).toContain('lý tưởng');
  });

  it('evaluates Dak Lak coffee parcel (heavy clay loam, bd = 1.17 g/cm³)', () => {
    const input = inputFor('daklak-coffee');
    const diag = assessSoilCompaction(input);

    expect(diag.bulkDensityGPerCm3).toBeCloseTo(1.17, 2);
    expect(diag.textureClass).toBe('heavy');
    // 1.17 is between idealMax (1.10) and affectsGrowth (1.40)
    expect(diag.risk).toBe('ideal');
    expect(diag.isRestricting).toBe(false);
  });

  it('evaluates Can Tho rice parcel (heavy texture, bd = 1.22 g/cm³)', () => {
    const input = inputFor('cantho-rice');
    const diag = assessSoilCompaction(input);

    expect(diag.bulkDensityGPerCm3).toBeCloseTo(1.22, 2);
    expect(diag.textureClass).toBe('heavy');
    expect(diag.risk).toBe('ideal');
  });

  it('flags severe root-restricting compaction when bulk density exceeds threshold', () => {
    const input = inputFor('daklak-coffee');
    // Heavy soil root-limiting threshold is 1.47 g/cm³
    const diag = assessSoilCompaction(input, { bulkDensityGPerCm3: 1.55 });

    expect(diag.risk).toBe('severe');
    expect(diag.isRestricting).toBe(true);
    expect(diag.summary.en).toContain('exceeds root restriction threshold');
    expect(diag.summary.vi).toContain('vượt ngưỡng cản rễ');
    expect(diag.recommendations.some((r) => r.type === 'mechanical')).toBe(true);
  });

  it('handles missing bulk density gracefully', () => {
    const base = inputFor('cantho-rice');
    const input = without(base, 'bulk_density', 'bdod');

    const diag = assessSoilCompaction(input);
    expect(diag.risk).toBe('unknown');
    expect(diag.bulkDensityGPerCm3).toBeNull();
    expect(diag.fieldTestProtocol).toBeDefined();
    expect(diag.recommendations[0].type).toBe('testing');
  });
});
