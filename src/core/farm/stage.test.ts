import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldRaster, FieldTelemetry, ModelInput } from '@/contracts';
import { buildAdvisoryReport } from '@/core/advisory';
import { getCrop } from '@/core/crops';
import { computeScoreTimeline } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { addDays, diffDays } from '@/lib/time';
import { CROWN, HARVEST_DAYS, MAX_BARE_MONTHS, MAX_TRADE_OFF, MIN_GROWTH_GAIN, PATCH_MAX_AGE_DAYS, bareRun, farmOptions, fieldPatches, cropLook, farmNotes, farmPeriods, farmSceneAt, farmSceneOfPeriod, periodDay, periodLand, periodScore, periodSky, periodWeather, runOn, seasonMonths, seasonRuns, weatherAt } from './index';

function demo(id: string): ModelInput {
  const parcel = getSampleParcel(id)!;
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...(parcel.defaultGroundTruth ?? {}) }, priorities: ['profit', 'soil', 'water'], today: telemetry.window.today };
}

describe('the year in months and quarters', () => {
  const input = demo('cantho-rice');
  const win = input.telemetry.window;

  it('is the twelve calendar months ending with today, inside the window, without a gap', () => {
    const months = farmPeriods(win, 'month');
    expect(months).toHaveLength(12);
    expect(months.at(-1)!.to).toBe(win.today);
    expect(months.at(-1)!.months[0]).toBe(Number(win.today.slice(5, 7)));
    expect(months[0].from >= win.start).toBe(true);
    for (let i = 1; i < months.length; i++) expect(months[i].from).toBe(addDays(months[i - 1].to, 1));
    for (const m of months) expect(m.from <= m.to).toBe(true);
  });

  it('groups the same months three at a time, the last quarter ending today', () => {
    const quarters = farmPeriods(win, 'quarter');
    expect(quarters).toHaveLength(4);
    expect(quarters.at(-1)!.to).toBe(win.today);
    expect(quarters.flatMap((q) => q.months)).toEqual(farmPeriods(win, 'month').flatMap((m) => m.months));
    expect(quarters[0].from).toBe(farmPeriods(win, 'month')[0].from);
  });

  it('sums a period from its days and adds nothing', () => {
    for (const p of farmPeriods(win, 'month')) {
      const s = periodWeather(input.telemetry, p);
      let rain = 0;
      let read = 0;
      for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
        const w = weatherAt(input.telemetry, d);
        if (w.kind !== 'unknown') read++;
        rain += w.rainMm ?? 0;
      }
      expect(s.days).toBe(diffDays(p.to, p.from) + 1);
      expect(s.daysRead).toBe(read);
      expect(s.rainMm ?? 0).toBeCloseTo(rain, 0);
      expect(s.wetDays).toBeLessThanOrEqual(s.daysRead);
    }
  });

  it('draws the sky of a period by rule, rain first, and unknown without a reading', () => {
    const none = { daysRead: 0, wetDays: 0, heavyRainDays: 0, hotDays: 0, frostDays: 0, overcastDays: 0 };
    expect(periodSky(none)).toBe('unknown');
    expect(periodSky({ ...none, daysRead: 30 })).toBe('clear');
    expect(periodSky({ ...none, daysRead: 30, wetDays: 12, hotDays: 15 })).toBe('rain');
    expect(periodSky({ ...none, daysRead: 30, wetDays: 14, heavyRainDays: 3 })).toBe('heavy-rain');
    expect(periodSky({ ...none, daysRead: 30, hotDays: 9 })).toBe('hot');
    expect(periodSky({ ...none, daysRead: 30, frostDays: 5 })).toBe('frost');
    expect(periodSky({ ...none, daysRead: 30, overcastDays: 15 })).toBe('cloudy');
    const before = periodWeather(input.telemetry, { id: 'x', step: 'month', from: addDays(win.start, -60), to: addDays(win.start, -31), months: [1], partial: false });
    expect(before).toMatchObject({ kind: 'unknown', rainMm: null, tMaxMeanC: null, daysRead: 0 });
  });

  it('shows the field of the period day (a harvest inside it, else its last day) under the sky of the whole period', () => {
    const score = computeScoreTimeline(input);
    for (const p of farmPeriods(win, 'quarter')) {
      const { scene, summary } = farmSceneOfPeriod(input, score, p);
      const on = periodDay(input, score, p);
      expect(on >= p.from && on <= p.to).toBe(true);
      const day = farmSceneAt(input, score, on);
      expect(scene.crop).toEqual(day.crop);
      expect(scene.soil).toEqual(day.soil);
      expect(scene.weather.kind).toBe(summary.kind);
      expect(scene.weather.rainMm).toBe(summary.rainMm);
      const mean = periodScore(score, p);
      expect(mean == null || (mean >= 0 && mean <= 100)).toBe(true);
    }
  });

  it('lets a crop be seen growing: the maize field passes from bare to full height across the months', () => {
    const maize = demo('iowa-corn-soy');
    const score = computeScoreTimeline(maize);
    const growth = farmPeriods(maize.telemetry.window, 'month').map((p) => farmSceneOfPeriod(maize, score, p).scene.crop.growth);
    expect(Math.min(...growth)).toBe(0);
    expect(Math.max(...growth)).toBe(1);
  });

  it('shows each harvest of the year, in months and in quarters, even when it is over by the last day', () => {
    // Maize in Iowa: the harvest stage runs in early September, so 31 August and 30 September both miss it.
    const maize = demo('iowa-corn-soy');
    const ms = computeScoreTimeline(maize);
    const harvestDays = ms.snapshots.filter((s) => s.stage?.id === 'harvest').map((s) => s.t);
    expect(harvestDays.length).toBeGreaterThan(0);
    for (const step of ['month', 'quarter'] as const) {
      const cut = farmPeriods(maize.telemetry.window, step).filter((p) => farmSceneOfPeriod(maize, ms, p).scene.crop.harvested != null);
      expect(cut, step).toHaveLength(1);
      expect(cut[0].from <= harvestDays[0] && harvestDays[0] <= cut[0].to).toBe(true);
    }
    // Rice in Can Tho, three crops a year back to back with no harvest stage: the end of each late season is the harvest.
    const rice = demo('cantho-rice');
    const rs = computeScoreTimeline(rice);
    const ends = rs.snapshots.filter((s, i) => s.stage?.id === 'late-season' && rs.snapshots[i + 1]?.stage?.id === 'initial').map((s) => s.t);
    expect(ends.length).toBe(3);
    const months = farmPeriods(rice.telemetry.window, 'month').filter((p) => farmSceneOfPeriod(rice, rs, p).scene.crop.harvested != null);
    expect(months.map((p) => p.id)).toEqual(ends.map((t) => t.slice(0, 7)));
    for (const end of ends) {
      // Cut from the first to the last of the late season's final HARVEST_DAYS, then gone on the next sowing.
      expect(farmSceneAt(rice, rs, addDays(end, -HARVEST_DAYS)).crop.harvested).toBeNull();
      expect(farmSceneAt(rice, rs, addDays(end, -HARVEST_DAYS + 1)).crop.harvested).toBeCloseTo(1 / HARVEST_DAYS);
      expect(farmSceneAt(rice, rs, end).crop.harvested).toBe(1);
      expect(farmSceneAt(rice, rs, addDays(end, 1)).crop.harvested).toBeNull();
    }
  });

  it('sends no harvester to a perennial, nor to a late season that does not end inside the window', () => {
    const coffee = demo('daklak-coffee');
    const cs = computeScoreTimeline(coffee);
    for (const p of farmPeriods(coffee.telemetry.window, 'month')) expect(farmSceneOfPeriod(coffee, cs, p).scene.crop.harvested).toBeNull();
    const alfalfa = demo('nevada-alfalfa');
    const as = computeScoreTimeline(alfalfa);
    for (const p of farmPeriods(alfalfa.telemetry.window, 'month')) expect(farmSceneOfPeriod(alfalfa, as, p).scene.crop.harvested).toBeNull();
  });
});

