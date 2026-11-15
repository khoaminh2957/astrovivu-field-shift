import type { GroundTruth, I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { computeScoreTimeline } from '@/core/scoring';
import { diagnoseSoil } from './diagnosis';
import { soilPlan } from './plan';
import type { SoilDiagnosis, SoilPlan } from './types';

export interface SoilAnswerOptions {
  cropId?: string;
  groundTruth?: Partial<GroundTruth>;
}

export interface SoilAnswerResult {
  diagnosis: SoilDiagnosis | null;
  plan: SoilPlan;
  summary: I18nText[];
}

/**
 * Pure entry point for the chatbot (S14 #74 / C2 #31) to answer questions about a field's soil.
 *
 * - `opts.cropId` overrides the parcel's selected crop for this query; `opts.groundTruth` overlays
 *   grower readings mentioned in the user's question (e.g. `ph: 4.8`).
 * - Recomputes `computeScoreTimeline(nextInput)`, `diagnoseSoil(nextInput)`, and `soilPlan(nextInput, score)`.
 * - Returns 3 to 6 short bilingual sentences in `summary` where every number is drawn directly from
 *   `diagnosis` or `plan`, and every sentence carrying a dose states that on-site verification is required.
 * - Pure data return value (JSON-serializable, no functions or `Date` instances).
 */
export function soilAnswer(
  input: ModelInput,
  opts?: SoilAnswerOptions,
): SoilAnswerResult {
  const targetCropId = opts?.cropId !== undefined ? opts.cropId : input.cropId;
  const crop = getCrop(targetCropId);

  if (targetCropId != null && !crop) {
    const emptyPlan: SoilPlan = {
      items: [],
      summary: tx(
        `No soil improvement plan can be built because crop "${targetCropId}" is not in the crop catalogue.`,
        `Không thể lập kế hoạch cải tạo đất vì cây "${targetCropId}" không có trong danh mục dữ liệu.`,
      ),
      mostLimitingFactor: null,
    };
    return {
      diagnosis: null,
      plan: emptyPlan,
      summary: [
        tx(
          `No data is held in the crop catalogue for "${targetCropId}", so soil suitability and amendment rates cannot be evaluated.`,
          `Không có dữ liệu trong danh mục cây trồng cho "${targetCropId}", nên chưa thể đánh giá độ phù hợp đất và liều cải tạo.`,
        ),
      ],
    };
  }

  const nextInput: ModelInput = {
    ...input,
    cropId: targetCropId,
    groundTruth: {
      ...input.groundTruth,
      ...(opts?.groundTruth ?? {}),
    },
  };

  const score = computeScoreTimeline(nextInput);
  const diagnosis = diagnoseSoil(nextInput);
  const plan = soilPlan(nextInput, score);
  const summary: I18nText[] = [];

  const cropEn = crop?.names.en ?? 'the selected crop';
  const cropVi = crop?.names.vi ?? crop?.names.en ?? 'cây đang chọn';

  // 1. Overall suitability and most limiting factor from diagnosis.
  summary.push(diagnosis.summary);

  // 2. Specific reading & target range of the most limiting factor when present.
  if (diagnosis.mostLimitingFactor) {
    summary.push(diagnosis.mostLimitingFactor.note);
  }

  // 3. Actionable amendment steps from the plan (up to 3 items so total summary stays 3-6 sentences).
  const actionItems = plan.items.filter((i) => i.status !== 'no_data').slice(0, 3);
  for (const item of actionItems) {
    if (item.rateRange) {
      const { min, max, unit } = item.rateRange;
      summary.push(
        tx(
          `For ${cropEn}: ${item.action.en} Indicative dose range: ${min}-${max} ${unit} (on-site verification with a laboratory soil test is required).`,
          `Với ${cropVi}: ${item.action.vi} Khoảng liều định hướng: ${min}-${max} ${unit} (cần kiểm tra tại chỗ bằng phân tích đất ở phòng thí nghiệm).`,
        ),
      );
    } else {
      summary.push(
        tx(
          `For ${cropEn}: ${item.title.en} — ${item.action.en}`,
          `Với ${cropVi}: ${item.title.vi} — ${item.action.vi}`,
        ),
      );
    }
  }

  // 4. Summary of steps and missing readings to measure first.
  summary.push(plan.summary);

  // Ensure at least 3 sentences even when no limiting factor and no action items exist.
  if (summary.length < 3) {
    const missing = plan.items.filter((i) => i.status === 'no_data');
    if (missing.length > 0) {
      summary.push(
        tx(
          `Measure before applying amendments: ${missing.map((m) => m.title.en).join('; ')}.`,
          `Đo kiểm tra trước khi bón chất cải tạo: ${missing.map((m) => m.title.vi).join('; ')}.`,
        ),
      );
    } else {
      summary.push(
        tx(
          `All evaluated soil readings for ${cropEn} are within the optimal range.`,
          `Mọi chỉ tiêu đất đã có số đo cho ${cropVi} đều nằm trong khoảng tối ưu.`,
        ),
      );
    }
  }

  return {
    diagnosis,
    plan,
    summary: summary.slice(0, 6),
  };
}
