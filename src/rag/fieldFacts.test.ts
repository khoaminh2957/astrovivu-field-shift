import { describe, expect, it } from 'vitest';
import type { FieldContext } from '@/contracts';
import { thresholdEvents } from '@/data/harmonize/risk';
import { sampleContext } from '../../scripts/rag/sample-context';
import { FIXTURE_CONTEXT } from '../../scripts/rag/eval';
import { riskDetail, RISK_RULE } from './fieldAnswer';
import { lookupFieldFacts, monthlyNormal, parseFieldFact, readFact, riskFacts } from './fieldFacts';
import { routeIntent } from './intent';

const ctx = (facts: Record<string, string>): FieldContext => ({ ...FIXTURE_CONTEXT, facts });

describe('a fact string read back', () => {
  it('gives the value, the source, the pixel and how the number was made', () => {
    expect(parseFieldFact('ph', '5.6 (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 4.9-6.3)')).toMatchObject({
      value: '5.6',
      amount: '5.6',
      number: 5.6,
      source: 'SoilGrids v2.0',
      pixel: '250 m',
      pixelM: 250,
      provenance: 'modelled',
      interval: ['4.9', '6.3'],
    });
    // A source name with commas and brackets of its own, a date, a normal and an age.
    expect(parseFieldFact('ndvi', '0.71 (MODIS Terra MOD13Q1 v6.1 vegetation indices, 250 m pixel, 2026-10-16; 17% above normal (within the normal band, normal 0.61); stale: 29 days old)')).toMatchObject({
      amount: '0.71',
      source: 'MODIS Terra MOD13Q1 v6.1 vegetation indices',
      provenance: 'observed',
      date: '2026-10-16',
      normal: '17% above normal (within the normal band, normal 0.61)',
      staleDays: 29,
    });
    expect(parseFieldFact('climate_rain_annual', '1516 mm mean annual rainfall (ERA5 reanalysis (ECMWF), daily aggregates, 25 km pixel, modelled, 2006-2025)')).toMatchObject({
      amount: '1516 mm',
      source: 'ERA5 reanalysis (ECMWF), daily aggregates',
      pixelM: 25_000,
      provenance: 'modelled',
      period: '2006-2025',
    });
  });

  it('keeps the unit with the number and leaves describing words out', () => {
    const amount = (raw: string) => parseFieldFact('k', raw).amount;
    expect(amount('16.9 cmol(+)/kg (SoilGrids 2.0 (0-30 cm), 250 m pixel, modelled)')).toBe('16.9 cmol(+)/kg');
    expect(amount('96 mm over the 30 days to 2026-11-10 (GPM IMERG, 10 km pixel)')).toBe('96 mm');
    expect(amount('-13.1 °C lowest forecast minimum, on 2026-11-24 (16-day weather forecast, 11 km pixel, forecast, 2026-11-14 to 2026-11-28)')).toBe('-13.1 °C');
    expect(amount('71/100 productivity on 2026-11-10 (condition 74)')).toBe('71/100');
    expect(amount('Moderately well drained (SSURGO soil survey (dominant component of the map unit))')).toBe('Moderately well drained');
  });

  it('knows a number the grower entered, and the estimate it replaced', () => {
    const f = parseFieldFact('ph', '6.1 (measured by the farmer; satellite/model estimate was 5.6 (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 4.9-6.3))');
    expect(f.provenance).toBe('farmer');
    expect(f.replaced).toBe('5.6 (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 4.9-6.3)');
    expect(parseFieldFact('irrigation', 'supplemental (entered by the farmer, source well)').provenance).toBe('farmer');
  });

  it('takes a reanalysis for a model even when the fact does not repeat it', () => {
    expect(parseFieldFact('climate_monthly_rain', 'Jan 8, Feb 5 mm (monthly means, ERA5, 2005-2024)')).toMatchObject({ source: 'ERA5', provenance: 'modelled', period: '2005-2024' });
    expect(parseFieldFact('elevation_m', '602 m (parcel elevation)').provenance).toBe('unknown');
  });

  it('parses every fact of the four demo fields without losing the number', () => {
    for (const id of ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa']) {
      const c = sampleContext(id);
      for (const [key, raw] of Object.entries(c.facts)) {
        if (/^(note_|data_mode|score_|factor_|reliability|expected_yield|climate_monthly|risk_)/.test(key)) continue;
        const f = parseFieldFact(key, raw);
        expect(raw.startsWith(f.amount), `${id} ${key}: ${raw}`).toBe(true);
        if (/^-?\d/.test(raw)) expect(f.number, `${id} ${key}`).toBe(Number(raw.match(/^-?\d+(?:\.\d+)?/)![0]));
      }
    }
  });
});