describe('a rotation on the stage', () => {
  it('lists the months of a season across the new year', () => {
    expect(seasonMonths(11, 2)).toEqual([11, 12, 1, 2]);
    expect(seasonMonths(3, 3)).toEqual([3]);
    expect(seasonMonths(1, 12)).toHaveLength(12);
  });

  it('puts the crop of each season on the field in its months, and leaves the grower entries alone', () => {
    const input = demo('cantho-rice');
    const before = JSON.stringify(input.groundTruth);
    const report = buildAdvisoryReport(input, computeScoreTimeline(input));
    expect(report.rotations.length).toBeGreaterThan(0);
    for (const strategy of report.rotations) {
      const runs = seasonRuns(input, strategy);
      for (const p of farmPeriods(input.telemetry.window, 'month')) {
        const run = runOn(runs, p.to);
        if (!run) continue;
        expect(run.months).toContain(p.months[0]);
        const wanted = run.season.cropId === 'fallow' ? null : run.season.cropId;
        expect(run.input.cropId).toBe(wanted);
        const scene = farmSceneOfPeriod(run.input, run.score, p).scene;
        expect(scene.crop.look).toBe(cropLook(getCrop(wanted)));
      }
    }
    expect(JSON.stringify(input.groundTruth)).toBe(before);
  });

  it('draws bare ground for a month the strategy leaves empty', () => {
    const input = demo('cantho-rice');
    const bare = bareRun(input);
    expect(bare.input.cropId).toBeNull();
    expect(farmSceneAt(bare.input, bare.score, input.today).crop.look).toBe('none');
    expect(input.cropId).not.toBeNull();
  });
});

