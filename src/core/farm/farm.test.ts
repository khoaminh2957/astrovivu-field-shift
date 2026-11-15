import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRANCHES, type BranchId, type BranchTelemetry, type FieldTelemetry, type GroundTruth, type ModelInput } from '@/contracts';
import { computeScoreTimeline, whatIf } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { emptyBranch } from '@/lib/series';
import { addDays } from '@/lib/time';
import { cropLook, farmLines, farmOptions, farmSceneAt, forecastDays, FROST_TMIN_C, HEAVY_RAIN_MM, HOT_TMAX_C, nextRisk, runTrial, seasonOutcome, skyKind, weatherAt, WET_DAY_MM, withChange } from './index';
import { getCrop } from '@/core/crops';

function demo(id: string, own: Partial<GroundTruth> = {}, cropId?: string | null): ModelInput {
  const parcel = getSampleParcel(id)!;
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: cropId === undefined ? parcel.defaultCropId : cropId, groundTruth: { ...(parcel.defaultGroundTruth ?? {}), ...own }, priorities: ['profit', 'soil', 'water'], today: telemetry.window.today };
}

/** Every day of the telemetry window of a field. */
const days = (input: ModelInput): string[] => {
  const out: string[] = [];
  for (let d = input.telemetry.window.start; d <= input.telemetry.window.today; d = addDays(d, 1)) out.push(d);
  return out;
};

describe('the sky of a day', () => {
  it('is drawn from the thresholds of the risk events', () => {
    expect(skyKind({ tMaxC: 30, tMinC: 22, rainMm: HEAVY_RAIN_MM })).toBe('heavy-rain');
    expect(skyKind({ tMaxC: 30, tMinC: 22, rainMm: WET_DAY_MM })).toBe('rain');
    expect(skyKind({ tMaxC: 30, tMinC: 22, rainMm: 0.9 })).toBe('clear');
    expect(skyKind({ tMaxC: 12, tMinC: FROST_TMIN_C, rainMm: 0 })).toBe('frost');
    expect(skyKind({ tMaxC: HOT_TMAX_C, tMinC: 26, rainMm: 0 })).toBe('hot');
    expect(skyKind({ tMaxC: 30, tMinC: 22, rainMm: 0 }, true)).toBe('cloudy');
    // Rain is drawn before heat or cloud: it is what the grower sees first.
    expect(skyKind({ tMaxC: 36, tMinC: 26, rainMm: 5 }, true)).toBe('rain');
  });

  it('is unknown, with no figure, when the day has no reading', () => {
    expect(skyKind({ tMaxC: null, tMinC: null, rainMm: null })).toBe('unknown');
    const input = demo('cantho-rice');
    const before = weatherAt(input.telemetry, addDays(input.telemetry.window.start, -40));
    expect(before).toMatchObject({ kind: 'unknown', tMaxC: null, tMinC: null, rainMm: null, sourceIds: [] });
  });

  it('reads the record up to today and the forecast after it', () => {
    const input = demo('cantho-rice');
    const { today, forecastEnd } = input.telemetry.window;
    const now = weatherAt(input.telemetry, today);
    expect(now.forecast).toBe(false);
    expect(now.tMaxC).toBe(30.02);
    expect(now.tMinC).toBe(23.72);
    expect(now.sourceIds).toContain('nasa-power');
    // CHIRPS stops weeks before today: the day's rain then comes from the reanalysis, and says so.
    expect(now.rainMm).toBe(0.3);
    expect(now.sourceIds).toContain('era5');
    expect(now.rain7Mm).not.toBeNull();

    const tomorrow = weatherAt(input.telemetry, addDays(today, 1));
    expect(tomorrow.forecast).toBe(true);
    expect(tomorrow.sourceIds).toEqual(['open-meteo-forecast']);
    expect(tomorrow.rain7Mm).toBeNull();

    const strip = forecastDays(input.telemetry);
    expect(strip[0].t).toBe(today);
    // The forecast runs for two weeks; a last day without figures is left out.
    expect(strip.at(-1)!.t <= forecastEnd!).toBe(true);
    expect(strip.length).toBeGreaterThanOrEqual(14);
    expect(strip.slice(1).every((d) => d.forecast)).toBe(true);
  });

  it('draws every kind of day somewhere on the demo fields', () => {
    const kinds = new Set<string>();
    for (const id of ['cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa']) {
      const input = demo(id);
      for (const d of days(input)) kinds.add(weatherAt(input.telemetry, d).kind);
    }
    expect([...kinds].sort()).toEqual(['clear', 'cloudy', 'frost', 'heavy-rain', 'hot', 'rain']);
  });
});