describe('readings by what the question is about', () => {
  it('gives the readings of the focus and nothing else', () => {
    const { readings, missing } = lookupFieldFacts(FIXTURE_CONTEXT, ['soil', 'organic'], [], 'en');
    expect(readings.map((r) => r.key)).toEqual(['soc_gkg']);
    expect(missing).toEqual([]);
    expect(lookupFieldFacts(FIXTURE_CONTEXT, [], ['ndvi'], 'en').readings.map((r) => r.key)).toEqual(['ndvi']);
  });

  it('names a reading the field does not have, with the reason and a way to get it', () => {
    const { readings, missing } = lookupFieldFacts(FIXTURE_CONTEXT, ['salinity'], [], 'vi');
    expect(readings).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ key: 'ec_dsm', label: 'Độ mặn của đất (độ dẫn điện)' });
    expect(missing[0].why).toContain('SSURGO');
    expect(missing[0].howToGet).toContain('EC');
  });

  it('shows class names in the language of the answer and numbers as the fact prints them', () => {
    const iowa = sampleContext('iowa-corn-soy');
    expect(readFact(iowa, 'drainage_class', 'vi')!.shown).toBe('thoát nước khá tốt');
    expect(readFact(iowa, 'drainage_class', 'en')!.shown).toBe('Moderately well drained');
    expect(readFact(iowa, 'aspect_label', 'vi')!.shown).toBe('bằng phẳng (không có hướng dốc)');
    expect(readFact(iowa, 'om_pct', 'vi')!.shown).toBe('3.17 %');
  });

  it('finds the wettest and the driest month of the climate', () => {
    const n = monthlyNormal(FIXTURE_CONTEXT, 'climate_monthly_rain')!;
    expect([n.max.month, n.max.text]).toEqual([9, '280']);
    expect([n.min.month, n.min.text]).toEqual([2, '5']);
    expect(n.months).toHaveLength(12);
    expect(monthlyNormal(ctx({}), 'climate_monthly_rain')).toBeNull();
  });
});

