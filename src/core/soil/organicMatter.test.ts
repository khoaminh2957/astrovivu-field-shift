import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { assessSoilOrganicMatter, SOM_TARGETS, VAN_BEMMELEN_FACTOR } from './organicMatter';

const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, groundTruth: ModelInput['groundTruth'] = {}): ModelInput {
  const p = getSampleParcel(id)!;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: p.defaultCropId,
    groundTruth: { ...(p.defaultGroundTruth ?? {}), ...groundTruth },
    priorities: ['profit', 'soil', 'water'],
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

describe('Soil organic matter evaluation & rotation pathways (Issue #48 / S7)', () => {
  it('evaluates Iowa corn-soy parcel correctly (temperate medium soil, SSURGO OM)', () => {
    const input = inputFor('iowa-corn-soy');
    const diag = assessSoilOrganicMatter(input);

    expect(diag.isTropical).toBe(false);
    expect(diag.textureClass).toBe('medium');
    expect(diag.targetRange).toEqual(SOM_TARGETS.temperate.medium);
    expect(diag.currentSomPct).toBeCloseTo(3.17, 2);
    // 3.17% is within the optimal range (2.8 - 4.0%)
    expect(diag.status).toBe('optimal');
    expect(diag.deficitPct).toBe(0);
    expect(diag.summary.en).toContain('meets or exceeds');
    expect(diag.summary.vi).toContain('đạt hoặc vượt');
    expect(diag.pathways.length).toBe(4);
  });

  it('converts SoilGrids SOC to SOM via Van Bemmelen factor for Dak Lak basaltic soil', () => {
    const input = inputFor('daklak-coffee');
    const diag = assessSoilOrganicMatter(input);

    expect(diag.isTropical).toBe(true);
    expect(diag.textureClass).toBe('heavy');
    // Dak Lak SOC is 19.4 g/kg -> SOM = (19.4 * 1.724) / 10 = 3.34%
    const expectedSom = (19.4 * VAN_BEMMELEN_FACTOR) / 10;
    expect(diag.currentSomPct).toBeCloseTo(expectedSom, 2);
    // Heavy tropical soil target min is 2.8%
    expect(diag.status).toBe('optimal');
    expect(diag.deficitPct).toBe(0);
  });

  it('evaluates Can Tho rice parcel correctly (tropical heavy alluvial soil)', () => {
    const input = inputFor('cantho-rice');
    const diag = assessSoilOrganicMatter(input);

    expect(diag.isTropical).toBe(true);
    expect(diag.textureClass).toBe('heavy');
    expect(diag.targetRange?.minPct).toBe(2.8);
    // Can Tho SOC is 33.3 g/kg -> SOM is ~5.74%, optimal for flooded heavy alluvium
    expect(diag.currentSomPct).toBeCloseTo((33.3 * VAN_BEMMELEN_FACTOR) / 10, 2);
    expect(diag.status).toBe('optimal');
    expect(diag.deficitPct).toBe(0);
  });

  it('identifies suboptimal SOM and positive deficit for Nevada alfalfa arid sandy soil', () => {
    const input = inputFor('nevada-alfalfa');
    const diag = assessSoilOrganicMatter(input);

    expect(diag.isTropical).toBe(false);
    expect(diag.textureClass).toBe('light');
    // Temperate light soil min target is 1.8%
    expect(diag.targetRange?.minPct).toBe(1.8);
    // Nevada SSURGO OM is 1.5%, which is suboptimal (below 1.8%)
    expect(diag.currentSomPct).toBe(1.5);
    expect(diag.status).toBe('suboptimal');
    expect(diag.deficitPct).toBeCloseTo(0.3, 1);
    expect(diag.summary.en).toContain('below the target minimum');
    expect(diag.summary.vi).toContain('thấp hơn mức khuyến nghị');
  });

  it('respects grower groundTruth override and flags depleted state', () => {
    // Override with 1.0% SOM on heavy tropical soil (target min is 2.8%)
    const input = inputFor('cantho-rice', { organicMatterPct: 1.0 });
    const diag = assessSoilOrganicMatter(input);

    expect(diag.fromGrower).toBe(true);
    expect(diag.sourceId).toBe('ground-truth');
    expect(diag.currentSomPct).toBe(1.0);
    // 1.0% is below 2.8 * 0.7 = 1.96% -> depleted
    expect(diag.status).toBe('depleted');
    expect(diag.deficitPct).toBeCloseTo(1.8, 1);
    expect(diag.summary.en).toContain('critically depleted');
    expect(diag.summary.vi).toContain('suy kiệt nghiêm trọng');
  });

  it('provides 4 distinct management pathways with bilingual instructions', () => {
    const input = inputFor('daklak-coffee');
    const diag = assessSoilOrganicMatter(input);

    const pathwayIds = diag.pathways.map((p) => p.id);
    expect(pathwayIds).toEqual(['green_manure', 'residue_retention', 'compost', 'biochar']);

    for (const pathway of diag.pathways) {
      expect(pathway.title.en && pathway.title.vi).toBeTruthy();
      expect(pathway.description.en && pathway.description.vi).toBeTruthy();
      expect(pathway.estimatedAnnualGainPct[0]).toBeGreaterThan(0);
      expect(pathway.estimatedAnnualGainPct[1]).toBeGreaterThan(pathway.estimatedAnnualGainPct[0]);
    }
  });

  it('handles missing SOM and texture gracefully', () => {
    const base = inputFor('cantho-rice');
    const input = without(base, 'om_pct', 'soc_gkg', 'texture_class', 'usda_texture');

    const diag = assessSoilOrganicMatter(input);
    expect(diag.status).toBe('unknown');
    expect(diag.currentSomPct).toBeNull();
    expect(diag.pathways.length).toBe(4);
  });
});
