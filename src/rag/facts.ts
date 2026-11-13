/**
 * Renders EcoCrop structured requirements as text, in English or Vietnamese. Used by the index
 * build (fact-sheet chunks) and at answer time (ideal-conditions and comparison answers), so the
 * wording a user reads matches the passage that is cited.
 */
import type { Lang } from '@/contracts';
import type { CropFacts, Range4 } from './types';

// Multi-word values first, so "light shade" is not turned into "nhẹ (cát) shade".
const VI_TERMS: [RegExp, string][] = [
  [/\bclear skies\b/g, 'trời quang'],
  [/\bvery bright\b/g, 'rất sáng'],
  [/\bcloudy skies\b/g, 'trời nhiều mây'],
  [/\bheavy shade\b/g, 'bóng râm nặng'],
  [/\blight shade\b/g, 'bóng râm nhẹ'],
  [/\bshort day\b/g, 'ngày ngắn'],
  [/\blong day\b/g, 'ngày dài'],
  [/\bneutral day\b/g, 'trung tính với độ dài ngày'],
  [/\bheavy\b/g, 'nặng (sét)'],
  [/\bmedium\b/g, 'trung bình'],
  [/\blight\b/g, 'nhẹ (cát)'],
  [/\borganic\b/g, 'hữu cơ'],
  [/\bwell \(dry spells\)/g, 'thoát nước tốt (chịu được đợt khô)'],
  [/\bexcessive \(dry\/moderately dry\)/g, 'thoát nước mạnh (khô/khá khô)'],
  [/\bpoorly \(saturated >50% of year\)/g, 'thoát nước kém (bão hoà >50% thời gian trong năm)'],
  [/\bwell\b/g, 'tốt'],
  [/\bpoorly\b/g, 'kém'],
  [/\bexcessive\b/g, 'quá mạnh'],
  [/\bshallow\b/g, 'nông'],
  [/\bdeep\b/g, 'sâu'],
  [/\bhigh\b/g, 'cao'],
  [/\bmoderate\b/g, 'trung bình'],
  [/\blow\b/g, 'thấp'],
  [/\bhours\b/g, 'giờ'],
  [/\bannual\b/g, 'một năm'],
  [/\bperennial\b/g, 'lâu năm'],
  [/\bbiennial\b/g, 'hai năm'],
  [/\bherb\b/g, 'cây thân thảo'],
  [/\btree\b/g, 'cây gỗ'],
  [/\bshrub\b/g, 'cây bụi'],
  [/\bgrass\b/g, 'cỏ'],
  [/\bvine\b/g, 'dây leo'],
  [/\bnone\b/g, 'không'],
];

/** Best-effort Vietnamese rendering of EcoCrop categorical values. */
export function viTerm(s: string): string {
  let out = s;
  for (const [re, vi] of VI_TERMS) out = out.replace(re, vi);
  return out;
}

const n = (v: number | null) => (v == null ? '?' : String(Number(v.toFixed(1))));

export function optText(r: Range4 | undefined, unit: string): string | null {
  if (!r || (r[1] == null && r[2] == null)) return null;
  return `${n(r[1])}-${n(r[2])}${unit}`;
}
export function absText(r: Range4 | undefined, unit: string): string | null {
  if (!r || (r[0] == null && r[3] == null)) return null;
  return `${n(r[0])}-${n(r[3])}${unit}`;
}

export function cropLabel(f: CropFacts, lang: Lang): string {
  const common = lang === 'vi' ? (f.vi ?? f.en) : f.en;
  return common ? `${common} (${f.sci})` : f.sci;
}

/** Common name for use inside a sentence ("soybean", "đậu nành"); scientific name as fallback. */
export function cropShortName(f: CropFacts, lang: Lang): string {
  const common = lang === 'vi' ? (f.vi ?? f.en) : f.en;
  if (!common) return f.sci;
  return /^[A-ZĐÀ-Ỹ][a-zà-ỹđ]/u.test(common) ? common.charAt(0).toLowerCase() + common.slice(1) : common;
}

