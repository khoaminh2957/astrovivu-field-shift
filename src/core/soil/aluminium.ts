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
  measured?: { exchAlCmolKg?: number; ececCmolKg?: number },
): AluminiumDiagnosis {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const gt = input.groundTruth as { ph?: number; exchAlCmolKg?: number };

  const currentPh = gt.ph ?? factNum(t, 'ph');
  const ecec = measured?.ececCmolKg ?? (factNum(t, 'ecec_cmolkg') ?? null);
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
  if (ecec == null || ecec <= 0) {
    const recommendations = [
      tx(
        'Measure effective CEC (ECEC: exchangeable bases plus exchangeable acidity) before interpreting aluminum saturation or applying lime.',
        'Đo CEC hiệu dụng (ECEC: tổng cation bazơ trao đổi và độ chua trao đổi) trước khi diễn giải độ bão hòa nhôm hoặc bón vôi.',
      ),
    ];
    return {
      status: 'unknown',
      currentPh,
      exchAlCmolKg: exchAl,
      alSaturationPct: null,
      cropTolerance,
      limeRequirementTHa: null,
      method: 'Kamprath (1970) — ECEC measurement required',
      summary: tx(
        `Exchangeable aluminum is ${exchAl} cmol(+)/kg, but ECEC is not available; aluminum saturation and lime rate are not calculated.`,
        `Nhôm trao đổi là ${exchAl} cmol(+)/kg nhưng chưa có ECEC; không tính độ bão hòa nhôm và liều vôi.`,
      ),
      recommendations,
      caveats,
      needsLocalReview: true,
    };
  }

  // Calculate Al saturation against measured ECEC, never total CEC.
  const alSaturationPct = r1((exchAl / ecec) * 100);

  // Lime Requirement based on Kamprath (1970), Soil Sci. Soc. Am. Proc. 34: 252-254.
  // LR = f * exchAl (cmol/kg), where f = 1.5 (mineral soils) to 2.0 (high organic matter / buffer).
  const minRate = r1(1.5 * exchAl);
  const maxRate = r1(2.0 * exchAl);

  const status: AluminiumStatus = cropTolerance.absMaxPct == null
    ? 'unknown'
    : alSaturationPct > cropTolerance.absMaxPct
      ? 'toxic'
      : alSaturationPct > cropTolerance.optMaxPct!
        ? 'potential_risk'
        : 'safe';

  const recommendations: I18nText[] = status === 'safe'
    ? [tx('No aluminum-driven lime recommendation is made at the measured saturation.', 'Không khuyến nghị bón vôi để xử lý nhôm ở mức bão hòa đã đo được.')]
    : status === 'unknown'
      ? [tx('No lime rate is reported because the crop has no published aluminum tolerance threshold.', 'Không đưa ra liều vôi vì cây chưa có ngưỡng chịu nhôm được công bố.')]
      : [tx(
          `Apply ${minRate}-${maxRate} t/ha agricultural limestone (CaCO3 equivalent) to reduce exchangeable aluminum risk.`,
          `Bón ${minRate}-${maxRate} tấn/ha vôi nông nghiệp (CaCO3 tương đương) để giảm nguy cơ nhôm trao đổi.`,
        )];

  if (status !== 'safe' && status !== 'unknown' && maxRate > 4.0) {
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
    limeRequirementTHa: status === 'safe' || status === 'unknown' ? null : [minRate, maxRate],
    method: 'Kamprath (1970), SSSA Proc. 34: 252-254; Cochrane et al. (1980), Trop. Agric. 57: 133-140',
    summary,
    recommendations,
    caveats,
    needsLocalReview: true,
  };
}

