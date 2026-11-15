/**
 * Deterministic comparison of field facts with a crop's EcoCrop requirements, for extractive
 * field answers ("is my soil too acid for soybean?"). It never estimates a missing value: a
 * requirement without a matching field fact goes to `missing`, with the cheapest way to get it.
 */
import type { FieldContext, Lang } from '@/contracts';
import { parseFact, parseMonthly } from './fieldContext';
import type { CropFacts, Range4 } from './types';

export type CheckStatus = 'optimal' | 'tolerated-low' | 'tolerated-high' | 'outside-low' | 'outside-high' | 'match' | 'mismatch';

export interface Check {
  key: 'ph' | 'temp' | 'rain' | 'texture' | 'drainage' | 'frost' | 'altitude' | 'salinity' | 'depth';
  value: string;
  /** The field fact string it came from (value + source). */
  fact: string;
  required: string;
  status: CheckStatus;
  /** For temperature: months whose normal mean is inside the optimum. */
  goodMonths?: number[];
}

export interface Assessment {
  crop: CropFacts;
  checks: Check[];
  missing: Check['key'][];
}

function classify(v: number, r: Range4): CheckStatus | null {
  const [aMin, oMin, oMax, aMax] = r;
  if (oMin == null || oMax == null) return null;
  if (v >= oMin && v <= oMax) return 'optimal';
  if (v < oMin) return aMin != null && v < aMin ? 'outside-low' : 'tolerated-low';
  return aMax != null && v > aMax ? 'outside-high' : 'tolerated-high';
}

const rangeText = (r: Range4, unit: string) =>
  `optimal ${r[1]}-${r[2]}${unit}${r[0] != null || r[3] != null ? `, tolerated ${r[0] ?? '?'}-${r[3] ?? '?'}${unit}` : ''}`;

const TEXTURE_OF: Record<string, string> = {
  clay: 'heavy', 'silty clay': 'heavy', 'sandy clay': 'heavy', heavy: 'heavy',
  'clay loam': 'medium', 'silty clay loam': 'medium', 'sandy clay loam': 'medium', loam: 'medium', 'silt loam': 'medium', silt: 'medium', medium: 'medium',
  'sandy loam': 'light', 'loamy sand': 'light', sand: 'light', light: 'light', organic: 'organic',
};

