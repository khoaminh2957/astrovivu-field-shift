import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { MAAS_HOFFMAN_PARAMS } from '@/core/scoring/literature';
import { factNum } from './buffer';
import { amendmentTHa, DOSE_DEPTH_M, GYPSUM_G_PER_CMOLC } from './mass';

/**
 * Salinity and sodicity of a field: what class the soil is in, how much extra irrigation water
 * keeps salt out of the root zone, and how much gypsum replaces the exchangeable sodium.
 *
 * Every number below comes from one of four publications, named where it is used:
 *
 * - FAO 29: Ayers & Westcot (1985), Water quality for agriculture, FAO Irrigation and Drainage
 *   Paper 29 Rev. 1, section 2.4.2 "Salinity control by leaching": equation (9) for the leaching
 *   requirement, equation (7) for the depth of water to apply, Example 3 (maize, ECw 1.2 dS/m).
 * - FAO 39: Abrol, Yadav & Massoud (1988), Salt-affected soils and their management, FAO Soils
 *   Bulletin 39: Table 10 (section 3.1.2) for the salinity classes, section 4.1 for the sodic limit
 *   of ESP 15, section 4.4.1 (iii) for the gypsum equivalent of exchangeable sodium.
 * - HB 60: Richards (ed., 1954), Diagnosis and improvement of saline and alkali soils, USDA
 *   Agriculture Handbook 60: p. 26 for the equation from SAR to ESP, pp. 49-50 for the worked
 *   example that lowers ESP to about 10 and for the factor 1.25 on the gypsum of Table 6.
 * - The crop's threshold is the one the scoring model uses (`MAAS_HOFFMAN_PARAMS`, by the salinity
 *   class of the crop in the catalogue).
 *
 * Where a reading is missing the result carries no number for what depends on it, and names the
 * measurement to make.
 */

export type SalinityRiskLevel =
  | 'non_saline'
  | 'slightly_saline'
  | 'moderately_saline'
  | 'severely_saline'
  | 'unknown';

export type SodicityRiskLevel = 'non_sodic' | 'sodic' | 'unknown';

export interface LeachingPlan {
  /** ECe the crop tolerates without yield loss, dS/m; null when the crop has no salinity class. */
  cropThresholdEcDsM: number | null;
  waterEcDsM: number | null;
  /** Null when a reading is missing or the water is too saline for leaching to work. */
  leachingFraction: number | null;
  leachingPercent: number | null;
  /** mm of water to apply for each 100 mm the crop uses: 100 / (1 - LR). */
  appliedMmPer100MmEt: number | null;
  method: string;
  note: I18nText;
}

export interface GypsumPlan {
  initialEspPct: number | null;
  targetEspPct: number;
  sar: number | null;
  /** Readings the dose was computed from; null when missing (then there is no dose). */
  cecCmolKg: number | null;
  bulkDensityTM3: number | null;
  depthM: number;
  rateRangeTHa: [lo: number, hi: number] | null;
  method: string;
  note: I18nText;
}

