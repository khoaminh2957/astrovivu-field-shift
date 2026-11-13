/**
 * Rule-based intent routing for English and Vietnamese questions. Patterns run on the folded
 * query (no diacritics), so they work whether or not the user typed accents.
 */
import { fold } from './text';

export type Intent = 'field' | 'score-change' | 'compare' | 'term' | 'rotation' | 'care' | 'ideal' | 'general' | 'off-topic';

/** Requirement the question focuses on, if any. */
export type Focus = 'ph' | 'temp' | 'rain' | 'water' | 'soil' | 'texture' | 'drainage' | 'cycle' | 'frost' | 'light' | 'salinity' | 'altitude';

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
  ['salinity', /salin|\bsalt|\bman\b|nhiem man/],
  ['altitude', /altitude|elevation|highland|\bdo cao\b|vung cao/],
];

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
}

export function routeIntent(query: string, opts: { cropCount: number; hasContext: boolean; termHit: boolean }): Routed {
  const q = fold(query);
  const focus = FOCUS_RULES.filter(([, re]) => has(q, re)).map(([f]) => f);
  const months = parseMonths(query);
  const aboutField = opts.hasContext && has(q, FIELD);
  const base = { focus, months, aboutField };
  if (has(q, OFF) && opts.cropCount === 0) return { intent: 'off-topic', ...base };
  if (opts.hasContext && has(q, SCORE) && (has(q, CHANGE) || has(q, WHY) || months.length > 0)) return { intent: 'score-change', ...base };
  if (opts.cropCount >= 2 && has(q, COMPARE)) return { intent: 'compare', ...base };
  if (has(q, ROTATION)) return { intent: 'rotation', ...base };
  if (opts.termHit && (has(q, TERM_Q) || opts.cropCount === 0) && !(aboutField && opts.cropCount > 0)) return { intent: 'term', ...base };
  if (aboutField && (opts.cropCount > 0 || focus.length > 0 || has(q, IDEAL))) return { intent: 'field', ...base };
  if (has(q, CARE) && opts.cropCount > 0) return { intent: 'care', ...base };
  if (opts.cropCount > 0) return { intent: opts.hasContext && has(q, /can (i|we) grow|trong duoc khong|co nen trong/) ? 'field' : 'ideal', ...base };
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