describe('the short notes of the three characters', () => {
  it('give a verdict and at most two points each, in both languages, without measurement jargon', () => {
    for (const id of ['cantho-rice', 'iowa-corn-soy', 'daklak-coffee', 'nevada-alfalfa']) {
      const input = demo(id);
      const score = computeScoreTimeline(input);
      const report = buildAdvisoryReport(input, score);
      const today = farmNotes(input, farmSceneAt(input, score, input.today), { report });
      const periods = farmPeriods(input.telemetry.window, 'month').map((p) => {
        const { scene, summary } = farmSceneOfPeriod(input, score, p);
        return farmNotes(input, scene, { summary, report });
      });
      for (const notes of [today, ...periods]) {
        for (const who of ['space', 'soil', 'rice'] as const) {
          const note = notes[who];
          expect(note.headline.en.length, `${id} ${who}`).toBeGreaterThan(0);
          expect(note.headline.vi.length, `${id} ${who}`).toBeGreaterThan(0);
          expect(note.points.length).toBeLessThanOrEqual(2);
          for (const text of [note.headline, ...note.points]) {
            expect(text.en).not.toMatch(/NDVI|m³/);
            expect(text.vi).not.toMatch(/NDVI|m³/);
          }
        }
      }
    }
  });

  it('say there is no reading instead of guessing, and name a remedy only when the soil plan has one', () => {
    const input = demo('cantho-rice');
    const score = computeScoreTimeline(input);
    const blank: ModelInput = { ...input, telemetry: { ...input.telemetry, branches: Object.fromEntries(Object.entries(input.telemetry.branches).map(([k, b]) => [k, { ...b, series: [], facts: [], events: [] }])) as unknown as FieldTelemetry['branches'] } };
    const notes = farmNotes(blank, farmSceneAt(blank, score, input.today));
    expect(notes.space.headline.en).toMatch(/No weather reading/);
    expect(notes.soil.headline.en).toMatch(/No soil moisture reading/);
    expect(notes.soil.points).toHaveLength(0);
    expect(notes.soil.alert).toBe(false);
    const withPlan = farmNotes(input, farmSceneAt(input, score, input.today), {
      report: { ...buildAdvisoryReport(input, score), soilPlan: { summary: { en: '', vi: '' }, mostLimitingFactor: 'ph', items: [{ metric: 'ph', status: 'outside', title: { en: 'Raise the pH with lime', vi: 'Nâng pH bằng vôi' }, action: { en: '', vi: '' }, rateRange: null, timing: { en: '', vi: '' }, verification: { en: '', vi: '' }, evidence: [], caveats: [], needsLocalReview: true }] } },
    });
    expect(withPlan.soil.alert).toBe(true);
    expect(withPlan.soil.points.some((p) => p.vi.includes('Nâng pH bằng vôi'))).toBe(true);
  });
});

