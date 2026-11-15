/**
 * Answers about the readings of the field itself, over the built index (public/rag) and the
 * contexts of the fixture and of the four demo fields. Requires `npm run rag:build`.
 */
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldContext, Lang } from '@/contracts';
import { FIXTURE_CONTEXT } from '../../scripts/rag/eval';
import { SAMPLE_FIELDS, sampleContext } from '../../scripts/rag/sample-context';
import { fileLoader } from '../../server/loader';
import { answerExtractive } from './engine';
import { monthlyNormal, parseFieldFact } from './fieldFacts';
import { KnowledgeStore } from './store';

let store: KnowledgeStore;
beforeAll(async () => {
  store = new KnowledgeStore(fileLoader(path.resolve(import.meta.dirname, '../../public/rag')));
  await store.ensureCore();
});

const ask = (query: string, lang: Lang, context?: FieldContext) => answerExtractive(store, { query, lang, context });
const contexts = new Map<string, FieldContext>();
const demo = (id: string) => contexts.get(id) ?? contexts.set(id, sampleContext(id)).get(id)!;

/** Unsigned numbers of a text, as printed. */
const numbers = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * Numbers of an answer that are neither in the facts of the field nor among the ones the caller
 * says the answer may add. Quoted glossary sentences and citation markers are left out. What an
 * answer may always add: the width of the parcel it reckons from its area, and the "5" and "95"
 * of "5-95 %" where the field has a fact with such a range. Nothing else is let through: a date
 * the answer reckons, a count, a month or a threshold has to be named by the test that expects it.
 */
function strangers(answer: string, ctx: FieldContext, mayAdd: (string | number)[] = []): string[] {
  const facts = Object.values(ctx.facts);
  const own = new Set([...facts.flatMap(numbers), String(Math.round(Math.sqrt(ctx.areaHa * 10_000))), ...(facts.some((f) => f.includes('5-95%')) ? ['5', '95'] : []), ...mayAdd.map(String)]);
  const body = answer.replace(/“[^”]*”/g, '').replace(/\[S\d+\]/g, '');
  return numbers(body).filter((n) => !own.has(n));
}

/** The numbers of a day written out ("21 November 2026", "21/11/2026"). */
const dayParts = (iso: string): number[] => iso.split('-').map(Number);
/** The thresholds the app warns by, which a forecast answer states. */
const RULES = [2, 35, 30, 1, 50];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

