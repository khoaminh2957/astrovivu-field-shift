/**
 * Answers about the readings of the locked parcel itself (`field-fact`): a value with its source
 * and how far it can be trusted, the wettest or hottest month of its climate, and the risks in
 * its forecast. Every number is copied from `FieldContext.facts`; a reading the parcel does not
 * have is named as missing, with the reason and the cheapest way to get it. Scope: docs/RAG.md.
 */
import type { FieldContext, KnowledgeChunk, Lang } from '@/contracts';
import type { Citer } from './cite';
import { bestSentences } from './cite';
import { availableReadings, type FieldReading, lookupFieldFacts, type MissingReading, monthlyNormal, type MonthlyNormal, type ParsedFact, parseFieldFact, readFact, type RiskFact, riskFacts, type RiskKind } from './fieldFacts';
import { type Focus, guard } from './intent';
import type { Analysis } from './retrieve';
import type { KnowledgeStore } from './store';
import { fold, terms } from './text';

type L = (en: string, vi: string) => string;
const tr = (lang: Lang): L => (en, vi) => (lang === 'vi' ? vi : en);

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: number, lang: Lang) => (lang === 'vi' ? `tháng ${m}` : MONTH_EN[m - 1]);

/** "2026-11-14" as "14 November 2026" or "14/11/2026". */
function day(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'vi' ? `${d}/${m}/${y}` : `${d} ${MONTH_EN[m - 1]} ${y}`;
}

const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Side of a square of the parcel's area, in metres: what a pixel size is compared with. */
const sideM = (ctx: FieldContext): number => Math.round(Math.sqrt(Math.max(0, ctx.areaHa) * 10_000));

// Glossary entry that explains a source, cited beside the reading it qualifies.
const SOURCE_GLOSSARY: [RegExp, string][] = [
  [/SoilGrids/i, 'soilgrids'],
  [/SRTM/i, 'srtm-terrain'],
  [/SMAP|soil moisture/i, 'soil-moisture'],
  [/MOD13|vegetation ind/i, 'ndvi'],
  [/MOD11|land surface temp/i, 'lst'],
  [/IMERG/i, 'imerg-rainfall'],
  [/weather forecast/i, 'provenance'],
  [/POWER|MERRA/i, 'nasa-power'],
  [/ERA5|reanalysis/i, 'provenance'],
];

function glossaryFor(store: KnowledgeStore, fact: ParsedFact, lang: Lang): KnowledgeChunk | undefined {
  const id = fact.provenance === 'farmer' ? 'ground-truth-override' : fact.provenance === 'score' ? 'productivity-score' : SOURCE_GLOSSARY.find(([re]) => re.test(fact.source ?? ''))?.[1];
  return id ? (store.chunks.get(`gloss-${lang}:${id}`) ?? store.chunks.get(`gloss-${lang}:${id}:0`)) : undefined;
}

/** The sentence of the glossary entry that speaks of the source (the first one otherwise), quoted and cited. */
function sourceNote(store: KnowledgeStore, fact: ParsedFact, cite: Citer, lang: Lang, used: Set<string>): string | null {
  const g = glossaryFor(store, fact, lang);
  if (!g || used.has(g.id)) return null;
  used.add(g.id);
  const about = fact.provenance === 'farmer' || fact.provenance === 'score' ? [] : [...terms(fact.source ?? ''), ...(fact.provenance === 'forecast' ? ['forecast', 'du', 'bao'] : [])];
  const s = bestSentences(g, about, 1)[0] ?? g.text.split(/(?<=[.!?])\s+/)[0];
  return `“${s}” ${cite.cite(g, s)}`;
}

/** The estimate a farmer's number replaced: its value and where it came from. */
function replacedText(raw: string, lang: Lang): string {
  const f = parseFieldFact('', raw);
  const where = [f.source, f.pixel ? tr(lang)(`one value per ${f.pixel}`, `mỗi giá trị cho một ô ${f.pixel}`) : null].filter(Boolean).join(', ');
  return where ? `${f.amount} (${where})` : f.amount;
}

/** "Source: SoilGrids 2.0 (0-30 cm), one value per 250 m." */
function sourceSentence(f: ParsedFact, lang: Lang): string | null {
  const t = tr(lang);
  if (f.provenance === 'farmer' || !f.source) return null;
  const bits = [f.source];
  if (f.pixel) bits.push(t(`one value per ${f.pixel}`, `mỗi giá trị cho một ô ${f.pixel}`));
  if (f.period) bits.push(/ to /.test(f.period) ? t(`for ${f.period}`, `cho giai đoạn ${f.period.replace(' to ', ' đến ')}`) : t(`mean of ${f.period}`, `trung bình ${f.period}`));
  if (f.date) bits.push(t(`read on ${f.date}`, `số liệu ngày ${f.date}`));
  return `${t('Source', 'Nguồn')}: ${bits.join(', ')}.`;
}

