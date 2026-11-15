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
 * Numbers of an answer that are not in the facts of the field. Quoted glossary sentences and
 * citation markers are left out; so are whole numbers up to 31 (days of a date the answer
 * reckons, months, counts), the "5-95" of the range and the thresholds of the warning rules.
 */
function strangers(answer: string, ctx: FieldContext): string[] {
  const own = new Set([...Object.values(ctx.facts).flatMap(numbers), String(Math.round(Math.sqrt(ctx.areaHa * 10_000))), '95', '35', '50']);
  const body = answer.replace(/“[^”]*”/g, '').replace(/\[S\d+\]/g, '');
  return numbers(body).filter((n) => !own.has(n) && !(Number.isInteger(Number(n)) && Number(n) <= 31));
}

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
      expect(strangers(r.answer, ctx), `${id}: ${q}\n${r.answer}`).toEqual([]);
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
    expect(strangers(wettest.answer, ctx)).toEqual([]);
    expect(strangers(coldest.answer, ctx)).toEqual([]);
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
    expect(strangers(whole.answer, ctx)).toEqual([]);
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
    expect(r.answer).toContain('EcoCrop không có ngưỡng nào về mục này cho cà phê vối');
  });

  it('a model value of rain or temperature is not said to need a soil test', async () => {
    const r = await ask('Is my field too dry for robusta coffee?', 'en', demo('daklak-coffee'));
    const rain = r.answer.split('\n\n').find((p) => p.startsWith('Mean annual rainfall'))!;
    expect(rain).toContain('It is a model estimate for a 25 km cell, not a measurement on your field.');
    expect(rain).not.toContain('soil test');
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
