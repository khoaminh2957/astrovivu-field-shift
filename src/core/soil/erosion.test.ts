import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, I18nText, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { erosionRisk } from './index';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;

function loadSample(id: string): ModelInput {
  const parcel = getSampleParcel(id)!;
  const telemetry = JSON.parse(
    readFileSync(`public/data/samples/${id}.json`, 'utf8'),
  ) as FieldTelemetry;
  return {
    parcel,
    telemetry,
    cropId: parcel.defaultCropId,
    groundTruth: { ...(parcel.defaultGroundTruth ?? {}) },
    priorities: ['profit', 'soil', 'water'],
    today: '2026-11-14',
  };
}

function cloneWithSlope(input: ModelInput, slopeDeg: number | null | undefined): ModelInput {
  const facts = input.telemetry.branches.terrain.facts
    .filter((f) => f.key !== 'slope_deg')
    .concat(
      slopeDeg === undefined
        ? []
        : [
            {
              key: 'slope_deg',
              branch: 'terrain' as const,
              label: { en: 'Slope', vi: 'Độ dốc' },
              value: slopeDeg,
              unit: '°',
              sourceId: 'srtm-opentopodata',
            },
          ],
    );
  return {
    ...input,
    telemetry: {
      ...input.telemetry,
      branches: {
        ...input.telemetry.branches,
        terrain: {
          ...input.telemetry.branches.terrain,
          facts,
        },
      },
    },
  };
}