/** One sentence on how far the reading can be trusted, from how it was produced and the size of its pixel. */
function trustSentence(f: ParsedFact, ctx: FieldContext, lang: Lang): string | null {
  const t = tr(lang);
  const side = sideM(ctx);
  const larger = f.pixelM != null && side > 0 && f.pixelM > side;
  const mixed = larger ? t(`, larger than your field (about ${side} m across), so the surroundings are mixed in`, `, lớn hơn thửa ruộng của bạn (rộng khoảng ${side} m), nên giá trị lẫn cả vùng xung quanh`) : '';
  const stale = f.staleDays != null ? ` ${t(`The reading is ${f.staleDays} days old.`, `Số liệu đã cũ ${f.staleDays} ngày.`)}` : '';
  switch (f.provenance) {
    case 'farmer': {
      const was = f.replaced ? t(` The estimate it replaced was ${replacedText(f.replaced, 'en')}.`, ` Ước tính bị thay thế là ${replacedText(f.replaced, 'vi')}.`) : '';
      return t('This is the number you entered, so it replaces every satellite and model estimate.', 'Đây là số bạn tự nhập, nên nó thay cho mọi ước tính của vệ tinh và mô hình.') + was;
    }
    case 'modelled':
      return t(`It is a model estimate for ${f.pixel ? `one ${f.pixel} cell` : 'the area'}${mixed}, not a measurement on your field.`, `Đây là giá trị do mô hình ước tính cho ${f.pixel ? `một ô ${f.pixel}` : 'khu vực'}${mixed}, không phải số đo tại ruộng của bạn.`) + stale;
    case 'observed':
      return (f.pixel ? t(`It is an observation of one ${f.pixel} cell${mixed}.`, `Đây là số quan trắc của một ô ${f.pixel}${mixed}.`) : t('It is a mapped or surveyed value for the place, not a sample taken on your field.', 'Đây là giá trị từ bản đồ hoặc điều tra của khu vực, không phải mẫu lấy tại ruộng của bạn.')) + stale;
    case 'derived':
      return t('It is derived from other readings, not measured directly.', 'Đây là giá trị suy ra từ số liệu khác, không đo trực tiếp.') + stale;
    case 'forecast':
      return t(`It is a forecast${f.pixel ? ` for one ${f.pixel} cell` : ''}, not an observation: it does not see cold hollows or showers at the scale of one field.`, `Đây là dự báo${f.pixel ? ` cho một ô ${f.pixel}` : ''}, không phải quan trắc: dự báo không thấy được chỗ trũng lạnh hay cơn mưa ở cỡ một thửa ruộng.`);
    case 'simulated':
      return t('This value is simulated demo data.', 'Giá trị này là dữ liệu demo mô phỏng.');
    case 'score':
      return t(
        'It is a result the app computes itself for the crop of the field, from the readings of the field. It is not a measurement, and not a value read from a map or a survey.',
        'Đây là kết quả do chính ứng dụng tính cho cây của thửa, từ các số liệu của thửa. Đây không phải số đo, cũng không phải giá trị đọc từ bản đồ hay điều tra.',
      );
    default:
      return stale.trim() || null;
  }
}

/** What the productivity score is made of, in words: "growing condition 74, site compatibility 88; confidence of the score 0.62". */
function scoreParts(f: ParsedFact, lang: Lang): string | null {
  const t = tr(lang);
  if (!f.score) return null;
  const parts = [f.score.condition != null ? t(`growing condition ${f.score.condition}`, `điều kiện sinh trưởng ${f.score.condition}`) : null, f.score.compatibility != null ? t(`site compatibility ${f.score.compatibility}`, `mức phù hợp của khu đất ${f.score.compatibility}`) : null].filter(Boolean).join(', ');
  const confidence = f.score.confidence != null ? t(`confidence of the score ${f.score.confidence}`, `độ tin cậy của điểm ${f.score.confidence}`) : null;
  const all = [parts, confidence].filter(Boolean).join('; ');
  const when = f.date ? t(`on ${f.date}`, `ngày ${f.date}`) : null;
  return [when, all ? `(${all})` : null].filter(Boolean).join(' ') || null;
}