describe('the seven questions of the issue, on the fixture field', () => {
  it('gives the pH of the field and says where the number comes from', async () => {
    const r = await ask('Đất của tôi pH bao nhiêu và số đó lấy từ đâu?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', ask: 'value' });
    expect(r.answer).toMatch(/^pH đất của ruộng bạn: 5\.6\./);
    expect(r.answer).toContain('Nguồn: SoilGrids v2.0, mỗi giá trị cho một ô 250 m.');
    expect(r.answer).toContain('khoảng 5-95 % là 4.9 đến 6.3');
    expect(r.answer).toContain('không phải số đo tại ruộng của bạn');
    expect(r.citations[0].chunkId).toBe('gloss-vi:soilgrids');
  });

  it('says that the field has no salinity value, and does not answer with the pH', async () => {
    const r = await ask('Đất ruộng tôi có bị mặn không?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', focus: expect.arrayContaining(['salinity']) });
    expect(r.answer).toContain('không có số liệu cho thửa ruộng này');
    expect(r.answer).toContain('SSURGO');
    expect(r.answer).toContain('máy đo EC');
    expect(r.answer).not.toContain('5.6');
    expect(r.answer).not.toMatch(/pH/);
  });

  it('gives the slope, and says it has no erosion estimate', async () => {
    const r = await ask('Ruộng tôi có dốc không, có dễ xói mòn không?', 'vi', FIXTURE_CONTEXT);
    expect(r.answer).toMatch(/^Độ dốc của ruộng bạn: 7\.7 °; chênh cao trong thửa: 14 m\./);
    expect(r.answer).toContain('chưa ước tính xói mòn');
    expect(r.answer).not.toMatch(/pH/);
  });

  it('gives the organic carbon without calling it low or high', async () => {
    const r = await ask('Chất hữu cơ trong đất tôi thấp hay cao?', 'vi', FIXTURE_CONTEXT);
    expect(r.answer).toMatch(/^Carbon hữu cơ trong đất của ruộng bạn: 19\.4 g\/kg\./);
    expect(r.answer).toContain('khoảng 5-95 % là 3.9 đến 44.1');
    expect(r.answer).toContain('Tôi chỉ nêu số liệu');
    expect(r.answer).not.toMatch(/pH đất của ruộng bạn/);
  });

  it('reads the forecast for frost', async () => {
    const r = await ask('Tuần tới có sương giá không?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(r.answer).toMatch(/^Dự báo cho ruộng của bạn không có cảnh báo sương giá nào đến 17\/11\/2026\./);
    expect(r.answer).toContain('18.5 °C, vào ngày 24/11/2026');
    expect(r.answer).toContain('từ 2 °C trở xuống');
    expect(r.answer).toContain('Đây là dự báo');
  });

  it('names the wettest month from the monthly means', async () => {
    const r = await ask('Tháng nào mưa nhiều nhất ở ruộng tôi?', 'vi', FIXTURE_CONTEXT);
    const n = monthlyNormal(FIXTURE_CONTEXT, 'climate_monthly_rain')!;
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', ask: 'month-extreme' });
    expect(r.answer).toContain(`tháng mưa nhiều nhất là tháng ${n.max.month}, ${n.max.text} mm`);
    expect(r.answer).toContain(`tháng mưa ít nhất là tháng ${n.min.month}, ${n.min.text} mm`);
    expect([n.max.month, n.min.month]).toEqual([9, 2]);
  });

  it('compares the pH with soybean and says what the pH alone says about liming', async () => {
    const r = await ask('Đất tôi chua, trồng đậu nành được không, cần bón gì?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis.intent).toBe('field');
    expect(r.answer).toContain('pH đất của ruộng bạn là 5.6');
    expect(r.answer).toContain('nằm trong khoảng tối ưu của đậu nành');
    expect(r.answer).toContain('Cần bón gì: nếu chỉ xét pH thì chưa cần');
    expect(r.answer).toContain('4.9 đến 6.3');
  });
});

describe('a value of the field and a definition', () => {
  it('"pH đất của tôi bao nhiêu" gives the value; "pH đất là gì" still gives the definition', async () => {
    const value = await ask('pH đất của tôi bao nhiêu?', 'vi', FIXTURE_CONTEXT);
    expect(value.retrieval.analysis.intent).toBe('field-fact');
    expect(value.answer).toMatch(/^pH đất của ruộng bạn: 5\.6\./);
    const definition = await ask('pH đất là gì?', 'vi', FIXTURE_CONTEXT);
    expect(definition.retrieval.analysis.intent).toBe('term');
    expect(definition.answer).toMatch(/^pH đất đo độ chua/);
    expect(definition.citations[0].chunkId).toBe('gloss-vi:soil-ph');
  });

  it('the same in English', async () => {
    expect((await ask('What is the pH of my soil?', 'en', FIXTURE_CONTEXT)).answer).toMatch(/^Soil pH on your field: 5\.6\./);
    expect((await ask('What is soil pH?', 'en', FIXTURE_CONTEXT)).retrieval.analysis.intent).toBe('term');
  });

  it('a number the grower entered is given as theirs, with the estimate it replaced', async () => {
    const own = sampleContext('daklak-coffee', { ph: 6.1 });
    const r = await ask('pH đất của tôi bao nhiêu?', 'vi', own);
    expect(r.answer).toMatch(/^pH đất của ruộng bạn: 6\.1\. Đây là số bạn tự nhập/);
    expect(r.answer).toContain('Ước tính bị thay thế là 5.7 (SoilGrids 2.0 (0-30 cm), mỗi giá trị cho một ô 250 m)');
    expect(r.citations[0].chunkId).toBe('gloss-vi:ground-truth-override');
  });

  it('without a locked field it says so and gives no number of a field', async () => {
    const r = await ask('pH đất của tôi bao nhiêu?', 'vi');
    expect(r.retrieval.analysis.intent).toBe('field-fact');
    expect(r.answer).toMatch(/^Chưa khoá thửa ruộng nào/);
    expect(r.answer).not.toContain('của ruộng bạn:');
  });

  it('does not fall back to the pH when the reading is not recognised', async () => {
    const r = await ask('Ruộng tôi có nhiều kẽm không?', 'vi', demo('daklak-coffee'));
    expect(r.answer).toMatch(/^Tôi chưa nhận ra bạn hỏi về số liệu nào/);
    expect(r.answer).toContain('Với thửa này tôi có: pH đất');
    // The readings are named, none is given: the only number is the "30" of "rain over the last 30 days".
    expect(numbers(r.answer)).toEqual(['30']);
  });
});

