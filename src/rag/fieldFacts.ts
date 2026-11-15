/**
 * Readings of the locked parcel, looked up in `FieldContext.facts` by what the question is about.
 * Pure: it parses the fact strings `buildFieldContext` writes ("value unit (source, pixel,
 * provenance, date; 5-95%: lo-hi; ...)") and never estimates a reading that is not there. A
 * missing reading comes back with the reason it is missing and the cheapest way to get it.
 */
import type { FieldContext, Lang } from '@/contracts';
import { parseMonthly } from './fieldContext';
import type { Focus } from './intent';

export type Provenance = 'farmer' | 'observed' | 'modelled' | 'derived' | 'forecast' | 'simulated' | 'unknown';

export interface ParsedFact {
  key: string;
  /** The fact as `FieldContext.facts` holds it. */
  raw: string;
  /** Everything the fact says before its source: "5.6", "19.4 g/kg", "96 mm over the 30 days to 2026-11-10". */
  value: string;
  /** The number and its unit, or the class name, as the fact prints them: "5.6", "19.4 g/kg", "96 mm", "clay loam". */
  amount: string;
  number: number | null;
  /** Name of the source, without pixel, provenance or date. */
  source: string | null;
  /** Ground size of one value of the source: "250 m", "9 km". */
  pixel: string | null;
  pixelM: number | null;
  provenance: Provenance;
  /** Day of the observation, when the fact states one. */
  date: string | null;
  /** Years a climate normal was taken over: "2006-2025". */
  period: string | null;
  /** 5 % and 95 % bounds of the source's prediction interval. */
  interval: [string, string] | null;
  staleDays: number | null;
  /** How the reading compares with its normal for the day: "9% below normal (within the normal band, normal 0.23)". */
  normal: string | null;
  /** The estimate a farmer's own number replaced, as a fact string. */
  replaced: string | null;
}

/** Split at a separator that is outside every pair of parentheses. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

const PIXEL = /^(\d+(?:\.\d+)?) (m|km) pixel$/;
/** Words that follow a number in a fact and describe it; anything else right after a number is its unit. */
const NOT_A_UNIT = /^(over|mean|lowest|highest|forecast|productivity|of|on|in)$/;

function amountOf(value: string): string {
  const score = value.match(/^-?\d+(?:\.\d+)?\/\d+/);
  if (score) return score[0];
  const m = value.match(/^(-?\d+(?:\.\d+)?)(?: (\S+))?/);
  if (!m) return value;
  return m[2] && !NOT_A_UNIT.test(m[2]) ? `${m[1]} ${m[2].replace(/,$/, '')}` : m[1];
}