describe('risks of the forecast', () => {
  // Sixteen days: two frosty nights, one day of 62 mm, the rest mild and wet enough.
  const days = Array.from({ length: 16 }, (_, i) => ({ t: `2026-11-${String(10 + i).padStart(2, '0')}`, tMax: 20, tMin: i === 3 || i === 4 ? -1.5 : 8, rain: i === 9 ? 62 : 3, windMaxKmh: 10 }));
  const events = thresholdEvents(days, 'open-meteo-forecast');
  const facts = Object.fromEntries(events.map((e) => [`risk_${e.kind}_${e.start}`, `${e.title.en}: ${e.detail.en} (${e.start} to ${e.end}, severity ${e.severity}/3, 16-day weather forecast, 11 km pixel, forecast)`]));

  it('reads kind, dates and level back from the facts', () => {
    expect(riskFacts(ctx(facts)).map((r) => [r.kind, r.start, r.end, r.severity])).toEqual([
      ['frost', '2026-11-13', '2026-11-14', 2],
      ['heavy-rain', '2026-11-19', '2026-11-19', 2],
    ]);
  });

  it('says the detail in Vietnamese as the app itself words it', () => {
    const read = riskFacts(ctx(facts));
    for (const [i, e] of events.entries()) expect(riskDetail(read[i], 'vi')).toBe(e.detail.vi);
    expect(riskDetail(read[0], 'en')).toBe(events[0].detail.en);
    // Every kind the app can raise.
    const all = thresholdEvents(
      Array.from({ length: 16 }, (_, i) => ({ t: `2026-07-${String(1 + i).padStart(2, '0')}`, tMax: i < 3 ? 39 : 30, tMin: 20, rain: 0, windMaxKmh: i === 5 ? 72 : 10 })),
      'x',
    );
    expect(new Set(all.map((e) => e.kind))).toEqual(new Set(['heat', 'dry-spell', 'wind']));
    for (const e of all) {
      const [r] = riskFacts(ctx({ [`risk_${e.kind}_${e.start}`]: `${e.title.en}: ${e.detail.en} (${e.start} to ${e.end}, severity ${e.severity}/3, forecast)` }));
      expect(riskDetail(r, 'vi'), e.kind).toBe(e.detail.vi);
    }
  });

  it('states the rules the app warns by', () => {
    const day = (over: Partial<{ tMax: number; tMin: number; rain: number; windMaxKmh: number }>) => ({ t: '2026-11-10', tMax: 20, tMin: 10, rain: 5, windMaxKmh: 5, ...over });
    const kinds = (ds: ReturnType<typeof day>[]) => thresholdEvents(ds.map((d, i) => ({ ...d, t: `2026-11-${String(10 + i).padStart(2, '0')}` })), 'x').map((e) => e.kind);
    // Frost at 2 °C, not at 2.1.
    expect(RISK_RULE.frost![0]).toContain('2 °C');
    expect(kinds([day({ tMin: 2 })])).toEqual(['frost']);
    expect(kinds([day({ tMin: 2.1 })])).toEqual([]);
    // Heat at 35 °C on two days running, not on one.
    expect(RISK_RULE.heat![0]).toContain('35 °C');
    expect(kinds([day({ tMax: 35 }), day({ tMax: 35 })])).toEqual(['heat']);
    expect(kinds([day({ tMax: 35 }), day({ tMax: 34.9 })])).toEqual([]);
    // Heavy rain at 30 mm in a day.
    expect(RISK_RULE['heavy-rain']![0]).toContain('30 mm');
    expect(kinds([day({ rain: 30 })])).toEqual(['heavy-rain']);
    expect(kinds([day({ rain: 29.9 })])).toEqual([]);
    // A dry spell at ten days under 1 mm.
    expect(RISK_RULE['dry-spell']![0]).toContain('ten');
    expect(kinds(Array.from({ length: 10 }, () => day({ rain: 0.9 })))).toEqual(['dry-spell']);
    expect(kinds(Array.from({ length: 9 }, () => day({ rain: 0.9 })))).toEqual([]);
    // Wind at 50 km/h.
    expect(RISK_RULE.wind![0]).toContain('50 km/h');
    expect(kinds([day({ windMaxKmh: 50 })])).toEqual(['wind']);
    expect(kinds([day({ windMaxKmh: 49 })])).toEqual([]);
  });
});