describe('on the demo fields', () => {
  const QUESTIONS: [string, Lang, string[]][] = [
    ['What is the pH of my soil and where does the number come from?', 'en', ['ph']],
    ['pH đất của tôi bao nhiêu?', 'vi', ['ph']],
    ['How much organic matter does my soil have?', 'en', ['soc_gkg']],
    ['CEC của đất ruộng tôi là bao nhiêu?', 'vi', ['cec_cmolkg']],
    ['Đất tôi có bao nhiêu đạm?', 'vi', ['nitrogen_gkg']],
    ['What is the bulk density of my soil?', 'en', ['bulk_density']],
    ['How steep is my field?', 'en', ['slope_deg', 'relief_m']],
    ['Ruộng tôi ở độ cao bao nhiêu?', 'vi', ['elevation_m']],
    ['NDVI của ruộng tôi bao nhiêu, lấy từ vệ tinh nào?', 'vi', ['ndvi']],
    ['How wet is the root zone on my field?', 'en', ['sm_root']],
    ['How much rain fell on my field in the last 30 days?', 'en', ['rain_30d']],
  ];

  it.each(SAMPLE_FIELDS)('%s: every number in an answer is a number of the field', async (id) => {
    const ctx = demo(id);
    for (const [q, lang, keys] of QUESTIONS) {
      const r = await ask(q, lang, ctx);
      expect(r.retrieval.analysis.intent, q).toBe('field-fact');
      for (const key of keys) expect(r.answer, `${q} (${key})`).toContain(parseFieldFact(key, ctx.facts[key]).amount);
      // "Rain over the last 30 days" and "the last 90 days" are names of readings.
      expect(strangers(r.answer, ctx, /rain/i.test(q) ? [30, 90] : []), `${id}: ${q}\n${r.answer}`).toEqual([]);
    }
  });

  it.each(SAMPLE_FIELDS)('%s: the wettest and the coldest month are those of the monthly means', async (id) => {
    const ctx = demo(id);
    const rain = monthlyNormal(ctx, 'climate_monthly_rain')!;
    const temp = monthlyNormal(ctx, 'climate_monthly_t')!;
    const wettest = await ask('Which month is the wettest on my field?', 'en', ctx);
    expect(wettest.answer).toContain(`the wettest month is ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][rain.max.month - 1]}, ${rain.max.text} mm`);
    const coldest = await ask('Tháng nào lạnh nhất ở đây?', 'vi', ctx);
    expect(coldest.answer).toMatch(new RegExp(`^Ở ruộng của bạn, tháng lạnh nhất là tháng ${temp.min.month}, ${temp.min.text.replace('.', '\\.')} °C`));
    // The months are numbered in the Vietnamese answer and in its list of twelve.
    expect(strangers(wettest.answer, ctx)).toEqual([]);
    expect(strangers(coldest.answer, ctx, MONTHS)).toEqual([]);
  });

  it('salinity is a number in Iowa (soil survey) and missing in Đắk Lắk', async () => {
    const iowa = await ask('Is my soil salty?', 'en', demo('iowa-corn-soy'));
    expect(iowa.answer).toMatch(/^Soil salinity \(electrical conductivity\) on your field: 0 dS\/m\. Source: SSURGO soil survey/);
    const dakLak = await ask('Is my soil salty?', 'en', demo('daklak-coffee'));
    expect(dakLak.answer).toMatch(/^Soil salinity \(electrical conductivity\): there is no value for this field\./);
    expect(dakLak.answer).not.toContain(parseFieldFact('ph', demo('daklak-coffee').facts.ph).amount);
  });

  it('lists the frost warnings of the week, and only those', async () => {
    const ctx = demo('iowa-corn-soy');
    const week = await ask('Will there be frost next week?', 'en', ctx);
    expect(week.answer).toContain('holds 1 frost warning up to 21 November 2026');
    expect(week.answer).toContain('- 14 November 2026 to 16 November 2026: frost, level 2 of 3. Minimum temperature down to -2.5 °C.');
    expect(week.answer).not.toContain('22 November 2026 to');
    const whole = await ask('Dự báo có sương giá không?', 'vi', ctx);
    expect(whole.answer).toContain('có 2 cảnh báo sương giá đến 28/11/2026');
    expect(whole.answer).toContain('- 22/11/2026 đến 28/11/2026: sương giá, mức 3/3. Nhiệt độ thấp nhất xuống -13.1 °C.');
    // Beside the facts: the count of warnings, the "3" of "level 2 of 3" and the frost threshold.
    expect(strangers(whole.answer, ctx, [2, 3])).toEqual([]);
    expect(strangers(week.answer, ctx, [1, 2, 3, ...dayParts('2026-11-21')])).toEqual([]);
  });

  it('says there is no warning, with the number that shows it', async () => {
    const ctx = demo('cantho-rice');
    const r = await ask('Tuần tới có mưa lớn không?', 'vi', ctx);
    expect(r.answer).toMatch(/^Dự báo cho ruộng của bạn không có cảnh báo mưa lớn nào đến 21\/11\/2026\./);
    expect(r.answer).toContain(`Tổng lượng mưa dự báo là ${parseFieldFact('forecast_rain', ctx.facts.forecast_rain).amount}`);
    expect(r.answer).toContain('từ 30 mm trong một ngày');
  });

  it('a crop and a reading EcoCrop has no threshold for: the reading, not the pH', async () => {
    const ctx = demo('daklak-coffee');
    const r = await ask('Độ dốc ruộng tôi có hợp với cà phê vối không?', 'vi', ctx);
    expect(r.retrieval.analysis.intent).toBe('field');
    expect(r.answer).toMatch(/^Độ dốc của ruộng bạn: 7\.7 °/);
    expect(r.answer).toContain('EcoCrop không ghi yêu cầu nào về mục này cho cà phê vối');
  });

  it('a model value of rain or temperature is not said to need a soil test', async () => {
    const r = await ask('Is my field too dry for robusta coffee?', 'en', demo('daklak-coffee'));
    const rain = r.answer.split('\n\n').find((p) => p.startsWith('Mean annual rainfall'))!;
    expect(rain).toContain('It is a model estimate for a 25 km cell, not a measurement on your field.');
    expect(rain).not.toContain('soil test');
  });
});

