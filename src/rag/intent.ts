/**
 * Rule-based intent routing for English and Vietnamese questions. Patterns run on the folded
 * query (no diacritics), so they work whether or not the user typed accents.
 */
import { fold } from './text';

/**
 * `field` compares the parcel with what a crop needs; `field-fact` reports a reading of the parcel
 * itself (its value, where it comes from and how far it can be trusted), a month of its climate or
 * the risks in its forecast.
 */
export type Intent = 'field' | 'field-fact' | 'score-change' | 'compare' | 'term' | 'rotation' | 'care' | 'ideal' | 'general' | 'off-topic';

/** Requirement or reading the question focuses on, if any. */
export type Focus =
  | 'ph'
  | 'temp'
  | 'rain'
  | 'water'
  | 'soil'
  | 'texture'
  | 'drainage'
  | 'cycle'
  | 'frost'
  | 'light'
  | 'salinity'
  | 'altitude'
  | 'organic'
  | 'cec'
  | 'nitrogen'
  | 'density'
  | 'slope'
  | 'depth';

/** What a `field-fact` question wants: a reading, the wettest or hottest month, or what the forecast holds. */
export type FieldAsk = 'value' | 'month-extreme' | 'forecast';

/** Why a question is declined (docs/RAG.md, scope table). */
export type OutOfScope = 'photo-diagnosis' | 'price-forecast' | 'legal' | 'pesticide-dose' | 'other';

const has = (q: string, re: RegExp) => re.test(q);

const FIELD = /\b(my|our|here|this (field|farm|plot|parcel|land|garden)|the field|the parcel|locked)\b|cua toi|cua minh|cua chung toi|ruong toi|vuon toi|dat toi|o day|thua (nay|ruong|dat)|manh (ruong|dat|vuon)|ruong nay|vuon nay|dat nay|nong trai/;
const SCORE = /\bscore|productivity|\bdiem\b|diem so|nang suat (giam|tang)|chi so nang suat/;
const CHANGE = /\b(drop|dropp|fell|fall|decline|declin|decreas|went down|lower|rise|rose|increas|jump|change)|giam|tang|thay doi|di xuong|sut/;
const WHY = /\bwhy\b|\bhow come\b|vi sao|tai sao|ly do|nguyen nhan/;
const COMPARE = /\b(vs|versus|compare|comparison|compared|better|worse|or|than|difference)\b|so sanh|hay la|\bhay\b|hon|khac nhau|giua/;
const TERM_Q = /\bwhat (is|are|does)\b|\bmean(s|ing)?\b|\bexplain|\bdefin|\bhow (is|are) .* (measured|calculated)|la gi|nghia la|y nghia|giai thich|dinh nghia|duoc (do|tinh)|la sao|khac gi/;
const ROTATION = /rotat|follow(ing)? (crop|with)|after (harvest|it|the)|plant (next|after)|cover crop|green manure|intercrop|break crop|what (to|should i) (plant|grow) (next|after)|luan canh|xen canh|trong sau|trong tiep|vu sau|cay che phu|phan xanh|trong xen|cay trong ke tiep|tiep theo/;
const CARE = /\bwhen (to|should|do|can)\b|calendar|schedule|\bsow|\bplant(ing)? (date|time|season)|harvest|fertili[sz]|prun|weed|pest|disease|care|spacing|seed rate|\bhow (to|do i) (grow|plant|care)|khi nao|luc nao|lich|thoi vu|gieo|thu hoach|bon phan|cham soc|tia canh|sau benh|benh hai|mat do|khoang cach|cach trong|ky thuat trong/;
const IDEAL = /ideal|optim|best|requirement|condition|need|grow(s|ing)? (well|best)|climate|suitab|toleran|thrive|can (i|it|we) grow|grow (in|on|at)|ly tuong|toi uu|dieu kien|yeu cau|can gi|thich hop|phu hop|chiu duoc|khi hau|trong duoc|co trong|sinh truong/;
const OFF = /\b(stock|share price|bitcoin|crypto|loan|lawyer|lawsuit|medic(al|ine)|doctor|symptom|dose for (a|my) (child|baby)|politic|election|football|movie)\b|chung khoan|tien ao|vay von|luat su|bac si|trieu chung|chinh tri|bau cu|bong da/;
// Declined whether or not a crop is named: the assistant has no data that could answer them.
const PHOTO = /(photo|picture|image|upload)\w* .*(disease|pest|diagnos|identif|wrong with)|(disease|pest|diagnos|identif)\w* .*(photo|picture|image)|(\banh\b|hinh anh|buc hinh).*(benh|chan doan|sau hai|nhan dien)|(chan doan|nhan dien|benh) .*(qua|bang|tu|theo) (anh|hinh)|gui anh|chup anh/;
// Folded "gia" is giá (price), but also the second syllable of "sương giá" (frost) and the first of
// "gia đình", "gia súc", "gia cầm", "giá thể", "giá trị": those are not prices.
const PRICE = String.raw`(?:\bprices?\b|(?<!suong )\bgia\b(?! (?:dinh|suc|cam|the|tri)\b))`;
const AHEAD = String.raw`(?:tomorrow|next (?:week|month|year|season)|will (?:it |they )?(?:rise|fall|go up|go down|drop)|forecast|predict|ngay mai|tuan (?:sau|toi)|thang (?:sau|toi)|nam (?:sau|toi)|sap toi|du bao|se (?:tang|giam|len|xuong))`;
const PRICE_AHEAD = new RegExp(`${PRICE}.*${AHEAD}|${AHEAD}.*${PRICE}`);
// "sổ đỏ" (land title) is left out on purpose: folded it is "so do", which is also "số đó" (that number).
const LEGAL = /\b(lawyer|lawsuit|legal advice|land dispute|land title|sue)\b|luat su|kien tung|tranh chap|phap ly|quyen su dung dat/;
const DOSE = /(dose|dosage|mixing rate|how much) .*(pesticide|herbicide|fungicide|insecticide)|(pesticide|herbicide|fungicide|insecticide)\w* .*(dose|dosage|brand|product name|how much)|lieu (luong|dung|pha).*thuoc|thuoc (tru sau|diet co|tru benh|bao ve thuc vat|bvtv).*(lieu|bao nhieu|loai nao|ten gi|hieu nao)|pha thuoc/;