/** One line per requirement; missing values are omitted, never invented. */
export function factLines(f: CropFacts, lang: Lang): { key: string; line: string }[] {
  const vi = lang === 'vi';
  const L: { key: string; line: string }[] = [];
  const pushRange = (key: string, r: Range4 | undefined, unit: string, en: string, vn: string) => {
    const o = optText(r, unit);
    const a = absText(r, unit);
    if (!o && !a) return;
    L.push({
      key,
      line: vi
        ? `${vn}: tối ưu ${o ?? 'không rõ'}${a ? `, chịu được ${a}` : ''}.`
        : `${en}: optimal ${o ?? 'unknown'}${a ? `, tolerated ${a}` : ''}.`,
    });
  };
  pushRange('temp', f.temp, ' °C', 'Mean temperature during growth', 'Nhiệt độ trung bình khi sinh trưởng');
  pushRange('rain', f.rain, ' mm', 'Annual rainfall', 'Lượng mưa năm');
  pushRange('ph', f.ph, '', 'Soil pH', 'pH đất');
  const cat = (key: string, p: { opt?: string; abs?: string } | undefined, en: string, vn: string) => {
    if (!p || (!p.opt && !p.abs)) return;
    const o = p.opt ? (vi ? viTerm(p.opt) : p.opt) : null;
    const a = p.abs && p.abs !== p.opt ? (vi ? viTerm(p.abs) : p.abs) : null;
    L.push({
      key,
      line: vi ? `${vn}: ${o ? `tối ưu ${o}` : ''}${o && a ? '; ' : ''}${a ? `chịu được ${a}` : ''}.` : `${en}: ${o ? `optimal ${o}` : ''}${o && a ? '; ' : ''}${a ? `tolerated ${a}` : ''}.`,
    });
  };
  cat('texture', f.texture, 'Soil texture', 'Thành phần cơ giới đất');
  cat('drainage', f.drainage, 'Drainage', 'Thoát nước');
  cat('depth', f.depth, 'Soil depth', 'Độ sâu tầng đất');
  cat('fertility', f.fertility, 'Soil fertility', 'Độ phì đất');
  cat('salinity', f.salinity, 'Salinity', 'Độ mặn');
  cat('light', f.light, 'Light', 'Ánh sáng');
  if (f.cycle) L.push({ key: 'cycle', line: vi ? `Thời gian sinh trưởng: ${f.cycle[0]}-${f.cycle[1]} ngày.` : `Growing period: ${f.cycle[0]}-${f.cycle[1]} days.` });
  if (f.killTempEarly != null)
    L.push({ key: 'kill', line: vi ? `Nhiệt độ gây chết ở giai đoạn đầu: ${f.killTempEarly} °C.` : `Killing temperature in early growth: ${f.killTempEarly} °C.` });
  if (f.killTempRest != null)
    L.push({ key: 'killRest', line: vi ? `Nhiệt độ gây chết khi nghỉ: ${f.killTempRest} °C.` : `Killing temperature during rest: ${f.killTempRest} °C.` });
  if (f.altAbsMax != null && f.altAbsMax > 0)
    L.push({ key: 'alt', line: vi ? `Độ cao tối đa chịu được: ${f.altAbsMax} m.` : `Maximum tolerated altitude: ${f.altAbsMax} m.` });
  if (f.latAbs) L.push({ key: 'lat', line: vi ? `Vĩ độ chịu được: ${f.latAbs[0]}° đến ${f.latAbs[1]}°.` : `Tolerated latitude: ${f.latAbs[0]}° to ${f.latAbs[1]}°.` });
  if (f.photoperiod) L.push({ key: 'photo', line: vi ? `Quang chu kỳ: ${viTerm(f.photoperiod)}.` : `Photoperiod: ${f.photoperiod}.` });
  if (f.climate) L.push({ key: 'climate', line: vi ? `Vùng khí hậu: ${f.climate}.` : `Climate zones: ${f.climate}.` });
  if (f.usesMain) L.push({ key: 'uses', line: vi ? `Công dụng chính: ${f.usesMain}.` : `Main uses: ${f.usesMain}.` });
  if (f.companions) L.push({ key: 'companions', line: vi ? `Cây trồng kèm: ${f.companions}.` : `Companion species: ${f.companions}.` });
  return L;
}

export function renderFactSheet(f: CropFacts, lang: Lang): string {
  const vi = lang === 'vi';
  const kind = [f.lifeForm, f.lifeSpan].filter(Boolean).map((s) => (vi ? viTerm(s!) : s));
  const head = vi
    ? `${cropLabel(f, 'vi')}${f.family ? `, họ ${f.family}` : ''}${kind.length ? `; ${kind.join(', ')}` : ''}${f.category ? `; nhóm ${f.category}` : ''}.`
    : `${cropLabel(f, 'en')}${f.family ? `, family ${f.family}` : ''}${kind.length ? `; ${kind.join(', ')}` : ''}${f.category ? `; category ${f.category}` : ''}.`;
  const names = f.names.length ? (vi ? ` Tên thường gọi khác: ${f.names.slice(0, 6).join(', ')}.` : ` Other common names: ${f.names.slice(0, 6).join(', ')}.`) : '';
  const lines = factLines(f, lang).map((l) => l.line);
  const tail = vi
    ? ' Nguồn: FAO EcoCrop. Ngưỡng tối ưu là điều kiện cây phát triển tốt nhất; ngưỡng chịu được là giới hạn cây còn sống.'
    : ' Source: FAO EcoCrop. Optimal is where the crop grows best; tolerated is the limit beyond which it fails.';
  return `${head}${names} ${lines.join(' ')}${tail}`;
}