describe('what the first review of this change found', () => {
  it('the app\'s own score is given as a score, not as a value from a source', async () => {
    const r = await ask('What is the productivity score of my field?', 'en', FIXTURE_CONTEXT);
    expect(r.answer).toMatch(/^Productivity score on your field: 71\/100, on 2026-11-10 \(growing condition 74, site compatibility 88; confidence of the score 0\.62\)\./);
    expect(r.answer).toContain('It is a result the app computes itself');
    expect(r.answer).not.toMatch(/Source:|mapped or surveyed/);
    expect(r.citations[0].chunkId).toBe('gloss-en:productivity-score');
    expect(strangers(r.answer, FIXTURE_CONTEXT)).toEqual([]);
    const vi = await ask('Điểm năng suất của ruộng tôi bao nhiêu?', 'vi', FIXTURE_CONTEXT);
    expect(vi.answer).toMatch(/^Điểm năng suất của ruộng bạn: 71\/100, ngày 2026-11-10 \(điều kiện sinh trưởng 74, mức phù hợp của khu đất 88; độ tin cậy của điểm 0\.62\)\./);
  });

  it('the two numbers beside the elevation are the lowest and the highest point of the parcel, not a 5-95 % range', async () => {
    const ctx = demo('iowa-corn-soy');
    expect(ctx.facts.elevation_m).toContain('lowest and highest point of the parcel: 302-314');
    const r = await ask('How high is my field?', 'en', ctx);
    expect(r.answer).toContain('Elevation on your field: 308 m.');
    expect(r.answer).toContain('Inside the parcel the elevation goes from 302 to 314 m.');
    expect(r.answer).not.toContain('5-95');
    const vi = await ask('Ruộng tôi ở độ cao bao nhiêu?', 'vi', ctx);
    expect(vi.answer).toContain('Trong thửa, độ cao đi từ 302 đến 314 m.');
    // The soil estimates keep their range.
    expect((await ask('What is the pH of my soil?', 'en', demo('daklak-coffee'))).answer).toContain('The source gives a 5-95 % range of 4.3 to 7.4.');
  });

  it('"in the next two weeks" is fourteen days, and the second frost warning is not left out', async () => {
    const ctx = demo('iowa-corn-soy');
    const vi = await ask('Trong 2 tuần tới có sương giá không?', 'vi', ctx);
    expect(vi.answer).toContain('có 2 cảnh báo sương giá đến 28/11/2026');
    expect(vi.answer).toContain('- 22/11/2026 đến 28/11/2026: sương giá, mức 3/3.');
    const en = await ask('Will there be frost in the next two weeks?', 'en', ctx);
    expect(en.answer).toContain('holds 2 frost warnings up to 28 November 2026');
    // Ten days: to 24 November, which the second warning has begun by.
    expect((await ask('Is frost coming in the next 10 days?', 'en', ctx)).answer).toContain('holds 2 frost warnings up to 24 November 2026');
    // Five days: to 19 November, before the second warning.
    expect((await ask('Is frost coming in the next 5 days?', 'en', ctx)).answer).toContain('holds 1 frost warning up to 19 November 2026');
  });

  it('a question that reaches beyond the forecast is answered up to its last day, and says so', async () => {
    const ctx = demo('iowa-corn-soy');
    const r = await ask('Will there be frost in the next 30 days?', 'en', ctx);
    expect(r.answer).toContain('up to 28 November 2026');
    expect(r.answer).not.toContain('December');
    expect(r.answer).toContain('The forecast reaches only to 28 November 2026, not the 30 days you asked about: nothing can be said of the days after it.');
    // A field without a warning: "no warning" is said for the days of the forecast only.
    const calm = await ask('Trong 30 ngày tới có sương giá không?', 'vi', demo('cantho-rice'));
    expect(calm.answer).toMatch(/^Dự báo cho ruộng của bạn không có cảnh báo sương giá nào đến 28\/11\/2026\./);
    expect(calm.answer).toContain('Dự báo chỉ tới ngày 28/11/2026, không đủ 30 ngày như bạn hỏi');
    expect(strangers(calm.answer, demo('cantho-rice'), [30, 2])).toEqual([]);
  });

  it('salinity and soil depth are held against the classes EcoCrop gives the crop', async () => {
    const iowa = await ask('Is my soil too salty for maize?', 'en', demo('iowa-corn-soy'));
    expect(iowa.answer).toMatch(/^Soil salinity \(electrical conductivity\) on your field is 0 dS\/m \(SSURGO soil survey[^)]*\)\): inside maize's optimal range \(optimal low \(<4 dS\/m\), tolerated medium \(4-10 dS\/m\)\)/);
    expect(iowa.answer).not.toMatch(/sets no threshold|records no requirement/);
    // No reading on the fixture field: the requirement is still said, and the reading named as missing.
    const none = await ask('Is my soil too salty for maize?', 'en', FIXTURE_CONTEXT);
    expect(none.answer).toMatch(/^Your field has no soil salinity \(electrical conductivity\) reading to compare with maize's requirement/);
    expect(none.answer).toContain('EcoCrop gives for maize: Salinity: optimal low (<4 dS/m); tolerated medium (4-10 dS/m).');
    expect(none.answer).toContain('Missing for this comparison: soil salinity (electrical conductivity) (an EC meter');
    const depth = await ask('Is my soil deep enough for maize?', 'en', FIXTURE_CONTEXT);
    expect(depth.answer).toContain('EcoCrop gives for maize: Soil depth: optimal medium (50-150 cm); tolerated shallow (20-50 cm).');
    // A question about something else does not list the two as missing.
    expect((await ask('Is my soil too acid for maize?', 'en', FIXTURE_CONTEXT)).answer).not.toMatch(/salinity|stops roots/);
  });

  it('a salty or a shallow soil is told from one the crop tolerates', async () => {
    const salty = (ec: string): FieldContext => ({ ...FIXTURE_CONTEXT, facts: { ...FIXTURE_CONTEXT.facts, ec_dsm: `${ec} dS/m (measured by the farmer)` } });
    const status = async (ctx: FieldContext, q: string) => (await ask(q, 'en', ctx)).answer.split('\n\n')[0];
    expect(await status(salty('2'), 'Is my soil too salty for maize?')).toContain("inside maize's optimal range");
    expect(await status(salty('6'), 'Is my soil too salty for maize?')).toContain('outside the optimum but within what maize tolerates');
    expect(await status(salty('12'), 'Is my soil too salty for maize?')).toContain('beyond what maize tolerates');
    const deep = (cm: string): FieldContext => ({ ...FIXTURE_CONTEXT, facts: { ...FIXTURE_CONTEXT.facts, depth_cm: `${cm} cm (measured by the farmer)` } });
    expect(await status(deep('90'), 'Is my soil deep enough for maize?')).toContain("inside maize's optimal range");
    expect(await status(deep('30'), 'Is my soil deep enough for maize?')).toContain('outside the optimum but within what maize tolerates');
    expect(await status(deep('10'), 'Is my soil deep enough for maize?')).toContain('beyond what maize tolerates');
  });

  it('a reading EcoCrop knows only as a fertility class is given without a verdict, and says why', async () => {
    const r = await ask('Is the organic matter of my soil enough for maize?', 'en', FIXTURE_CONTEXT);
    expect(r.answer).toMatch(/^Soil organic carbon on your field: 19\.4 g\/kg\./);
    expect(r.answer).toContain('EcoCrop describes what maize needs as a fertility class, not as a figure: Soil fertility: optimal high; tolerated low.');
  });

  it('a question about the soil moisture is answered with the soil moisture and nothing else', async () => {
    const r = await ask('Số độ ẩm đất của ruộng tôi tin được tới đâu?', 'vi', FIXTURE_CONTEXT);
    expect(r.answer).toMatch(/^Độ ẩm đất vùng rễ của ruộng bạn: 0\.21 m³\/m³\./);
    for (const other of ['pH', 'Lượng mưa', 'Tưới', 'Carbon hữu cơ', 'thành phần cơ giới']) expect(r.answer, other).not.toContain(other);
    const iowa = await ask('How reliable is the soil moisture reading for my field?', 'en', demo('iowa-corn-soy'));
    expect(iowa.answer).toMatch(/^Root-zone soil moisture on your field: 0\.38 m³\/m³; surface soil moisture: 0\.34 m³\/m³\./);
    expect(iowa.answer).not.toMatch(/pH|Rain|Irrigation|organic/);
  });

  it('the normal of a named month is given for that month', async () => {
    const r = await ask('Tháng 3 ruộng tôi mưa bao nhiêu?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', ask: 'month-value', months: [3] });
    expect(r.answer).toMatch(/^Vào tháng 3, ruộng của bạn mưa trung bình 22 mm\./);
    expect(strangers(r.answer, FIXTURE_CONTEXT, MONTHS)).toEqual([]);
    expect((await ask('How much does it rain on my field in March?', 'en', FIXTURE_CONTEXT)).answer).toMatch(/^In March your field gets 22 mm of rain on average\./);
    expect((await ask('How warm is it on my field in July?', 'en', FIXTURE_CONTEXT)).answer).toMatch(/^In July the mean air temperature on your field is 24\.1 °C\./);
  });

  it('rain summed from the reanalysis says that it stands in for the observed series', async () => {
    const ctx = demo('iowa-corn-soy');
    expect(ctx.facts.rain_30d).toContain('in place of CHIRPS daily rainfall');
    const r = await ask('How much rain fell on my field in the last 30 days?', 'en', ctx);
    expect(r.answer).toContain('It stands in for CHIRPS daily rainfall (ClimateSERV dataset 0), the observed series, which ends on 2026-09-30.');
  });

  it('a temperature is compared with its normal in degrees, not as a share of it', async () => {
    const ctx = demo('iowa-corn-soy');
    expect(ctx.facts.t2m_min).not.toMatch(/\d{3,}%/);
    const r = await ask('What is the air temperature on my field?', 'en', ctx);
    expect(r.answer).toMatch(/minimum air temperature of the day: 3\.99 °C/);
    expect(r.answer).toMatch(/minimum air temperature of the day 4\.05 °C above normal \(within the normal band, normal -0\.06\)/);
    expect((await ask('Nhiệt độ ở ruộng tôi bao nhiêu?', 'vi', ctx)).answer).toMatch(/nhiệt độ không khí thấp nhất ngày cao hơn bình thường 4\.05 °C \(trong dải bình thường, mức bình thường -0\.06\)/);
  });

  it('a forecast of the weather, with no hazard named, lists every warning', async () => {
    const r = await ask('Dự báo thời tiết tuần tới cho ruộng tôi thế nào?', 'vi', demo('iowa-corn-soy'));
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
    expect(r.answer).toMatch(/^Dự báo cho ruộng của bạn có 1 cảnh báo thời tiết đến 21\/11\/2026:/);
  });

  it('"how is my field" is the comparison with the crop of the field, as it was', async () => {
    const r = await ask('Ruộng của tôi thế nào?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field', cropIds: ['coffea-canephora'] });
    expect(r.answer).toContain('nằm trong khoảng tối ưu của cà phê vối');
  });
});

