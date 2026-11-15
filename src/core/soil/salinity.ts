import type { I18nText, ModelInput, SalinityClass } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { MAAS_HOFFMAN_PARAMS } from '@/core/scoring/literature';
import { factNum } from './buffer';

export type SalinityRiskLevel =
  | 'non_saline'
  | 'slightly_saline'
  | 'moderately_saline'
  | 'severely_saline'
  | 'unknown';

export type SodicityRiskLevel = 'non_sodic' | 'sodic' | 'severely_sodic' | 'unknown';

export interface LeachingPlan {
  cropThresholdEcDsM: number | null;
  waterEcDsM: number | null;
  leachingFraction: number | null;
  leachingPercent: number | null;
  method: string;
  note: I18nText;
}

export interface GypsumPlan {
  initialEspPct: number | null;
  targetEspPct: number;
  sar: number | null;
  rateRangeTHa: [lo: number, hi: number] | null;
  method: string;
  note: I18nText;
}

export interface SalinitySodicityDiagnosis {
  salinityStatus: SalinityRiskLevel;
  sodicityStatus: SodicityRiskLevel;
  soilEcDsM: number | null;
  waterEcDsM: number | null;
  sar: number | null;
  espPct: number | null;
  leaching: LeachingPlan;
  gypsum: GypsumPlan;
  requiredMeasurements: I18nText[];
  summary: I18nText;
  recommendations: I18nText[];
  caveats: I18nText[];
  needsLocalReview: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Calculates Leaching Requirement (LR) and Gypsum Requirement (GR) for salt-affected soils.
 *
 * Literature Sources:
 * 1. FAO Irrigation and Drainage Paper 29 Rev. 1 (Ayers & Westcot, 1985), Section 2.4.2, Eq. (9).
 * 2. USDA Agriculture Handbook 60 (Richards, 1954), Diagnosis and Improvement of Saline and Alkali Soils, p. 38-41.
 * 3. Maas & Hoffman (1977) Crop Salt Tolerance Thresholds (via MAAS_HOFFMAN_PARAMS).
 *
 * @param input ModelInput of the field and selected crop
 * @param measured Optional diagnostic measurements for water EC, SAR, or ESP
 */
export function leachingRequirement(
  input: ModelInput,
  measured?: { waterEcDsM?: number; sar?: number; espPct?: number; cropThresholdEcDsM?: number },
): SalinitySodicityDiagnosis {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const gt = input.groundTruth as ModelInput['groundTruth'] & { waterEcDsM?: number; sar?: number; espPct?: number };

  const soilEc = gt.ecDsM ?? factNum(t, 'ec_dsm');
  const waterEc = measured?.waterEcDsM ?? gt.waterEcDsM ?? null;
  const sar = measured?.sar ?? gt.sar ?? null;
  let esp = measured?.espPct ?? gt.espPct ?? null;

  // Convert SAR to ESP if SAR is provided but ESP is absent (USDA Handbook 60, p. 26)
  if (esp == null && sar != null && sar > 0) {
    esp = r1((100 * (0.01475 * sar - 0.0126)) / (1 + (0.01475 * sar - 0.0126)));
    if (esp < 0) esp = 0;
  }

  const cec = factNum(t, 'cec_cmolkg');
  const bulkDensity = factNum(t, 'bulk_density');
  const depthCm = gt.soilDepthCm ?? factNum(t, 'depth_cm');
  const ph = gt.ph ?? factNum(t, 'ph');

  const requiredMeasurements: I18nText[] = [];
  const caveats: I18nText[] = [
    tx(
      'Indicative calculation: requires local laboratory testing of irrigation water and soil saturated paste.',
      'Ước tính định hướng: cần kiểm tra tại chỗ bằng phân tích phòng thí nghiệm mẫu nước tưới và cao đất bão hòa.',
    ),
  ];

  // 1. Determine Crop Salinity Threshold (ECe threshold at 100% potential yield)
  let cropThresholdEc: number;
  if (measured?.cropThresholdEcDsM != null) {
    cropThresholdEc = measured.cropThresholdEcDsM;
  } else if (c?.req.salinity?.opt) {
    const optClass = c.req.salinity.opt as SalinityClass;
    cropThresholdEc = MAAS_HOFFMAN_PARAMS[optClass]?.thresholdDsM ?? 2.0;
  } else {
    // Default to moderately sensitive threshold (2.0 dS/m, standard field crop benchmark)
    cropThresholdEc = 2.0;
  }

  // 2. Classify Soil Salinity Status
  let salinityStatus: SalinityRiskLevel;
  if (soilEc == null) {
    salinityStatus = 'unknown';
    requiredMeasurements.push(
      tx(
        'Soil electrical conductivity from saturated paste extract (ECe in dS/m)',
        'Độ dẫn điện của đất từ dịch chiết bão hòa (ECe tính bằng dS/m)',
      ),
    );
  } else if (soilEc <= 1.0) {
    salinityStatus = 'non_saline';
  } else if (soilEc <= 2.5) {
    salinityStatus = 'slightly_saline';
  } else if (soilEc <= 4.0) {
    salinityStatus = 'moderately_saline';
  } else {
    salinityStatus = 'severely_saline';
  }

  // 3. Classify Sodicity Status
  let sodicityStatus: SodicityRiskLevel = 'unknown';
  if (esp == null && sar == null) {
    sodicityStatus = 'unknown';
    if (ph != null && ph >= 8.5) {
      requiredMeasurements.push(
        tx(
          'Soil exchangeable sodium percentage (ESP) or Sodium Adsorption Ratio (SAR) — high pH suggests sodicity risk',
          'Tỷ lệ natri trao đổi (ESP) hoặc tỷ số hấp phụ natri (SAR) — pH cao gợi ý nguy cơ đất kiềm/sodic',
        ),
      );
      caveats.push(
        tx(
          `At pH ${ph}, soil is likely sodic with dispersed clay platelets and compromised permeability. Confirm ESP via lab test.`,
          `Ở pH ${ph}, đất có nguy cơ bị sodic làm phân tán hạt sét và tắc nghẽn thấm nước. Cần xác nhận ESP qua phân tích.`,
        ),
      );
    }
  } else if (esp != null) {
    if (esp < 10) sodicityStatus = 'non_sodic';
    else if (esp <= 15) sodicityStatus = 'sodic';
    else sodicityStatus = 'severely_sodic';
  }

  // 4. Calculate Leaching Requirement (LR) — FAO Paper 29, Section 2.4.2, Eq. (9)
  let leachingFraction: number | null = null;
  let leachingPercent: number | null = null;
  let leachingNote: I18nText;

  if (waterEc == null) {
    requiredMeasurements.push(
      tx(
        'Electrical conductivity of irrigation water source (ECw in dS/m)',
        'Độ dẫn điện của nguồn nước tưới (ECw tính bằng dS/m)',
      ),
    );
    leachingNote = tx(
      'Cannot calculate leaching requirement without irrigation water salinity (ECw). Test the irrigation water electrical conductivity.',
      'Không thể tính nhu cầu rửa mặn khi chưa có độ mặn nước tưới (ECw). Cần kiểm tra độ dẫn điện của nguồn nước tưới.',
    );
  } else {
    // Formula: LR = ECw / (5 * ECe - ECw) [FAO 29, Section 2.4.2, Eq. (9)]
    const denominator = 5 * cropThresholdEc - waterEc;
    if (denominator <= 0) {
      leachingFraction = 1.0;
      leachingPercent = 100.0;
      leachingNote = tx(
        `Irrigation water salinity (${waterEc} dS/m) exceeds the safe leaching threshold for ${c ? c.names.en : 'the crop'} (5*ECe = ${5 * cropThresholdEc} dS/m). Water is too saline for this crop without blending.`,
        `Độ mặn nước tưới (${waterEc} dS/m) vượt quá ngưỡng rửa mặn an toàn cho cây trồng (5*ECe = ${5 * cropThresholdEc} dS/m). Nguồn nước quá mặn, không thể dùng trực tiếp nếu không pha loãng.`,
      );
    } else {
      leachingFraction = r3(waterEc / denominator);
      leachingPercent = r1(leachingFraction * 100);
      leachingNote = tx(
        `Leaching fraction is ${leachingPercent}% of applied irrigation water (FAO Irrigation and Drainage Paper 29, Section 2.4.2, Eq. (9)). For each 100 mm crop water need, apply ${(100 / (1 - leachingFraction)).toFixed(1)} mm.`,
        `Nhu cầu rửa mặn là ${leachingPercent}% tổng lượng nước tưới (FAO Irrigation and Drainage Paper 29, mục 2.4.2, CT (9)). Với mỗi 100 mm nhu cầu nước của cây, cần tưới ${(100 / (1 - leachingFraction)).toFixed(1)} mm.`,
      );
    }
  }

  // 5. Calculate Gypsum Requirement (GR) — USDA Handbook 60, Eq. 6 (p. 38-41)
  const targetEsp = 10.0; // Safe threshold below which clay flocculation is maintained (Oster et al. 1999)
  let gypsumRateRange: [lo: number, hi: number] | null = null;
  let gypsumNote: I18nText;

  if (esp == null) {
    gypsumNote = tx(
      'No gypsum dosage calculated: exchangeable sodium (ESP or SAR) has not been measured. Laboratory soil test required.',
      'Không tính định mức thạch cao: chưa có số đo natri trao đổi (ESP hoặc SAR). Cần phân tích đất tại phòng thí nghiệm.',
    );
  } else if (esp <= targetEsp) {
    gypsumNote = tx(
      `Exchangeable sodium percentage (${esp}%) is below the critical sodicity threshold (${targetEsp}%). No gypsum amendment required.`,
      `Tỷ lệ natri trao đổi (${esp}%) nằm dưới ngưỡng nguy hại (${targetEsp}%). Không cần bón thạch cao.`,
    );
  } else if (cec == null || bulkDensity == null || depthCm == null || depthCm <= 0 || bulkDensity <= 0) {
    requiredMeasurements.push(
      tx(
        'Soil CEC, bulk density, and effective treatment depth for gypsum requirement',
        'CEC, dung trọng và độ sâu xử lý của đất để tính nhu cầu thạch cao',
      ),
    );
    gypsumNote = tx(
      'No gypsum dosage calculated: CEC, bulk density, and treatment depth are required; measure them first.',
      'Không tính định mức thạch cao: cần CEC, dung trọng và độ sâu xử lý; hãy đo trước.',
    );
  } else {
    // For a 1 ha layer, GR (t pure gypsum/ha) = 0.086 × depth(m) × bulk density(t/m³)
    // × CEC(cmolc/kg) × ΔESP. The 0.086 conversion is 0.861 kg gypsum per
    // cmolc Na/kg soil divided by 10, expressed per t/m³ and metre of soil.
    // Apply displacement efficiency factor F in [1.1, 1.3].
    const deltaEsp = esp - targetEsp;
    const baseGr = 0.086 * (depthCm / 100) * bulkDensity * cec * deltaEsp;
    const minRate = r1(baseGr * 1.1);
    const maxRate = r1(baseGr * 1.3);
    gypsumRateRange = [minRate, maxRate];

    gypsumNote = tx(
      `Sodic soil remediation: Apply ${minRate}-${maxRate} t/ha agricultural gypsum (CaSO4·2H2O) to lower ESP from ${esp}% to ${targetEsp}% using ${depthCm} cm depth and bulk density ${bulkDensity} t/m³ (USDA Agriculture Handbook 60, p. 38-41). Incorporate and leach on site.`,
      `Cải tạo đất kiềm/sodic: Bón ${minRate}-${maxRate} tấn/ha thạch cao nông nghiệp (CaSO4·2H2O) để giảm ESP từ ${esp}% xuống ${targetEsp}% với độ sâu ${depthCm} cm và dung trọng ${bulkDensity} tấn/m³ (USDA Agriculture Handbook 60, tr. 38-41). Cần trộn và tháo rửa tại chỗ.`,
    );

    if (maxRate > 5.0) {
      caveats.push(
        tx(
          'Split gypsum applications if exceeding 5.0 t/ha to facilitate thorough dissolution and displacement.',
          'Nếu lượng thạch cao vượt quá 5,0 tấn/ha nên chia làm nhiều đợt bón để đảm bảo hòa tan và trao đổi ion triệt để.',
        ),
      );
    }
  }

  // 6. Build Recommendations and Summary
  const recommendations: I18nText[] = [];
  if (leachingPercent != null && leachingPercent > 0) {
    recommendations.push(
      tx(
        `Increase seasonal irrigation depth by ${leachingPercent}% to leach soluble salts below the root zone.`,
        `Tăng lượng nước tưới trong vụ thêm ${leachingPercent}% để đẩy rửa muối hòa tan xuống dưới tầng rễ.`,
      ),
    );
  }
  if (gypsumRateRange != null) {
    recommendations.push(
      tx(
        `Broadcast ${gypsumRateRange[0]}-${gypsumRateRange[1]} t/ha agricultural gypsum to replace exchangeable sodium with calcium.`,
        `Rải ${gypsumRateRange[0]}-${gypsumRateRange[1]} tấn/ha thạch cao nông nghiệp để thay thế natri hấp phụ bằng canxi.`,
      ),
    );
  }
  if (requiredMeasurements.length > 0) {
    recommendations.push(
      tx(
        `Perform missing diagnostic measurements before chemical intervention: ${requiredMeasurements.map((m) => m.en).join('; ')}.`,
        `Thực hiện các phép đo còn thiếu trước khi cải tạo hóa học: ${requiredMeasurements.map((m) => m.vi).join('; ')}.`,
      ),
    );
  }

  const summary = tx(
    `Salinity status: ${salinityStatus}; Sodicity status: ${sodicityStatus}. ${leachingPercent != null ? `Leaching requirement: ${leachingPercent}%.` : 'Leaching fraction uncalculated (requires ECw).'} ${gypsumRateRange != null ? `Gypsum rate: ${gypsumRateRange[0]}-${gypsumRateRange[1]} t/ha.` : ''}`,
    `Hiện trạng độ mặn: ${salinityStatus}; Độ kiềm/sodic: ${sodicityStatus}. ${leachingPercent != null ? `Nhu cầu rửa mặn: ${leachingPercent}%.` : 'Chưa tính được nhu cầu rửa mặn (cần số đo ECw).'} ${gypsumRateRange != null ? `Định mức thạch cao: ${gypsumRateRange[0]}-${gypsumRateRange[1]} tấn/ha.` : ''}`,
  );

  return {
    salinityStatus,
    sodicityStatus,
    soilEcDsM: soilEc,
    waterEcDsM: waterEc,
    sar,
    espPct: esp,
    leaching: {
      cropThresholdEcDsM: cropThresholdEc,
      waterEcDsM: waterEc,
      leachingFraction,
      leachingPercent,
      method: 'FAO Irrigation and Drainage Paper 29 (Ayers & Westcot, 1985), Eq. 4, p. 21',
      note: leachingNote,
    },
    gypsum: {
      initialEspPct: esp,
      targetEspPct: targetEsp,
      sar,
      rateRangeTHa: gypsumRateRange,
      method: 'USDA Agriculture Handbook 60 (Richards, 1954), p. 38-41',
      note: gypsumNote,
    },
    requiredMeasurements,
    summary,
    recommendations,
    caveats,
    needsLocalReview: true,
  };
}