/** "9% below normal (within the normal band, normal 0.23)" in the language of the answer. */
function normalText(normal: string, lang: Lang): string {
  if (lang !== 'vi') return normal;
  return normal
    .replace(/^about normal/, 'xấp xỉ mức bình thường')
    .replace(/^(\d+)% below normal/, 'thấp hơn bình thường $1 %')
    .replace(/^(\d+)% above normal/, 'cao hơn bình thường $1 %')
    // A difference in the unit of the reading: "4.06 °C above normal".
    .replace(/^(\d+(?:\.\d+)?) (\S+) below normal/, 'thấp hơn bình thường $1 $2')
    .replace(/^(\d+(?:\.\d+)?) (\S+) above normal/, 'cao hơn bình thường $1 $2')
    .replace('within the normal band', 'trong dải bình thường')
    .replace('below the 10th percentile', 'dưới phân vị 10')
    .replace('above the 90th percentile', 'trên phân vị 90')
    .replace(', normal ', ', mức bình thường ');
}

/** Readings that share a source go into one paragraph: the values, then the source once. */
function groupBySource(readings: FieldReading[]): FieldReading[][] {
  const groups: FieldReading[][] = [];
  for (const r of readings) {
    const g = groups.find((x) => x[0].source === r.source && x[0].pixel === r.pixel && x[0].provenance === r.provenance && x[0].date === r.date && x[0].period === r.period);
    if (g) g.push(r);
    else groups.push([r]);
  }
  return groups;
}

const JUDGE = /low or high|high or low|too (low|high|much|little)|\b(good|bad|enough|normal|poor|rich)\b|thap hay cao|cao hay thap|nhieu hay it|it hay nhieu|co (tot|du|on|ngheo|giau|binh thuong)|\b(tot|xau|ngheo|giau) (khong|hay)/;
const ERODE = /\berosion|\berod|xoi mon/;

export function missingSentence(m: MissingReading, lang: Lang): string {
  const t = tr(lang);
  return t(`${m.label}: there is no value for this field. ${m.why} The cheapest way to get one: ${m.howToGet}.`, `${m.label}: không có số liệu cho thửa ruộng này. ${m.why} Cách rẻ nhất để có số: ${m.howToGet}.`);
}

/** The paragraphs of a value answer for readings that were found: the number first, then the source, then how far to trust it. */
export function readingParagraphs(store: KnowledgeStore, readings: FieldReading[], ctx: FieldContext, cite: Citer, lang: Lang): string[] {
  const t = tr(lang);
  const used = new Set<string>();
  return groupBySource(readings).map((group) => {
    const lower = (r: FieldReading) => `${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}`;
    const values = group.map((r, i) => `${i === 0 ? `${r.label} ${t('on your field', 'của ruộng bạn')}` : lower(r)}: ${r.shown}${r.score && scoreParts(r, lang) ? `, ${scoreParts(r, lang)}` : ''}`).join('; ');
    const intervals = group.filter((r) => r.interval).map((r) => `${group.length > 1 ? `${lower(r)} ` : ''}${r.interval![0]} ${t('to', 'đến')} ${r.interval![1]}`);
    // The lowest and the highest point of the parcel: a spread inside the field, not an uncertainty of the source.
    const unitOf = (r: FieldReading) => (r.number != null && r.amount.includes(' ') ? ` ${r.amount.slice(r.amount.indexOf(' ') + 1)}` : '');
    const within = group.filter((r) => r.within).map((r) => t(`Inside the parcel the ${lower(r)} goes from ${r.within![0]} to ${r.within![1]}${unitOf(r)}.`, `Trong thửa, ${lower(r)} đi từ ${r.within![0]} đến ${r.within![1]}${unitOf(r)}.`));
    const normals = group.filter((r) => r.normal).map((r) => `${group.length > 1 ? `${lower(r)} ` : ''}${normalText(r.normal!, lang)}`);
    const standIn = group[0].standsInFor;
    return [
      `${values}.`,
      sourceSentence(group[0], lang),
      trustSentence(group[0], ctx, lang),
      standIn ? t(`It stands in for ${standIn.name}, the observed series${standIn.ends ? `, which ends on ${standIn.ends}` : ''}.`, `Số này thay cho ${standIn.name}, chuỗi quan trắc${standIn.ends ? `, vốn dừng ở ngày ${standIn.ends}` : ''}.`) : null,
      intervals.length ? t(`The source gives a 5-95 % range of ${intervals.join('; ')}.`, `Nguồn cho khoảng 5-95 % là ${intervals.join('; ')}.`) : null,
      ...within,
      normals.length ? t(`Against the normal for this time of year: ${normals.join('; ')}.`, `So với mức bình thường của thời điểm này trong năm: ${normals.join('; ')}.`) : null,
      sourceNote(store, group[0], cite, lang, used),
    ]
      .filter(Boolean)
      .join(' ');
  });
}

