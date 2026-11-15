import type { I18nText, ModelInput, StaticFact } from '@/contracts';
import { tx } from '@/contracts';
import { monthlyNormals } from '@/lib/climate';
import { factNum, findFact } from './buffer';

/**
 * Monthly soil erosion risk index from NASA Earth observation and soil data:
 * rainfall (ERA5 climatology / CHIRPS), slope steepness (SRTM 30 m), soil texture & organic
 * carbon (SoilGrids / SSURGO), and vegetation cover (MODIS MOD13Q1 NDVI).
 *
 * Because slope length (lambda) is not present in the parcel telemetry, this module computes a
 * dimensionless relative monthly index (R_m * K * S * C_m) and NEVER reports soil loss in t/ha/yr.
 *
 * Formulas and citations:
 * - RUSLE framework: Renard, K.G., Foster, G.R., Weesies, G.A., McCool, D.K., & Yoder, D.C.
 *   (1997), Predicting Soil Erosion by Water: A Guide to Conservation Planning with the Revised
 *   Universal Soil Loss Equation (RUSLE), USDA Agriculture Handbook No. 703, ch. 1, eq. (1-1),
 *   p. 9.
 * - Rainfall erosivity from monthly precipitation: Renard, K.G. & Freimund, J.R. (1994), Using
 *   monthly precipitation data to estimate the R-factor in the revised USLE, Journal of
 *   Hydrology, 157(1-4): 287-306, eq. (9), p. 297 (R = 0.04830 * p^1.610); and Modified
 *   Fournier Index F = sum(p_m^2) / P from Arnoldus, H.M.J. (1980), An approximation of the
 *   rainfall factor in the Universal Soil Loss Equation, in Assessment of Erosion, John Wiley
 *   & Sons, pp. 127-132.
 * - Slope steepness factor S (without slope length L): McCool, D.K., Brown, L.C., Foster, G.R.,
 *   Mutchler, C.K., & Meyer, L.D. (1987), Revised slope steepness factor for the Universal Soil
 *   Loss Equation, Transactions of the ASAE, 30(5): 1387-1396, eq. (5)-(6), p. 1391; also
 *   USDA Agriculture Handbook No. 703 (Renard et al., 1997), ch. 4, eq. (4-9) & (4-10), p. 107.
 * - Soil erodibility factor K: Wischmeier, W.H. & Smith, D.D. (1978), Predicting Rainfall
 *   Erosion Losses - A Guide to Conservation Planning, USDA Agriculture Handbook No. 537, p. 11
 *   (nomograph equation); SI unit factor 0.1317 from USDA Agriculture Handbook No. 703
 *   (Renard et al., 1997), ch. 3, p. 88 & Appendix A, p. 375.
 * - Cover-management factor C from NDVI: van der Knijff, J.M., Jones, R.J.A., & Montanarella,
 *   L. (2000), Soil Erosion Risk Assessment in Europe, EUR 19044 EN, European Soil Bureau,
 *   Joint Research Centre, Ispra, section 3.4, p. 17.
 */

export interface ErosionComponentRef<T = number | null> {
  value: T;
  sourceId: string;
  citation: string;
}

export interface MonthlyErosionRisk {
  /** Calendar month 1..12. */
  month: number;
  /** Mean monthly precipitation, mm. */
  rainMm: number;
  /** Monthly rainfall-runoff erosivity factor R_m (MJ * mm / (ha * h * month)). */
  rainfallFactor: number;
  /** Mean monthly NDVI clamped only inside coverFactor computation. */
  ndvi: number;
  /** Dimensionless cover-management factor C_m in (0, 1]. */
  coverFactor: number;
  /** Dimensionless relative monthly erosion risk index (R_m * K * S * C_m). */
  index: number;
}

export interface ErosionRecommendation {
  id: 'contour-farming' | 'inter-season-cover';
  action: I18nText;
  rationale: I18nText;
  recheck: I18nText;
}

export interface SoilErosionAssessment {
  months: MonthlyErosionRisk[] | null;
  annualIndex: number | null;
  peakMonth: number | null;
  peakIndex: number | null;
  isRelativeIndex: true;
  relativeIndexNotice: I18nText;
  reason: I18nText | null;
  components: {
    rainfall: ErosionComponentRef<number | null> & { modifiedFournierIndex: number | null };
    slope: ErosionComponentRef<number | null> & { slopeDeg: number | null };
    soilErodibility: ErosionComponentRef<number | null>;
    cover: ErosionComponentRef<number | null>;
  };
  recommendations: ErosionRecommendation[];
}