describe('routing of questions about the field itself', () => {
  const route = (q: string, o: Partial<{ cropCount: number; hasContext: boolean; termHit: boolean }> = {}) => routeIntent(q, { cropCount: 0, hasContext: true, termHit: false, ...o });

  it('tells a value of the field from a definition', () => {
    expect(route('pH đất của tôi bao nhiêu?', { termHit: true })).toMatchObject({ intent: 'field-fact', ask: 'value', focus: expect.arrayContaining(['ph']) });
    expect(route('What is my soil pH?', { termHit: true })).toMatchObject({ intent: 'field-fact', ask: 'value' });
    expect(route('pH đất là gì?', { termHit: true }).intent).toBe('term');
    expect(route('What is soil pH?', { termHit: true }).intent).toBe('term');
    // "Mean" and "why" ask for an explanation even with the field in the sentence.
    expect(route('Độ ẩm vùng rễ ở đây nghĩa là gì?', { termHit: true }).intent).toBe('term');
    expect(route('Why is the soil moisture pixel so much bigger than my field?', { termHit: true }).intent).toBe('term');
  });

  it('has a focus for the readings that had none', () => {
    const focus = (q: string) => route(q).focus;
    expect(focus('Chất hữu cơ trong đất tôi thấp hay cao?')).toContain('organic');
    expect(focus('How much organic matter is in my soil?')).toContain('organic');
    expect(focus('CEC của đất tôi là bao nhiêu?')).toContain('cec');
    expect(focus('Đất tôi có bao nhiêu đạm?')).toContain('nitrogen');
    expect(focus('Tôi muốn đảm bảo đủ nước')).not.toContain('nitrogen');
    expect(focus('Dung trọng đất của tôi?')).toContain('density');
    expect(focus('Ruộng tôi có dốc không, có dễ xói mòn không?')).toContain('slope');
    expect(focus('How steep is my field?')).toContain('slope');
    expect(focus('Tầng đất ruộng tôi dày bao nhiêu?')).toContain('depth');
    expect(focus('How deep is my soil?')).toContain('depth');
  });

  it('reads a question about the days ahead or about a month as one about the field', () => {
    expect(route('Tuần tới có sương giá không?', { termHit: true })).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(route('Will it rain heavily tomorrow?')).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(route('Tháng nào mưa nhiều nhất ở ruộng tôi?')).toMatchObject({ intent: 'field-fact', ask: 'month-extreme' });
    expect(route('Which month is the coldest here?')).toMatchObject({ intent: 'field-fact', ask: 'month-extreme' });
    // Without a field these are not about one.
    expect(route('Tuần tới có sương giá không?', { termHit: true, hasContext: false }).intent).toBe('term');
  });

  it('leaves a question that names a crop to the comparison with that crop', () => {
    expect(route('Is my soil too acid for soybean?', { cropCount: 1 }).intent).toBe('field');
    expect(route('Đất tôi chua, trồng đậu nành được không, cần bón gì?', { cropCount: 1 }).intent).toBe('field');
  });

  it('does not guess a reading when none is recognised', () => {
    expect(route('Ruộng tôi có nhiều kẽm không?')).toMatchObject({ intent: 'field-fact', ask: 'value', focus: [] });
    // A question about suitability with no reading named is still the comparison with the crop.
    expect(route('Ruộng của tôi có phù hợp không?').intent).toBe('field');
  });

  it('declines what it has no data for, crop or no crop', () => {
    expect(route('Gửi ảnh lá cà phê bị bệnh thì bạn chẩn đoán được không?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'photo-diagnosis' });
    expect(route('Can you identify the disease from a photo of the leaf?')).toMatchObject({ intent: 'off-topic', outOfScope: 'photo-diagnosis' });
    expect(route('Giá cà phê ngày mai bao nhiêu?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'price-forecast' });
    expect(route('Will the price of rice go up next month?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'price-forecast' });
    expect(route('Tranh chấp đất với hàng xóm thì làm sao?')).toMatchObject({ intent: 'off-topic', outOfScope: 'legal' });
    expect(route('What dose of herbicide should I use on maize?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'pesticide-dose' });
    expect(route('What is the bitcoin price today?')).toMatchObject({ intent: 'off-topic', outOfScope: 'other' });
    // "số đó" (that number) folds to the same letters as "sổ đỏ" (land title): not a legal question.
    expect(route('Đất của tôi pH bao nhiêu và số đó lấy từ đâu?', { termHit: true }).intent).toBe('field-fact');
  });
});
