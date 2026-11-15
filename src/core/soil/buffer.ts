import type { I18nText, ModelInput, PhPlan, TextureClass } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { classifyReferenceSoilType } from './reference';
import type { ReferenceSoilType } from './types';

/**
 * Buffer factors: metric tonnes of pure CaCO3 equivalent per hectare per 1.0 pH unit
 * in the top ~20 cm root zone.
 *
 * Sources:
 * - McLean, E.O. (1982). Chemical and microbiological properties: Soil pH and lime requirement.
 *   Agronomy Monograph 9, ASA-SSSA.
 * - USDA NRCS (2014). National Soil Survey Handbook (NSSH) §618.45 Lime Requirement.
 * - University of California ANR / Purdue University Extension Soil Fertility Guidelines.
 */
export const LIME_BUFFER_FACTORS: Record<ReferenceSoilType, [lo: number, hi: number]> = {
  Sandy: [1.2, 2.5],
  Loamy: [2.5, 4.5],
  Silty: [2.8, 4.8],
  Clay: [4.5, 7.5],
  'Peat / Organic': [5.0, 9.0],
  'Chalky / Calcareous': [0, 0], // Naturally saturated with carbonates
};

export const SULFUR_BUFFER_FACTORS: Record<ReferenceSoilType, [lo: number, hi: number] | null> = {
  Sandy: [0.3, 0.7],
  Loamy: [0.6, 1.2],
  Silty: [0.7, 1.3],
  Clay: [1.2, 2.2],
  'Peat / Organic': [1.0, 2.5],
  'Chalky / Calcareous': null, // Calcareous soils buffer acidification; uneconomic
};