function composeValue(store: KnowledgeStore, a: Analysis, cite: Citer, ctx: FieldContext): string[] {
  const t = tr(a.lang);
  const q = fold(a.query);
  const { readings, missing } = lookupFieldFacts(ctx, a.focus, a.termIds, a.lang);
  if (!readings.length && !missing.length) {
    // The parcel is meant, but no reading was recognised: say so, do not answer about another one.
    const can = availableReadings(ctx, a.lang);
    return [
      t('I could not tell which reading of your field you mean.', 'Tôi chưa nhận ra bạn hỏi về số liệu nào của thửa ruộng.'),
      can.length
        ? t(`For this field I have: ${can.join(', ')}. Name one, for example "What is the pH of my soil?".`, `Với thửa này tôi có: ${can.join(', ')}. Hãy nêu một mục, ví dụ "pH đất của tôi bao nhiêu?".`)
        : t('This field has no readings loaded yet.', 'Thửa ruộng này chưa có số liệu nào được tải.'),
    ];
  }
  const paras = [...readingParagraphs(store, readings, ctx, cite, a.lang), ...missing.map((m) => missingSentence(m, a.lang))];
  // Frost is a matter of the days ahead as much as of the last reading.
  if (a.focus.includes('frost')) paras.push(...forecastParagraphs(store, ['frost'], null, cite, ctx, a.lang));
  if (readings.length && a.focus.includes('slope') && ERODE.test(q))
    paras.push(t('I give the slope only: the app has no erosion estimate, which also depends on rain intensity, soil cover and the length of the slope.', 'Tôi chỉ nêu được độ dốc: ứng dụng chưa ước tính xói mòn, vì xói mòn còn tuỳ cường độ mưa, độ che phủ đất và chiều dài sườn dốc.'));
  else if (readings.length && JUDGE.test(q))
    paras.push(
      t(
        'I give the reading only. Whether it is low or high depends on the soil and the crop: name a crop and I compare pH, temperature, rain, texture and drainage with what it needs; for the other readings I have no threshold with a source yet.',
        'Tôi chỉ nêu số liệu. Thấp hay cao còn tuỳ loại đất và cây trồng: hãy nêu tên cây để tôi so pH, nhiệt độ, lượng mưa, thành phần cơ giới và thoát nước với yêu cầu của cây; với các chỉ tiêu khác tôi chưa có ngưỡng nào có nguồn.',
      ),
    );
  if (ctx.facts.data_mode) paras.push(t(`Note: ${ctx.facts.data_mode}.`, `Lưu ý: dữ liệu đang dùng là ${/simulated/.test(ctx.facts.data_mode) ? 'mô phỏng' : 'bộ demo lưu sẵn'}.`));
  const estimated = readings.some((r) => r.provenance === 'modelled' && /^(ph|soc_gkg|om_pct|cec_cmolkg|nitrogen_gkg|bulk_density|clay_pct|usda_texture|texture_class)$/.test(r.key));
  paras.push(
    missing.length || estimated
      ? t('Next step: a soil test or your own measurement, entered under Ground truth, replaces the estimate in every score.', 'Bước tiếp theo: phân tích đất hoặc tự đo rồi nhập ở bảng Số đo thực địa; số đó sẽ thay cho ước tính trong mọi điểm số.')
      : t('Next step: open the matching branch of the HUD to see this reading over the year.', 'Bước tiếp theo: mở nhánh tương ứng trên HUD để xem số liệu này trong cả năm.'),
  );
  return paras;
}

// ------------------------------------------------------------------------------------------------

const LEAST = /driest|\bleast\b|coldest|coolest|lowest|it nhat|kho nhat|lanh nhat|ret nhat|thap nhat|mat nhat/;