/**
 * A definition or an explanation is wanted, not the reading of the parcel. A bare "what is" or
 * "là gì" is not in here: beside "my field" it asks for the value ("what is my soil pH").
 */
const MEANING = /\bmean(s|ing)?\b|\bexplain|\bdefin|\bhow (is|are) .* (measured|calculated)|nghia la|y nghia|giai thich|dinh nghia|duoc (do|tinh)|la sao|khac gi/;
const FORECAST = /\bnext (week|few days|\d+ days|days)|\bcoming (days|week|fortnight)|\bthis week\b|\btomorrow\b|\bforecast|\bin the next\b|\bahead\b|tuan (toi|sau|nay)|sap toi|ngay mai|may ngay (toi|nua)|\d+ ngay (toi|nua)|du bao/;
// Folded "bao" is bão (storm), and also the second syllable of "dự báo" (forecast) and "cảnh báo" (warning).
const WEATHER_RISK = /\bwind|storm|\bgio\b|(?<!du |canh )\bbao\b(?! nhieu)|\brisk|hazard|warning|rui ro|canh bao|nguy co/;
const MONTH_EXTREME = /\b(which|what) months?\b.*(wet|dry|rain|hot|cold|warm|cool)|(wettest|driest|rainiest|hottest|coldest|warmest|coolest) months?|thang nao.*(mua|nong|lanh|kho|mat|ret|am)|(mua|nong|lanh|kho|ret) (nhieu |it )?nhat.*thang/;

const FOCUS_RULES: [Focus, RegExp][] = [
  // Folded "voi" is both vôi (lime) and vối (robusta coffee): only "bón/rải vôi" counts.
  ['ph', /\bph\b|acid|alkalin|sour soil|\blime\b|liming|\bchua\b|kiem tinh|dat kiem|\bphen\b|bon voi|rai voi/],
  ['frost', /frost|freez|cold damage|chill|suong gia|suong muoi|ret hai|bang gia/],
  ['temp', /temperat|\bheat\b|\bhot\b|\bcold\b|warm|cool|degree|nhiet|nong|lanh|am ap/],
  ['rain', /rain|precip|monsoon|wet season|dry season|\bmua\b|mua mua|mua kho|luong mua/],
  ['water', /water|irrigat|drought|moisture|evapotrans|tuoi|nuoc|han han|kho han|do am|\bhan\b/],
  ['drainage', /drain|waterlog|flood|thoat nuoc|ngap|\bung\b/],
  ['texture', /texture|clay|sand|loam|heavy soil|light soil|dat set|dat cat|dat thit|co gioi/],
  ['soil', /\bsoil\b|\bdat\b|tho nhuong/],
  ['cycle', /how long|days to|growing period|cycle|maturity|bao lau|thoi gian sinh truong|may ngay|bao nhieu ngay/],
  ['light', /\blight\b|shade|\bsun\b|sunlight|anh sang|bong ram|\bnang\b/],
  ['salinity', /salin|\bsalt|\bman\b|nhiem man|\bec\b|electrical conductivity|do dan dien/],
  ['altitude', /altitude|elevation|highland|how high\b|above sea level|\bdo cao\b|vung cao|muc nuoc bien/],
  ['organic', /organic (matter|carbon)|\bsoc\b|\bhumus\b|chat huu co|carbon huu co|\bmun\b/],
  ['cec', /\bcec\b|cation exchange|trao doi cation|giu phan/],
  // Folded "dam" is đạm (nitrogen) and also đảm (as in "đảm bảo"): the latter is excluded.
  ['nitrogen', /\bnitrogen\b|\bnito\b|\bdam\b(?! bao)/],
  ['density', /bulk density|compact|dung trong|nen chat|do chat cua dat/],
  ['slope', /\bslop|steep|\berosion|\berod|\baspect\b|\brelief\b|\bdoc\b|do doc|xoi mon|huong doc|chenh cao/],
  ['depth', /soil depth|depth of (the |my )?soil|rooting depth|restrictive layer|shallow soil|how deep|tang dat|do sau|sau bao nhieu|day bao nhieu|do day tang|tang han che|tang canh tac/],
];

