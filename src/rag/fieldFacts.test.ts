import { describe, expect, it } from 'vitest';
import type { FieldContext } from '@/contracts';
import { thresholdEvents } from '@/data/harmonize/risk';
import { sampleContext } from '../../scripts/rag/sample-context';
import { FIXTURE_CONTEXT } from '../../scripts/rag/eval';
import { horizonDays, riskDetail, RISK_RULE } from './fieldAnswer';
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

  it('reads the app\'s own score as a score, and what it is made of', () => {
    const f = parseFieldFact('score_now', '71/100 productivity on 2026-11-10 (condition 74, compatibility 88; score confidence 0.62)');
    expect(f).toMatchObject({ amount: '71/100', provenance: 'score', source: null, date: '2026-11-10', score: { condition: '74', compatibility: '88', confidence: '0.62' } });
  });

  it('keeps the spread inside the parcel apart from a range of the source, and knows a series that stands in', () => {
    const elevation = parseFieldFact('elevation_m', '308 m (SRTM GL1 30 m point elevations, 30 m pixel; lowest and highest point of the parcel: 302-314)');
    expect(elevation).toMatchObject({ amount: '308 m', within: ['302', '314'], interval: null, source: 'SRTM GL1 30 m point elevations' });
    const rain = parseFieldFact('rain_30d', '85.6 mm over the 30 days to 2026-11-14 (ERA5 reanalysis (ECMWF), daily aggregates, 25 km pixel, modelled; in place of CHIRPS daily rainfall (ClimateSERV dataset 0), the observed series, which ends on 2026-09-30)');
    expect(rain).toMatchObject({ amount: '85.6 mm', provenance: 'modelled', standsInFor: { name: 'CHIRPS daily rainfall (ClimateSERV dataset 0)', ends: '2026-09-30' } });
    expect(parseFieldFact('ph', '5.6 (SoilGrids v2.0, 250 m pixel, modelled; 5-95%: 4.9-6.3)')).toMatchObject({ interval: ['4.9', '6.3'], within: null, standsInFor: null });
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

  it('leaves a broad word and the term of a source out when something names the reading', () => {
    const keys = (focus: Parameters<typeof lookupFieldFacts>[1], terms: string[], ctx = FIXTURE_CONTEXT) => lookupFieldFacts(ctx, focus, terms, 'en').readings.map((r) => r.key);
    // "Soil moisture": the words soil and water are broad, the glossary term names the reading.
    expect(keys(['water', 'soil'], ['soil-moisture'])).toEqual(['sm_root']);
    // "Which way does my field slope": the slope, not the elevation the entry on SRTM terrain would add.
    expect(keys(['slope'], ['srtm-terrain'])).toEqual(['slope_deg', 'relief_m']);
    // A source alone still answers with its readings.
    expect(keys([], ['srtm-terrain'])).toEqual(['elevation_m', 'slope_deg']);
    // "The water in my soil" is the soil moisture and the rain, not the pH.
    expect(keys(['water', 'soil'], [])).toEqual(['sm_root', 'rain_30d']);
    // Only a broad word: every reading of it.
    expect(keys(['soil'], [])).toEqual(['ph', 'texture_class', 'soc_gkg', 'drainage_class']);
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

  it('tells a Vietnamese word from the other words that fold to the same letters', () => {
    const focus = (q: string) => route(q).focus;
    // "mua" (to buy) is not "mưa" (rain); "mùa mưa" and "mùa khô" (the seasons) still are about rain.
    expect(focus('Tôi muốn mua phân bón cho ruộng tôi')).not.toContain('rain');
    expect(focus('Mùa khô ở ruộng tôi kéo dài bao lâu?')).toContain('rain');
    expect(focus('Lượng mưa ở ruộng tôi?')).toContain('rain');
    // "năng suất" (yield) is not "nắng" (sun); "đám ruộng" (a plot) is not "đạm" (nitrogen).
    expect(focus('Năng suất ruộng tôi thế nào?')).not.toContain('light');
    expect(focus('Ruộng tôi có đủ nắng không?')).toContain('light');
    expect(focus('Đám ruộng của tôi pH bao nhiêu?')).toEqual(['ph']);
    // "chưa" (not yet) is not "chua" (acid); "nông dân" (farmer) is not "nóng" (hot); "khó" (hard) is not "khô" (dry).
    expect(focus('Ruộng tôi chưa bón phân')).not.toContain('ph');
    expect(focus('Đất ruộng tôi có chua không?')).toContain('ph');
    expect(focus('Nông dân ở đây trồng gì?')).not.toContain('temp');
    expect(focus('Ruộng tôi khó làm quá')).not.toContain('water');
    // Typed without accents there is nothing to tell them apart by: the reading is assumed, as before.
    expect(focus('luong mua o ruong toi')).toContain('rain');
    expect(focus('ruong toi co du nang khong')).toContain('light');
  });

  it('reads how far ahead a question looks', () => {
    expect(route('Trong 2 tuần tới có sương giá không?', { termHit: true })).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(horizonDays('trong 2 tuan toi co suong gia khong')).toBe(14);
    expect(horizonDays('will there be frost in the next two weeks')).toBe(14);
    expect(horizonDays('in the next 3 weeks')).toBe(21);
    expect(horizonDays('next fortnight')).toBe(14);
    expect(horizonDays('will there be frost in the next 30 days')).toBe(30);
    expect(horizonDays('10 ngay toi co mua khong')).toBe(10);
    expect(horizonDays('tuan toi co suong gia khong')).toBe(7);
    expect(horizonDays('ngay mai co mua khong')).toBe(1);
    expect(horizonDays('du bao co suong gia khong')).toBeNull();
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
    // More ways of asking for a dose, and a lease.
    expect(route('Liều thuốc trừ nấm cho cà phê là bao nhiêu?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'pesticide-dose' });
    expect(route('Liều glyphosate cho 1 ha?', { hasContext: false })).toMatchObject({ intent: 'off-topic', outOfScope: 'pesticide-dose' });
    expect(route('How much glyphosate per hectare?', { hasContext: false })).toMatchObject({ intent: 'off-topic', outOfScope: 'pesticide-dose' });
    expect(route('Hợp đồng thuê đất cần ghi gì?', { hasContext: false })).toMatchObject({ intent: 'off-topic', outOfScope: 'legal' });
  });

  it('does not take frost for a price, an assessment for a price, or a form of address for a photo', () => {
    // "băng giá" and "sương giá" are frost; "đánh giá" is to assess; "gia tăng" is to increase.
    expect(route('Tuần tới có băng giá không?')).toMatchObject({ intent: 'field-fact', ask: 'forecast', focus: ['frost'] });
    expect(route('Đánh giá rủi ro sương giá tuần tới cho ruộng tôi', { termHit: true })).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(route('Sâu bệnh gia tăng trong tuần tới thì làm gì?').intent).not.toBe('off-topic');
    expect(route('tuan toi co bang gia khong')).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(route('danh gia rui ro suong gia tuan toi cho ruong toi', { termHit: true }).intent).toBe('field-fact');
    // A price that is one is still declined, with and without accents.
    expect(route('Giá lúa tuần tới thế nào?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'price-forecast' });
    expect(route('gia lua tuan toi the nao', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'price-forecast' });
    // "Anh ơi" opens a question; "ảnh" is a photo.
    expect(route('Anh ơi cho hỏi bệnh đạo ôn trên lúa phòng thế nào?', { cropCount: 1 })).toMatchObject({ intent: 'care' });
    expect(route('anh oi cho hoi benh dao on tren lua phong the nao', { cropCount: 1 }).intent).toBe('care');
    expect(route('Nhìn ảnh này thì lúa bị bệnh gì?', { cropCount: 1 })).toMatchObject({ intent: 'off-topic', outOfScope: 'photo-diagnosis' });
    expect(route('gui anh la bi benh thi ban chan doan duoc khong')).toMatchObject({ intent: 'off-topic', outOfScope: 'photo-diagnosis' });
  });
});