describe('words that fold into a crop name', () => {
  it('"đạm" (nitrogen) is not the greater yam, and "tôi" typed without accents is not garlic', async () => {
    const nitrogen = await ask('Đất tôi có bao nhiêu đạm?', 'vi', FIXTURE_CONTEXT);
    expect(nitrogen.retrieval.analysis).toMatchObject({ intent: 'field-fact', cropIds: [], focus: expect.arrayContaining(['nitrogen']) });
    const plain = await ask('dat cua toi ph bao nhieu', 'vi', FIXTURE_CONTEXT);
    expect(plain.retrieval.analysis).toMatchObject({ intent: 'field-fact', cropIds: [] });
    expect(plain.answer).toMatch(/^pH đất của ruộng bạn: 5\.6\./);
    // Garlic is still found where it is meant.
    expect((await ask('Tôi trồng tỏi thì cần pH bao nhiêu?', 'vi')).retrieval.analysis.cropIds).toEqual(['allium-sativum']);
    expect((await ask('toi trong toi thi can ph bao nhieu', 'vi')).retrieval.analysis.cropIds).toEqual(['allium-sativum']);
  });

  it('a question about garlic typed with accents keeps its crop: the "toi" phrases are set aside only without accents', async () => {
    const ph = await ask('Tỏi cần pH bao nhiêu?', 'vi');
    expect(ph.retrieval.analysis).toMatchObject({ intent: 'ideal', cropIds: ['allium-sativum'] });
    expect(ph.answer).toContain('pH đất: tối ưu 6-6.6');
    for (const q of ['Tỏi nên trồng vào tháng mấy?', 'Tỏi cần đất gì?', 'Tỏi có chịu được đất chua không?', 'Tỏi trồng ở đất cát được không?']) expect((await ask(q, 'vi')).retrieval.analysis.cropIds, q).toEqual(['allium-sativum']);
    // Typed without accents, "toi can" is "I need": the field, not garlic.
    expect((await ask('toi can biet ph dat cua toi', 'vi', FIXTURE_CONTEXT)).retrieval.analysis).toMatchObject({ intent: 'field-fact', cropIds: [] });
  });

  it('"sương giá" (frost) is not a price', async () => {
    const r = await ask('Dự báo có sương giá không?', 'vi', FIXTURE_CONTEXT);
    expect(r.retrieval.analysis).toMatchObject({ intent: 'field-fact', ask: 'forecast' });
  });
});

describe('declined questions', () => {
  it.each([
    ['Gửi ảnh lá cà phê bị bệnh thì bạn chẩn đoán được không?', 'vi', 'Tôi không xem được ảnh'],
    ['Can you identify the disease from a photo of the leaf?', 'en', 'I cannot look at a photo'],
    ['Giá cà phê ngày mai bao nhiêu?', 'vi', 'Tôi không dự báo giá'],
    ['Will the price of rice go up next month?', 'en', 'I do not forecast prices'],
    ['Tranh chấp đất với hàng xóm thì làm sao?', 'vi', 'Tôi không tư vấn pháp lý'],
    ['What dose of herbicide should I use on maize?', 'en', 'I do not name pesticide products or doses'],
  ] as [string, Lang, string][])('%s', async (q, lang, start) => {
    const r = await ask(q, lang, FIXTURE_CONTEXT);
    expect(r.retrieval.analysis.intent).toBe('off-topic');
    expect(r.answer.startsWith(start)).toBe(true);
    expect(r.citations).toEqual([]);
    expect(numbers(r.answer)).toEqual([]);
  });
});