describe('the land month by month', () => {
  it('draws a herbaceous perennial as tall as its observed canopy: alfalfa in Nevada', () => {
    const alfalfa = demo('nevada-alfalfa');
    const score = computeScoreTimeline(alfalfa);
    const land = farmPeriods(alfalfa.telemetry.window, 'month').map((p) => ({ id: p.id, ...periodLand(alfalfa, score, p) }));
    const growth = land.map((l) => l.growth);
    // Its crown in winter, full height under a closed canopy (MODIS NDVI above 0.75 in June and July).
    expect(Math.min(...growth)).toBe(CROWN);
    expect(Math.max(...growth)).toBe(1);
    expect(land.every((l) => !l.bare && l.look === 'grass')).toBe(true);
    // After the summer peak a cut shows: lower than full height, still above the crown.
    const top = growth.indexOf(1);
    expect(growth.slice(top).some((g) => g < 0.9 && g > CROWN)).toBe(true);
    // At least five heights through the year, where the stage calendar drew three.
    expect(new Set(growth.map((g) => g.toFixed(2))).size).toBeGreaterThanOrEqual(5);
  });

  it('keeps the stage calendar for a herbaceous perennial that is not the field\'s own crop', () => {
    const alfalfa = demo('nevada-alfalfa');
    const other = { ...alfalfa, parcel: { ...alfalfa.parcel, defaultCropId: 'zea-mays' } };
    const score = computeScoreTimeline(other);
    const growth = farmPeriods(other.telemetry.window, 'month').map((p) => periodLand(other, score, p).growth);
    // Without the canopy it stands at its crown or climbs through its stages, never dipping after the top.
    const top = growth.indexOf(1);
    expect(top).toBeGreaterThan(-1);
    expect(growth.slice(top).every((g) => g === 1 || g === CROWN)).toBe(true);
  });

  it('keeps a woody perennial at full height: coffee in Dak Lak', () => {
    const coffee = demo('daklak-coffee');
    const score = computeScoreTimeline(coffee);
    for (const p of farmPeriods(coffee.telemetry.window, 'month')) expect(periodLand(coffee, score, p).growth).toBe(1);
  });

  it('shows bare ground, sowing, growth and the harvest of the maize field, and the three rice harvests', () => {
    const maize = demo('iowa-corn-soy');
    const ms = computeScoreTimeline(maize);
    const land = farmPeriods(maize.telemetry.window, 'month').map((p) => periodLand(maize, ms, p));
    expect(land.some((l) => l.bare)).toBe(true);
    expect(land.filter((l) => l.harvested != null)).toHaveLength(1);
    const grown = land.filter((l) => !l.bare).map((l) => l.growth);
    expect(Math.min(...grown)).toBeLessThan(1);
    for (const l of land) if (l.bare) expect(l).toMatchObject({ cropId: null, look: 'none' });
    const rice = demo('cantho-rice');
    const rs = computeScoreTimeline(rice);
    expect(farmPeriods(rice.telemetry.window, 'month').filter((p) => periodLand(rice, rs, p).harvested != null)).toHaveLength(3);
  });
});