function monthParagraph(n: MonthlyNormal, lang: Lang, leastFirst: boolean): string {
  const t = tr(lang);
  const rain = n.key === 'climate_monthly_rain';
  const hi = `${monthName(n.max.month, lang)}, ${n.max.text} ${n.unit}`;
  const lo = `${monthName(n.min.month, lang)}, ${n.min.text} ${n.unit}`;
  const lead = rain
    ? leastFirst
      ? t(`On your field the driest month is ${lo} on average; the wettest is ${hi}.`, `Ở ruộng của bạn, tháng mưa ít nhất là ${lo} (trung bình nhiều năm); tháng mưa nhiều nhất là ${hi}.`)
      : t(`On your field the wettest month is ${hi} on average; the driest is ${lo}.`, `Ở ruộng của bạn, tháng mưa nhiều nhất là ${hi} (trung bình nhiều năm); tháng mưa ít nhất là ${lo}.`)
    : leastFirst
      ? t(`On your field the coldest month is ${lo} (mean air temperature); the warmest is ${hi}.`, `Ở ruộng của bạn, tháng lạnh nhất là ${lo} (nhiệt độ không khí trung bình); tháng nóng nhất là ${hi}.`)
      : t(`On your field the warmest month is ${hi} (mean air temperature); the coldest is ${lo}.`, `Ở ruộng của bạn, tháng nóng nhất là ${hi} (nhiệt độ không khí trung bình); tháng lạnh nhất là ${lo}.`);
  const all = n.months.map((m) => `${lang === 'vi' ? `T${m.month}` : MONTH_EN[m.month - 1].slice(0, 3)} ${m.text}`).join(', ');
  return `${lead} ${t(`All twelve months (${n.unit}): ${all}.`, `Cả mười hai tháng (${n.unit}): ${all}.`)}`;
}

/** The normal of the months a question names: "In March your field gets 22 mm of rain on average." */
function namedMonthParagraph(n: MonthlyNormal, months: number[], lang: Lang): string {
  const t = tr(lang);
  const rain = n.key === 'climate_monthly_rain';
  const said = months
    .map((m) => n.months.find((x) => x.month === m))
    .filter((x): x is MonthlyNormal['months'][number] => x != null)
    .map((x) =>
      rain
        ? t(`In ${monthName(x.month, 'en')} your field gets ${x.text} mm of rain on average.`, `Vào ${monthName(x.month, 'vi')}, ruộng của bạn mưa trung bình ${x.text} mm.`)
        : t(`In ${monthName(x.month, 'en')} the mean air temperature on your field is ${x.text} °C.`, `Vào ${monthName(x.month, 'vi')}, nhiệt độ không khí trung bình ở ruộng của bạn là ${x.text} °C.`),
    );
  const all = n.months.map((m) => `${lang === 'vi' ? `T${m.month}` : MONTH_EN[m.month - 1].slice(0, 3)} ${m.text}`).join(', ');
  return `${said.join(' ')} ${t(`All twelve months (${n.unit}): ${all}.`, `Cả mười hai tháng (${n.unit}): ${all}.`)}`;
}

function composeMonths(store: KnowledgeStore, a: Analysis, cite: Citer, ctx: FieldContext): string[] {
  const t = tr(a.lang);
  const q = guard(a.query);
  const wantsRain = a.focus.some((f) => f === 'rain' || f === 'water') || /wet|dry|rain|\bmua\b|\bkho\b/.test(q);
  const wantsTemp = a.focus.some((f) => f === 'temp' || f === 'frost') || /hot|cold|warm|cool|\bnong\b|\blanh\b|\bret\b|\bmat\b/.test(q);
  const keys: MonthlyNormal['key'][] = wantsRain === wantsTemp ? ['climate_monthly_rain', 'climate_monthly_t'] : wantsRain ? ['climate_monthly_rain'] : ['climate_monthly_t'];
  const normals = keys.map((k) => monthlyNormal(ctx, k)).filter((n): n is MonthlyNormal => n != null);
  if (!normals.length)
    return [t('The climate history of this field has not loaded, so I have no monthly means to answer from. It needs at least three years of history; try again once the climate branch has loaded.', 'Lịch sử khí hậu của thửa ruộng này chưa tải xong nên tôi chưa có trung bình theo tháng để trả lời. Cần ít nhất ba năm số liệu; hãy hỏi lại khi nhánh khí hậu đã tải.')];
  const used = new Set<string>();
  const named = a.ask === 'month-value' && a.months.length > 0;
  const paras = normals.map((n) => (named ? namedMonthParagraph(n, a.months, a.lang) : monthParagraph(n, a.lang, LEAST.test(q))));
  const f = normals[0].fact;
  paras.push([sourceSentence(f, a.lang), trustSentence(f, ctx, a.lang), sourceNote(store, f, cite, a.lang, used)].filter(Boolean).join(' '));
  paras.push(t('These are means over many years: a single year can differ. Next step: the rainfall and climate branches of the HUD show this year against the normal.', 'Đây là trung bình nhiều năm: từng năm có thể khác. Bước tiếp theo: nhánh mưa và khí hậu trên HUD cho thấy năm nay so với mức bình thường.'));
  return paras;
}

// ------------------------------------------------------------------------------------------------

