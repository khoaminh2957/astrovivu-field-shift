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

/** A whole number with thousands separators: 7,089,041 in English, 7.089.041 in Vietnamese. */
export function groupDigits(v: number, lang: Lang): string {
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'vi' ? '.' : ',');
}

const VI_COMMONNESS: Record<string, string> = { global: 'toàn cầu', widespread: 'rộng rãi', regional: 'theo vùng', local: 'cục bộ' };
// Country names are FAOSTAT's. The two countries the app has reference figures for are given their Vietnamese name.
const VI_COUNTRY: Record<string, string> = { VNM: 'Việt Nam', USA: 'Hoa Kỳ' };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/**
 * Where a crop is grown, as sentences: the countries that report it and the largest harvested
 * areas when FAOSTAT has an item for the crop, and what is missing when it has not. Used by the
 * index build (the `:where` passage) and at answer time, so the wording a user reads is the
 * passage that is cited. Every number is a column of the crop atlas.
 */
export function whereLines(f: CropFacts, lang: Lang): string[] {
  const w = f.prevalence;
  if (!w) return [];
  const vi = lang === 'vi';
  const name = cropLabel(f, lang);
  const country = (c: { iso3: string; name: string }) => (vi ? (VI_COUNTRY[c.iso3] ?? c.name) : c.name);
  // What a country's own statistics say, where the atlas has it: not FAOSTAT's figure, and said with its publication.
  const national = (w.national ?? []).map((c) => {
    const when = c.years ? (vi ? ` năm ${c.years}` : ` in ${c.years}`) : '';
    const made = c.productionT != null ? (vi ? ` và sản lượng ${groupDigits(c.productionT, 'vi')} tấn` : ` and ${groupDigits(c.productionT, 'en')} t produced`) : '';
    return vi
      ? `${country(c)}, theo thống kê quốc gia: ${groupDigits(c.areaHa, 'vi')} ha thu hoạch${made}${when} (${c.source}).`
      : `${country(c)}, from its national statistics: ${groupDigits(c.areaHa, 'en')} ha harvested${made}${when} (${c.source}).`;
  });
  // `none` says what the atlas did, not what FAOSTAT has: FAOSTAT has an item "Bananas", and the atlas ties it to another Musa.
  if (w.match === 'none')
    return [vi ? `Atlas cây trồng chưa gắn mặt hàng FAOSTAT nào với ${name}, nên không có số liệu FAOSTAT theo nước cho cây này.` : `The crop atlas ties no FAOSTAT item to ${name}, so it has no FAOSTAT figures by country for it.`, ...national];
  if (w.match === 'group') {
    const others = (w.sharedBy ?? 1) - 1;
    return [
      vi
        ? `FAOSTAT không có số liệu riêng cho ${name}: cây này được tính gộp trong mặt hàng ${w.faostatItem ?? 'gộp'}${others > 0 ? `, cùng ${others} cây khác của atlas` : ''}. Vì vậy FAOSTAT không cho diện tích ở nước nào.`
        : `FAOSTAT has no figures for ${name} alone: it is counted inside the item ${w.faostatItem ?? 'of a group'}${others > 0 ? `, with ${others} other crops of the atlas` : ''}. FAOSTAT gives no area for any country.`,
      ...national,
    ];
  }
  const out: string[] = [];
  // Each country's figure is the mean of its own latest three years with a value; `w.years` only covers them all.
  const span = w.years ? (vi ? ` (mỗi nước lấy trung bình ba năm gần nhất có số liệu, trong khoảng ${w.years})` : ` (each country's mean of its latest three years with data, within ${w.years})`) : '';
  if (w.countries != null && w.worldAreaHa != null)
    out.push(
      vi
        ? `${name}: ${w.countries} nước báo cáo sản xuất với FAOSTAT, diện tích thu hoạch toàn thế giới ${groupDigits(w.worldAreaHa, 'vi')} ha${span}.`
        : `${name}: ${w.countries} countries report production to FAOSTAT, with ${groupDigits(w.worldAreaHa, 'en')} ha harvested in the world${span}.`,
    );
  if (w.commonness) out.push(vi ? `Atlas cây trồng xếp mức phổ biến: ${VI_COMMONNESS[w.commonness] ?? w.commonness}.` : `The crop atlas classes it as ${w.commonness}.`);
  const of = (c: { years?: string }) => (c.years ? (vi ? `, trung bình ${c.years}` : `, mean of ${c.years}`) : '');
  if (w.top?.length) {
    // The years are said once when the listed countries share them, and country by country when they do not.
    const shared = w.top.every((c) => c.years === w.top![0].years) ? w.top[0].years : undefined;
    const lead = vi ? 'Diện tích thu hoạch lớn nhất' : 'Largest harvested areas';
    out.push(`${lead}${shared ? (vi ? ` (trung bình ${shared})` : ` (means of ${shared})`) : ''}: ${w.top.map((c) => `${country(c)} ${groupDigits(c.areaHa, lang)} ha${shared ? '' : of(c)}`).join('; ')}.`);
  }
  for (const c of w.also ?? []) out.push(vi ? `${country(c)}: ${groupDigits(c.areaHa, 'vi')} ha${of(c)}, lớn thứ ${c.rank}.` : `${country(c)}: ${groupDigits(c.areaHa, 'en')} ha${of(c)}, the ${ordinal(c.rank)} largest.`);
  // The item is always named: "Carrots and turnips" is not carrots alone, whether or not the atlas ties a second crop to it.
  if (w.faostatItem)
    out.push(
      (w.sharedBy ?? 1) > 1
        ? vi
          ? `Đây là số liệu của mặt hàng FAOSTAT ${w.faostatItem}, mặt hàng mà atlas gắn với ${w.sharedBy} cây; không phải số riêng của một cây.`
          : `These are the figures of the FAOSTAT item ${w.faostatItem}, which the atlas ties to ${w.sharedBy} crops; they are not for one crop alone.`
        : vi
          ? `Đây là số liệu của mặt hàng FAOSTAT ${w.faostatItem}.`
          : `These are the figures of the FAOSTAT item ${w.faostatItem}.`,
    );
  out.push(...national);
  return out;
}