describe('the crop on the field', () => {
  it('is drawn by the kind of plant', () => {
    expect(cropLook(getCrop('oryza-sativa'))).toBe('paddy');
    expect(cropLook(getCrop('zea-mays'))).toBe('tall-cereal');
    expect(cropLook(getCrop('triticum-aestivum'))).toBe('cereal');
    expect(cropLook(getCrop('coffea-canephora'))).toBe('bush');
    expect(cropLook(getCrop('medicago-sativa'))).toBe('grass');
    expect(cropLook(getCrop('glycine-max'))).toBe('legume');
    expect(cropLook(null)).toBe('none');
  });

  it('grows, ripens and is harvested through the year of the maize field', () => {
    const input = demo('iowa-corn-soy');
    const score = computeScoreTimeline(input);
    const scenes = days(input).map((d) => farmSceneAt(input, score, d));
    const stages = [...new Set(scenes.map((s) => s.crop.stage))];
    expect(stages).toEqual(expect.arrayContaining(['fallow', 'initial', 'development', 'mid-season', 'late-season', 'harvest']));
    // Bare soil off season, full height at mid-season, ripe at harvest.
    for (const s of scenes) {
      if (s.crop.stage === 'fallow' || s.crop.stage === 'pre-sowing') expect(s.crop.growth, s.t).toBe(0);
      if (s.crop.stage === 'mid-season') expect(s.crop.growth, s.t).toBe(1);
      if (s.crop.stage === 'harvest') expect(s.crop.ripeness, s.t).toBe(1);
    }
    // The harvester works its way across the field, and only during the harvest stage.
    const cut = scenes.filter((s) => s.crop.harvested != null);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.every((s) => s.crop.stage === 'harvest')).toBe(true);
    expect(cut[0].crop.harvested).toBeGreaterThan(0);
    expect(cut[0].crop.harvested).toBeLessThan(0.3);
    for (let i = 1; i < cut.length; i++) if (cut[i].t === addDays(cut[i - 1].t, 1)) expect(cut[i].crop.harvested!).toBeGreaterThanOrEqual(cut[i - 1].crop.harvested!);
    // Days to harvest count down to it.
    const growing = scenes.filter((s) => s.crop.daysToHarvest != null);
    expect(growing.at(-1)!.crop.daysToHarvest).toBeLessThan(growing[0].crop.daysToHarvest!);
    expect(scenes.some((s) => s.crop.sowing)).toBe(true);
  });

  it('keeps a perennial standing all year and never sends a harvester', () => {
    const input = demo('daklak-coffee');
    const score = computeScoreTimeline(input);
    for (const d of days(input).filter((_, i) => i % 15 === 0)) {
      const s = farmSceneAt(input, score, d);
      expect(s.crop.look).toBe('bush');
      expect(s.crop.growth).toBe(1);
      expect(s.crop.harvested).toBeNull();
      expect(s.crop.sowing).toBe(false);
    }
  });

  it('has no plant and says so when no crop is chosen', () => {
    const input = demo('cantho-rice', {}, null);
    const score = computeScoreTimeline(input);
    const scene = farmSceneAt(input, score, input.today);
    expect(scene.crop).toMatchObject({ cropId: null, look: 'none', growth: 0, stage: null });
    expect(farmLines(input, scene).rice.text.en).toContain('No crop is chosen');
  });
});

