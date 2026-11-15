import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { computeScoreTimeline } from '@/core/scoring';
import { diagnoseSoil } from './diagnosis';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry => JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, groundTruth: ModelInput['groundTruth'] = {}): ModelInput {
  const parcel = getSampleParcel(id)!;
  return { parcel, telemetry: load(id), cropId: parcel.defaultCropId, groundTruth, priorities: ['soil'], today: '2026-11-14' };
}

describe('S1 soil diagnosis', () => {
  for (const id of IDS) {
    it(`diagnoses all six soil factors for ${id}`, () => {
      const input = inputFor(id);
      const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
      expect(diagnosis?.gaps.map((gap) => gap.key)).toEqual(['ph', 'texture', 'drainage', 'depth', 'salinity', 'fertility']);
      for (const gap of diagnosis?.gaps ?? []) {
        expect(gap.label.en).toBeTruthy();
        expect(gap.label.vi).toBeTruthy();
      }
    });
  }

  it('reports missing data without inventing a score', () => {
    const input = inputFor('cantho-rice');
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    expect(diagnosis?.gaps.find((gap) => gap.key === 'drainage')?.status).toBe('unknown');
    expect(diagnosis?.gaps.find((gap) => gap.key === 'depth')?.status).toBe('unknown');
    expect(diagnosis?.gaps.find((gap) => gap.key === 'salinity')?.status).toBe('unknown');
  });

  it('uses crop drainage requirements instead of treating well-drained soil as universally optimal', () => {
    const input = inputFor('cantho-rice', { drainage: 'well' });
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    const drainage = diagnosis?.gaps.find((gap) => gap.key === 'drainage');
    expect(drainage?.status).toBe('outside');
    expect(drainage?.limiting).toBe(false);
  });

  it('uses a grower pH measurement in the diagnosis', () => {
    const input = inputFor('daklak-coffee', { ph: 4.5 });
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    const ph = diagnosis?.gaps.find((gap) => gap.key === 'ph');
    expect(ph?.facts[0].value).toBe(4.5);
    expect(ph?.status).toBe('tolerated');
  });

  it('uses the score summary for Nevada limiting and reports the organic-matter conflict', () => {
    const input = inputFor('nevada-alfalfa');
    const score = computeScoreTimeline(input);
    const diagnosis = diagnoseSoil(input, score);
    expect(diagnosis?.limitingKey).toBeNull();
    expect(diagnosis?.gaps.find((gap) => gap.key === 'ph')).toMatchObject({ status: 'tolerated', gap: { amount: 0.6, direction: 'lower' }, limiting: false });
    expect(diagnosis?.conflicts[0].en).toContain('1.5%');
    expect(diagnosis?.conflicts[0].en).toContain('3.1%');
  });

  it('reports pH uncertainty endpoints and unknown soil factors for Can Tho', () => {
    const input = inputFor('cantho-rice');
    const diagnosis = diagnoseSoil(input, computeScoreTimeline(input));
    expect(diagnosis?.limitingKey).toBeNull();
    expect(diagnosis?.gaps.find((gap) => gap.key === 'ph')?.gapAtEnds).toEqual([{ amount: 1.3, unit: 'pH', direction: 'raise' }, { amount: 1.2, unit: 'pH', direction: 'lower' }]);
    expect(diagnosis?.gaps.filter((gap) => ['drainage', 'depth', 'salinity'].includes(gap.key)).every((gap) => gap.status === 'unknown')).toBe(true);
import type { FieldTelemetry, GroundTruth, I18nText, ModelInput, PhPlan } from '@/contracts';
import { buildAdvisoryReport } from '@/core/advisory';
import { phPlan } from '@/core/advisory/actions';
import { getCrop } from '@/core/crops';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { aluminiumRisk } from './aluminium';
import { calculateBufferPhPlan } from './buffer';
import { diagnoseSoil } from './diagnosis';
import { buildSoilPlan } from './plan';
import { leachingRequirement } from './salinity';
import type { SoilDiagnosis, SoilPlan } from './types';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

/** A sample field as the app opens it, with the grower's own numbers on top when given. */
function demo(id: string, own: Partial<GroundTruth> = {}, cropId?: string): ModelInput {
  const p = getSampleParcel(id)!;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: cropId ?? p.defaultCropId,
    groundTruth: { ...(p.defaultGroundTruth ?? {}), ...own },
    priorities: ['profit', 'soil', 'water'],
    today: '2026-11-14',
  };
}

/** The same field with some soil facts taken out of the telemetry. */
function without(input: ModelInput, ...keys: string[]): ModelInput {
  const telemetry = structuredClone(input.telemetry);
  for (const b of Object.values(telemetry.branches)) {
    if (b) b.facts = b.facts.filter((f) => !keys.includes(f.key));
  }
  return { ...input, telemetry };
}

const planOf = (input: ModelInput): { diag: SoilDiagnosis; plan: SoilPlan; ph: PhPlan | undefined } => {
  const diag = diagnoseSoil(input);
  const ph = phPlan(input);
  return { diag, plan: buildSoilPlan(diag, input, ph), ph };
};
const row = (d: SoilDiagnosis, key: string) => d.metrics.find((m) => m.key === key)!;

describe('soil diagnosis and plan on the sample fields', () => {
  for (const id of IDS) {
    it(`${id}: every text has both languages, every rate is a range with a caveat, the plan survives JSON`, () => {
      const { diag, plan } = planOf(demo(id));

      expect(diag.fieldId).toBe(id);
      expect(diag.metrics.map((m) => m.key).slice(0, 5)).toEqual(['ph', 'texture', 'drainage', 'depth', 'salinity']);
      expect(diag.summary.en && diag.summary.vi).toBeTruthy();
      for (const m of diag.metrics) {
        expect(m.label.en && m.label.vi).toBeTruthy();
        expect(m.note.en && m.note.vi).toBeTruthy();
        // A row without a reading carries no value in its place.
        if (m.status === 'no_data') expect(m.currentValue).toBeNull();
      }

      expect(plan.summary.en && plan.summary.vi).toBeTruthy();
      for (const item of plan.items) {
        for (const text of [item.title, item.action, item.timing, item.verification]) expect(text.en && text.vi).toBeTruthy();
        for (const ev of item.evidence) {
          expect(ev.label.en && ev.label.vi).toBeTruthy();
          if (typeof ev.value === 'object' && ev.value !== null) expect(ev.value.en && ev.value.vi).toBeTruthy();
        }
        if (item.rateRange) {
          expect(item.rateRange.min).toBeLessThanOrEqual(item.rateRange.max);
          expect(item.caveats.some((c) => c.vi.includes('cần kiểm tra tại chỗ'))).toBe(true);
        }
        // Only the pH item may carry a rate, and it is the rate of the report's pH plan.
        if (item.metric !== 'ph') expect(item.rateRange).toBeNull();
      }
      expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    });
  }

  it('agrees with the suitability model: a row is optimal exactly when the model scores the factor 1, and has a verdict exactly when the model has a score', () => {
    const cases: ModelInput[] = [
      ...IDS.map((id) => demo(id)),
      demo('daklak-coffee', { ph: 4.5, drainage: 'poor', ecDsM: 3, soilDepthCm: 40, texture: 'light' }),
      demo('cantho-rice', { ph: 9.5, drainage: 'well', ecDsM: 1.5, soilDepthCm: 200 }),
      demo('nevada-alfalfa', { ecDsM: 5, soilDepthCm: 60, drainage: 'excessive', texture: 'heavy' }),
      demo('iowa-corn-soy', { ecDsM: 3 }, 'glycine-max'),
    ];
    let compared = 0;
    for (const input of cases) {
      const score = computeScoreTimeline(input);
      const factors = score.snapshots[score.snapshots.length - 1].factors;
      const diag = diagnoseSoil(input);
      for (const key of ['ph', 'texture', 'drainage', 'depth', 'salinity']) {
        const f = factors.find((x) => x.key === key)!;
        const m = row(diag, key);
        const where = `${input.parcel.id} ${input.cropId} ${key}`;
        // `uncertain` keeps the verdict of the centre of the estimate in `deficit`.
        const optimal = m.status === 'optimal' || (m.status === 'uncertain' && m.deficit === 0);
        const noVerdict = m.status === 'no_data' || m.status === 'reading_only';
        expect(f, where).toBeDefined();
        expect(optimal, where).toBe(f.score === 1);
        expect(noVerdict, where).toBe(f.score === null);
        compared++;
      }
    }
    expect(compared).toBe(40);
  });

  it('Nevada alfalfa: pH 8.8 is tolerated, 0.6 above the optimum, and is the limiting factor; no sulfur rate is given', () => {
    const { diag, plan, ph } = planOf(demo('nevada-alfalfa'));
    const m = row(diag, 'ph');
    expect(m.currentValue).toBe(8.8);
    expect(m.status).toBe('tolerable');
    expect(m.note.vi).toContain('ngoài khoảng tối ưu');
    expect(m.note.en).toContain('outside optimal');
    expect(m.deficit).toBe(0.6);
    expect(m.isLimiting).toBe(true);
    expect(diag.mostLimitingFactor?.key).toBe('ph');

    const item = plan.items.find((i) => i.metric === 'ph')!;
    expect(ph?.amendment).toBe('sulfur');
    expect(item.action.en).toContain('sulfur');
    expect(item.rateRange).toBeNull();
    expect(item.action.en).toContain('no sulfur rate is given');
  });

  it('Can Tho rice: drainage, depth and salinity have no data and lead to "measure first", with no rate and no pH item', () => {
    const { diag, plan } = planOf(demo('cantho-rice'));
    for (const key of ['drainage', 'depth', 'salinity']) {
      expect(row(diag, key).status).toBe('no_data');
      const item = plan.items.find((i) => i.metric === key)!;
      expect(item.status).toBe('no_data');
      expect(item.rateRange).toBeNull();
      expect(item.title.en).toContain('Measure first');
      expect(item.title.vi).toContain('Cần đo trước');
    }
    expect(plan.items.find((i) => i.metric === 'salinity')!.action.vi).toContain('mẫu đất');
    expect(plan.items.some((i) => i.metric === 'ph')).toBe(false);
  });

  it('the pH item of the soil plan carries the dose of the report\'s pH plan, not another one', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const { diag, plan, ph } = planOf(input);
    expect(row(diag, 'ph').status).toBe('tolerable');
    expect(row(diag, 'ph').deficit).toBe(0.5);
    expect(ph?.rateTHa).toEqual([4, 6.4]);
    const item = plan.items.find((i) => i.metric === 'ph')!;
    expect(item.rateRange).toEqual({ min: 4, max: 6.4, unit: 't/ha' });

    // Through the report: one lime figure, the same in both places.
    const report = buildAdvisoryReport(input, computeScoreTimeline(input));
    expect(report.ph?.rateTHa).toEqual([4, 6.4]);
    expect(report.soilPlan?.items.find((i) => i.metric === 'ph')?.rateRange).toEqual({ min: 4, max: 6.4, unit: 't/ha' });

    // Without a pH plan the item states the gap and gives no dose.
    const bare = buildSoilPlan(diag, input).items.find((i) => i.metric === 'ph')!;
    expect(bare.rateRange).toBeNull();
  });
});

describe('no value stands in for a missing reading', () => {
  it('a field without a texture class is not treated as medium: the row is no_data', () => {
    const input = without(demo('iowa-corn-soy'), 'texture_class', 'usda_texture');
    const m = row(diagnoseSoil(input), 'texture');
    expect(m.status).toBe('no_data');
    expect(m.currentValue).toBeNull();
    expect(m.isLimiting).toBe(false);
    // Maize grows best in medium soil: the old default made this row "matches optimal".
    expect(getCrop('zea-mays')!.req.texture!.opt).toContain('medium');
    const item = planOf(input).plan.items.find((i) => i.metric === 'texture')!;
    expect(item.status).toBe('no_data');
    expect(item.rateRange).toBeNull();
  });

  it('a field without available water capacity gets no value from a reference table: the row is no_data', () => {
    for (const id of ['daklak-coffee', 'cantho-rice']) {
      const m = row(diagnoseSoil(demo(id)), 'awc');
      expect(m.status).toBe('no_data');
      expect(m.currentValue).toBeNull();
      expect(m.targetRange).toBeUndefined();
    }
    // Where SSURGO has it, the reading is listed (0.20 cm/cm = 200 mm/m), without a verdict.
    const iowa = row(diagnoseSoil(demo('iowa-corn-soy')), 'awc');
    expect(iowa.currentValue).toBe(200);
    expect(iowa.unit).toBe('mm/m');
    expect(iowa.status).toBe('reading_only');
  });

  it('readings the catalogue has no requirement for carry no verdict and lead to no item', () => {
    for (const id of IDS) {
      const { diag, plan } = planOf(demo(id));
      for (const key of ['organic_matter', 'cec', 'awc', 'nitrogen']) {
        const m = diag.metrics.find((x) => x.key === key);
        if (!m) continue;
        expect(['reading_only', 'no_data']).toContain(m.status);
        expect(m.targetRange).toBeUndefined();
        expect(m.isLimiting).toBe(false);
        expect(plan.items.some((i) => i.metric === key)).toBe(false);
      }
      // No yearly fertiliser rate and no compost rate: they rested on a table without sources.
      expect(plan.items.some((i) => i.metric === 'macronutrients')).toBe(false);
      const text = JSON.stringify(plan);
      expect(text).not.toMatch(/kg N\/ha|P2O5|K2O|compost/i);
    }
  });

  it('without a crop, readings are listed and nothing is judged', () => {
    const input: ModelInput = { ...demo('iowa-corn-soy'), cropId: null };
    const diag = diagnoseSoil(input);
    for (const m of diag.metrics) expect(['reading_only', 'no_data']).toContain(m.status);
    expect(diag.mostLimitingFactor).toBeNull();
    expect(buildSoilPlan(diag, input, phPlan(input)).items.every((i) => i.status === 'no_data')).toBe(true);
  });
});

describe('the requirement is the crop\'s own, from the catalogue', () => {
  it('rice on well-drained soil is not optimal: rice needs poorly drained soil', () => {
    expect(getCrop('oryza-sativa')!.req.drainage).toEqual({ opt: ['poor'], abs: ['poor'] });
    const well = planOf(demo('cantho-rice', { drainage: 'well' }));
    expect(row(well.diag, 'drainage').status).toBe('outside');
    // A crop that needs standing water is not told to dig drains.
    const poor = planOf(demo('cantho-rice', { drainage: 'poor' }));
    expect(row(poor.diag, 'drainage').status).toBe('optimal');
    expect(poor.plan.items.some((i) => i.metric === 'drainage')).toBe(false);
  });

  it('salinity is judged by the salinity class of the crop, not by one threshold for every crop', () => {
    // Alfalfa: grows best up to class "low" (2.0 dS/m), tolerates class "medium" (4.5 dS/m).
    expect(getCrop('medicago-sativa')!.req.salinity).toEqual({ opt: 'low', abs: 'medium' });
    expect(row(diagnoseSoil(demo('nevada-alfalfa', { ecDsM: 2 })), 'salinity').status).toBe('optimal');
    const at3 = row(diagnoseSoil(demo('nevada-alfalfa', { ecDsM: 3 })), 'salinity');
    expect(at3.status).toBe('tolerable');
    expect(at3.targetRange).toEqual({ optHi: 2, absHi: 4.5 });
    expect(at3.deficit).toBe(1);
    expect(row(diagnoseSoil(demo('nevada-alfalfa', { ecDsM: 5 })), 'salinity').status).toBe('outside');
    // Robusta coffee: class "low" for both, so 3 dS/m is already outside what it tolerates.
    expect(getCrop('coffea-canephora')!.req.salinity).toEqual({ opt: 'low', abs: 'low' });
    expect(row(diagnoseSoil(demo('daklak-coffee', { ecDsM: 3 })), 'salinity').status).toBe('outside');
    // A crop with no salinity class: the reading is listed, no threshold is assumed.
    expect(getCrop('tagetes-erecta')!.req.salinity).toBeUndefined();
    const none = row(diagnoseSoil(demo('nevada-alfalfa', { ecDsM: 3 }, 'tagetes-erecta')), 'salinity');
    expect(none.status).toBe('reading_only');
    expect(none.targetRange).toBeUndefined();
  });

  it('a salinity item quotes the finding and the leaching requirement, and gives no rate', () => {
    const { plan } = planOf(demo('nevada-alfalfa', { ecDsM: 5 }));
    const item = plan.items.find((i) => i.metric === 'salinity')!;
    expect(item.status).toBe('outside');
    expect(item.rateRange).toBeNull();
    expect(JSON.stringify(item.evidence)).toContain('equation (9)');
  });
});

describe('the pH plan of the report is the one of main, not the buffer method', () => {
  it('Dak Lak with alfalfa: lime 5.5-8.8 t/ha (the buffer method would say 0.2-18.8)', () => {
    const input = demo('daklak-coffee', {}, 'medicago-sativa');
    const report = buildAdvisoryReport(input, computeScoreTimeline(input));
    expect(report.ph).toMatchObject({ current: 5.7, target: 6.8, amendment: 'lime', rateTHa: [5.5, 8.8] });
    expect(calculateBufferPhPlan(input)?.rateTHa).toEqual([0.2, 18.8]);
  });

  it('buffer method, kept in the module and not used: clay soil takes more lime than sandy soil for the same pH gap', () => {
    const base = demo('iowa-corn-soy');
    const sandy = calculateBufferPhPlan({ ...base, cropId: 'glycine-max', groundTruth: { ph: 5.0, texture: 'light' } });
    const clay = calculateBufferPhPlan({ ...base, cropId: 'glycine-max', groundTruth: { ph: 5.0, texture: 'heavy' } });
    expect(sandy?.amendment).toBe('lime');
    expect(clay?.amendment).toBe('lime');
    expect(clay!.rateTHa![1]).toBeGreaterThan(sandy!.rateTHa![1]);
  });
});

describe('Vietnamese text', () => {
  it('carries no English class or status word', () => {
    const vi: string[] = [];
    const take = (t: I18nText | undefined) => { if (t) vi.push(t.vi); };
    const inputs = [
      ...IDS.map((id) => demo(id)),
      demo('daklak-coffee', { ph: 4.5, drainage: 'poor', ecDsM: 3, soilDepthCm: 40, texture: 'light' }),
      demo('cantho-rice', { drainage: 'well', ecDsM: 9, soilDepthCm: 10 }),
      demo('nevada-alfalfa', { ecDsM: 5, drainage: 'excessive', texture: 'heavy' }),
      { ...demo('iowa-corn-soy'), cropId: null },
    ];
    for (const input of inputs) {
      const { diag, plan } = planOf(input);
      take(diag.summary);
      for (const m of diag.metrics) { take(m.label); take(m.note); }
      take(plan.summary);
      for (const i of plan.items) {
        for (const t of [i.title, i.action, i.timing, i.verification, ...i.caveats]) take(t);
        for (const ev of i.evidence) { take(ev.label); if (typeof ev.value === 'object' && ev.value !== null) take(ev.value as I18nText); }
      }
      const salt = leachingRequirement(input, { waterEcDsM: 1.2, espPct: 22 });
      for (const t of [salt.summary, salt.leaching.note, salt.gypsum.note, ...salt.recommendations, ...salt.caveats]) take(t);
      const al = aluminiumRisk(input, { exchAlCmolKg: 2 });
      for (const t of [al.summary, al.cropTolerance.note, ...al.recommendations, ...al.caveats]) take(t);
    }
    const words = /\b(Clay|Sandy|Loamy|Silty|Peat|Chalky|Calcareous|optimal|tolerable|outside|uncertain|no_data|reading_only|non_saline|slightly_saline|moderately_saline|severely_saline|non_sodic|potential_risk|unknown|heavy|medium|light|organic|poor|well|excessive|shallow|deep|drained|loam|sand|silt)\b/;
    for (const text of vi) expect(text, text).not.toMatch(words);
    expect(vi.length).toBeGreaterThan(100);
  });
});

// ------------------------------------------------------------------------------------------------
// docs/SOIL.md, section 4: the tables of the document are the output of the code.
// ------------------------------------------------------------------------------------------------
const DOC = readFileSync('docs/SOIL.md', 'utf8');
const rate = (r: [number, number] | null | undefined) => (r ? `${r[0]}-${r[1]} t/ha` : 'no rate');
const phCell = (p: PhPlan | undefined) => (!p || p.amendment === 'none' ? 'none' : `${p.amendment}, ${rate(p.rateTHa)}`);
/** The rows the document lacks; listed together so that a change in the code shows every row to update. */
const missingFromDoc = (lines: string[]): string[] => lines.filter((line) => !DOC.includes(line));

describe('tables of docs/SOIL.md, section 4', () => {
  it('4.1 diagnosis of the four sample fields', () => {
    const cell = (d: SoilDiagnosis, key: string) => {
      const m = row(d, key);
      return m.currentValue == null ? m.status : `${m.status} (${m.currentValue})`;
    };
    const lines: string[] = [];
    for (const id of IDS) {
      const input = demo(id);
      const d = diagnoseSoil(input);
      const line = `| ${id} | ${input.cropId} | ${cell(d, 'ph')} | ${cell(d, 'texture')} | ${cell(d, 'drainage')} | ${cell(d, 'depth')} | ${cell(d, 'salinity')} | ${d.mostLimitingFactor?.key ?? 'none'} |`;
      lines.push(line);
    }
    expect(missingFromDoc(lines)).toEqual([]);
  });

  it('4.2 soil plan of the four sample fields', () => {
    const lines: string[] = [];
    for (const id of IDS) {
      const { plan, ph } = planOf(demo(id));
      const steps = plan.items.map((i) => `${i.metric}: ${i.status === 'no_data' ? 'measure first' : rate(i.rateRange ? [i.rateRange.min, i.rateRange.max] : null)}`).join('; ');
      const line = `| ${id} | ${phCell(ph)} | ${steps || 'none'} |`;
      lines.push(line);
    }
    expect(missingFromDoc(lines)).toEqual([]);
  });

  it('4.3 pH plan of the report and the buffer method, six cases', () => {
    const cases: [string, string | undefined, Partial<GroundTruth>, string][] = [
      ['daklak-coffee', undefined, {}, 'map pH'],
      ['daklak-coffee', 'medicago-sativa', {}, 'map pH'],
      ['daklak-coffee', undefined, { ph: 4.5 }, 'grower pH 4.5'],
      ['cantho-rice', undefined, {}, 'map pH'],
      ['iowa-corn-soy', undefined, {}, 'map pH'],
      ['nevada-alfalfa', undefined, {}, 'map pH'],
    ];
    const lines: string[] = [];
    for (const [id, crop, own, what] of cases) {
      const input = demo(id, own, crop);
      const report = buildAdvisoryReport(input, computeScoreTimeline(input)).ph!;
      const buffer = calculateBufferPhPlan(input)!;
      const line = `| ${id} | ${input.cropId} | ${what} | ${report.current} -> ${report.target} | ${phCell(report)} | ${phCell(buffer)} |`;
      lines.push(line);
    }
    expect(missingFromDoc(lines)).toEqual([]);
  });

  it('4.4 worked doses', () => {
    const gypsum = leachingRequirement(demo('nevada-alfalfa'), { espPct: 22 });
    const g = `| Gypsum | nevada-alfalfa, test value ESP 22 % | CEC ${gypsum.gypsum.cecCmolKg} cmol(+)/kg, bulk density ${gypsum.gypsum.bulkDensityTM3} t/m3, depth ${gypsum.gypsum.depthM} m | ${rate(gypsum.gypsum.rateRangeTHa)} |`;
    const al = aluminiumRisk(demo('daklak-coffee'), { exchAlCmolKg: 2 });
    const a = `| Lime for aluminium | daklak-coffee, test value Al 2 cmol(+)/kg | bulk density ${al.bulkDensityTM3} t/m3, depth ${al.depthM} m | ${rate(al.limeRequirementTHa)} |`;
    const lr = leachingRequirement(demo('nevada-alfalfa'), { waterEcDsM: 1.2 });
    const l = `| Leaching requirement | nevada-alfalfa, test value ECw 1.2 dS/m | crop threshold ${lr.leaching.cropThresholdEcDsM} dS/m | LR ${lr.leaching.leachingFraction}, ${lr.leaching.appliedMmPer100MmEt} mm per 100 mm |`;
    expect(missingFromDoc([g, a, l])).toEqual([]);
  });
});