export function renderWhere(f: CropFacts, lang: Lang): string {
  const tail = f.prevalence?.national?.length
    ? lang === 'vi'
      ? ' Nguồn: FAOSTAT (QCL) và thống kê quốc gia nêu ở trên, qua atlas cây trồng của Astrovivu.'
      : ' Sources: FAOSTAT (QCL) and the national statistics named above, through the Astrovivu crop atlas.'
    : lang === 'vi'
      ? ' Nguồn: FAOSTAT (QCL), qua atlas cây trồng của Astrovivu.'
      : ' Source: FAOSTAT (QCL), through the Astrovivu crop atlas.';
  return `${whereLines(f, lang).join(' ')}${tail}`;
}

export function renderFactSheet(f: CropFacts, lang: Lang): string {
  const vi = lang === 'vi';
  const kind = [f.lifeForm, f.lifeSpan].filter(Boolean).map((s) => (vi ? viTerm(s!) : s));
  const head = vi
    ? `${cropLabel(f, 'vi')}${f.family ? `, họ ${f.family}` : ''}${kind.length ? `; ${kind.join(', ')}` : ''}${f.category ? `; nhóm ${f.category}` : ''}.`
    : `${cropLabel(f, 'en')}${f.family ? `, family ${f.family}` : ''}${kind.length ? `; ${kind.join(', ')}` : ''}${f.category ? `; category ${f.category}` : ''}.`;
  const names = f.names.length ? (vi ? ` Tên thường gọi khác: ${f.names.slice(0, 6).join(', ')}.` : ` Other common names: ${f.names.slice(0, 6).join(', ')}.`) : '';
  const lines = factLines(f, lang).map((l) => l.line);
  // A crop the atlas keeps that EcoCrop has no record of: say so, and do not name EcoCrop as the source of nothing.
  if (f.ecocropId == null)
    return `${head}${names} ${vi ? 'FAO EcoCrop không có bản ghi nào về cây này, nên ở đây không có ngưỡng nhiệt độ, lượng mưa hay đất. Cây được giữ vì có trong danh mục cây đã biên soạn của Astrovivu.' : 'FAO EcoCrop has no record of this crop, so no temperature, rainfall or soil thresholds are known here. It is kept because it is in the catalogue of crops curated for Astrovivu.'}`;
  const tail = vi
    ? ' Nguồn: FAO EcoCrop. Ngưỡng tối ưu là điều kiện cây phát triển tốt nhất; ngưỡng chịu được là giới hạn cây còn sống.'
    : ' Source: FAO EcoCrop. Optimal is where the crop grows best; tolerated is the limit beyond which it fails.';
  return `${head}${names} ${lines.join(' ')}${tail}`;
}