/** Readings of weather: the ones a forecast question can be about. */
const WEATHER: Focus[] = ['frost', 'temp', 'rain', 'water'];

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_VI_WORD = ['gieng', 'hai', 'ba', 'tu', 'nam', 'sau', 'bay', 'tam', 'chin', 'muoi', 'muoi mot', 'chap'];

/** Month numbers (1-12) mentioned in the query. */
export function parseMonths(query: string): number[] {
  const q = fold(query);
  const out = new Set<number>();
  for (const [i, m] of MONTHS_EN.entries()) if (new RegExp(`\\b${m}[a-z]*\\b`).test(q) && !(m === 'may' && /\bmay (i|it|we|be)\b/.test(q))) out.add(i + 1);
  for (const m of q.matchAll(/thang\s+(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) out.add(n);
  }
  // "tháng mười một" before "tháng mười"
  for (let i = MONTHS_VI_WORD.length - 1; i >= 0; i--) {
    if (new RegExp(`thang ${MONTHS_VI_WORD[i]}\\b`).test(q)) {
      out.add(i + 1);
      break;
    }
  }
  return [...out];
}

export interface Routed {
  intent: Intent;
  focus: Focus[];
  months: number[];
  /** The question explicitly refers to the user's own parcel. */
  aboutField: boolean;
  /** For `field-fact`: what is asked of the parcel. */
  ask?: FieldAsk;
  /** For `off-topic`: why the question is declined. */
  outOfScope?: OutOfScope;
}

/** The reason a question is declined, if it is. A crop named in it does not rescue the first four. */
export function outOfScope(foldedQuery: string, cropCount: number): OutOfScope | null {
  if (has(foldedQuery, PHOTO)) return 'photo-diagnosis';
  if (has(foldedQuery, PRICE_AHEAD)) return 'price-forecast';
  if (has(foldedQuery, DOSE)) return 'pesticide-dose';
  if (has(foldedQuery, LEGAL)) return 'legal';
  if (has(foldedQuery, OFF) && cropCount === 0) return 'other';
  return null;
}

/**
 * Whether the question asks for a reading of the parcel itself, and of which kind. A crop in the
 * question makes it a comparison with that crop (`field`); "what does it mean" and "why" make it
 * an explanation (`term`), even when the parcel is mentioned.
 */
function fieldAsk(q: string, focus: Focus[], o: { cropCount: number; hasContext: boolean; termHit: boolean; mentionsField: boolean }): FieldAsk | null {
  if (o.cropCount > 0 || has(q, MEANING) || has(q, WHY)) return null;
  const located = o.hasContext || o.mentionsField;
  if (located && has(q, FORECAST) && (focus.some((f) => WEATHER.includes(f)) || has(q, WEATHER_RISK))) return 'forecast';
  if (located && has(q, MONTH_EXTREME)) return 'month-extreme';
  if (o.mentionsField && (focus.some((f) => f !== 'cycle') || o.termHit)) return 'value';
  return null;
}

export function routeIntent(query: string, opts: { cropCount: number; hasContext: boolean; termHit: boolean }): Routed {
  const q = fold(query);
  const focus = FOCUS_RULES.filter(([, re]) => has(q, re)).map(([f]) => f);
  const months = parseMonths(query);
  const mentionsField = has(q, FIELD);
  const aboutField = opts.hasContext && mentionsField;
  const base = { focus, months, aboutField };
  const declined = outOfScope(q, opts.cropCount);
  if (declined) return { intent: 'off-topic', ...base, outOfScope: declined };
  if (opts.hasContext && has(q, SCORE) && (has(q, CHANGE) || has(q, WHY) || months.length > 0)) return { intent: 'score-change', ...base };
  if (opts.cropCount >= 2 && has(q, COMPARE)) return { intent: 'compare', ...base };
  if (has(q, ROTATION)) return { intent: 'rotation', ...base };
  const ask = fieldAsk(q, focus, { ...opts, mentionsField });
  if (ask) return { intent: 'field-fact', ...base, ask };
  if (opts.termHit && (has(q, TERM_Q) || opts.cropCount === 0) && !(aboutField && opts.cropCount > 0)) return { intent: 'term', ...base };
  if (aboutField && (opts.cropCount > 0 || focus.length > 0 || has(q, IDEAL))) return { intent: 'field', ...base };
  if (has(q, CARE) && opts.cropCount > 0) return { intent: 'care', ...base };
  if (opts.cropCount > 0) return { intent: opts.hasContext && has(q, /can (i|we) grow|trong duoc khong|co nen trong/) ? 'field' : 'ideal', ...base };
  // The parcel is meant but no reading, crop or requirement was recognised: say so and list what
  // can be asked, instead of answering about a reading that was not asked for.
  if (aboutField && !has(q, MEANING) && !has(q, WHY)) return { intent: 'field-fact', ...base, ask: 'value' };
  if (aboutField) return { intent: 'field', ...base };
  if (has(q, TERM_Q) || opts.termHit) return { intent: 'term', ...base };
  return { intent: 'general', ...base };
}

/**
 * Glossary term detection: folded keyword -> glossary id. Kept small and explicit; BM25 over the
 * glossary aliases does the rest.
 */
export const TERM_KEYWORDS: [RegExp, string][] = [
  [/\bndvi\b|chi so thuc vat khac biet|do xanh/, 'ndvi'],
  [/\bevi\b|enhanced vegetation|thuc vat tang cuong/, 'evi'],
  [/\blst\b|land surface temp|surface temperature|nhiet do be mat/, 'lst'],
  [/\besi\b|evaporative stress|stress boc thoat hoi|stress nuoc/, 'evaporative-stress'],
  [/evapotranspir|\bet0\b|\beto\b|\bet\b|boc thoat hoi|thoat hoi nuoc/, 'evapotranspiration'],
  [/\bkc\b|crop coefficient|fao.?56|he so cay trong/, 'crop-coefficient'],
  [/soil.moisture anomal|moisture anomal|\banomal|do lech|bat thuong/, 'soil-moisture-anomaly'],
  [/root.?zone|soil moisture|surface moisture|m3\/m3|do am (dat|vung re|tang re|lop mat)|am do dat/, 'soil-moisture'],
  [/water balance|water deficit|can bang nuoc|thieu hut nuoc|tham hut nuoc/, 'water-balance'],
  [/growing degree|\bgdd\b|degree.days?|tich on|do.ngay|tong nhiet/, 'growing-degree-days'],
  [/frost risk|\bfrost\b|suong gia|suong muoi/, 'frost-risk'],
  [/\bimerg\b|\bgpm\b|satellite rain|mua ve tinh/, 'imerg-rainfall'],
  [/nasa power|\bpower\b data|merra/, 'nasa-power'],
  [/\bpar\b|photosynthetically active|buc xa quang hop/, 'par'],
  [/\bsrtm\b|elevation model|\bslope\b|\baspect\b|do doc|huong doc/, 'srtm-terrain'],
  [/soilgrids|soil ?grids/, 'soilgrids'],
  [/satellite (vs|versus|and|compared)|ground (truth|measure)|differ.* ground|from space|mixed pixel|ve tinh (va|so voi|khac)|do (tai|thuc dia)|so do mat dat|diem anh/, 'satellite-vs-ground'],
  [/pixel|footprint|resolution|do phan giai|kich thuoc diem anh/, 'footprint-fit'],
  [/latency|revisit|stale|cadence|do tre|chu ky lap|so lieu cu/, 'latency-revisit'],
  [/confidence|badge|do tin cay|huy hieu/, 'confidence-badge'],
  [/modell?ed|reanalysis|simulated|forecast vs|provenance|tai phan tich|mo phong|nguon goc so lieu/, 'provenance'],
  [/productivity score|limiting factor|yeu to gioi han|diem nang suat/, 'productivity-score'],
  [/ground.?truth override|override|ghi de/, 'ground-truth-override'],
  [/\bsoil ph\b|\bph\b|acid soil|dat chua|do chua/, 'soil-ph'],
  [/soil texture|thanh phan co gioi|sa cau/, 'soil-texture'],
  [/which (satellite|source|data)|data sources?|nguon du lieu|ve tinh nao/, 'nasa-sources-summary'],
];

export function detectTerms(query: string): string[] {
  const q = fold(query);
  const out: string[] = [];
  for (const [re, id] of TERM_KEYWORDS) if (re.test(q) && !out.includes(id)) out.push(id);
  return out;
}