export function parseFieldFact(key: string, raw: string): ParsedFact {
  const open = raw.indexOf(' (');
  const close = raw.lastIndexOf(')');
  const value = (open < 0 ? raw : raw.slice(0, open)).trim();
  const inner = open >= 0 && close > open ? raw.slice(open + 2, close) : '';
  const num = value.match(/^-?\d+(?:\.\d+)?/);
  const out: ParsedFact = { key, raw, value, amount: amountOf(value), number: num ? Number(num[0]) : null, source: null, pixel: null, pixelM: null, provenance: 'unknown', date: null, period: null, interval: null, staleDays: null, normal: null, replaced: null };
  if (!inner) return out;
  if (/^(measured|entered|reported) by the farmer/.test(inner)) {
    out.provenance = 'farmer';
    out.replaced = inner.match(/estimate was (.+)$/)?.[1] ?? null;
    return out;
  }
  const [descriptor, ...rest] = splitTop(inner, '; ');
  for (const part of rest) {
    const interval = part.match(/^5-95%: (-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
    const stale = part.match(/^stale: (\d+) days old$/);
    if (interval) out.interval = [interval[1], interval[2]];
    else if (stale) out.staleDays = Number(stale[1]);
    else if (/normal/.test(part)) out.normal = part;
  }
  // The name comes first; pixel, provenance and date follow it in any number.
  const name: string[] = [];
  let observed = false;
  for (const token of splitTop(descriptor, ', ')) {
    const pixel = token.match(PIXEL);
    if (pixel) {
      out.pixel = `${pixel[1]} ${pixel[2]}`;
      out.pixelM = Number(pixel[1]) * (pixel[2] === 'km' ? 1000 : 1);
    } else if (token === 'modelled' || token === 'derived' || token === 'forecast' || token === 'simulated') out.provenance = token;
    else if (token === 'ground-truth') out.provenance = 'farmer';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(token)) out.date = token;
    else if (/^\d{4}-\d{4}$/.test(token)) out.period = token;
    else if (/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(token)) out.period = token;
    else if (token === 'monthly means' || /^severity \d\/3$/.test(token)) continue;
    else {
      name.push(token);
      observed = true;
    }
  }
  out.source = name.length ? name.join(', ') : null;
  // `buildFieldContext` names the provenance of every source that is not an observation.
  if (out.provenance === 'unknown' && observed) {
    const src = out.source ?? '';
    // A reanalysis or a soil model is a model whether or not the fact repeats it.
    out.provenance = /^derived from /.test(src) ? 'derived' : /^parcel /.test(src) ? 'unknown' : /reanalysis|ERA5|MERRA|SoilGrids/i.test(src) ? 'modelled' : 'observed';
  }
  return out;
}

// ------------------------------------------------------------------------------------------------

type Text = [en: string, vi: string];

/** What each reading is called. Keys are the fact keys of `FieldContext.facts`. */
const LABEL: Record<string, Text> = {
  ph: ['Soil pH', 'pH đất'],
  ec_dsm: ['Soil salinity (electrical conductivity)', 'Độ mặn của đất (độ dẫn điện)'],
  om_pct: ['Soil organic matter', 'Chất hữu cơ trong đất'],
  soc_gkg: ['Soil organic carbon', 'Carbon hữu cơ trong đất'],
  cec_cmolkg: ['Cation exchange capacity (CEC)', 'Dung tích trao đổi cation (CEC)'],
  nitrogen_gkg: ['Total nitrogen in the soil', 'Đạm tổng số trong đất'],
  bulk_density: ['Bulk density', 'Dung trọng đất'],
  usda_texture: ['Soil texture (USDA class)', 'Loại đất theo thành phần cơ giới (USDA)'],
  texture_class: ['Texture group', 'Nhóm thành phần cơ giới'],
  clay_pct: ['Clay', 'Sét'],
  sand_pct: ['Sand', 'Cát'],
  silt_pct: ['Silt', 'Limon'],
  drainage_class: ['Drainage class', 'Cấp thoát nước'],
  depth_cm: ['Depth to a layer that stops roots', 'Độ sâu đến tầng hạn chế rễ'],
  awc_cmcm: ['Available water capacity', 'Sức chứa nước hữu hiệu'],
  elevation_m: ['Elevation', 'Độ cao'],
  slope_deg: ['Slope', 'Độ dốc'],
  relief_m: ['Difference in height within the parcel', 'Chênh cao trong thửa'],
  aspect_label: ['The slope faces', 'Hướng dốc'],
  sm_root: ['Root-zone soil moisture', 'Độ ẩm đất vùng rễ'],
  sm_surface: ['Surface soil moisture', 'Độ ẩm đất lớp mặt'],
  ndvi: ['NDVI', 'NDVI'],
  evi: ['EVI', 'EVI'],
  lst_day: ['Daytime land surface temperature', 'Nhiệt độ bề mặt đất ban ngày'],
  esi: ['Evaporative stress index', 'Chỉ số stress bốc thoát hơi'],
  et: ['Evapotranspiration', 'Bốc thoát hơi nước'],
  et0: ['Reference evapotranspiration', 'Bốc thoát hơi tham chiếu'],
  t2m: ['Mean air temperature of the day', 'Nhiệt độ không khí trung bình ngày'],
  t2m_max: ['Maximum air temperature of the day', 'Nhiệt độ không khí cao nhất ngày'],
  t2m_min: ['Minimum air temperature of the day', 'Nhiệt độ không khí thấp nhất ngày'],
  rh: ['Relative humidity', 'Độ ẩm không khí'],
  par: ['Photosynthetically active radiation (PAR)', 'Bức xạ quang hợp (PAR)'],
  wind: ['Wind speed', 'Tốc độ gió'],
  rain_30d: ['Rain over the last 30 days', 'Lượng mưa 30 ngày qua'],
  rain_90d: ['Rain over the last 90 days', 'Lượng mưa 90 ngày qua'],
  climate_rain_annual: ['Mean annual rainfall', 'Lượng mưa trung bình năm'],
  climate_t_mean: ['Mean annual air temperature', 'Nhiệt độ không khí trung bình năm'],
  irrigation: ['Irrigation', 'Tưới'],
  score_now: ['Productivity score', 'Điểm năng suất'],
  forecast_tmin: ['Lowest minimum temperature in the forecast', 'Nhiệt độ thấp nhất trong dự báo'],
  forecast_tmax: ['Highest maximum temperature in the forecast', 'Nhiệt độ cao nhất trong dự báo'],
  forecast_rain: ['Rain in the forecast', 'Lượng mưa trong dự báo'],
};

/** Fact keys that answer a question about a focus, most direct first. */
const FOCUS_FACTS: Record<Focus, string[]> = {
  ph: ['ph'],
  salinity: ['ec_dsm'],
  organic: ['om_pct', 'soc_gkg'],
  cec: ['cec_cmolkg'],
  nitrogen: ['nitrogen_gkg'],
  density: ['bulk_density'],
  texture: ['usda_texture', 'texture_class', 'clay_pct', 'sand_pct', 'silt_pct'],
  drainage: ['drainage_class'],
  depth: ['depth_cm'],
  slope: ['slope_deg', 'relief_m', 'aspect_label'],
  altitude: ['elevation_m'],
  temp: ['t2m', 'climate_t_mean'],
  rain: ['rain_30d', 'rain_90d', 'climate_rain_annual'],
  water: ['sm_root', 'sm_surface', 'rain_30d', 'irrigation'],
  frost: ['t2m_min', 'forecast_tmin'],
  light: ['par'],
  soil: ['ph', 'usda_texture', 'texture_class', 'om_pct', 'soc_gkg', 'cec_cmolkg', 'nitrogen_gkg', 'bulk_density', 'drainage_class', 'depth_cm', 'ec_dsm'],
  // The length of a crop's cycle is a property of the crop, not a reading of the parcel.
  cycle: [],
};

/** Glossary term -> the readings that show it on the parcel. */
export const TERM_FACTS: Record<string, string[]> = {
  ndvi: ['ndvi'],
  evi: ['evi'],
  lst: ['lst_day'],
  'evaporative-stress': ['esi'],
  evapotranspiration: ['et0', 'et'],
  'crop-coefficient': ['et0'],
  'soil-moisture': ['sm_root', 'sm_surface'],
  'soil-moisture-anomaly': ['sm_root'],
  'water-balance': ['rain_30d', 'et0'],
  'growing-degree-days': ['t2m'],
  'frost-risk': ['t2m_min'],
  'imerg-rainfall': ['rain_30d'],
  'nasa-power': ['t2m'],
  par: ['par'],
  'srtm-terrain': ['elevation_m', 'slope_deg'],
  soilgrids: ['ph', 'clay_pct'],
  'soil-ph': ['ph'],
  'soil-texture': ['texture_class', 'drainage_class'],
  'productivity-score': ['score_now'],
};

/** Why a reading can be absent, by the first fact key of its focus. */
const WHY_MISSING: Record<string, Text> = {
  ec_dsm: [
    'Salinity (electrical conductivity) is read from the United States soil survey (SSURGO) only, so a field outside the United States has no value unless you enter one.',
    'Độ mặn (độ dẫn điện) chỉ lấy được từ bản đồ điều tra đất SSURGO của Mỹ, nên thửa ruộng ngoài nước Mỹ không có số liệu trừ khi bạn tự nhập.',
  ],
  depth_cm: [
    'The depth to a layer that stops roots is read from the United States soil survey (SSURGO) only.',
    'Độ sâu đến tầng hạn chế rễ chỉ lấy được từ bản đồ điều tra đất SSURGO của Mỹ.',
  ],
  drainage_class: [
    'The drainage class is read from the United States soil survey (SSURGO) only, unless you enter your own.',
    'Cấp thoát nước chỉ lấy được từ bản đồ điều tra đất SSURGO của Mỹ, trừ khi bạn tự nhập.',
  ],
  rain_30d: [
    'No daily rainfall series reaches the last 30 days for this field.',
    'Chưa có chuỗi mưa theo ngày nào phủ tới 30 ngày gần đây của thửa ruộng này.',
  ],
  t2m_min: ['No air-temperature series or forecast was loaded for this field.', 'Chưa tải được chuỗi nhiệt độ không khí hay dự báo cho thửa ruộng này.'],
};
const WHY_DEFAULT: Text = ['The data loaded for this field holds no value for it.', 'Dữ liệu đã tải của thửa ruộng này không có giá trị nào cho mục đó.'];

/** The cheapest way to get a reading that is missing. */
const HOW_TO_GET: Record<string, Text> = {
  ph: ['a soil test (pH in water) from the local extension office, or a pH kit', 'phân tích đất (pH nước) ở trạm khuyến nông, hoặc bộ thử pH'],
  ec_dsm: ['an EC meter in a soil-water paste, or a lab test of a soil sample', 'máy đo EC trên hỗn hợp đất và nước, hoặc gửi mẫu đất tới phòng thí nghiệm'],
  om_pct: ['a lab soil test (organic matter or organic carbon)', 'phân tích đất ở phòng thí nghiệm (chất hữu cơ hoặc carbon hữu cơ)'],
  cec_cmolkg: ['a lab soil test', 'phân tích đất ở phòng thí nghiệm'],
  nitrogen_gkg: ['a lab soil test', 'phân tích đất ở phòng thí nghiệm'],
  bulk_density: ['a core of known volume, dried and weighed', 'lấy mẫu đất bằng ống có thể tích biết trước, sấy khô rồi cân'],
  usda_texture: ['a jar or ribbon test of the topsoil, or a lab soil test', 'thử đất bằng lọ nước hoặc vê đất, hoặc phân tích ở phòng thí nghiệm'],
  drainage_class: ['watching where water stands 24 hours after heavy rain', 'quan sát nơi nước còn đọng 24 giờ sau mưa lớn'],
  depth_cm: ['a pit or an auger hole down to the layer roots do not pass', 'đào phẫu diện hoặc khoan tới tầng rễ không xuyên qua được'],
  slope_deg: ['a clinometer app on a phone, held along the steepest line', 'ứng dụng đo độ nghiêng trên điện thoại, đặt theo hướng dốc nhất'],
  elevation_m: ['the altitude a phone GPS shows on the field', 'độ cao GPS của điện thoại đo tại ruộng'],
  rain_30d: ['a rain gauge on the farm', 'thùng đo mưa đặt tại ruộng'],
  t2m_min: ['a minimum thermometer at crop height', 'nhiệt kế tối thấp đặt ngang tầm cây'],
  sm_root: ['a soil-moisture probe at root depth, or feeling a handful of soil from that depth', 'đầu đo độ ẩm ở tầng rễ, hoặc nắm thử đất lấy ở độ sâu đó'],
};
const HOW_DEFAULT: Text = ['a measurement on the field, entered under Ground truth', 'một số đo tại ruộng, nhập ở bảng Số đo thực địa'];

const pickText = (t: Text, lang: Lang) => (lang === 'vi' ? t[1] : t[0]);

export function factLabel(key: string, lang: Lang): string {
  return LABEL[key] ? pickText(LABEL[key], lang) : key;
}

export interface FieldReading extends ParsedFact {
  label: string;
  /** The value as the answer shows it: class names in the language of the answer. */
  shown: string;
}

export interface MissingReading {
  key: string;
  label: string;
  why: string;
  howToGet: string;
}

const VI_DRAINAGE: [RegExp, string][] = [
  [/^somewhat excessively drained/i, 'thoát nước hơi mạnh'],
  [/^excessively drained/i, 'thoát nước quá mạnh'],
  [/^moderately well drained/i, 'thoát nước khá tốt'],
  [/^well drained|^well$/i, 'thoát nước tốt'],
  [/^somewhat poorly drained/i, 'thoát nước hơi kém'],
  [/^very poorly drained/i, 'thoát nước rất kém'],
  [/^poorly drained|^poor$/i, 'thoát nước kém'],
];
const VI_COMPASS: Record<string, string> = { N: 'bắc', NE: 'đông bắc', E: 'đông', SE: 'đông nam', S: 'nam', SW: 'tây nam', W: 'tây', NW: 'tây bắc', flat: 'bằng phẳng (không có hướng dốc)' };
const EN_COMPASS: Record<string, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west', flat: 'no direction (the parcel is flat)' };
const VI_TEXTURE_GROUP: Record<string, string> = { heavy: 'nặng (nhiều sét)', medium: 'trung bình', light: 'nhẹ (nhiều cát)', organic: 'hữu cơ' };
const EN_TEXTURE_GROUP: Record<string, string> = { heavy: 'heavy (clayey)', medium: 'medium', light: 'light (sandy)', organic: 'organic' };
const VI_IRRIGATION: Record<string, string> = { full: 'tưới đủ', supplemental: 'tưới bổ sung', rainfed: 'nhờ nước mưa' };

function shownValue(key: string, value: string, lang: Lang): string {
  if (key === 'aspect_label') return (lang === 'vi' ? VI_COMPASS : EN_COMPASS)[value] ?? value;
  if (key === 'texture_class') return (lang === 'vi' ? VI_TEXTURE_GROUP : EN_TEXTURE_GROUP)[value] ?? value;
  if (lang !== 'vi') return value;
  if (key === 'drainage_class') return VI_DRAINAGE.find(([re]) => re.test(value))?.[1] ?? value;
  if (key === 'irrigation') return VI_IRRIGATION[value] ?? value;
  return value;
}

export function readFact(ctx: FieldContext, key: string, lang: Lang): FieldReading | null {
  const raw = ctx.facts[key];
  if (!raw) return null;
  const parsed = parseFieldFact(key, raw);
  return { ...parsed, label: factLabel(key, lang), shown: shownValue(key, parsed.amount, lang) };
}

export interface FieldLookup {
  readings: FieldReading[];
  /** One entry per focus or term none of whose readings the parcel has. */
  missing: MissingReading[];
}

/**
 * The readings of the parcel that answer a question about these focuses and glossary terms. A
 * broad word beside a specific one ("is my soil salty") leaves only the specific one.
 */
export function lookupFieldFacts(ctx: FieldContext, focus: Focus[], termIds: string[], lang: Lang): FieldLookup {
  const specific = focus.filter((f) => f !== 'soil' && f !== 'water');
  const wanted: string[][] = (specific.length ? specific : focus).map((f) => FOCUS_FACTS[f]).filter((keys) => keys.length > 0);
  for (const t of termIds) if (TERM_FACTS[t]) wanted.push(TERM_FACTS[t]);
  const readings: FieldReading[] = [];
  const missing: MissingReading[] = [];
  const seen = new Set<string>();
  for (const keys of wanted) {
    const found = keys.map((k) => readFact(ctx, k, lang)).filter((r): r is FieldReading => r != null);
    for (const r of found) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      readings.push(r);
    }
    const first = keys[0];
    // A focus counts as answered when any of its readings is there, or was already given.
    if (!found.length && !keys.some((k) => seen.has(k)) && !missing.some((m) => m.key === first)) {
      missing.push({ key: first, label: factLabel(first, lang), why: pickText(WHY_MISSING[first] ?? WHY_DEFAULT, lang), howToGet: pickText(HOW_TO_GET[first] ?? HOW_DEFAULT, lang) });
    }
  }
  return { readings, missing };
}

