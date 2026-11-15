/**
 * The rotation builder and what the country of the parcel grows (K10; docs/SCORING.md, section 12).
 * The country tables are the real rows of data/crops/atlas/crop_country.csv, read the way the
 * scripts read them; where a test needs a table that says something else, it says so.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CountryCrops, FieldTelemetry, ModelInput, RotationStrategy } from '@/contracts';
import { computeScoreTimeline, prevalenceStatus, TRIAL_MIN_COMPATIBILITY } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { countryCropsFromAtlas } from '../../../scripts/crops/country-crops';
import { buildAdvisoryReport, slotCropChoices, swapRotationSeason } from './index';
import { buildRotations, countryKey, countryStatus } from './rotation';

const FIELDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const ISO3: Record<string, string> = { 'daklak-coffee': 'VNM', 'cantho-rice': 'VNM', 'iowa-corn-soy': 'USA', 'nevada-alfalfa': 'USA' };

const telemetry = new Map<string, FieldTelemetry>();
const load = (id: string): FieldTelemetry => telemetry.get(id) ?? telemetry.set(id, JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry).get(id)!;

/** A demo field as the app opens it; `country` is what the model is told about the country, if anything. */
function inputFor(id: string, country?: CountryCrops): ModelInput {
  const parcel = getSampleParcel(id)!;
  const defaults = (parcel as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth ?? {};
  return { parcel, telemetry: load(id), cropId: parcel.defaultCropId, groundTruth: { ...defaults }, priorities: ['profit', 'water', 'soil'], today: '2026-11-14', ...(country ? { country } : {}) };
}

const cropsOf = (r: RotationStrategy): string[] => [...new Set(r.seasons.map((s) => s.cropId).filter((id) => id !== 'fallow'))];
const sequence = (r: RotationStrategy): string =>
  `${r.kind} ${r.years}y: ${r.seasons
    .filter((s) => s.cropId !== 'fallow')
    .map((s) => `${s.cropId}@${s.startMonth}${(s.year ?? 0) > 0 ? `/y${s.year}` : ''}${(s.share ?? 1) < 1 ? `*${s.share}` : ''}`)
    .join(' ')}`;

/** The same table with other levels for some crops, as rows FAOSTAT names the crop in. */
function withLevels(country: CountryCrops, levels: Record<string, 'absent' | 'minor'>): CountryCrops {
  const prevalence = { ...country.prevalence };
  for (const [id, level] of Object.entries(levels)) prevalence[id] = { ...(prevalence[id] ?? { source: 'test' }), level, match: 'exact' };
  return { iso3: country.iso3, prevalence };
}

describe('without a country table', () => {
  // The rotations of the four demo fields as `main` built them before the builder read a country table (15 November 2026).
  const BEFORE: Record<(typeof FIELDS)[number], string[]> = {
    'daklak-coffee': [
      'current 1y: coffea-canephora@1',
      'soil-health 1y: coffea-canephora@1 arachis-pintoi@1*0.25',
      'water-saver 1y: coffea-canephora@1*0.7 phaseolus-vulgaris@5*0.3',
      'resilience 1y: coffea-canephora@1*0.6 phaseolus-vulgaris@5*0.2 arachis-pintoi@1*0.25',
    ],
    'cantho-rice': [
      'current 1y: oryza-sativa@11 oryza-sativa@3 oryza-sativa@7',
      'soil-health 2y: oryza-sativa@11 sesbania-rostrata@3 arachis-hypogaea@5 sesbania-rostrata@9 glycine-max@1/y1 sesbania-rostrata@5/y1 ipomoea-batatas@7/y1 sesbania-rostrata@11/y1',
      'water-saver 1y: phaseolus-vulgaris@10 fagopyrum-esculentum@1',
      'income 1y: glycine-max@1 ipomoea-batatas@5 oryza-sativa@9',
      'resilience 3y: oryza-sativa@11 sesbania-rostrata@3 glycine-max@1/y1 sesbania-rostrata@5/y1 ipomoea-batatas@5/y2',
    ],
    'iowa-corn-soy': [
      'current 2y: zea-mays@5 glycine-max@5/y1',
      'soil-health 2y: zea-mays@5 glycine-max@6/y1',
      'water-saver 1y: citrullus-lanatus@6 fagopyrum-esculentum@9',
      'income 2y: zea-mays@6 phaseolus-vulgaris@5/y1 brassica-napus@8/y1',
      'resilience 3y: zea-mays@5 phaseolus-vulgaris@7/y1 solanum-tuberosum@5/y2',
    ],
    'nevada-alfalfa': [
      'current 1y: medicago-sativa@1',
      'soil-health 5y: medicago-sativa@1 medicago-sativa@1/y1 medicago-sativa@1/y2 medicago-sativa@1/y3',
      'resilience 5y: medicago-sativa@1 medicago-sativa@1/y1 medicago-sativa@1/y2',
    ],
  };

  it.each(FIELDS)('%s: the rotations are the ones built before', (id) => {
    const rotations = buildRotations(inputFor(id));
    expect(rotations.map(sequence)).toEqual(BEFORE[id]);
    // Nothing is said about a country that was not given.
    for (const r of rotations) {
      expect(r.gaps.some((g) => /No statistic says/.test(g.en))).toBe(false);
      expect(r.risks.some((g) => /New crop, needs a trial/.test(g.en))).toBe(false);
    }
    expect(countryStatus(inputFor(id), 'fagopyrum-esculentum')).toBeNull();
  });

  it('a table in which every crop is grown changes nothing either', () => {
    for (const id of FIELDS) {
      const real = countryCropsFromAtlas(ISO3[id]);
      const allGrown: CountryCrops = { iso3: real.iso3, prevalence: Object.fromEntries(buildRotations(inputFor(id)).flatMap(cropsOf).map((c) => [c, { level: 'minor' as const, match: 'exact' as const, source: 'test' }])) };
      // Crops missing from this table are unknown, which keeps them; the ones the rotations use are grown.
      expect(buildRotations(inputFor(id, allGrown)).map(sequence)).toEqual(BEFORE[id]);
    }
  });
});

describe('with the table of the country', () => {
  it.each(FIELDS)('%s: no strategy the builder proposes holds a crop the country reports none of', (id) => {
    const input = inputFor(id, countryCropsFromAtlas(ISO3[id]));
    for (const r of buildRotations(input)) {
      // The current practice is what the grower grows, whatever a statistic says.
      if (r.kind === 'current') continue;
      expect(cropsOf(r).filter((c) => countryStatus(input, c) === 'absent'), r.id).toEqual([]);
    }
  });

  it('the Mekong paddy field: buckwheat, which Viet Nam reports none of, leaves the water-saver rotation', () => {
    const vnm = countryCropsFromAtlas('VNM');
    expect(vnm.prevalence['fagopyrum-esculentum']).toMatchObject({ level: 'absent', match: 'exact' });
    const before = buildRotations(inputFor('cantho-rice')).find((r) => r.kind === 'water-saver')!;
    const after = buildRotations(inputFor('cantho-rice', vnm)).find((r) => r.kind === 'water-saver')!;
    expect(cropsOf(before)).toContain('fagopyrum-esculentum');
    expect(cropsOf(after)).not.toContain('fagopyrum-esculentum');
    expect(cropsOf(after)).toEqual(['phaseolus-vulgaris', 'raphanus-sativus']);
    // The four other rotations of the field hold no such crop and are built as before.
    const others = (rs: RotationStrategy[]) => rs.filter((r) => r.kind !== 'water-saver').map(sequence);
    expect(others(buildRotations(inputFor('cantho-rice', vnm)))).toEqual(others(buildRotations(inputFor('cantho-rice'))));
  });

  it('a crop the statistics cannot tell about stays, and the strategy says so in both languages', () => {
    const vnm = countryCropsFromAtlas('VNM');
    const input = inputFor('daklak-coffee', vnm);
    // Common bean is counted inside a FAOSTAT group: its row says nothing of the species.
    expect(vnm.prevalence['phaseolus-vulgaris'].match).toBe('group');
    expect(countryStatus(input, 'phaseolus-vulgaris')).toBe('unknown');
    const waterSaver = buildRotations(input).find((r) => r.kind === 'water-saver')!;
    expect(cropsOf(waterSaver)).toContain('phaseolus-vulgaris');
    const gap = waterSaver.gaps.find((g) => g.en.startsWith('No statistic says'))!;
    expect(gap.en).toContain('Common bean');
    expect(gap.vi).toMatch(/^Chưa có số liệu cho biết nước của thửa ruộng này có trồng Đậu cô ve hay không/);
    // The grower's own crop is not questioned: robusta is grown on this field.
    expect(buildRotations(input).find((r) => r.kind === 'current')!.gaps.some((g) => g.en.startsWith('No statistic says'))).toBe(false);
  });

  it('durian, a group crop in Viet Nam, stays a choice in Đắk Lắk and is marked as not known', () => {
    // No rotation of the Đắk Lắk field picks durian today (see the sequences above), so the test
    // looks where the grower can pick it: the choices for a slot of the stand.
    const vnm = countryCropsFromAtlas('VNM');
    expect(prevalenceStatus(vnm.prevalence['durio-zibethinus'])).toBe('unknown');
    const input = inputFor('daklak-coffee', vnm);
    const resilience = buildRotations(input).find((r) => r.kind === 'resilience')!;
    const durian = slotCropChoices(input, resilience, 0).find((c) => c.cropId === 'durio-zibethinus');
    expect(durian).toMatchObject({ prevalence: 'unknown' });
    expect(durian!.suitability).toBeGreaterThan(0);
  });

  it('the grower\'s own crop stays in every strategy although a table reports none of it', () => {
    // Not what the atlas says of rice in Viet Nam: a table made for this test.
    const noRice = withLevels(countryCropsFromAtlas('VNM'), { 'oryza-sativa': 'absent' });
    const input = inputFor('cantho-rice', noRice);
    const rotations = buildRotations(input);
    expect(rotations.find((r) => r.kind === 'current')!.seasons.filter((s) => s.cropId === 'oryza-sativa')).toHaveLength(3);
    expect(rotations.filter((r) => r.kind !== 'current').some((r) => cropsOf(r).includes('oryza-sativa'))).toBe(true);
    for (const r of rotations) expect(r.risks.some((x) => /New crop, needs a trial/.test(x.en)), r.id).toBe(false);
  });
});

describe('the crop choices of a slot', () => {
  const vnm = countryCropsFromAtlas('VNM');
  const input = inputFor('cantho-rice', vnm);
  const current = buildRotations(input).find((r) => r.kind === 'current')!;
  const third = current.seasons.findIndex((s) => s.startMonth === 7);
  const choices = slotCropChoices(input, current, third);

  it('say how much of each crop the country grows', () => {
    expect(choices.find((c) => c.cropId === 'fallow')!.prevalence).toBeUndefined();
    expect(choices.find((c) => c.cropId === 'oryza-sativa')).toMatchObject({ prevalence: 'major' });
    expect(choices.find((c) => c.cropId === 'ipomoea-batatas')).toMatchObject({ prevalence: 'common' });
    expect(choices.find((c) => c.cropId === 'phaseolus-vulgaris')).toMatchObject({ prevalence: 'unknown' });
    // Without a table nothing is said.
    for (const c of slotCropChoices(inputFor('cantho-rice'), buildRotations(inputFor('cantho-rice')).find((r) => r.kind === 'current')!, third)) expect(c.prevalence).toBeUndefined();
  });

  it('offer a crop the country reports none of last, and only where it suits the field', () => {
    const absent = choices.filter((c) => c.prevalence === 'absent');
    expect(absent.length).toBeGreaterThan(0);
    // Three of the crops docs/SCORING.md, 12.4, names as unreported in Viet Nam rather than known not to be grown.
    expect(absent.map((c) => c.cropId)).toEqual(expect.arrayContaining(['lycopersicon-esculentum', 'cucumis-sativus', 'solanum-melongena']));
    for (const c of absent) expect(c.suitability, c.cropId).toBeGreaterThanOrEqual(TRIAL_MIN_COMPATIBILITY * 100);
    const firstAbsent = choices.findIndex((c) => c.prevalence === 'absent');
    expect(choices.slice(firstAbsent).every((c) => c.prevalence === 'absent')).toBe(true);
    // The same slot without a table offers more crops: the ones dropped are the absent ones below the threshold.
    const untold = slotCropChoices(inputFor('cantho-rice'), buildRotations(inputFor('cantho-rice')).find((r) => r.kind === 'current')!, third);
    const dropped = untold.filter((c) => !choices.some((x) => x.cropId === c.cropId));
    for (const c of dropped) {
      expect(countryStatus(input, c.cropId), c.cropId).toBe('absent');
      expect(c.suitability ?? 0, c.cropId).toBeLessThan(TRIAL_MIN_COMPATIBILITY * 100);
    }
  });

  it('a rotation the grower puts such a crop into says it is a new crop that needs a trial', () => {
    const base = buildRotations(input);
    const res = swapRotationSeason(input, base, current, third, 'lycopersicon-esculentum')!;
    const custom = res.rotations.find((r) => r.kind === 'custom')!;
    expect(cropsOf(custom)).toContain('lycopersicon-esculentum');
    const risk = custom.risks.find((x) => x.en.startsWith('New crop, needs a trial'))!;
    expect(risk.en).toContain('Tomato');
    expect(risk.vi).toMatch(/^Cây mới, cần thử nghiệm/);
    expect(risk.vi).toContain('Cà chua');
  });
});

describe('the remembered result', () => {
  it('is not returned for another country table', () => {
    const vnm = countryCropsFromAtlas('VNM');
    const plain = inputFor('cantho-rice');
    const withCountry = inputFor('cantho-rice', vnm);
    // One telemetry object for both: the memo is keyed on it.
    expect(withCountry.telemetry).toBe(plain.telemetry);
    const a = buildRotations(plain);
    const b = buildRotations(withCountry);
    expect(b).not.toBe(a);
    expect(b.map(sequence)).not.toEqual(a.map(sequence));
    // The same call again is remembered; so is an equal table carried by another object.
    expect(buildRotations(withCountry)).toBe(b);
    expect(buildRotations(inputFor('cantho-rice', { iso3: 'VNM', prevalence: { ...vnm.prevalence } }))).toBe(b);
    expect(buildRotations(plain)).toBe(a);
    // A table that says buckwheat is grown brings it back.
    const grown = buildRotations(inputFor('cantho-rice', withLevels(vnm, { 'fagopyrum-esculentum': 'minor' })));
    expect(grown).not.toBe(b);
    expect(cropsOf(grown.find((r) => r.kind === 'water-saver')!)).toContain('fagopyrum-esculentum');
  });

  it('the advisory report is rebuilt as well', () => {
    const plain = inputFor('cantho-rice');
    const withCountry = inputFor('cantho-rice', countryCropsFromAtlas('VNM'));
    const score = computeScoreTimeline(plain);
    const a = buildAdvisoryReport(plain, score);
    const b = buildAdvisoryReport(withCountry, score);
    expect(b).not.toBe(a);
    expect(cropsOf(a.rotations.find((r) => r.kind === 'water-saver')!)).toContain('fagopyrum-esculentum');
    expect(cropsOf(b.rotations.find((r) => r.kind === 'water-saver')!)).not.toContain('fagopyrum-esculentum');
  });

  it('the key holds what the rotations depend on: country, and for each crop grown, absent or not known', () => {
    const vnm = countryCropsFromAtlas('VNM');
    expect(countryKey(inputFor('cantho-rice'))).toBe('');
    const key = countryKey(inputFor('cantho-rice', vnm));
    expect(key.startsWith('VNM:')).toBe(true);
    expect(key).toContain('oryza-sativa=g');
    expect(key).toContain('fagopyrum-esculentum=a');
    expect(key).toContain('phaseolus-vulgaris=u');
    // A change of share that leaves the status alone does not change the key.
    const shifted: CountryCrops = { iso3: 'VNM', prevalence: { ...vnm.prevalence, 'oryza-sativa': { ...vnm.prevalence['oryza-sativa'], sharePct: 1 } } };
    expect(countryKey(inputFor('cantho-rice', shifted))).toBe(key);
  });
});