function textureClass(s: string): string | null {
  const t = s.toLowerCase().replace(/\(.*$/, '').trim();
  return TEXTURE_OF[t] ?? Object.entries(TEXTURE_OF).find(([k]) => t.startsWith(k))?.[1] ?? null;
}

/** EcoCrop's salinity classes, by the electrical conductivity they name: low (<4 dS/m), medium (4-10 dS/m), high (>10 dS/m). */
const SALINITY_CLASS = ['low', 'medium', 'high'];
const salinityClassOf = (ecDsM: number): number => (ecDsM < 4 ? 0 : ecDsM <= 10 ? 1 : 2);
/** EcoCrop's soil-depth classes, by the depth they name: very shallow (<20 cm), shallow (20-50 cm), medium (50-150 cm), deep (>>150 cm). */
const DEPTH_CLASS = ['very shallow', 'shallow', 'medium', 'deep'];
const depthClassOf = (cm: number): number => (cm < 20 ? 0 : cm < 50 ? 1 : cm < 150 ? 2 : 3);
/** Place of an EcoCrop class text ("medium (4-10 dS/m)") in its scale; -1 when it names none of the classes. */
const classRank = (text: string | undefined, scale: string[]): number => (text ? scale.findIndex((c, i) => text.toLowerCase().startsWith(c) && !scale.slice(i + 1).some((longer) => text.toLowerCase().startsWith(longer))) : -1);

export function assess(crop: CropFacts, ctx: FieldContext): Assessment {
  const f = ctx.facts;
  const checks: Check[] = [];
  const missing: Check['key'][] = [];

  const ph = parseFact(f.ph);
  if (crop.ph && crop.ph[1] != null) {
    if (ph != null) checks.push({ key: 'ph', value: String(ph), fact: f.ph, required: rangeText(crop.ph, ''), status: classify(ph, crop.ph)! });
    else missing.push('ph');
  }

  if (crop.temp && crop.temp[1] != null) {
    const monthly = parseMonthly(f.climate_monthly_t);
    const annual = parseFact(f.climate_t_mean) ?? parseFact(f.t2m);
    if (annual != null) {
      const goodMonths = monthly
        ? monthly.flatMap((v, i) => (v != null && v >= crop.temp![1]! && v <= crop.temp![2]! ? [i + 1] : []))
        : undefined;
      checks.push({ key: 'temp', value: `${annual} °C`, fact: f.climate_t_mean ?? f.t2m, required: rangeText(crop.temp, ' °C'), status: classify(annual, crop.temp)!, goodMonths });
    } else missing.push('temp');
  }

  if (crop.rain && crop.rain[1] != null) {
    const annual = parseFact(f.climate_rain_annual);
    const irrigated = /^(full|supplemental)/.test(f.irrigation ?? '');
    if (annual != null) checks.push({ key: 'rain', value: `${annual} mm`, fact: f.climate_rain_annual, required: rangeText(crop.rain, ' mm'), status: irrigated && annual < (crop.rain[1] ?? 0) ? 'tolerated-low' : classify(annual, crop.rain)! });
    else missing.push('rain');
  }

  if (crop.texture?.opt || crop.texture?.abs) {
    const tc = f.texture_class ? textureClass(f.texture_class) : null;
    if (tc) {
      const opt = (crop.texture.opt ?? '').split(/,\s*/);
      const abs = (crop.texture.abs ?? '').split(/,\s*/);
      checks.push({ key: 'texture', value: f.texture_class.replace(/\s*\(.*$/, ''), fact: f.texture_class, required: `optimal ${crop.texture.opt ?? '?'}${crop.texture.abs ? `, tolerated ${crop.texture.abs}` : ''}`, status: opt.includes(tc) ? 'match' : abs.includes(tc) ? 'tolerated-low' : 'mismatch' });
    } else missing.push('texture');
  }

  if (crop.drainage?.opt) {
    const d = f.drainage_class?.toLowerCase();
    if (d) {
      const word = d.startsWith('poor') ? 'poorly' : d.startsWith('exces') ? 'excessive' : d.startsWith('well') || d.startsWith('moder') ? 'well' : null;
      if (word) checks.push({ key: 'drainage', value: f.drainage_class.replace(/\s*\(.*$/, ''), fact: f.drainage_class, required: `optimal ${crop.drainage.opt}`, status: crop.drainage.opt.includes(word) ? 'match' : (crop.drainage.abs ?? '').includes(word) ? 'tolerated-low' : 'mismatch' });
    } else missing.push('drainage');
  }

  if (crop.killTempEarly != null) {
    const tmin = parseFact(f.t2m_min) ?? parseFact(f.fc_tmin);
    if (tmin != null) checks.push({ key: 'frost', value: `${tmin} °C`, fact: f.t2m_min ?? f.fc_tmin, required: `killing temperature in early growth ${crop.killTempEarly} °C`, status: tmin <= crop.killTempEarly ? 'outside-low' : tmin <= crop.killTempEarly + 3 ? 'tolerated-low' : 'optimal' });
  }

  // Salinity: the field's electrical conductivity against the class the crop grows best in and the highest it tolerates.
  const saltOpt = classRank(crop.salinity?.opt, SALINITY_CLASS);
  if (saltOpt >= 0) {
    const ec = parseFact(f.ec_dsm);
    const saltAbs = Math.max(saltOpt, classRank(crop.salinity?.abs, SALINITY_CLASS));
    if (ec != null) {
      const here = salinityClassOf(ec);
      checks.push({ key: 'salinity', value: `${ec} dS/m`, fact: f.ec_dsm, required: `optimal ${crop.salinity!.opt}${saltAbs > saltOpt ? `, tolerated ${crop.salinity!.abs}` : ''}`, status: here <= saltOpt ? 'optimal' : here <= saltAbs ? 'tolerated-high' : 'outside-high' });
    } else missing.push('salinity');
  }

  // Soil depth: the depth to a layer that stops roots against the depth the crop grows best in and the shallowest it tolerates.
  const depthOpt = classRank(crop.depth?.opt, DEPTH_CLASS);
  if (depthOpt >= 0) {
    const cm = parseFact(f.depth_cm);
    const absRank = classRank(crop.depth?.abs, DEPTH_CLASS);
    const depthAbs = absRank >= 0 ? Math.min(depthOpt, absRank) : depthOpt;
    if (cm != null) {
      const here = depthClassOf(cm);
      checks.push({ key: 'depth', value: `${cm} cm`, fact: f.depth_cm, required: `optimal ${crop.depth!.opt}${depthAbs < depthOpt ? `, tolerated ${crop.depth!.abs}` : ''}`, status: here >= depthOpt ? 'optimal' : here >= depthAbs ? 'tolerated-low' : 'outside-low' });
    } else missing.push('depth');
  }

  const elev = parseFact(f.elevation_m);
  if (crop.altAbsMax != null && crop.altAbsMax > 0 && elev != null) {
    checks.push({ key: 'altitude', value: `${elev} m`, fact: f.elevation_m, required: `up to ${crop.altAbsMax} m`, status: elev <= crop.altAbsMax ? 'optimal' : 'outside-high' });
  }
  return { crop, checks, missing };
}

/** How to get a missing fact cheaply (SYSTEM_INSTRUCTIONS: name the cheapest way). */
export function howToGet(key: Check['key'], lang: Lang): string {
  const en: Record<Check['key'], string> = {
    ph: 'a soil test (pH in water) from the local extension office or a pH kit',
    temp: 'a season of air-temperature records, or the climate history once it loads',
    rain: 'a rain gauge at the farm, or the rainfall history once it loads',
    texture: 'a jar or ribbon test of the topsoil, or a lab soil test',
    drainage: 'watching where water stands 24 hours after heavy rain',
    frost: 'a minimum thermometer at crop height',
    altitude: 'the parcel elevation (terrain branch)',
    salinity: 'an EC meter in a soil-water paste, or a lab test of a soil sample',
    depth: 'a pit or an auger hole down to the layer roots do not pass',
  };
  const vi: Record<Check['key'], string> = {
    ph: 'phân tích đất (pH nước) tại trạm khuyến nông hoặc bộ thử pH',
    temp: 'số liệu nhiệt độ không khí một vụ, hoặc lịch sử khí hậu khi tải xong',
    rain: 'thùng đo mưa tại vườn, hoặc lịch sử lượng mưa khi tải xong',
    texture: 'thử đất bằng lọ nước hoặc vê đất, hoặc phân tích tại phòng thí nghiệm',
    drainage: 'quan sát nơi nước còn đọng 24 giờ sau mưa lớn',
    frost: 'nhiệt kế tối thấp đặt ngang tầm cây',
    altitude: 'độ cao của thửa (nhánh địa hình)',
    salinity: 'máy đo EC trên hỗn hợp đất và nước, hoặc gửi mẫu đất tới phòng thí nghiệm',
    depth: 'đào phẫu diện hoặc khoan tới tầng rễ không xuyên qua được',
  };
  return (lang === 'vi' ? vi : en)[key];
}