const CITATIONS = {
  framework:
    'Renard et al. (1997), USDA Agriculture Handbook No. 703, ch. 1, eq. (1-1), p. 9',
  rainfall:
    'Renard & Freimund (1994), J. Hydrology 157: 287-306, eq. (9), p. 297; Arnoldus (1980), Wiley, pp. 127-132',
  slope:
    'McCool et al. (1987), Trans. ASAE 30(5): 1387-1396, eq. (5)-(6), p. 1391; USDA AH 703, ch. 4, eq. (4-9)-(4-10), p. 107',
  erodibility:
    'Wischmeier & Smith (1978), USDA Agriculture Handbook No. 537, p. 11; SI conversion 0.1317 per USDA AH 703, ch. 3, p. 88 & Appendix A, p. 375',
  cover:
    'van der Knijff, Jones & Montanarella (2000), EUR 19044 EN, European Soil Bureau, section 3.4, p. 17',
} as const;

const VAN_BAMM_SOC_TO_OM = 1.724;
const VERY_FINE_SAND_SHARE = 0.2;
const SI_K_CONVERSION = 0.1317;
const MIN_K_FACTOR = 0.005;

const RELATIVE_INDEX_NOTICE = tx(
  'Dimensionless relative erosion risk index (R * K * S * C). Slope length (lambda) is absent from parcel telemetry, so absolute soil loss in t/ha/yr is never estimated or reported.',
  'Chỉ số nguy cơ xói mòn tương đối không thứ nguyên (R * K * S * C). Dữ liệu thửa không có chiều dài sườn dốc nên không ước tính hay ghi lượng đất mất theo t/ha/năm.',
);

function resolveSourceId(
  t: ModelInput['telemetry'],
  candidates: Array<string | undefined>,
): string {
  for (const id of candidates) {
    if (id && t.sources[id]) return id;
  }
  return Object.keys(t.sources)[0] ?? candidates.find(Boolean) ?? 'unknown';
}

function findRawFact(t: ModelInput['telemetry'], branch: keyof ModelInput['telemetry']['branches'], key: string): StaticFact | undefined {
  return t.branches[branch]?.facts.find((f) => f.key === key) ?? findFact(t, key);
}

/** McCool et al. (1987), eq. (5)-(6), p. 1391; USDA AH 703 (1997), eq. (4-9)-(4-10), p. 107. */
function slopeSteepnessFactor(slopeDeg: number): number {
  const rad = (slopeDeg * Math.PI) / 180;
  const sinTheta = Math.sin(rad);
  const tanTheta = Math.tan(rad);
  return tanTheta < 0.09 ? 10.8 * sinTheta + 0.03 : 16.8 * sinTheta - 0.5;
}

/**
 * Wischmeier & Smith (1978), USDA AH 537, p. 11 nomograph approximation, converted to SI
 * (t * ha * h / (ha * MJ * mm)) via factor 0.1317 (USDA AH 703, p. 88 & p. 375).
 */
function soilErodibilityK(clayPct: number, sandPct: number, siltPct: number, omPct: number): number {
  const omCapped = Math.min(4, Math.max(0, omPct));
  const veryFineSand = VERY_FINE_SAND_SHARE * sandPct;
  const particleParam = Math.max(0, (siltPct + veryFineSand) * (100 - clayPct));
  const structureCode = 2; // fine granular baseline when topsoil structure class is unobserved
  const permeabilityCode =
    clayPct > 40 ? 5 : clayPct > 27 ? 4 : sandPct > 60 ? 2 : 3;
  const kUs =
    (2.1e-4 * Math.pow(particleParam, 1.14) * (12 - omCapped) +
      3.25 * (structureCode - 2) +
      2.5 * (permeabilityCode - 3)) /
    100;
  return Math.max(MIN_K_FACTOR, SI_K_CONVERSION * kUs);
}

/** van der Knijff et al. (2000), EUR 19044 EN, section 3.4, p. 17 (alpha = 2, beta = 1). */
function coverFactorFromNdvi(ndvi: number): number {
  const clamped = Math.max(0, Math.min(0.99, ndvi));
  return Math.exp(-2 * (clamped / (1 - clamped)));
}

