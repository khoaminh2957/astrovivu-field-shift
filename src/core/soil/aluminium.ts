import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { factNum } from './buffer';

export type AluminiumStatus = 'safe' | 'potential_risk' | 'toxic' | 'unknown';

export interface AluminiumCropTolerance {
  hasData: boolean;
  optMaxPct: number | null;
  absMaxPct: number | null;
  note: I18nText;
}

export interface AluminiumDiagnosis {
  status: AluminiumStatus;
  currentPh: number | null;
  exchAlCmolKg: number | null;
  alSaturationPct: number | null;
  cropTolerance: AluminiumCropTolerance;
  limeRequirementTHa: [lo: number, hi: number] | null;
  method: string;
  summary: I18nText;
  recommendations: I18nText[];
  caveats: I18nText[];
  needsLocalReview: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Known published critical aluminum saturation thresholds (% of ECEC).
 * In accordance with Issue #46, species without curated published thresholds
 * are NOT guessed or inferred from other crops.
 */
const CROP_AL_SATURATION_TOLERANCE: Record<string, { optMax: number; absMax: number }> = {
  // Source: Cochrane, Salinas and Sanchez (1980), Tropical Agriculture 57: 133-140;
  // Sanchez, P.A. (2019) Properties and Management of Soils in the Tropics.
  'manihot-esculenta': { optMax: 60, absMax: 80 }, // Cassava (highly Al-tolerant)
  'ananas-comosus': { optMax: 50, absMax: 70 },    // Pineapple
  'vigna-unguiculata': { optMax: 25, absMax: 45 }, // Cowpea
};

/**
 * Evaluates aluminum toxicity risk on acid soils and calculates lime requirement
 * based on exchangeable aluminum (Kamprath 1970; Cochrane et al. 1980).
 *
 * @param input Pure ModelInput of the field and crop
 * @param measured Optional diagnostic measurements (e.g., from on-site laboratory testing)
 */
export function aluminiumRisk(
  input: ModelInput,
  measured?: { exchAlCmolKg?: number },
): AluminiumDiagnosis {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const gt = input.groundTruth as { ph?: number; exchAlCmolKg?: number };

  const currentPh = gt.ph ?? factNum(t, 'ph');
  const cec = factNum(t, 'cec_cmolkg') ?? 15.0;
  const exchAl = measured?.exchAlCmolKg ?? gt.exchAlCmolKg ?? null;

  // 1. Evaluate Crop Tolerance Data
  const cropAlData = c ? CROP_AL_SATURATION_TOLERANCE[c.id] : undefined;
  let cropTolerance: AluminiumCropTolerance;

  if (cropAlData) {
    cropTolerance = {
      hasData: true,
      optMaxPct: cropAlData.optMax,
      absMaxPct: cropAlData.absMax,
      note: tx(
        `${c?.names.en} tolerates up to ${cropAlData.absMax}% aluminum saturation (optimal below ${cropAlData.optMax}%). (Cochrane et al. 1980).`,
        `${c?.names.vi ?? c?.names.en} chịu được độ bão hòa nhôm tối đa ${cropAlData.absMax}% (tối ưu dưới ${cropAlData.optMax}%). (Cochrane et al. 1980).`,
      ),
    };
  } else {
    cropTolerance = {
      hasData: false,
      optMaxPct: null,
      absMaxPct: null,
      note: tx(
        `No published aluminum saturation tolerance threshold available for ${c ? c.names.en : 'selected crop'}. Values are not inferred from other crops.`,
        `Chưa có số liệu ngưỡng chịu độc nhôm công bố cho ${c ? (c.names.vi ?? c.names.en) : 'cây trồng này'}. Không tự suy diễn từ cây khác.`,
      ),
    };
  }

  // Common caveats
  const caveats: I18nText[] = [
    tx(
      'Indicative estimate: on-site verification with laboratory soil testing (1M KCl extract) is required.',
      'Ước tính định hướng: cần kiểm tra tại chỗ bằng phân tích đất phòng thí nghiệm (trích ly 1M KCl).',
    ),
  ];

  // 2. Case: No measured exchangeable aluminum
  if (exchAl == null) {
    const isAcidic = currentPh != null && currentPh < 5.5;
    const isStronglyAcidic = currentPh != null && currentPh < 5.0;

    // Requirement 2: When no measurement is provided, status is strictly 'unknown'
    const status: AluminiumStatus = 'unknown';

    const recommendations: I18nText[] = [
      tx(
        'Submit a composite topsoil sample (0-20 cm) for 1M KCl-extractable exchangeable aluminum (Al3+) laboratory analysis.',
        'Lấy mẫu đất hỗn hợp tầng mặt (0-20 cm) gửi phòng phân tích để đo nhôm trao đổi (Al3+ trích ly bằng 1M KCl).',
      ),
    ];

    let summary: I18nText;
    if (isStronglyAcidic || isAcidic) {
      summary = tx(
        `Soil pH is acidic (${currentPh}): potential aluminum toxicity risk. Soluble Al3+ hydrolyzes below pH 5.5. Exchangeable aluminum measurement is required.`,
        `pH đất chua (${currentPh}): có thể có nguy cơ độc nhôm. Al3+ dễ bị giải phóng dưới pH 5,5. Cần đo nhôm trao đổi.`,
      );
      caveats.push(
        tx(
          'Acid soils below pH 5.5 may exhibit aluminum-induced root stunting and phosphorus fixation.',
          'Đất chua dưới pH 5,5 có thể có nguy cơ làm rễ bị chùn đầu và cố định lân do độc nhôm.',
        ),
      );
    } else {
      summary = tx(
        `Exchangeable aluminum data is not recorded. At pH ${currentPh ?? 'unknown'}, aluminum solubility is generally suppressed, but laboratory verification is recommended if acidifying.`,
        `Chưa có số đo nhôm trao đổi. Ở pH ${currentPh ?? 'chưa rõ'}, độ hòa tan của nhôm thường bị ức chế, nhưng vẫn nên phân tích nếu đất có xu hướng chua hóa.`,
      );
    }

    return {
      status,
      currentPh,
      exchAlCmolKg: null,
      alSaturationPct: null,
      cropTolerance,
      limeRequirementTHa: null,
      method: 'Kamprath (1970) / Cochrane et al. (1980) — requires measured exchAl',
      summary,
      recommendations,
      caveats,
      needsLocalReview: true,
    };
  }

  // 3. Case: Measured exchangeable aluminum is available
  // Calculate effective cation exchange capacity (ECEC) and Al saturation
  const effectiveCec = Math.max(exchAl, cec);
  const alSaturationPct = r1((exchAl / effectiveCec) * 100);

  // Lime Requirement based on Kamprath (1970), Soil Sci. Soc. Am. Proc. 34: 252-254.
  // LR = f * exchAl (cmol/kg), where f = 1.5 (mineral soils) to 2.0 (high organic matter / buffer).
  const minRate = r1(1.5 * exchAl);
  const maxRate = r1(2.0 * exchAl);

  const status: AluminiumStatus = alSaturationPct >= 20 || (currentPh != null && currentPh < 5.0) ? 'toxic' : 'safe';

  const recommendations: I18nText[] = [
    tx(
      `Apply ${minRate}-${maxRate} t/ha agricultural limestone (CaCO3 equivalent) to precipitate exchangeable Al3+ into non-toxic Al(OH)3.`,
      `Bón ${minRate}-${maxRate} tấn/ha vôi nông nghiệp (CaCO3 tương đương) để kết tủa Al3+ thành Al(OH)3 không độc.`,
    ),
  ];

  if (maxRate > 4.0) {
    recommendations.push(
      tx(
        'Split the total lime rate over two seasonal applications (max 3.5-4.0 t/ha per application) to avoid micronutrient lock-up.',
        'Chia lượng vôi làm hai vụ bón (tối đa 3,5-4,0 tấn/ha mỗi lần) để tránh cố định vi lượng.',
      ),
    );
  }

  const summary = tx(
    `Measured exchangeable aluminum is ${exchAl} cmol(+)/kg (Al saturation: ${alSaturationPct}% of ECEC). Lime rate of ${minRate}-${maxRate} t/ha calculated to neutralize toxic aluminum (Kamprath 1970).`,
    `Nhôm trao đổi đo được là ${exchAl} cmol(+)/kg (độ bão hòa nhôm: ${alSaturationPct}% ECEC). Liều vôi khử độc nhôm tính theo Kamprath (1970) là ${minRate}-${maxRate} tấn/ha.`,
  );

  return {
    status,
    currentPh,
    exchAlCmolKg: exchAl,
    alSaturationPct,
    cropTolerance,
    limeRequirementTHa: [minRate, maxRate],
    method: 'Kamprath (1970), SSSA Proc. 34: 252-254; Cochrane et al. (1980), Trop. Agric. 57: 133-140',
    summary,
    recommendations,
    caveats,
    needsLocalReview: true,
  };
}