const SOIL_TYPE_VI: Record<ReferenceSoilType, string> = {
  Sandy: 'cát',
  Loamy: 'thịt',
  Silty: 'thịt limon',
  Clay: 'sét',
  'Peat / Organic': 'than bùn / hữu cơ',
  'Chalky / Calcareous': 'đá vôi / kiềm tính',
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export function findFact(t: ModelInput['telemetry'], key: string) {
  for (const b of Object.values(t.branches)) {
    const f = b?.facts.find((x) => x.key === key);
    if (f && f.value != null) return f;
  }
  return undefined;
}

export function factNum(t: ModelInput['telemetry'], key: string): number | null {
  const v = findFact(t, key)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Calculates a buffer-capacity-adjusted pH amendment plan (lime or sulfur).
 * Conforms to `PhPlan` interface from `src/contracts/advisory.ts`.
 */
export function calculateBufferPhPlan(input: ModelInput): PhPlan | undefined {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const measured = input.groundTruth.ph;
  const phFact = findFact(t, 'ph');
  const current = measured ?? (typeof phFact?.value === 'number' ? phFact.value : null);

  if (!c || current == null || c.flags?.includes('ph-missing')) return undefined;

  const [, lo, hi] = c.req.ph;
  const textureClass = input.groundTruth.texture ?? (findFact(t, 'texture_class')?.value as TextureClass | undefined);
  const usdaTexture = findFact(t, 'usda_texture')?.value as string | undefined;
  const socGkg = factNum(t, 'soc_gkg');
  const cec = factNum(t, 'cec_cmolkg');
  const clay = factNum(t, 'clay_pct');

  const refType = classifyReferenceSoilType(textureClass, usdaTexture, current, socGkg);
  const soilSrc = phFact?.sourceId ? (t.sources[phFact.sourceId]?.name ?? phFact.sourceId) : 'soil map';

  const caveats: I18nText[] = [
    tx(
      'Indicative buffer-based estimate: confirm with a laboratory buffer-pH test (SMP or Woodruff) before purchasing bulk amendments.',
      'Ước tính dựa trên đệm đất: cần xác nhận lại bằng phân tích pH đệm (SMP hoặc Woodruff) tại phòng thí nghiệm trước khi mua vật tư.',
    ),
  ];

  if (measured == null) {
    caveats.push(
      tx(
        `Current pH is an estimate from satellite/soil maps (${soilSrc}), not measured on-site.`,
        `pH hiện tại là ước tính từ bản đồ (${soilSrc}), chưa phải số đo trực tiếp tại ruộng.`,
      ),
    );
  }

  // Case 1: Soil is more acidic than crop's optimal minimum
  if (current < lo) {
    const target = r1(Math.min(hi, lo + 0.3));
    const targetDelta = target - current;

    // Uncertainty interval of pH if available
    const uncert = measured == null && Array.isArray(phFact?.uncertainty) ? phFact.uncertainty : null;
    const [bLo, bHi] = LIME_BUFFER_FACTORS[refType];

    // If dynamic CEC or clay is available, refine buffer factor
    let effBLo = bLo;
    let effBHi = bHi;
    if (cec != null && cec > 0) {
      const cecFactor = 0.12 * cec + 0.8;
      effBLo = Math.min(bLo, r1(cecFactor * 0.85));
      effBHi = Math.max(bHi, r1(cecFactor * 1.15));
    } else if (clay != null && clay > 0) {
      const clayFactor = 0.06 * clay + 1.2;
      effBLo = Math.min(bLo, r1(clayFactor * 0.85));
      effBHi = Math.max(bHi, r1(clayFactor * 1.15));
    }

    let minRate: number;
    let maxRate: number;

    if (uncert && uncert.length === 2) {
      // uncert[0] is 5th percentile (more acidic), uncert[1] is 95th percentile
      const deltaMax = Math.max(0.2, target - uncert[0]);
      const deltaMin = Math.max(0.1, target - uncert[1]);
      minRate = r1(Math.min(deltaMin, targetDelta) * effBLo);
      maxRate = r1(Math.max(deltaMax, targetDelta) * effBHi);
    } else {
      minRate = r1(targetDelta * effBLo);
      maxRate = r1(targetDelta * effBHi);
    }

    // Safety checks
    if (minRate < 0.2) minRate = 0.2;
    if (maxRate < minRate) maxRate = r1(minRate * 1.4);

    caveats.push(
      tx(
        'Apply agricultural limestone (CaCO3) or dolomite 1-3 months before planting and incorporate into top 15-20 cm. Split applications if rate exceeds 4.0 t/ha.',
        'Bón vôi nông nghiệp (CaCO3) hoặc dolomite 1-3 tháng trước vụ gieo trồng và cày xới sâu 15-20 cm. Nếu liều vượt quá 4,0 t/ha nên chia làm hai đợt.',
      ),
    );

    return {
      current,
      target,
      amendment: 'lime',
      rateTHa: [minRate, maxRate],
      basis: tx(
        `${c.names.en} prefers pH ${lo}-${hi}. Soil is ${refType} (buffering capacity: ${effBLo}-${effBHi} t CaCO3/ha/pH). Lime rate scales with clay/CEC buffer capacity (McLean 1982, USDA NRCS).`,
        `${c.names.vi ?? c.names.en} thích hợp nhất ở pH ${lo}-${hi}. Đất thuộc nhóm ${SOIL_TYPE_VI[refType]} (khả năng đệm: ${effBLo}-${effBHi} tấn CaCO3/ha/đơn vị pH). Liều lượng tính theo dung tích đệm của sét và CEC (McLean 1982, USDA NRCS).`,
      ),
      caveats,
    };
  }

  // Case 2: Soil is more alkaline than crop's optimal maximum
  if (current > hi) {
    const target = r1(Math.max(lo, hi - 0.3));
    const targetDelta = current - target;
    const isCalcareous = current >= 7.5 || refType === 'Chalky / Calcareous';

    const sFactors = SULFUR_BUFFER_FACTORS[refType];

    if (isCalcareous || !sFactors) {
      caveats.push(
        tx(
          `At pH ${current}, the soil is calcareous with high free calcium carbonate buffering. Lowering pH with elemental sulfur is slow, unpredictable, and economically unviable. Prioritize tolerant varieties or acid-forming fertilizers (e.g., ammonium sulfate) rather than broadcast sulfur.`,
          `Ở pH ${current}, đất mang tính kiềm vôi với lượng canxi cacbonat tự do cao. Việc hạ pH bằng lưu huỳnh rất chậm, khó lường và không hiệu quả về mặt kinh tế. Nên ưu tiên chọn giống cây chịu kiềm hoặc dùng phân bón có gốc axit hóa (như amoni sunfat) thay vì rải lưu huỳnh toàn diện.`,
        ),
      );
      return {
        current,
        target,
        amendment: 'sulfur',
        rateTHa: null,
        basis: tx(
          `Soil pH (${current}) exceeds optimal ceiling (${hi}) for ${c.names.en}. Due to high calcareous buffering, no reliable blanket rate can be recommended without laboratory titrations.`,
          `pH đất (${current}) cao hơn ngưỡng tối ưu (${hi}) của ${c.names.vi ?? c.names.en}. Do tính đệm kiềm vôi cao, không đưa ra định mức đại trà khi chưa có chuẩn độ phòng thí nghiệm.`,
        ),
        caveats,
      };
    }

    const minRate = r1(targetDelta * sFactors[0]);
    const maxRate = r1(targetDelta * sFactors[1]);

    caveats.push(
      tx(
        'Elemental sulfur requires microbial oxidation (warm, moist, aerated conditions) taking 3-6 months. Do not exceed 1.5 t/ha in a single application.',
        'Lưu huỳnh nguyên tố cần vi sinh vật oxy hóa (điều kiện ấm, ẩm, thoáng khí) kéo dài 3-6 tháng. Không bón quá 1,5 t/ha trong một lần.',
      ),
    );

    return {
      current,
      target,
      amendment: 'sulfur',
      rateTHa: [minRate, maxRate],
      basis: tx(
        `${c.names.en} prefers pH ${lo}-${hi}. Soil is ${refType}. Elemental sulfur rate is adjusted for soil texture buffering (UC ANR guidelines).`,
        `${c.names.vi ?? c.names.en} phát triển tốt nhất ở pH ${lo}-${hi}. Đất thuộc nhóm ${SOIL_TYPE_VI[refType]}. Định mức lưu huỳnh nguyên tố được điều chỉnh theo độ đệm cơ giới đất (hướng dẫn UC ANR).`,
      ),
      caveats,
    };
  }

  // Case 3: pH is inside optimal window
  return {
    current,
    target: current,
    amendment: 'none',
    rateTHa: null,
    basis: tx(
      `pH ${current} is inside the ${lo}-${hi} optimal range for ${c.names.en}. No pH amendment is needed.`,
      `pH ${current} nằm trọn trong khoảng tối ưu ${lo}-${hi} của ${c.names.vi ?? c.names.en}. Không cần bón chất điều hòa pH.`,
    ),
    caveats,
  };
}