/** Renard & Freimund (1994), J. Hydrology 157, eq. (9), p. 297. */
function monthlyRainfallErosivity(rainMm: number): number {
  const p = Math.max(0, rainMm);
  return 0.0483 * Math.pow(p, 1.61);
}

function resolveMonthlyRainMm(t: ModelInput['telemetry']): number[] | null {
  const normals = monthlyNormals(t.climateHistory);
  if (normals.length === 12 && normals.every((n) => n.rainMm != null && Number.isFinite(n.rainMm))) {
    return normals.map((n) => Math.max(0, n.rainMm as number));
  }

  const rainSeries =
    t.branches.rainfall?.series.find((s) => s.key === 'rain_era5') ??
    t.branches.rainfall?.series.find((s) => s.key === 'rain');
  if (!rainSeries?.samples.length) return null;

  const sums = new Array<number>(12).fill(0);
  const counts = new Array<number>(12).fill(0);
  for (const pt of rainSeries.samples) {
    if (pt.v == null || !Number.isFinite(pt.v)) continue;
    const m = Number(pt.t.slice(5, 7));
    if (m >= 1 && m <= 12) {
      sums[m - 1] += Math.max(0, pt.v);
      counts[m - 1] += 1;
    }
  }
  if (counts.some((c) => c === 0)) return null;
  const daysInMonth = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return sums.map((sum, idx) => (sum / counts[idx]) * daysInMonth[idx]);
}

function resolveMonthlyNdvi(t: ModelInput['telemetry']): { values: number[]; sourceId: string } | null {
  const ndviSeries = t.branches.vegetation?.series.find((s) => s.key === 'ndvi');
  const sourceId = resolveSourceId(t, [ndviSeries?.sourceId, 'modis-mod13q1']);
  if (!ndviSeries?.samples.length) return null;

  const valid = ndviSeries.samples.filter((pt) => pt.v != null && Number.isFinite(pt.v));
  if (!valid.length) return null;

  const overallMean = valid.reduce((acc, pt) => acc + (pt.v as number), 0) / valid.length;
  const values: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthPts = valid.filter((pt) => Number(pt.t.slice(5, 7)) === m);
    values.push(
      monthPts.length
        ? monthPts.reduce((acc, pt) => acc + (pt.v as number), 0) / monthPts.length
        : overallMean,
    );
  }
  return { values, sourceId };
}

function buildRecommendations(): ErosionRecommendation[] {
  return [
    {
      id: 'contour-farming',
      action: tx(
        'Lay out rows, bunds, or micro-terraces along terrain contours across the slope.',
        'Bố trí hàng cây, bờ ngăn hoặc bậc thềm nhỏ theo đường đồng mức vuông góc với hướng dốc.',
      ),
      rationale: tx(
        'Contour barriers break downslope overland flow and reduce effective slope steepness and runoff energy without specifying any input rate.',
        'Canh tác theo đường đồng mức giúp chia cắt dòng chảy tràn xuống dốc và giảm năng lượng cuốn trôi đất mặt.',
      ),
      recheck: tx(
        'Walk the field after heavy storms in the peak rainfall month to check for rills breaching contour rows.',
        'Đi kiểm tra mặt ruộng sau các trận mưa lớn vào tháng mưa cao điểm xem có rãnh xói cắt qua hàng đồng mức hay không.',
      ),
    },
    {
      id: 'inter-season-cover',
      action: tx(
        'Maintain surface residue, mulch, or a live cover crop between harvests and beneath perennial canopies.',
        'Duy trì tàn dư thực vật, lớp phủ hữu cơ hoặc cây che phủ giữa các vụ và dưới tán cây lâu năm.',
      ),
      rationale: tx(
        'Increasing ground cover during high-rainfall or bare-soil months directly lowers the cover factor C against raindrop splash.',
        'Tăng độ che phủ bề mặt vào các tháng mưa nhiều hoặc giai đoạn đất trống giúp giảm trực tiếp hệ số che phủ C trước tác động hạt mưa.',
      ),
      recheck: tx(
        'Inspect exposed soil patches before peak rains and verify sediment accumulation at lower field borders.',
        'Kiểm tra tỷ lệ đất trơ trước mùa mưa chính và quan sát lượng bùn đất bồi tụ ở rìa thấp của thửa ruộng.',
      ),
    },
  ];
}