const KIND_NAME: Record<RiskKind, [string, string]> = {
  frost: ['frost', 'sương giá'],
  heat: ['heat', 'nắng nóng'],
  'heavy-rain': ['heavy rain', 'mưa lớn'],
  'dry-spell': ['dry spell', 'khô hạn'],
  wind: ['strong wind', 'gió mạnh'],
  flood: ['flood', 'ngập lụt'],
  pest: ['pest', 'sâu hại'],
  disease: ['disease', 'bệnh hại'],
};

/** When the app raises each warning (src/data/harmonize/risk.ts); a test keeps the two in step. */
export const RISK_RULE: Partial<Record<RiskKind, [string, string]>> = {
  frost: ['a forecast minimum of 2 °C or lower', 'nhiệt độ thấp nhất dự báo từ 2 °C trở xuống'],
  heat: ['two or more days in a row with a forecast maximum of 35 °C or higher', 'từ hai ngày liên tiếp có nhiệt độ cao nhất dự báo từ 35 °C trở lên'],
  'heavy-rain': ['30 mm or more forecast in one day', 'dự báo từ 30 mm trong một ngày'],
  'dry-spell': ['ten or more days in a row with less than 1 mm of rain forecast', 'từ mười ngày liên tiếp dự báo mưa dưới 1 mm'],
  wind: ['wind of 50 km/h or more', 'gió từ 50 km/h trở lên'],
};

/** The detail of a risk event in Vietnamese, rebuilt from the numbers of the English text the fact carries. */
export function riskDetail(r: RiskFact, lang: Lang): string {
  if (lang !== 'vi') return r.detail;
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const m = (re: string) => r.detail.match(new RegExp(re));
  const frost = m(`^Minimum temperature down to ${num} °C\\.$`);
  if (frost) return `Nhiệt độ thấp nhất xuống ${frost[1]} °C.`;
  const heat = m(`^(\\d+) days at or above 35 °C, peak ${num} °C\\.$`);
  if (heat) return `${heat[1]} ngày từ 35 °C trở lên, cao nhất ${heat[2]} °C.`;
  const rain = m(`^${num} mm forecast in one day\\.$`);
  if (rain) return `Dự báo ${rain[1]} mm trong một ngày.`;
  const dry = m('^(\\d+) consecutive days with less than 1 mm of rain\\.$');
  if (dry) return `${dry[1]} ngày liên tiếp mưa dưới 1 mm.`;
  const wind = m('^Wind up to (\\d+) km/h\\.$');
  if (wind) return `Gió đến ${wind[1]} km/h.`;
  return `"${r.detail}"`;
}

/**
 * Which warnings a question is about; none named means all of them. `q` is the guarded text
 * (`guard`): with accents "bão" is the storm and "dự báo" is not; without accents "bao" after
 * "du" or "canh" is "du bao", "canh bao", and before "nhieu" it is "bao nhieu".
 */
function kindsAsked(q: string, focus: Focus[]): RiskKind[] {
  const out: RiskKind[] = [];
  if (focus.includes('frost') || /\bcold\b|\blanh\b|\bret\b/.test(q)) out.push('frost');
  if (/\bheat|\bhot\b|nang nong|\bnong\b/.test(q)) out.push('heat');
  const storm = /storm|(?<!du |canh )\bbao\b(?! nhieu)/.test(q);
  if (storm || /heavy rain|downpour|flood|mua (lon|to)|ngap/.test(q) || (focus.includes('rain') && !/\bdry\b|\bkho\b/.test(q))) out.push('heavy-rain', 'flood');
  if (/drought|dry spell|\bdry\b|kho han|han han|\bhan\b|\bkho\b/.test(q)) out.push('dry-spell');
  if (storm || /\bwind|\bgio\b/.test(q)) out.push('wind');
  return [...new Set(out)];
}

const NUMBER_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, mot: 1, hai: 2, ba: 3, bon: 4 };

/** Days ahead the question asks about; null for the whole forecast. `q` is the plainly folded question. */
export function horizonDays(q: string): number | null {
  if (/tomorrow|ngay mai/.test(q)) return 1;
  const count = (s: string | undefined) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : (NUMBER_WORD[s] ?? null));
  // "next 2 weeks", "two weeks", "2 tuần tới", "hai tuần nữa"; a fortnight.
  const weeks = q.match(/(?:next |coming |in |within )?(\d+|one|two|three|four) weeks?\b/) ?? q.match(/(\d+|mot|hai|ba|bon) tuan (?:toi|nua|sau)/);
  if (weeks && count(weeks[1]) != null) return 7 * count(weeks[1])!;
  if (/fortnight/.test(q)) return 14;
  const days = q.match(/(?:next |coming |in |within )?(\d+) days\b/) ?? q.match(/(\d+) ngay (?:toi|nua)/);
  if (days) return Number(days[1]);
  if (/next week|this week|coming week|tuan (toi|sau|nay)/.test(q)) return 7;
  return null;
}