describe('what the three characters say', () => {
  it('is made of the figures of the scene, each with its source', () => {
    const input = demo('cantho-rice');
    const score = computeScoreTimeline(input);
    const scene = farmSceneAt(input, score, input.today);
    const lines = farmLines(input, scene);
    expect(lines.space.text.en).toContain('30 °C by day, 24 °C at night');
    expect(lines.space.text.vi).toContain('ban ngày 30 °C, ban đêm 24 °C');
    expect(lines.space.sourceIds).toEqual(expect.arrayContaining(['nasa-power', 'era5']));
    expect(lines.soil.text.en).toContain(`(${scene.soil.moisture!.toFixed(2)} m³/m³)`);
    expect(lines.soil.text.en).toContain('Soil pH 6.1 (from the soil map, not a sample of this field)');
    expect(lines.soil.sourceIds).toEqual(expect.arrayContaining(['era5-land', 'soilgrids']));
    expect(lines.rice.text.en).toContain('Rice');
    expect(lines.rice.text.vi).toContain('Lúa');
    if (scene.crop.ndvi != null) expect(lines.rice.sourceIds).toEqual(['modis-mod13q1']);
    for (const l of Object.values(lines)) expect(l.text.vi.length).toBeGreaterThan(10);
  });

  it('says the grower\'s own pH is the grower\'s', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const scene = farmSceneAt(input, computeScoreTimeline(input), input.today);
    expect(scene.soil).toMatchObject({ ph: 4.5, phFrom: 'grower', phState: 'low', phUncertainty: null });
    const soil = farmLines(input, scene).soil;
    expect(soil.text.en).toContain('Soil pH 4.5 (your own value): too acid');
    expect(soil.text.vi).toContain('pH đất 4.5 (số của bạn): hơi chua');
    expect(soil.mood).toBe('worried');
  });

  it('says there is no reading, and names no source, on a field without data', () => {
    const base = demo('cantho-rice');
    const branches = Object.fromEntries(BRANCHES.map((b) => [b, emptyBranch(b)])) as Record<BranchId, BranchTelemetry>;
    const input: ModelInput = { ...base, telemetry: { ...base.telemetry, branches } };
    const scene = farmSceneAt(input, computeScoreTimeline(input), input.today);
    expect(scene.weather.kind).toBe('unknown');
    expect(scene.soil).toMatchObject({ moisture: null, state: null, ph: null });
    expect(scene.crop.vigor).toBeNull();
    const lines = farmLines(input, scene);
    expect(lines.space).toMatchObject({ text: { en: 'I have no weather reading for this day.' }, sourceIds: [] });
    expect(lines.soil.text.en).toContain('no soil reading');
    expect(lines.soil.sourceIds).toEqual([]);
    expect(lines.rice.text.en).toContain('No recent satellite image');
    expect(lines.rice.sourceIds).toEqual([]);
  });

  it('announces the next warning of the forecast, and a forecast day as a forecast', () => {
    const input = demo('iowa-corn-soy');
    const score = computeScoreTimeline(input);
    const risk = nextRisk(input.telemetry, input.today);
    expect(risk).not.toBeNull();
    const today = farmLines(input, farmSceneAt(input, score, input.today)).space;
    expect(today.text.en).toContain('Ahead:');
    expect(today.sourceIds).toContain(risk!.sourceId);
    // A forecast day from the strip: the sky is that day's, the crop and soil stay today's.
    const day = addDays(input.today, 3);
    const scene = farmSceneAt(input, score, input.today, day);
    expect(scene.weather).toMatchObject({ t: day, forecast: true });
    expect(scene.crop).toEqual(farmSceneAt(input, score, input.today).crop);
    expect(farmLines(input, scene).space.text.en.startsWith('Forecast for ')).toBe(true);
    expect(farmLines(input, scene).space.text.vi.startsWith('Dự báo ngày ')).toBe(true);
  });
});

describe('trials', () => {
  it('the what-if moves say what they change', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const moves = whatIf(input);
    const ph = moves.find((m) => m.changedFactor === 'ph')!;
    expect(ph.apply!.groundTruth!.ph).toBeGreaterThan(4.5);
    expect(ph.apply!.cropId).toBeUndefined();
    const crop = moves.find((m) => m.changedFactor === 'crop')!;
    expect(crop.apply!.cropId).not.toBe(input.cropId);
  });

  it('proposes only moves that raise the outcome, best first, each from the right character', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const base = computeScoreTimeline(input);
    const options = farmOptions(input, base);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.delta > 0 && o.after > o.before)).toBe(true);
    for (let i = 1; i < options.length; i++) expect(options[i].delta).toBeLessThanOrEqual(options[i - 1].delta);
    const ph = options.find((o) => o.kind === 'ph')!;
    expect(ph.by).toBe('soil');
    expect(ph.caveat.en).toContain('soil test');
    expect(ph.caveat.vi).toContain('phân tích đất');
    for (const o of options.filter((x) => x.kind === 'crop')) expect(o.by).toBe('rice');
    expect(options.filter((o) => o.kind === 'crop').length).toBeLessThanOrEqual(3);
  });

  it('runs the same year with the change, and leaves the grower\'s entries alone', () => {
    const input = demo('daklak-coffee', { ph: 4.5 });
    const frozen = JSON.stringify(input.groundTruth);
    const base = computeScoreTimeline(input);
    const ph = farmOptions(input, base).find((o) => o.kind === 'ph')!;
    const trial = runTrial(input, ph);
    expect(JSON.stringify(input.groundTruth)).toBe(frozen);
    expect(trial.input.telemetry).toBe(input.telemetry);
    expect(trial.input.groundTruth.ph).toBe(ph.change.groundTruth!.ph);
    expect(seasonOutcome(trial.score)).toBe(ph.after);
    expect(seasonOutcome(trial.score)).toBeGreaterThan(seasonOutcome(base));
    // The scene of the trial reads the trial's soil.
    const scene = farmSceneAt(trial.input, trial.score, input.today);
    expect(scene.soil.ph).toBe(ph.change.groundTruth!.ph);
    expect(scene.soil.phState).toBe('ok');
  });

  it('a crop trial draws the other crop', () => {
    const input = demo('cantho-rice');
    const next = withChange(input, { cropId: 'zea-mays', groundTruth: { sowingDate: undefined } });
    expect(next.cropId).toBe('zea-mays');
    expect(input.cropId).toBe('oryza-sativa');
    const scene = farmSceneAt(next, computeScoreTimeline(next), input.today);
    expect(scene.crop).toMatchObject({ cropId: 'zea-mays', look: 'tall-cereal' });
  });
});