/** Readings the parcel has, grouped for "what can I ask about this field". */
export function availableReadings(ctx: FieldContext, lang: Lang): string[] {
  const order = ['ph', 'usda_texture', 'om_pct', 'soc_gkg', 'cec_cmolkg', 'nitrogen_gkg', 'ec_dsm', 'drainage_class', 'slope_deg', 'elevation_m', 'sm_root', 'ndvi', 'rain_30d', 'climate_rain_annual', 'climate_t_mean', 'forecast_tmin', 'score_now'];
  return order.filter((k) => ctx.facts[k]).map((k) => factLabel(k, lang));
}

// ------------------------------------------------------------------------------------------------

export interface MonthValue {
  /** 1-12. */
  month: number;
  /** As the fact prints it. */
  text: string;
  value: number;
}

export interface MonthlyNormal {
  key: 'climate_monthly_rain' | 'climate_monthly_t';
  unit: string;
  months: MonthValue[];
  max: MonthValue;
  min: MonthValue;
  fact: ParsedFact;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The twelve monthly means of rain or temperature, with the highest and the lowest month. Ties go to the earlier month. */
export function monthlyNormal(ctx: FieldContext, key: MonthlyNormal['key']): MonthlyNormal | null {
  const raw = ctx.facts[key];
  const values = parseMonthly(raw);
  if (!raw || !values) return null;
  const months: MonthValue[] = values.flatMap((v, i) => (v == null ? [] : [{ month: i + 1, value: v, text: raw.match(new RegExp(`${MONTH_ABBR[i]} (-?\\d+(?:\\.\\d+)?)`))![1] }]));
  if (months.length < 12) return null;
  const max = months.reduce((a, b) => (b.value > a.value ? b : a));
  const min = months.reduce((a, b) => (b.value < a.value ? b : a));
  return { key, unit: key === 'climate_monthly_rain' ? 'mm' : '°C', months, max, min, fact: parseFieldFact(key, raw) };
}

// ------------------------------------------------------------------------------------------------

export type RiskKind = 'heat' | 'frost' | 'heavy-rain' | 'dry-spell' | 'flood' | 'wind' | 'pest' | 'disease';

export interface RiskFact {
  kind: RiskKind;
  start: string;
  end: string;
  /** 1 watch, 2 warning, 3 severe. */
  severity: number | null;
  /** Title and detail as the fact states them, in English. */
  title: string;
  detail: string;
  fact: ParsedFact;
}

/** Risk events of the forecast, earliest first: the `risk_<kind>_<start>` facts. */
export function riskFacts(ctx: FieldContext): RiskFact[] {
  const out: RiskFact[] = [];
  for (const [key, raw] of Object.entries(ctx.facts)) {
    const k = key.match(/^risk_(.+)_(\d{4}-\d{2}-\d{2})$/);
    if (!k) continue;
    const fact = parseFieldFact(key, raw);
    const [title, ...detail] = fact.value.split(': ');
    const span = raw.match(/\((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}), severity (\d)\/3/);
    out.push({ kind: k[1] as RiskKind, start: span?.[1] ?? k[2], end: span?.[2] ?? k[2], severity: span ? Number(span[3]) : null, title, detail: detail.join(': '), fact });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
