import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { DOSE_DEPTH_M, soilMassTHa } from './mass';

export interface NutrientRemovalRate {
  /** Removal rate per metric ton of harvested crop (kg nutrient / t product). */
  perTonKg: [min: number, max: number];
  /** Total removal budget range for the target yield (kg nutrient / ha). */
  totalKgHa: [min: number, max: number];
  unit: 'kg/ha';
  note?: I18nText;
}

export interface CropNutrientRemovalBudget {
  cropId: string;
  cropName: I18nText;
  /** Target yield in tonnes per hectare (t/ha). */
  targetYieldTHa: number;
  /** Nitrogen removal budget (kg N/ha). */
  nitrogen: NutrientRemovalRate;
  /** Phosphate removal budget (kg P₂O₅/ha). */
  phosphateP2O5: NutrientRemovalRate;
  /** Potash removal budget (kg K₂O/ha). */
  potashK2O: NutrientRemovalRate;
  /** Estimated topsoil total nitrogen stock in kg N/ha, if soil data has total nitrogen. */
  soilNitrogenStockKgHa: number | null;
  /** Estimated seasonal mineralized available N (1–3% of organic total N stock per year). */
  seasonalEstimatedMineralizedNKgHa: [min: number, max: number] | null;
  /** Literature reference citation. */
  citation: string;
  /** Important agronomic caveats and diagnostic notices. */
  caveats: I18nText[];
}

interface CropRemovalFactors {
  n: [number, number];
  p2o5: [number, number];
  k2o: [number, number];
  defaultYieldTHa: number;
  isLegume?: boolean;
}

/**
 * Standard nutrient removal rates (kg nutrient per tonne of harvested yield)
 * from International Plant Nutrition Institute (IPNI, 2014) and IFA/FAO (2002).
 */
export const NUTRIENT_REMOVAL_COEFFICIENTS: Record<string, CropRemovalFactors> = {
  // Maize / Corn grain
  'zea-mays': { n: [21, 25], p2o5: [8, 10], k2o: [18, 24], defaultYieldTHa: 8.0 },
  maize: { n: [21, 25], p2o5: [8, 10], k2o: [18, 24], defaultYieldTHa: 8.0 },
  corn: { n: [21, 25], p2o5: [8, 10], k2o: [18, 24], defaultYieldTHa: 8.0 },

  // Paddy Rice grain
  'oryza-sativa': { n: [16, 20], p2o5: [7, 9], k2o: [20, 28], defaultYieldTHa: 6.0 },
  rice: { n: [16, 20], p2o5: [7, 9], k2o: [20, 28], defaultYieldTHa: 6.0 },

  // Soybean seed (legume)
  'glycine-max': { n: [55, 65], p2o5: [13, 17], k2o: [25, 35], defaultYieldTHa: 3.5, isLegume: true },
  soybean: { n: [55, 65], p2o5: [13, 17], k2o: [25, 35], defaultYieldTHa: 3.5, isLegume: true },

  // Coffee green beans
  'coffea-canephora': { n: [30, 40], p2o5: [6, 8], k2o: [35, 50], defaultYieldTHa: 2.5 },
  'coffea-arabica': { n: [30, 40], p2o5: [6, 8], k2o: [35, 50], defaultYieldTHa: 2.0 },
  coffee: { n: [30, 40], p2o5: [6, 8], k2o: [35, 50], defaultYieldTHa: 2.5 },

  // Alfalfa dry hay (legume forage)
  'medicago-sativa': { n: [26, 30], p2o5: [6, 7], k2o: [24, 28], defaultYieldTHa: 10.0, isLegume: true },
  alfalfa: { n: [26, 30], p2o5: [6, 7], k2o: [24, 28], defaultYieldTHa: 10.0, isLegume: true },

  // Wheat grain
  'triticum-aestivum': { n: [24, 28], p2o5: [9, 11], k2o: [18, 22], defaultYieldTHa: 5.0 },
  wheat: { n: [24, 28], p2o5: [9, 11], k2o: [18, 22], defaultYieldTHa: 5.0 },
};