function forecastParagraphs(store: KnowledgeStore, kinds: RiskKind[], days: number | null, cite: Citer, ctx: FieldContext, lang: Lang): string[] {
  const t = tr(lang);
  const fcMin = readFact(ctx, 'forecast_tmin', lang);
  const fcMax = readFact(ctx, 'forecast_tmax', lang);
  const fcRain = readFact(ctx, 'forecast_rain', lang);
  const all = riskFacts(ctx);
  const anyForecast = fcMin ?? fcMax ?? fcRain ?? all[0]?.fact;
  if (!anyForecast) {
    // Without a forecast, the last reading that bears on the question is what there is to say.
    const recent = [kinds.includes('frost') || !kinds.length ? 't2m_min' : null, kinds.includes('heat') ? 't2m_max' : null, kinds.includes('heavy-rain') || kinds.includes('dry-spell') ? 'rain_30d' : null]
      .filter((k): k is string => k != null)
      .map((k) => readFact(ctx, k, lang))
      .filter((r): r is FieldReading => r != null);
    return [
      t('No weather forecast is loaded for this field, so I cannot say what the coming days hold.', 'Chưa tải được dự báo thời tiết cho thửa ruộng này nên tôi chưa nói được những ngày tới ra sao.'),
      ...(recent.length ? [t('The most recent readings are these, and they say nothing of the days ahead.', 'Số liệu gần nhất như sau, và chúng không nói gì về những ngày tới.'), ...readingParagraphs(store, recent, ctx, cite, lang)] : []),
    ];
  }
  const forecastEnd = anyForecast.period?.split(' to ')[1] ?? null;
  // The days asked about, but never beyond the last day of the forecast: no warning after that
  // day means nothing, because there is no forecast for it.
  const askedEnd = days != null ? addDays(ctx.date, days) : null;
  const beyond = askedEnd != null && forecastEnd != null && askedEnd > forecastEnd;
  const until = askedEnd == null || beyond ? forecastEnd : askedEnd;
  const events = all.filter((e) => (kinds.length === 0 || kinds.includes(e.kind)) && e.end >= ctx.date && (until == null || e.start <= until));
  const what = kinds.length ? [...new Set(kinds.filter((k) => k !== 'flood').map((k) => t(KIND_NAME[k][0], KIND_NAME[k][1])))].join(t(' or ', ' hoặc ')) : t('weather', 'thời tiết');
  const span = until ? t(`up to ${day(until, 'en')}`, `đến ${day(until, 'vi')}`) : t('in the forecast', 'trong dự báo');
  const paras: string[] = [];
  if (events.length) {
    const lines = events.map((e) => {
      const when = e.start === e.end ? day(e.start, lang) : `${day(e.start, lang)} ${t('to', 'đến')} ${day(e.end, lang)}`;
      const level = e.severity != null ? t(`, level ${e.severity} of 3`, `, mức ${e.severity}/3`) : '';
      return `- ${when}: ${t(KIND_NAME[e.kind][0], KIND_NAME[e.kind][1])}${level}. ${riskDetail(e, lang)}`;
    });
    paras.push(`${t(`The forecast for your field holds ${events.length} ${what} warning${events.length > 1 ? 's' : ''} ${span}:`, `Dự báo cho ruộng của bạn có ${events.length} cảnh báo ${what} ${span}:`)}\n${lines.join('\n')}`);
  } else {
    paras.push(t(`The forecast for your field holds no ${what} warning ${span}.`, `Dự báo cho ruộng của bạn không có cảnh báo ${what} nào ${span}.`));
  }
  if (beyond && forecastEnd && days != null)
    paras.push(
      t(
        `The forecast reaches only to ${day(forecastEnd, 'en')}, not the ${days} days you asked about: nothing can be said of the days after it.`,
        `Dự báo chỉ tới ngày ${day(forecastEnd, 'vi')}, không đủ ${days} ngày như bạn hỏi: những ngày sau đó chưa nói được gì.`,
      ),
    );
  // The numbers the warnings are raised from, and the rule, so that "no warning" can be checked.
  const support: string[] = [];
  const asked = kinds.length ? kinds : (['frost', 'heat', 'heavy-rain'] as RiskKind[]);
  const on = (f: FieldReading) => f.value.match(/on (\d{4}-\d{2}-\d{2})/)?.[1];
  const whole = forecastEnd ? t(`the whole forecast (to ${day(forecastEnd, 'en')})`, `cả kỳ dự báo (đến ${day(forecastEnd, 'vi')})`) : t('the forecast', 'dự báo');
  if (asked.includes('frost') && fcMin) support.push(t(`The lowest minimum in ${whole} is ${fcMin.shown}${on(fcMin) ? `, on ${day(on(fcMin)!, 'en')}` : ''}; the app warns of frost at ${RISK_RULE.frost![0]}.`, `Nhiệt độ thấp nhất trong ${whole} là ${fcMin.shown}${on(fcMin) ? `, vào ngày ${day(on(fcMin)!, 'vi')}` : ''}; ứng dụng cảnh báo sương giá khi ${RISK_RULE.frost![1]}.`));
  if (asked.includes('heat') && fcMax) support.push(t(`The highest maximum in ${whole} is ${fcMax.shown}${on(fcMax) ? `, on ${day(on(fcMax)!, 'en')}` : ''}; the app warns of heat at ${RISK_RULE.heat![0]}.`, `Nhiệt độ cao nhất trong ${whole} là ${fcMax.shown}${on(fcMax) ? `, vào ngày ${day(on(fcMax)!, 'vi')}` : ''}; ứng dụng cảnh báo nắng nóng khi ${RISK_RULE.heat![1]}.`));
  if ((asked.includes('heavy-rain') || asked.includes('dry-spell')) && fcRain) {
    const wettest = fcRain.value.match(/wettest day (-?\d+(?:\.\d+)?) mm on (\d{4}-\d{2}-\d{2})/);
    const n = fcRain.value.match(/over (\d+) days/)?.[1];
    support.push(t(`The forecast totals ${fcRain.shown}${n ? ` over ${n} days` : ''}${wettest ? `, the wettest day ${wettest[1]} mm on ${day(wettest[2], 'en')}` : ''}; the app warns of heavy rain at ${RISK_RULE['heavy-rain']![0]} and of a dry spell at ${RISK_RULE['dry-spell']![0]}.`, `Tổng lượng mưa dự báo là ${fcRain.shown}${n ? ` trong ${n} ngày` : ''}${wettest ? `, ngày mưa nhiều nhất ${wettest[1]} mm vào ${day(wettest[2], 'vi')}` : ''}; ứng dụng cảnh báo mưa lớn khi ${RISK_RULE['heavy-rain']![1]} và khô hạn khi ${RISK_RULE['dry-spell']![1]}.`));
  }
  if (support.length) paras.push(support.join(' '));
  const used = new Set<string>();
  paras.push([sourceSentence(anyForecast, lang), trustSentence({ ...anyForecast, provenance: 'forecast' }, ctx, lang), sourceNote(store, anyForecast, cite, lang, used)].filter(Boolean).join(' '));
  return paras;
}

