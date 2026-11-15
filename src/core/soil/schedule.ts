import type { I18nText, ISODate, RotationSeason, RotationStrategy, SoilPlan, SoilPlanItem } from '@/contracts';
import { tx } from '@/contracts';

export interface SoilScheduleEntry {
  year: number;
  month: number;
  requirementId: string;
  /** Fraction of the initial dose applied in this step (sums to 1 for a dosed requirement, 0 for a measurement/recheck-only step). */
  share: number;
  dose: { range: [number, number]; unit: string } | null;
  action: I18nText;
  recheck: I18nText;
  basis: I18nText;
}

/**
 * Citation for splitting large limestone applications (> 4 t/ha) into two applications:
 * Havlin, J.L., Tisdale, S.L., Nelson, W.L., & Beaton, J.D. (2014),
 * "Soil Fertility and Fertilizers: An Introduction to Nutrient Management" (8th ed., Pearson),
 * Chapter 3 "Soil Acidity and Alkalinity", p. 68; see also `phPlan` in `src/core/advisory/actions.ts`.
 */
export const LIME_SPLIT_THRESHOLD_T_HA = 4.0;
export const LIME_SPLIT_CITATION: I18nText = tx(
  'Havlin et al. (2014), Soil Fertility and Fertilizers (8th ed., Pearson), Ch. 3, p. 68: split lime rates above 4 t/ha across two seasons/years so that lime is mixed into the root zone without over-liming the surface layer. Consult a local extension advisor on splitting the dose.',
  'Havlin và cs. (2014), Soil Fertility and Fertilizers (ấn bản 8, Pearson), Chương 3, tr. 68: chia liều vôi trên 4 tấn/ha thành hai vụ/năm để trộn đều vào vùng rễ và tránh nâng pH cục bộ tầng mặt. Hỏi cán bộ khuyến nông về việc chia liều.',
);

const r2 = (v: number): number => Math.round(v * 100) / 100;

function parseIsoYearMonth(today: ISODate): { year: number; month: number } {
  const parts = today.split('-');
  const year = Number(parts[0]) || 2026;
  const month = Math.min(12, Math.max(1, Number(parts[1]) || 1));
  return { year, month };
}

function isPerennialRotation(seasons: RotationSeason[]): boolean {
  const planted = seasons.filter((s) => s.cropId !== 'fallow');
  if (planted.length === 0) return true;
  return planted.every((s) => s.startMonth === 1 && s.endMonth === 12);
}

function preSowingMonth(startMonth: number, leadMonths = 1): number {
  const m = ((startMonth - 1 - leadMonths) % 12 + 12) % 12 + 1;
  return m;
}

function scheduleTimingForStep(
  rotation: RotationStrategy,
  todayYear: number,
  todayMonth: number,
  stepIndex: number,
): { year: number; month: number; nextSowingMonth: number } {
  const planted = rotation.seasons.filter((s) => s.cropId !== 'fallow');
  if (isPerennialRotation(planted)) {
    return {
      year: todayYear + stepIndex,
      month: todayMonth,
      nextSowingMonth: todayMonth,
    };
  }

  const season = planted[stepIndex % planted.length] ?? planted[0]!;
  const startMonth = season.startMonth;
  // Place the amendment 1 month before startMonth (or 2 months before when startMonth > 2 and today is early in the year).
  const applyMonth = startMonth > 1 ? preSowingMonth(startMonth, 1) : 12;
  const firstYearOffset = todayMonth <= applyMonth ? 0 : 1;
  return {
    year: todayYear + firstYearOffset + stepIndex,
    month: applyMonth,
    nextSowingMonth: startMonth,
  };
}

function shouldSplitDose(item: SoilPlanItem): boolean {
  if (!item.rateRange) return false;
  if (item.metric !== 'ph') return false;
  return item.rateRange.max > LIME_SPLIT_THRESHOLD_T_HA;
}

/**
 * Schedules soil improvement and measurement/recheck actions across years and seasons of a rotation.
 *
 * - Pure function of `(plan, rotation, today)`: never reads the system clock.
 * - Lime applications with maximum rate > 4.0 t/ha are split into two steps (`share = 0.5` each)
 *   following Havlin et al. (2014, Ch. 3, p. 68), such that the shares sum to 1 and the low/high
 *   ends of `dose.range` sum to the exact initial `rateRange`.
 * - For annual rotations, applications are scheduled before `startMonth` of the upcoming planted
 *   season; for perennial crops (12-month cycle), applications are anchored to the month of `today`.
 * - Every year covered by the schedule carries at least one recheck entry (`recheck`) while open
 *   requirements exist in `plan.items`.
 */