const DEFAULT_REMOVAL: CropRemovalFactors = {
  n: [20, 26],
  p2o5: [7, 10],
  k2o: [18, 26],
  defaultYieldTHa: 4.0,
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Computes N, P, K crop nutrient removal budgets based on target harvest yield
 * and compares with available topsoil nitrogen stocks (Issue #49 / S8).
 */
export function cropNutrientRemoval(
  input: ModelInput,
  options?: { targetYieldTHa?: number }
): CropNutrientRemovalBudget {
  const cropId = input.cropId ?? 'unknown';
  const crop = input.cropId ? getCrop(input.cropId) : undefined;
  const cropKey = cropId.toLowerCase();
  const factors = NUTRIENT_REMOVAL_COEFFICIENTS[cropKey] ?? DEFAULT_REMOVAL;
  const isLegume = Boolean(factors.isLegume);

  const targetYieldTHa = options?.targetYieldTHa ?? factors.defaultYieldTHa;
  const cropName = crop ? tx(crop.names.en, crop.names.vi ?? crop.names.en) : tx(cropId, cropId);

  // Compute removal amounts
  const nTotal: [number, number] = [
    r1(factors.n[0] * targetYieldTHa),
    r1(factors.n[1] * targetYieldTHa),
  ];
  const pTotal: [number, number] = [
    r1(factors.p2o5[0] * targetYieldTHa),
    r1(factors.p2o5[1] * targetYieldTHa),
  ];
  const kTotal: [number, number] = [
    r1(factors.k2o[0] * targetYieldTHa),
    r1(factors.k2o[1] * targetYieldTHa),
  ];

  // Soil nitrogen estimation from facts
  const facts = input.telemetry.branches.soil?.facts ?? [];
  const nitrogenFact = facts.find((f) => f.key === 'nitrogen_gkg');
  const bdFact = facts.find((f) => f.key === 'bulk_density' || f.key === 'bdod');

  let soilNitrogenStockKgHa: number | null = null;
  let seasonalEstimatedMineralizedNKgHa: [number, number] | null = null;

  if (typeof nitrogenFact?.value === 'number') {
    let bdVal = typeof bdFact?.value === 'number' ? bdFact.value : 1.3;
    if (bdVal > 10) bdVal = bdVal / 100;

    const soilMass = soilMassTHa(DOSE_DEPTH_M, bdVal);
    // 1 g/kg = 1 kg/t; total N (kg/ha) = nitrogen_gkg * soilMass
    const stock = r1(nitrogenFact.value * soilMass);
    soilNitrogenStockKgHa = stock;
    // Typical annual mineralisation of total organic N is 1% to 3%
    seasonalEstimatedMineralizedNKgHa = [r1(stock * 0.01), r1(stock * 0.03)];
  }

  const caveats: I18nText[] = [
    tx(
      'Phosphorus and potassium fertilizer doses cannot be calculated without an on-farm soil test (e.g. Olsen P, Bray-1 P, or exchangeable K). Only total crop removal is reported to guide nutrient replenishment.',
      'Không thể tính liều phân bón lân (P₂O₅) và kali (K₂O) cụ thể khi chưa có kết quả phân tích đất tại chỗ (Olsen P, Bray-1 P, hoặc K trao đổi). Báo cáo chỉ nêu lượng lấy đi để bù đắp dinh dưỡng.'
    ),
  ];

  if (isLegume) {
    caveats.push(
      tx(
        'As a legume crop, approximately 50–70% of nitrogen needs are typically supplied via symbiotic atmospheric N₂ fixation by root-nodule rhizobia bacteria.',
        'Là cây họ đậu, khoảng 50–70% nhu cầu đạm thường được cung cấp thông qua cố định đạm sinh học nhờ vi khuẩn nốt sần rhizobia.'
      )
    );
  }

  caveats.push(
    tx(
      'Potassium removal depends heavily on residue management: leaving straw/residue in the field recycles 70–80% of crop potassium, whereas full removal depletes soil reserves rapidly.',
      'Lượng kali thực tế lấy đi phụ thuộc lớn vào việc quản lý tàn dư: giữ rơm rạ trên ruộng giúp hoàn trả 70–80% lượng kali, còn thu gom toàn bộ sẽ làm cạn kiệt kali nhanh chóng.'
    )
  );

  return {
    cropId,
    cropName,
    targetYieldTHa,
    nitrogen: {
      perTonKg: factors.n,
      totalKgHa: nTotal,
      unit: 'kg/ha',
      note: isLegume
        ? tx('Includes biological N fixation and soil uptake', 'Bao gồm cả đạm cố định sinh học và hút từ đất')
        : tx('Total crop uptake & removal', 'Tổng lượng cây hút và lấy đi'),
    },
    phosphateP2O5: {
      perTonKg: factors.p2o5,
      totalKgHa: pTotal,
      unit: 'kg/ha',
    },
    potashK2O: {
      perTonKg: factors.k2o,
      totalKgHa: kTotal,
      unit: 'kg/ha',
    },
    soilNitrogenStockKgHa,
    seasonalEstimatedMineralizedNKgHa,
    citation: 'IPNI (2014) Nutrient Removal by Crops; IFA/FAO (2002) Fertilizer Use by Crop.',
    caveats,
  };
}