function composeForecast(store: KnowledgeStore, a: Analysis, cite: Citer, ctx: FieldContext): string[] {
  const t = tr(a.lang);
  const paras = forecastParagraphs(store, kindsAsked(guard(a.query), a.focus), horizonDays(fold(a.query)), cite, ctx, a.lang);
  paras.push(t('Next step: the risk branch of the HUD shows each forecast day; check again the day before any field work that frost, heat or rain would spoil.', 'Bước tiếp theo: nhánh rủi ro trên HUD cho thấy từng ngày dự báo; hãy xem lại vào hôm trước khi làm việc đồng áng mà sương giá, nắng nóng hay mưa có thể làm hỏng.'));
  return paras;
}

// ------------------------------------------------------------------------------------------------

export function composeFieldFact(store: KnowledgeStore, a: Analysis, cite: Citer, ctx: FieldContext | undefined): string[] {
  const t = tr(a.lang);
  if (!ctx) {
    const paras = [t('No field is locked, so I have no reading of your field to give. Lock a parcel on the globe and ask again.', 'Chưa khoá thửa ruộng nào nên tôi chưa có số liệu nào của ruộng bạn. Hãy khoá một thửa trên bản đồ rồi hỏi lại.')];
    // What the reading means can still be said.
    const g = a.termIds[0] ? (store.chunks.get(`gloss-${a.lang}:${a.termIds[0]}`) ?? store.chunks.get(`gloss-${a.lang}:${a.termIds[0]}:0`)) : undefined;
    if (g) {
      const ss = g.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
      paras.push(`${ss} ${cite.cite(g, ss)}`);
    }
    return paras;
  }
  if (a.ask === 'month-extreme' || a.ask === 'month-value') return composeMonths(store, a, cite, ctx);
  if (a.ask === 'forecast') return composeForecast(store, a, cite, ctx);
  return composeValue(store, a, cite, ctx);
}