export function soilSchedule(
  plan: SoilPlan,
  rotation: RotationStrategy,
  today: ISODate,
): SoilScheduleEntry[] {
  if (plan.items.length === 0) return [];

  const { year: todayYear, month: todayMonth } = parseIsoYearMonth(today);
  const entries: SoilScheduleEntry[] = [];
  const coveredYears = new Set<number>();

  for (const item of plan.items) {
    const reqId = item.metric;
    if (item.rateRange) {
      const { min, max, unit } = item.rateRange;
      if (shouldSplitDose(item)) {
        const lo1 = r2(min / 2);
        const hi1 = r2(max / 2);
        const lo2 = r2(min - lo1);
        const hi2 = r2(max - hi1);

        const t0 = scheduleTimingForStep(rotation, todayYear, todayMonth, 0);
        const t1 = scheduleTimingForStep(rotation, todayYear, todayMonth, 1);
        coveredYears.add(t0.year);
        coveredYears.add(t1.year);

        entries.push({
          year: t0.year,
          month: t0.month,
          requirementId: reqId,
          share: 0.5,
          dose: { range: [lo1, hi1], unit },
          action: tx(
            `${item.title.en} (split application 1 of 2: ${lo1}-${hi1} ${unit}). Consult a local extension advisor on splitting the dose.`,
            `${item.title.vi} (đợt bón 1/2: ${lo1}-${hi1} ${unit}). Hỏi cán bộ khuyến nông về việc chia liều.`,
          ),
          recheck: item.verification,
          basis: LIME_SPLIT_CITATION,
        });

        entries.push({
          year: t1.year,
          month: t1.month,
          requirementId: reqId,
          share: 0.5,
          dose: { range: [lo2, hi2], unit },
          action: tx(
            `${item.title.en} (split application 2 of 2: ${lo2}-${hi2} ${unit}) after re-testing soil pH. Consult a local extension advisor on splitting the dose.`,
            `${item.title.vi} (đợt bón 2/2: ${lo2}-${hi2} ${unit}) sau khi đo kiểm tra lại pH đất. Hỏi cán bộ khuyến nông về việc chia liều.`,
          ),
          recheck: item.verification,
          basis: LIME_SPLIT_CITATION,
        });
      } else {
        const t0 = scheduleTimingForStep(rotation, todayYear, todayMonth, 0);
        coveredYears.add(t0.year);
        entries.push({
          year: t0.year,
          month: t0.month,
          requirementId: reqId,
          share: 1,
          dose: { range: [min, max], unit },
          action: tx(
            `${item.title.en} (${min}-${max} ${unit}). Consult a local extension advisor on splitting the dose if needed.`,
            `${item.title.vi} (${min}-${max} ${unit}). Hỏi cán bộ khuyến nông về việc chia liều nếu cần.`,
          ),
          recheck: item.verification,
          basis: tx(
            'Single pre-sowing application within the 4 t/ha per-season threshold (Havlin et al., 2014, Soil Fertility and Fertilizers, 8th ed., Ch. 3, p. 68).',
            'Bón một lần trước vụ gieo trong ngưỡng 4 tấn/ha mỗi vụ (Havlin và cs., 2014, Soil Fertility and Fertilizers, ấn bản 8, Chương 3, tr. 68).',
          ),
        });
      }
    } else {
      const t0 = scheduleTimingForStep(rotation, todayYear, todayMonth, 0);
      coveredYears.add(t0.year);
      entries.push({
        year: t0.year,
        month: t0.month,
        requirementId: reqId,
        share: 0,
        dose: null,
        action: item.action,
        recheck: item.verification,
        basis: item.timing,
      });
    }
  }

  // Ensure every year of the rotation horizon has at least one recheck row while open items exist.
  const totalYears = Math.max(1, rotation.years, coveredYears.size);
  const startYear = entries.length > 0 ? Math.min(...entries.map((e) => e.year)) : todayYear;
  const primaryItem = plan.items[0]!;

  for (let yOffset = 0; yOffset < totalYears; yOffset++) {
    const targetYear = startYear + yOffset;
    const hasRecheckInYear = entries.some(
      (e) => e.year === targetYear && e.recheck.en.trim().length > 0 && e.recheck.vi.trim().length > 0,
    );
    if (!hasRecheckInYear) {
      const t = scheduleTimingForStep(rotation, todayYear, todayMonth, yOffset);
      entries.push({
        year: targetYear,
        month: t.month,
        requirementId: primaryItem.metric,
        share: 0,
        dose: null,
        action: tx(
          `Annual soil follow-up check for ${primaryItem.metric}`,
          `Kiểm tra theo dõi đất hằng năm cho chỉ tiêu ${primaryItem.metric}`,
        ),
        recheck: primaryItem.verification,
        basis: tx(
          'Annual re-test of open soil requirements before the next season.',
          'Đo kiểm tra lại hằng năm đối với các yêu cầu cải tạo đất còn mở trước vụ kế tiếp.',
        ),
      });
    }
  }

  return entries.sort((a, b) => a.year - b.year || a.month - b.month);
}