export interface SalinitySodicityDiagnosis {
  salinityStatus: SalinityRiskLevel;
  sodicityStatus: SodicityRiskLevel;
  /** The two statuses in words, for a reader. */
  salinityLabel: I18nText;
  sodicityLabel: I18nText;
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

/** FAO 39, Table 10: upper ECe bound (dS/m) of "non saline", "slightly saline", "moderately saline". */
export const SALINITY_CLASS_ECE_DSM = { nonSaline: 2, slightlySaline: 4, moderatelySaline: 8 } as const;

/** FAO 39, section 4.1: soils with an exchangeable sodium percentage above 15 are sodic. */
export const SODIC_ESP_PCT = 15;

/**
 * ESP the gypsum dose aims at. HB 60 p. 49 works its example down "to about 10"; FAO 39 Table 32
 * (footnote) puts the level above which sensitive crops are seriously affected at about 10.
 */
export const TARGET_ESP_PCT = 10;

/**
 * HB 60 pp. 49-50: the gypsum of Table 6 is multiplied by 1.25 "to compensate for the lack of
 * quantitative replacement". The dose is given as a range from the exact equivalent to 1.25 times it.
 */
export const GYPSUM_FIELD_FACTOR = 1.25;

export const LR_METHOD = 'FAO Irrigation and Drainage Paper 29 Rev. 1 (Ayers & Westcot, 1985), section 2.4.2, equation (9)';
export const GYPSUM_METHOD =
  'FAO Soils Bulletin 39 (Abrol, Yadav & Massoud, 1988), section 4.4.1 (iii); USDA Agriculture Handbook 60 (Richards, 1954), Table 6 and pp. 49-50';

const SALINITY_LABEL: Record<SalinityRiskLevel, I18nText> = {
  non_saline: tx('not saline', 'không mặn'),
  slightly_saline: tx('slightly saline', 'mặn nhẹ'),
  moderately_saline: tx('moderately saline', 'mặn trung bình'),
  severely_saline: tx('strongly saline', 'mặn nặng'),
  unknown: tx('not known (no reading)', 'chưa rõ (chưa có số đo)'),
};

const SODICITY_LABEL: Record<SodicityRiskLevel, I18nText> = {
  non_sodic: tx('not sodic', 'không nhiễm natri (không sodic)'),
  sodic: tx('sodic', 'nhiễm natri (sodic)'),
  unknown: tx('not known (no reading)', 'chưa rõ (chưa có số đo)'),
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A reading that can be used: a finite number that is not negative. Anything else counts as missing. */
const reading = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** FAO 39 Table 10. The two top classes of the table (8-16 and above 16 dS/m) are reported as one. */
export function salinityClass(soilEcDsM: number | null): SalinityRiskLevel {
  if (soilEcDsM == null) return 'unknown';
  if (soilEcDsM <= SALINITY_CLASS_ECE_DSM.nonSaline) return 'non_saline';
  if (soilEcDsM <= SALINITY_CLASS_ECE_DSM.slightlySaline) return 'slightly_saline';
  if (soilEcDsM <= SALINITY_CLASS_ECE_DSM.moderatelySaline) return 'moderately_saline';
  return 'severely_saline';
}

/** HB 60 p. 26: ESP = 100 (-0.0126 + 0.01475 SAR) / (1 + (-0.0126 + 0.01475 SAR)). */
export function espFromSar(sar: number): number {
  const ratio = -0.0126 + 0.01475 * sar;
  return Math.max(0, r1((100 * ratio) / (1 + ratio)));
}

/**
 * FAO 29 equation (9): LR = ECw / (5 ECe - ECw). Null when the equation has no usable answer:
 * 5 ECe - ECw is zero or negative, or the fraction reaches 1 (all the water would have to drain).
 */
export function leachingFractionFao29(waterEcDsM: number, cropEceDsM: number): number | null {
  const denominator = 5 * cropEceDsM - waterEcDsM;
  if (denominator <= 0) return null;
  const lr = waterEcDsM / denominator;
  return lr >= 1 ? null : lr;
}

/**
 * Tonnes of pure gypsum per hectare that replace the exchangeable sodium between two ESP values in
 * a layer: 0.086 x depth (m) x bulk density (t/m3) x CEC (cmol(+)/kg) x (ESP - target ESP, %).
 * The 0.086 is 0.86 g of gypsum per cmol(+) (FAO 39, section 4.4.1 iii), ESP in percent of CEC and
 * 10,000 x depth x bulk density tonnes of soil per hectare.
 */
export function gypsumRequirementTHa(cecCmolKg: number, espPct: number, targetEspPct: number, bulkDensityTM3: number, depthM: number = DOSE_DEPTH_M): number {
  const sodiumToReplaceCmolKg = (cecCmolKg * (espPct - targetEspPct)) / 100;
  return amendmentTHa(sodiumToReplaceCmolKg, GYPSUM_G_PER_CMOLC, depthM, bulkDensityTM3);
}

/**
 * Leaching requirement (FAO 29) and gypsum requirement (FAO 39, HB 60) of the field for its crop.
 *
 * @param input ModelInput of the field and selected crop
 * @param measured Optional readings: EC of the irrigation water, SAR or ESP of the soil, and a
 *   crop threshold ECe the grower takes from FAO 29 Table 4 for the crop itself
 */
export function leachingRequirement(
  input: ModelInput,
  measured?: { waterEcDsM?: number; sar?: number; espPct?: number; cropThresholdEcDsM?: number },
): SalinitySodicityDiagnosis {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const gt = input.groundTruth as ModelInput['groundTruth'] & { waterEcDsM?: number; sar?: number; espPct?: number };
  const cropEn = c ? c.names.en : 'the crop';
  const cropVi = c ? (c.names.vi ?? c.names.en) : 'cây trồng';

  const soilEc = reading(gt.ecDsM ?? factNum(t, 'ec_dsm'));
  const waterEc = reading(measured?.waterEcDsM ?? gt.waterEcDsM);
  const sar = reading(measured?.sar ?? gt.sar);
  const espGiven = reading(measured?.espPct ?? gt.espPct);
  // An ESP above 100 % of the exchange capacity is not a reading.
  const esp = espGiven != null && espGiven <= 100 ? espGiven : sar != null ? espFromSar(sar) : null;
  const espFromSarOnly = (espGiven == null || espGiven > 100) && sar != null;

  const cec = reading(factNum(t, 'cec_cmolkg'));
  const bulkDensity = reading(factNum(t, 'bulk_density'));
  const ph = gt.ph ?? factNum(t, 'ph');

  const requiredMeasurements: I18nText[] = [];
  const caveats: I18nText[] = [
    tx(
      'Indicative calculation: requires local laboratory testing of irrigation water and soil saturated paste.',
      'Ước tính định hướng: cần kiểm tra tại chỗ bằng phân tích phòng thí nghiệm mẫu nước tưới và cao đất bão hòa.',
    ),
  ];

  // 1. Threshold of the crop: its salinity class in the catalogue, read as the scoring model reads it.
  //    Without a class there is no threshold: none is assumed.
  const cropClass = c?.req.salinity?.opt;
  const cropThresholdEc = reading(measured?.cropThresholdEcDsM) ?? (cropClass ? MAAS_HOFFMAN_PARAMS[cropClass].thresholdDsM : null);
  const thresholdIsOfClass = reading(measured?.cropThresholdEcDsM) == null && cropThresholdEc != null;

  // 2. Salinity class of the soil (FAO 39, Table 10).
  const salinityStatus = salinityClass(soilEc);
  if (soilEc == null) {
    requiredMeasurements.push(
      tx(
        'Soil electrical conductivity from saturated paste extract (ECe in dS/m)',
        'Độ dẫn điện của đất từ dịch chiết bão hòa (ECe tính bằng dS/m)',
      ),
    );
  }

  // 3. Sodicity (FAO 39, section 4.1: ESP above 15).
  let sodicityStatus: SodicityRiskLevel = 'unknown';
  if (esp != null) {
    sodicityStatus = esp > SODIC_ESP_PCT ? 'sodic' : 'non_sodic';
    if (espFromSarOnly) {
      caveats.push(
        tx(
          `ESP ${esp}% is computed from SAR ${sar} with the equation of USDA Agriculture Handbook 60, p. 26; it is not a measured ESP.`,
          `ESP ${esp}% được tính từ SAR ${sar} theo phương trình của USDA Agriculture Handbook 60, tr. 26; đây không phải ESP đo trực tiếp.`,
        ),
      );
    }
  } else {
    // HB 60 characterised alkali soils by a saturated-paste pH of 8.5 or more; FAO 39 section 4.1
    // warns that pH alone is not an index of sodicity. So a high pH only asks for the measurement.
    if (ph != null && ph >= 8.5) {
      requiredMeasurements.push(
        tx(
          'Exchangeable sodium percentage (ESP) or sodium adsorption ratio (SAR) of the soil',
          'Tỷ lệ natri trao đổi (ESP) hoặc tỷ số hấp phụ natri (SAR) của đất',
        ),
      );
      caveats.push(
        tx(
          `pH ${ph} is at or above 8.5, the saturated-paste pH by which Richards (1954) characterised alkali (sodic) soils (FAO Soils Bulletin 39, section 4.1). pH alone does not establish sodicity: have ESP or SAR measured.`,
          `pH ${ph} bằng hoặc cao hơn 8,5, mức pH hồ bão hòa mà Richards (1954) dùng để nhận diện đất kiềm natri (FAO Soils Bulletin 39, mục 4.1). Riêng pH chưa đủ kết luận đất nhiễm natri: cần đo ESP hoặc SAR.`,
        ),
      );
    }
  }

  // 4. Leaching requirement (FAO 29, equation 9) and the depth of water to apply (equation 7).
  let leachingFraction: number | null = null;
  let leachingPercent: number | null = null;
  let appliedMmPer100MmEt: number | null = null;
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
  } else if (cropThresholdEc == null) {
    leachingNote = tx(
      `No salinity threshold is known for ${cropEn}: the crop catalogue holds no salinity class for it. No leaching requirement is computed from an assumed threshold; take the ECe the crop tolerates from FAO Irrigation and Drainage Paper 29, Table 4, and enter it.`,
      `Chưa biết ngưỡng chịu mặn của ${cropVi}: danh mục cây trồng không có lớp chịu mặn cho cây này. Không tính nhu cầu rửa mặn từ một ngưỡng giả định; hãy lấy ECe mà cây chịu được ở Bảng 4 của FAO Irrigation and Drainage Paper 29 rồi nhập vào.`,
    );
  } else {
    const lr = leachingFractionFao29(waterEc, cropThresholdEc);
    if (lr == null) {
      leachingNote = tx(
        `Irrigation water of ${waterEc} dS/m is too saline for ${cropEn} (tolerated ECe ${cropThresholdEc} dS/m): equation (9) of FAO Irrigation and Drainage Paper 29 has no usable answer (5 x ECe - ECw is ${r1(5 * cropThresholdEc - waterEc)} dS/m, or all the water would have to drain). No depth of water is given: blend with fresher water or grow a more tolerant crop.`,
        `Nước tưới ${waterEc} dS/m quá mặn đối với ${cropVi} (ECe chịu được ${cropThresholdEc} dS/m): phương trình (9) của FAO Irrigation and Drainage Paper 29 không cho kết quả dùng được (5 x ECe - ECw bằng ${r1(5 * cropThresholdEc - waterEc)} dS/m, hoặc toàn bộ nước tưới phải thấm thoát). Không đưa ra lượng nước tưới: cần pha với nước ngọt hơn hoặc chọn cây chịu mặn tốt hơn.`,
      );
    } else {
      leachingFraction = r3(lr);
      leachingPercent = r1(lr * 100);
      // FAO 29 equation (7): AW = ET / (1 - LR).
      appliedMmPer100MmEt = Math.round(100 / (1 - lr));
      const basisEn = thresholdIsOfClass
        ? ` The threshold ${cropThresholdEc} dS/m is that of the salinity class of ${cropEn} in the crop catalogue, the level at which yield loss begins; FAO 29 advises the ECe for at least 90 percent yield from its Table 4, which gives a smaller figure.`
        : '';
      const basisVi = thresholdIsOfClass
        ? ` Ngưỡng ${cropThresholdEc} dS/m là ngưỡng của lớp chịu mặn của ${cropVi} trong danh mục cây trồng, mức bắt đầu giảm năng suất; FAO 29 khuyên dùng ECe ứng với ít nhất 90 phần trăm năng suất ở Bảng 4, khi đó con số sẽ nhỏ hơn.`
        : '';
      leachingNote = tx(
        `Leaching requirement LR = ECw / (5 x ECe - ECw) = ${waterEc} / (5 x ${cropThresholdEc} - ${waterEc}) = ${leachingFraction} (${LR_METHOD}). Water to apply AW = ET / (1 - LR) (equation 7): ${appliedMmPer100MmEt} mm for each 100 mm the crop uses.${basisEn}`,
        `Nhu cầu rửa mặn LR = ECw / (5 x ECe - ECw) = ${waterEc} / (5 x ${cropThresholdEc} - ${waterEc}) = ${leachingFraction} (FAO Irrigation and Drainage Paper 29 Rev. 1, Ayers & Westcot 1985, mục 2.4.2, phương trình 9). Lượng nước cần tưới AW = ET / (1 - LR) (phương trình 7): ${appliedMmPer100MmEt} mm cho mỗi 100 mm cây sử dụng.${basisVi}`,
      );
    }
  }

  // 5. Gypsum requirement (FAO 39 section 4.4.1 iii; HB 60 Table 6 and pp. 49-50).
  let gypsumRateRange: [lo: number, hi: number] | null = null;
  let gypsumNote: I18nText;

  if (esp == null) {
    gypsumNote = tx(
      'No gypsum dosage calculated: exchangeable sodium (ESP or SAR) has not been measured. Laboratory soil test required.',
      'Không tính định mức thạch cao: chưa có số đo natri trao đổi (ESP hoặc SAR). Cần phân tích đất tại phòng thí nghiệm.',
    );
  } else if (esp <= SODIC_ESP_PCT) {
    gypsumNote = tx(
      `Exchangeable sodium percentage (${esp}%) does not exceed ${SODIC_ESP_PCT}%, the limit above which a soil is sodic (FAO Soils Bulletin 39, section 4.1). No gypsum dose is computed.`,
      `Tỷ lệ natri trao đổi (${esp}%) không vượt ${SODIC_ESP_PCT}%, giới hạn mà trên đó đất được coi là nhiễm natri (FAO Soils Bulletin 39, mục 4.1). Không tính liều thạch cao.`,
    );
  } else if (cec == null || bulkDensity == null) {
    const missingEn: string[] = [];
    const missingVi: string[] = [];
    if (cec == null) {
      missingEn.push('cation exchange capacity (CEC)');
      missingVi.push('dung tích trao đổi cation (CEC)');
      requiredMeasurements.push(tx('Cation exchange capacity of the soil (CEC in cmol(+)/kg)', 'Dung tích trao đổi cation của đất (CEC tính bằng cmol(+)/kg)'));
    }
    if (bulkDensity == null) {
      missingEn.push('bulk density');
      missingVi.push('dung trọng');
      requiredMeasurements.push(tx('Bulk density of the 0-20 cm layer (g/cm3)', 'Dung trọng lớp đất 0-20 cm (g/cm3)'));
    }
    gypsumNote = tx(
      `The soil is sodic (ESP ${esp}%), but no gypsum dose is given: ${missingEn.join(' and ')} of the field ${missingEn.length > 1 ? 'are' : 'is'} missing, and the dose depends on ${missingEn.length > 1 ? 'them' : 'it'}. Measure first.`,
      `Đất nhiễm natri (ESP ${esp}%), nhưng không đưa ra liều thạch cao: thiếu ${missingVi.join(' và ')} của thửa ruộng, mà liều phụ thuộc vào ${missingVi.length > 1 ? 'các số đó' : 'số đó'}. Cần đo trước.`,
    );
  } else {
    const exact = gypsumRequirementTHa(cec, esp, TARGET_ESP_PCT, bulkDensity, DOSE_DEPTH_M);
    const minRate = r1(exact);
    const maxRate = r1(exact * GYPSUM_FIELD_FACTOR);
    gypsumRateRange = [minRate, maxRate];
    const depthCm = Math.round(DOSE_DEPTH_M * 100);

    gypsumNote = tx(
      `Sodic soil: ${minRate}-${maxRate} t/ha of pure gypsum (CaSO4.2H2O) lowers ESP from ${esp}% to ${TARGET_ESP_PCT}% in the top ${depthCm} cm. Computed as 0.086 x depth ${DOSE_DEPTH_M} m x bulk density ${bulkDensity} t/m3 x CEC ${cec} cmol(+)/kg x ${r1(esp - TARGET_ESP_PCT)} percentage points of ESP = ${minRate} t/ha (0.86 g of gypsum per cmol(+) of sodium: FAO Soils Bulletin 39, section 4.4.1 iii), up to 1.25 times that because the exchange is not complete in the field (USDA Agriculture Handbook 60, pp. 49-50). Work it into the top ${depthCm} cm, then leach.`,
      `Đất nhiễm natri: ${minRate}-${maxRate} tấn/ha thạch cao tinh khiết (CaSO4.2H2O) hạ ESP từ ${esp}% xuống ${TARGET_ESP_PCT}% trong lớp đất ${depthCm} cm trên cùng. Cách tính: 0,086 x độ sâu ${DOSE_DEPTH_M} m x dung trọng ${bulkDensity} t/m3 x CEC ${cec} cmol(+)/kg x ${r1(esp - TARGET_ESP_PCT)} điểm phần trăm ESP = ${minRate} tấn/ha (0,86 g thạch cao cho mỗi cmol(+) natri: FAO Soils Bulletin 39, mục 4.4.1 iii), đến 1,25 lần mức đó vì phản ứng trao đổi ngoài đồng không hoàn toàn (USDA Agriculture Handbook 60, tr. 49-50). Trộn vào lớp đất ${depthCm} cm trên cùng rồi tưới rửa.`,
    );
    caveats.push(
      tx(
        `The gypsum dose uses the bulk density (${bulkDensity} t/m3) and CEC (${cec} cmol(+)/kg) held for this field and a depth of ${depthCm} cm; it is for pure gypsum, so divide by the purity of the product. Confirm with a laboratory gypsum-requirement test before buying.`,
        `Liều thạch cao dùng dung trọng (${bulkDensity} t/m3) và CEC (${cec} cmol(+)/kg) đang có của thửa này và độ sâu ${depthCm} cm; liều tính cho thạch cao tinh khiết nên cần chia cho độ tinh khiết của sản phẩm. Cần kiểm tra tại chỗ bằng phép thử nhu cầu thạch cao ở phòng thí nghiệm trước khi mua.`,
      ),
    );
  }

  // 6. Recommendations and summary.
  const recommendations: I18nText[] = [];
  if (leachingFraction != null && leachingFraction > 0 && appliedMmPer100MmEt != null) {
    recommendations.push(
      tx(
        `Apply ${appliedMmPer100MmEt} mm of irrigation water for each 100 mm the crop uses, so that ${leachingPercent}% of it drains below the root zone and carries the salt with it.`,
        `Tưới ${appliedMmPer100MmEt} mm nước cho mỗi 100 mm cây sử dụng, để ${leachingPercent}% lượng nước đó thấm xuống dưới tầng rễ và mang muối theo.`,
      ),
    );
  }
  if (gypsumRateRange != null) {
    recommendations.push(
      tx(
        `Broadcast ${gypsumRateRange[0]}-${gypsumRateRange[1]} t/ha of gypsum (as pure CaSO4.2H2O) to replace exchangeable sodium with calcium.`,
        `Rải ${gypsumRateRange[0]}-${gypsumRateRange[1]} tấn/ha thạch cao (tính theo CaSO4.2H2O tinh khiết) để thay natri trao đổi bằng canxi.`,
      ),
    );
  }
  if (requiredMeasurements.length > 0) {
    recommendations.push(
      tx(
        `Measure first, before any chemical amendment: ${requiredMeasurements.map((m) => m.en).join('; ')}.`,
        `Cần đo trước, trước mọi biện pháp cải tạo hóa học: ${requiredMeasurements.map((m) => m.vi).join('; ')}.`,
      ),
    );
  }

  const salinityLabel = SALINITY_LABEL[salinityStatus];
  const sodicityLabel = SODICITY_LABEL[sodicityStatus];
  const lrEn = leachingPercent != null ? `Leaching requirement: ${leachingPercent}%.` : 'Leaching requirement not computed.';
  const lrVi = leachingPercent != null ? `Nhu cầu rửa mặn: ${leachingPercent}%.` : 'Chưa tính được nhu cầu rửa mặn.';
  const gypEn = gypsumRateRange != null ? ` Gypsum: ${gypsumRateRange[0]}-${gypsumRateRange[1]} t/ha.` : '';
  const gypVi = gypsumRateRange != null ? ` Thạch cao: ${gypsumRateRange[0]}-${gypsumRateRange[1]} tấn/ha.` : '';
  const summary = tx(
    `Salinity: ${salinityLabel.en}. Sodicity: ${sodicityLabel.en}. ${lrEn}${gypEn}`,
    `Độ mặn: ${salinityLabel.vi}. Natri trao đổi: ${sodicityLabel.vi}. ${lrVi}${gypVi}`,
  );

  return {
    salinityStatus,
    sodicityStatus,
    salinityLabel,
    sodicityLabel,
    soilEcDsM: soilEc,
    waterEcDsM: waterEc,
    sar,
    espPct: esp,
    leaching: {
      cropThresholdEcDsM: cropThresholdEc,
      waterEcDsM: waterEc,
      leachingFraction,
      leachingPercent,
      appliedMmPer100MmEt,
      method: LR_METHOD,
      note: leachingNote,
    },
    gypsum: {
      initialEspPct: esp,
      targetEspPct: TARGET_ESP_PCT,
      sar,
      cecCmolKg: cec,
      bulkDensityTM3: bulkDensity,
      depthM: DOSE_DEPTH_M,
      rateRangeTHa: gypsumRateRange,
      method: GYPSUM_METHOD,
      note: gypsumNote,
    },
    requiredMeasurements,
    summary,
    recommendations,
    caveats,
    needsLocalReview: true,
  };
}