describe('patches of the field from its NDVI picture', () => {
  const rasterOf = (id: string): FieldRaster => (JSON.parse(readFileSync(`public/data/samples/${id}.rasters.json`, 'utf8')) as FieldRaster[]).find((r) => r.key === 'ndvi')!;

  it('shows the weak and strong parts of a field that has them, as ratios to its mean', () => {
    const coffee = demo('daklak-coffee');
    const p = fieldPatches(rasterOf('daklak-coffee'), coffee.parcel, coffee.telemetry.window.today, 8, 20)!;
    expect(p.ratio).toHaveLength(160);
    expect(p.shares.low).toBeGreaterThan(0.1);
    expect(p.shares.high).toBeGreaterThan(0);
    expect(p.shares.low + p.shares.medium + p.shares.high).toBeCloseTo(1);
    expect(p.date <= coffee.telemetry.window.today).toBe(true);
  });

  it('keeps an even field even, and says nothing from a picture too old to describe the day', () => {
    const rice = demo('cantho-rice');
    const even = fieldPatches(rasterOf('cantho-rice'), rice.parcel, rice.telemetry.window.today, 8, 20)!;
    expect(even.shares.medium).toBe(1);
    const r = rasterOf('cantho-rice');
    const lastDay = r.frames.at(-1)!.t;
    expect(fieldPatches(r, rice.parcel, addDays(lastDay, PATCH_MAX_AGE_DAYS + 1), 8, 20)).toBeNull();
    expect(fieldPatches(undefined, rice.parcel, lastDay, 8, 20)).toBeNull();
  });
});

describe('what the characters propose', () => {
  it('gives every sample field something to try, each different, and says which are trade-offs', () => {
    for (const id of ['cantho-rice', 'daklak-coffee', 'iowa-corn-soy', 'nevada-alfalfa']) {
      const input = demo(id);
      const score = computeScoreTimeline(input);
      const opts = farmOptions(input, score);
      expect(opts.length, id).toBeGreaterThan(0);
      const keys = opts.map((o) => (o.kind === 'crop' ? `crop:${o.change.cropId}` : JSON.stringify(o.change)));
      expect(new Set(keys).size, id).toBe(keys.length);
      for (const o of opts) {
        // Nothing that changes neither figure; a gain never lowers the outcome or leaves the ground barer.
        expect(o.delta !== 0 || o.growthDelta !== 0, `${id} ${o.id}`).toBe(true);
        if (!o.tradeOff) {
          expect(o.delta >= 0 && o.monthsAfter >= o.monthsBefore - MAX_BARE_MONTHS, `${id} ${o.id}`).toBe(true);
          expect(o.delta > 0 || o.growthDelta >= MIN_GROWTH_GAIN, `${id} ${o.id}`).toBe(true);
        }
        if (o.delta < 0) expect(o.tradeOff).toBe(true);
        expect(o.delta, `${id} ${o.id}`).toBeGreaterThanOrEqual(-MAX_TRADE_OFF);
      }
    }
  });

  it('puts the real gain first where there is one: lime on the Nevada field', () => {
    const input = demo('nevada-alfalfa');
    const opts = farmOptions(input, computeScoreTimeline(input));
    expect(opts[0]).toMatchObject({ kind: 'ph', tradeOff: false });
    expect(opts[0].after).toBeGreaterThan(opts[0].before);
  });

  it('calls a switch that leaves the paddy bare most of the year a trade-off, whatever its growth score', () => {
    const input = demo('cantho-rice');
    for (const o of farmOptions(input, computeScoreTimeline(input)).filter((x) => x.monthsAfter < x.monthsBefore - MAX_BARE_MONTHS)) expect(o.tradeOff).toBe(true);
  });
});