function buildMissingResult(
  partial: Partial<SoilErosionAssessment['components']>,
  fallbackSourceId: string,
  reason: I18nText,
): SoilErosionAssessment {
  return {
    months: null,
    annualIndex: null,
    peakMonth: null,
    peakIndex: null,
    isRelativeIndex: true,
    relativeIndexNotice: RELATIVE_INDEX_NOTICE,
    reason,
    components: {
      rainfall: partial.rainfall ?? {
        value: null,
        modifiedFournierIndex: null,
        sourceId: fallbackSourceId,
        citation: CITATIONS.rainfall,
      },
      slope: partial.slope ?? {
        value: null,
        slopeDeg: null,
        sourceId: fallbackSourceId,
        citation: CITATIONS.slope,
      },
      soilErodibility: partial.soilErodibility ?? {
        value: null,
        sourceId: fallbackSourceId,
        citation: CITATIONS.erodibility,
      },
      cover: partial.cover ?? {
        value: null,
        sourceId: fallbackSourceId,
        citation: CITATIONS.cover,
      },
    },
    recommendations: buildRecommendations(),
  };
}

/** Computes a dimensionless monthly water erosion risk index across the parcel's 12 months. */
export function erosionRisk(input: ModelInput): SoilErosionAssessment {
  const t = input.telemetry;

  const rainSourceId = resolveSourceId(t, [t.climateSourceId, 'era5', 'chirps']);
  const slopeFact = findRawFact(t, 'terrain', 'slope_deg');
  const slopeSourceId = resolveSourceId(t, [slopeFact?.sourceId, 'srtm-opentopodata']);

  const clayFact = findRawFact(t, 'soil', 'clay_pct');
  const soilSourceId = resolveSourceId(t, [clayFact?.sourceId, 'ssurgo', 'soilgrids']);

  const monthlyRain = resolveMonthlyRainMm(t);
  const annualRainMm = monthlyRain ? monthlyRain.reduce((a, b) => a + b, 0) : null;
  const modifiedFournier =
    monthlyRain && annualRainMm && annualRainMm > 0
      ? monthlyRain.reduce((acc, p) => acc + p * p, 0) / annualRainMm
      : monthlyRain
        ? 0
        : null;

  const ndviResolved = resolveMonthlyNdvi(t);
  const coverSourceId = ndviResolved?.sourceId ?? resolveSourceId(t, ['modis-mod13q1']);

  const rawSlope = slopeFact?.value;
  if (typeof rawSlope !== 'number' || !Number.isFinite(rawSlope) || rawSlope < 0) {
    return buildMissingResult(
      {
        rainfall: {
          value: annualRainMm,
          modifiedFournierIndex: modifiedFournier,
          sourceId: rainSourceId,
          citation: CITATIONS.rainfall,
        },
        slope: {
          value: null,
          slopeDeg: null,
          sourceId: slopeSourceId,
          citation: CITATIONS.slope,
        },
        cover: {
          value: ndviResolved
            ? ndviResolved.values.reduce((acc, v) => acc + coverFactorFromNdvi(v), 0) / 12
            : null,
          sourceId: coverSourceId,
          citation: CITATIONS.cover,
        },
      },
      rainSourceId,
      tx(
        'Slope angle (slope_deg) is missing or invalid in terrain telemetry; erosion risk cannot be computed without treating missing slope as zero.',
        'Thiếu số liệu độ dốc (slope_deg) trong dữ liệu địa hình nên không thể tính chỉ số nguy cơ xói mòn; hệ thống không tự gán độ dốc bằng 0.',
      ),
    );
  }

  const clay = factNum(t, 'clay_pct');
  const sand = factNum(t, 'sand_pct');
  const silt = factNum(t, 'silt_pct');
  const soc = factNum(t, 'soc_gkg');
  const omFact = factNum(t, 'om_pct');
  const omPct =
    input.groundTruth.organicMatterPct ??
    (soc != null ? (soc / 10) * VAN_BAMM_SOC_TO_OM : omFact);

  if (clay == null || sand == null || silt == null || omPct == null) {
    return buildMissingResult(
      {
        rainfall: {
          value: annualRainMm,
          modifiedFournierIndex: modifiedFournier,
          sourceId: rainSourceId,
          citation: CITATIONS.rainfall,
        },
        slope: {
          value: slopeSteepnessFactor(rawSlope),
          slopeDeg: rawSlope,
          sourceId: slopeSourceId,
          citation: CITATIONS.slope,
        },
      },
      soilSourceId,
      tx(
        'Soil texture fractions (clay, sand, silt) or organic matter/carbon are missing; soil erodibility factor K cannot be estimated.',
        'Thiếu dữ liệu thành phần hạt (sét, cát, thịt) hoặc chất hữu cơ nên không thể ước tính hệ số dễ xói K của đất.',
      ),
    );
  }

  if (!monthlyRain || annualRainMm == null) {
    return buildMissingResult(
      {
        slope: {
          value: slopeSteepnessFactor(rawSlope),
          slopeDeg: rawSlope,
          sourceId: slopeSourceId,
          citation: CITATIONS.slope,
        },
        soilErodibility: {
          value: soilErodibilityK(clay, sand, silt, omPct),
          sourceId: soilSourceId,
          citation: CITATIONS.erodibility,
        },
      },
      rainSourceId,
      tx(
        'Monthly rainfall normals are missing from parcel telemetry; rainfall erosivity factor R cannot be computed.',
        'Thiếu dữ liệu lượng mưa trung bình 12 tháng nên không thể tính hệ số gây xói do mưa R.',
      ),
    );
  }

  if (!ndviResolved) {
    return buildMissingResult(
      {
        rainfall: {
          value: annualRainMm,
          modifiedFournierIndex: modifiedFournier,
          sourceId: rainSourceId,
          citation: CITATIONS.rainfall,
        },
        slope: {
          value: slopeSteepnessFactor(rawSlope),
          slopeDeg: rawSlope,
          sourceId: slopeSourceId,
          citation: CITATIONS.slope,
        },
        soilErodibility: {
          value: soilErodibilityK(clay, sand, silt, omPct),
          sourceId: soilSourceId,
          citation: CITATIONS.erodibility,
        },
      },
      coverSourceId,
      tx(
        'NDVI vegetation cover series is missing; monthly cover factor C cannot be derived.',
        'Thiếu chuỗi chỉ số thực vật NDVI nên không thể ước tính hệ số che phủ C theo tháng.',
      ),
    );
  }

  const sFactor = slopeSteepnessFactor(rawSlope);
  const kFactor = soilErodibilityK(clay, sand, silt, omPct);

  const months: MonthlyErosionRisk[] = monthlyRain.map((rainMm, i) => {
    const ndvi = ndviResolved.values[i];
    const rainfallFactor = monthlyRainfallErosivity(rainMm);
    const coverFactor = coverFactorFromNdvi(ndvi);
    const index = rainfallFactor * kFactor * sFactor * coverFactor;
    return {
      month: i + 1,
      rainMm,
      rainfallFactor,
      ndvi,
      coverFactor,
      index,
    };
  });

  const annualIndex = months.reduce((acc, m) => acc + m.index, 0);
  const meanCover = months.reduce((acc, m) => acc + m.coverFactor, 0) / months.length;
  const peak = months.reduce(
    (best, cur) => (cur.index > best.index ? cur : best),
    months[0],
  );

  return {
    months,
    annualIndex,
    peakMonth: peak.month,
    peakIndex: peak.index,
    isRelativeIndex: true,
    relativeIndexNotice: RELATIVE_INDEX_NOTICE,
    reason: null,
    components: {
      rainfall: {
        value: annualRainMm,
        modifiedFournierIndex: modifiedFournier,
        sourceId: rainSourceId,
        citation: CITATIONS.rainfall,
      },
      slope: {
        value: sFactor,
        slopeDeg: rawSlope,
        sourceId: slopeSourceId,
        citation: CITATIONS.slope,
      },
      soilErodibility: {
        value: kFactor,
        sourceId: soilSourceId,
        citation: CITATIONS.erodibility,
      },
      cover: {
        value: meanCover,
        sourceId: ndviResolved.sourceId,
        citation: CITATIONS.cover,
      },
    },
    recommendations: buildRecommendations(),
  };
}

export const assessSoilErosionRisk = erosionRisk;
export { CITATIONS as EROSION_CITATIONS };