describe('soil erosion risk index (NASA SRTM + MODIS + ERA5/CHIRPS + SoilGrids/SSURGO)', () => {
  it('returns 12 finite non-negative monthly values and valid sourceIds across all four sample fields', () => {
    const viStrings: string[] = [];
    const pushText = (t: I18nText | null | undefined) => {
      if (t) viStrings.push(t.vi);
    };

    for (const id of IDS) {
      const input = loadSample(id);
      const res = erosionRisk(input);

      expect(res.isRelativeIndex).toBe(true);
      expect(res.reason).toBeNull();
      expect(res.relativeIndexNotice.en.toLowerCase()).toContain('t/ha/yr');
      expect(res.relativeIndexNotice.vi.toLowerCase()).toContain('t/ha/năm');
      expect(res.months).toHaveLength(12);
      expect(res.annualIndex).not.toBeNull();
      expect(Number.isFinite(res.annualIndex)).toBe(true);
      expect(res.annualIndex!).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < 12; i++) {
        const m = res.months![i];
        expect(m.month).toBe(i + 1);
        expect(Number.isFinite(m.index)).toBe(true);
        expect(m.index).toBeGreaterThanOrEqual(0);
        expect(m.coverFactor).toBeGreaterThan(0);
        expect(m.coverFactor).toBeLessThanOrEqual(1);
      }

      const sources = input.telemetry.sources;
      expect(sources[res.components.rainfall.sourceId]).toBeDefined();
      expect(sources[res.components.slope.sourceId]).toBeDefined();
      expect(sources[res.components.soilErodibility.sourceId]).toBeDefined();
      expect(sources[res.components.cover.sourceId]).toBeDefined();

      expect(res.recommendations.map((r) => r.id)).toEqual([
        'contour-farming',
        'inter-season-cover',
      ]);
      for (const rec of res.recommendations) {
        expect('dose' in rec).toBe(false);
        expect('rateTHa' in rec).toBe(false);
        pushText(rec.action);
        pushText(rec.rationale);
        pushText(rec.recheck);
      }
      pushText(res.relativeIndexNotice);
    }

    const bannedEnWords =
      /\b(Clay|Sandy|Loamy|Silty|Peat|Chalky|Calcareous|optimal|tolerable|outside|uncertain|no_data|reading_only|non_saline|slightly_saline|moderately_saline|severely_saline|non_sodic|potential_risk|unknown|heavy|medium|light|organic|poor|well|excessive|shallow|deep|drained|loam|sand|silt)\b/;
    for (const vi of viStrings) {
      expect(vi, vi).not.toMatch(bannedEnWords);
    }
  });

  it('is monotonically non-decreasing when slope increases', () => {
    const base = loadSample('cantho-rice');
    const slopes = [1.4, 3.0, 5.2, 10.0];
    const results = slopes.map((s) => erosionRisk(cloneWithSlope(base, s)));

    for (let i = 1; i < results.length; i++) {
      expect(results[i].annualIndex!).toBeGreaterThanOrEqual(results[i - 1].annualIndex!);
      for (let m = 0; m < 12; m++) {
        expect(results[i].months![m].index).toBeGreaterThanOrEqual(
          results[i - 1].months![m].index,
        );
      }
    }
  });

  it('is monotonically non-decreasing when rainfall increases', () => {
    const base = loadSample('daklak-coffee');
    const wetter: ModelInput = {
      ...base,
      telemetry: {
        ...base.telemetry,
        climateHistory: base.telemetry.climateHistory?.map((yr) => ({
          ...yr,
          months: yr.months.map((m) => ({
            ...m,
            rainMm: m.rainMm == null ? m.rainMm : m.rainMm * 1.25,
          })),
        })),
      },
    };

    const resBase = erosionRisk(base);
    const resWetter = erosionRisk(wetter);
    expect(resWetter.annualIndex!).toBeGreaterThan(resBase.annualIndex!);
    for (let m = 0; m < 12; m++) {
      expect(resWetter.months![m].index).toBeGreaterThanOrEqual(resBase.months![m].index);
    }
  });

  it('is monotonically non-decreasing when NDVI vegetation cover decreases', () => {
    const base = loadSample('iowa-corn-soy');
    const sparserCover: ModelInput = {
      ...base,
      telemetry: {
        ...base.telemetry,
        branches: {
          ...base.telemetry.branches,
          vegetation: {
            ...base.telemetry.branches.vegetation,
            series: base.telemetry.branches.vegetation.series.map((s) =>
              s.key !== 'ndvi'
                ? s
                : {
                    ...s,
                    samples: s.samples.map((pt) => ({
                      ...pt,
                      v: pt.v == null ? pt.v : Math.max(0, pt.v - 0.15),
                    })),
                  },
            ),
          },
        },
      },
    };

    const resBase = erosionRisk(base);
    const resSparse = erosionRisk(sparserCover);
    expect(resSparse.annualIndex!).toBeGreaterThan(resBase.annualIndex!);
    for (let m = 0; m < 12; m++) {
      expect(resSparse.months![m].index).toBeGreaterThanOrEqual(resBase.months![m].index);
    }
  });

  it('returns null index with a bilingual explanation when slope_deg is missing (never treated as 0)', () => {
    const base = loadSample('daklak-coffee');
    for (const missingSlope of [undefined, null] as const) {
      const res = erosionRisk(cloneWithSlope(base, missingSlope));
      expect(res.months).toBeNull();
      expect(res.annualIndex).toBeNull();
      expect(res.peakMonth).toBeNull();
      expect(res.peakIndex).toBeNull();
      expect(res.components.slope.value).toBeNull();
      expect(res.components.slope.slopeDeg).toBeNull();
      expect(res.reason).not.toBeNull();
      expect(res.reason!.en).toMatch(/slope/i);
      expect(res.reason!.vi).toMatch(/độ dốc/i);
    }
  });

  it('matches the benchmark table and formula page citations in docs/SOIL.md section 5.6', () => {
    const doc = readFileSync('docs/SOIL.md', 'utf8');

    for (const citationPage of ['p. 9', 'p. 11', 'p. 107', 'p. 297', 'p. 17']) {
      expect(doc).toContain(citationPage);
    }

    for (const id of IDS) {
      const res = erosionRisk(loadSample(id));
      const row = `| ${id} | ${res.components.slope.slopeDeg} | ${res.components.slope.value!.toFixed(4)} | ${res.components.soilErodibility.value!.toFixed(4)} | ${Math.round(res.components.rainfall.value!)} | ${res.peakMonth} | ${res.peakIndex!.toFixed(3)} | ${res.annualIndex!.toFixed(2)} |`;
      expect(doc).toContain(row);
    }
  });
});
