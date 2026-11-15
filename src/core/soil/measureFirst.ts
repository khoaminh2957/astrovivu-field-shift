import type { GroundTruth, I18nText, ModelInput, ScoreTimeline, SoilPlan, TextureClass } from '@/contracts';
import { tx } from '@/contracts';
import { phPlan } from '@/core/advisory/actions';
import { getCrop } from '@/core/crops';
import { whatIf } from '@/core/scoring';
import { findFact } from './buffer';
import { diagnoseSoil } from './diagnosis';
import { buildSoilPlan } from './plan';

export type MeasurableSoilFactor =
  | 'ph'
  | 'texture'
  | 'drainage'
  | 'depth'
  | 'salinity'
  | 'organic_matter';

export interface MeasurementPriority {
  factor: MeasurableSoilFactor;
  label: I18nText;
  reason: I18nText;
  method: I18nText;
  changesAdvice: boolean;
  scoreSpread: number;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

const FACTOR_LABEL: Record<MeasurableSoilFactor, I18nText> = {
  ph: tx('Soil pH', 'pH đất'),
  texture: tx('Soil texture', 'Thành phần cơ giới'),
  drainage: tx('Soil drainage', 'Khả năng thoát nước'),
  depth: tx('Soil depth', 'Độ sâu tầng đất'),
  salinity: tx('Electrical conductivity / salinity (EC)', 'Độ dẫn điện / độ mặn (EC)'),
  organic_matter: tx('Soil organic matter', 'Chất hữu cơ trong đất'),
};

/**
 * Simple field measurement methods following USDA ARS / NRCS (1999),
 * "Soil Quality Test Kit Guide", PA-1629.
 */
const FIELD_METHOD: Record<MeasurableSoilFactor, I18nText> = {
  ph: tx(
    'Mix a 1:1 soil-to-water suspension from a 0-20 cm composite sample and read with a pocket pH meter or pH test strips (USDA Soil Quality Test Kit Guide, PA-1629, Section I, Ch. 6).',
    'Pha huyền phù đất:nước tỉ lệ 1:1 từ mẫu đất hỗn hợp tầng 0-20 cm và đo bằng bút đo pH cầm tay hoặc giấy thử pH (USDA Soil Quality Test Kit Guide, PA-1629, Phần I, Chương 6).',
  ),
  texture: tx(
    'Ribbon/feel test in the hand or jar settling test (sand, silt, clay layers) on a 0-20 cm composite sample (USDA Soil Quality Test Kit Guide, PA-1629, Section I, Ch. 10).',
    'Thử vê đất bằng tay hoặc thử lắng hạt trong lọ thủy tinh (tách lớp cát, limon, sét) trên mẫu đất tầng 0-20 cm (USDA Soil Quality Test Kit Guide, PA-1629, Phần I, Chương 10).',
  ),
  drainage: tx(
    'Infiltration ring test and observing how long water stands after heavy rain, plus checking a 30-50 cm pit for grey/mottled layers (USDA Soil Quality Test Kit Guide, PA-1629, Section I, Ch. 2 & 10).',
    'Thử tốc độ thấm bằng vòng thấm và quan sát thời gian nước đọng sau mưa lớn, kết hợp đào hố 30-50 cm xem tầng đất xám hoặc vết loang (USDA Soil Quality Test Kit Guide, PA-1629, Phần I, Chương 2 & 10).',
  ),
  depth: tx(
    'Probe with a soil auger or dig a profile pit to measure the depth to hardpan, bedrock, or water table (USDA Soil Quality Test Kit Guide, PA-1629, Section I, Ch. 10).',
    'Dùng mũi khoan đất hoặc đào phẫu diện để đo độ sâu từ mặt đất đến tầng đế cày, đá mẹ hoặc mực nước ngầm (USDA Soil Quality Test Kit Guide, PA-1629, Phần I, Chương 10).',
  ),
  salinity: tx(
    'Mix a 1:1 soil-to-water suspension from a 0-20 cm sample and measure electrical conductivity with a pocket EC meter (USDA Soil Quality Test Kit Guide, PA-1629, Section I, Ch. 5).',
    'Pha dịch đất:nước tỉ lệ 1:1 từ mẫu đất tầng 0-20 cm và đo bằng bút đo độ dẫn điện (EC) cầm tay (USDA Soil Quality Test Kit Guide, PA-1629, Phần I, Chương 5).',
  ),
  organic_matter: tx(
    'Inspect topsoil colour andcrumb structure in the field, and send a 0-20 cm composite sample for laboratory Walkley-Black or loss-on-ignition organic carbon analysis (USDA Soil Quality Test Kit Guide, PA-1629, Section I, Ch. 10).',
    'Quan sát màu sắc và kết cấu viên tầng mặt ngoài đồng, kết hợp gửi mẫu đất hỗn hợp 0-20 cm phân tích cacbon hữu cơ trong phòng thí nghiệm (USDA Soil Quality Test Kit Guide, PA-1629, Phần I, Chương 10).',
  ),
};

function textureFromClaySand(clay: number, sand: number): TextureClass {
  if (clay >= 35) return 'heavy';
  if (sand >= 52 && clay < 20) return 'light';
  return 'medium';
}

function runSoilPlanWithPatch(input: ModelInput, patch: Partial<GroundTruth>): SoilPlan {
  const next: ModelInput = {
    ...input,
    groundTruth: { ...input.groundTruth, ...patch },
  };
  const diag = diagnoseSoil(next);
  const ph = phPlan(next);
  return buildSoilPlan(diag, next, ph);
}

function planAdviceDiffers(planLo: SoilPlan, planHi: SoilPlan, factor: MeasurableSoilFactor): boolean {
  const itemLo = planLo.items.find((i) => i.metric === factor);
  const itemHi = planHi.items.find((i) => i.metric === factor);
  if (Boolean(itemLo) !== Boolean(itemHi)) return true;
  if (!itemLo || !itemHi) return false;
  if (itemLo.title.en !== itemHi.title.en) return true;
  if (Boolean(itemLo.rateRange) !== Boolean(itemHi.rateRange)) return true;
  return false;
}

function computeSpread(input: ModelInput, patchLo: Partial<GroundTruth>, patchHi: Partial<GroundTruth>): number {
  const wLo = whatIf(input, patchLo)[0];
  const wHi = whatIf(input, patchHi)[0];
  if (!wLo || !wHi) return 0;
  return Math.abs(wHi.after - wLo.after);
}

/**
 * Ranks which soil properties the grower should measure first on the field.
 *
 * - Factors already entered by the grower in `input.groundTruth` are omitted.
 * - Factors with an uncertainty interval `[lo, hi]` are tested at both ends with `buildSoilPlan`
 *   and `whatIf(input, patch)` to determine whether the interval flips the advice (`changesAdvice`)
 *   and how much the suitability score changes between the two ends (`scoreSpread`).
 * - Factors with no reading (`no_data`) that the selected crop has a requirement for are always
 *   listed with the reason that no reading is held yet.
 * - Sorted by `changesAdvice` (`true` before `false`), then `scoreSpread` descending.
 */
export function measurementPriorities(
  input: ModelInput,
  _score?: ScoreTimeline,
): MeasurementPriority[] {
  const gt = input.groundTruth;
  const t = input.telemetry;
  const crop = getCrop(input.cropId);
  const req = crop?.req;
  const diag = diagnoseSoil(input);
  const out: MeasurementPriority[] = [];

  const getMetric = (key: string) => diag.metrics.find((m) => m.key === key);

  // 1. Soil pH
  if (gt.ph == null) {
    const phMetric = getMetric('ph');
    const phFact = findFact(t, 'ph');
    const unc = Array.isArray(phFact?.uncertainty) ? (phFact.uncertainty as [number, number]) : null;
    if (phMetric?.status === 'no_data') {
      if (req?.ph && !crop?.flags?.includes('ph-missing')) {
        out.push({
          factor: 'ph',
          label: FACTOR_LABEL.ph,
          reason: tx(
            'No reading is held for soil pH on this parcel, while the selected crop has a pH requirement.',
            'Chưa có số nào cho pH đất trên thửa ruộng này, trong khi cây đang chọn có yêu cầu về pH.',
          ),
          method: FIELD_METHOD.ph,
          changesAdvice: false,
          scoreSpread: 0,
        });
      }
    } else if (unc) {
      const [lo, hi] = unc;
      const planLo = runSoilPlanWithPatch(input, { ph: lo });
      const planHi = runSoilPlanWithPatch(input, { ph: hi });
      const changesAdvice = planAdviceDiffers(planLo, planHi, 'ph');
      const scoreSpread = computeSpread(input, { ph: lo }, { ph: hi });
      out.push({
        factor: 'ph',
        label: FACTOR_LABEL.ph,
        reason: changesAdvice
          ? tx(
              `Map pH (${phMetric?.currentValue}) has a 5-95% uncertainty interval of ${lo}-${hi}, and the two ends lead to different liming/acidifying recommendations (score spread: ${scoreSpread} pts).`,
              `pH bản đồ (${phMetric?.currentValue}) có khoảng bất định 5-95% từ ${lo} đến ${hi}, và hai đầu khoảng dẫn đến khuyến nghị cải tạo khác nhau (chênh điểm: ${scoreSpread} điểm).`,
            )
          : tx(
              `Map pH (${phMetric?.currentValue}) has a 5-95% uncertainty interval of ${lo}-${hi} (score spread between ends: ${scoreSpread} pts).`,
              `pH bản đồ (${phMetric?.currentValue}) có khoảng bất định 5-95% từ ${lo} đến ${hi} (chênh điểm giữa hai đầu: ${scoreSpread} điểm).`,
            ),
        method: FIELD_METHOD.ph,
        changesAdvice,
        scoreSpread,
      });
    } else if (phFact?.value != null) {
      out.push({
        factor: 'ph',
        label: FACTOR_LABEL.ph,
        reason: tx(
          `The soil map source (${phFact.sourceId}) does not publish an uncertainty interval for pH (${phFact.value}); a field test verifies local variation.`,
          `Nguồn bản đồ đất (${phFact.sourceId}) không công bố khoảng bất định cho pH (${phFact.value}); đo tại chỗ giúp kiểm chứng biến động thực tế.`,
        ),
        method: FIELD_METHOD.ph,
        changesAdvice: false,
        scoreSpread: 0,
      });
    }
  }

  // 2. Soil texture
  if (gt.texture == null) {
    const texMetric = getMetric('texture');
    const texFact = findFact(t, 'texture_class');
    const clayFact = findFact(t, 'clay_pct');
    const sandFact = findFact(t, 'sand_pct');
    const clayUnc = Array.isArray(clayFact?.uncertainty) ? (clayFact.uncertainty as [number, number]) : null;
    const sandUnc = Array.isArray(sandFact?.uncertainty) ? (sandFact.uncertainty as [number, number]) : null;
    if (texMetric?.status === 'no_data') {
      if (req?.texture) {
        out.push({
          factor: 'texture',
          label: FACTOR_LABEL.texture,
          reason: tx(
            'No reading is held for soil texture on this parcel, while the crop has a texture requirement.',
            'Chưa có số nào cho thành phần cơ giới trên thửa ruộng này, trong khi cây có yêu cầu về cơ giới đất.',
          ),
          method: FIELD_METHOD.texture,
          changesAdvice: false,
          scoreSpread: 0,
        });
      }
    } else if (clayUnc && sandUnc) {
      const texLo = textureFromClaySand(clayUnc[0], sandUnc[1]);
      const texHi = textureFromClaySand(clayUnc[1], sandUnc[0]);
      const planLo = runSoilPlanWithPatch(input, { texture: texLo });
      const planHi = runSoilPlanWithPatch(input, { texture: texHi });
      const changesAdvice = planAdviceDiffers(planLo, planHi, 'texture');
      const scoreSpread = computeSpread(input, { texture: texLo }, { texture: texHi });
      out.push({
        factor: 'texture',
        label: FACTOR_LABEL.texture,
        reason: tx(
          `Map clay (${clayFact?.value}%, interval ${clayUnc[0]}-${clayUnc[1]}%) and sand (${sandFact?.value}%, interval ${sandUnc[0]}-${sandUnc[1]}%) span from ${texLo} to ${texHi} texture (score spread: ${scoreSpread} pts).`,
          `Sét bản đồ (${clayFact?.value}%, khoảng ${clayUnc[0]}-${clayUnc[1]}%) và cát (${sandFact?.value}%, khoảng ${sandUnc[0]}-${sandUnc[1]}%) trải từ nhóm đất ${texLo} đến ${texHi} (chênh điểm: ${scoreSpread} điểm).`,
        ),
        method: FIELD_METHOD.texture,
        changesAdvice,
        scoreSpread,
      });
    } else if (texFact?.value != null) {
      out.push({
        factor: 'texture',
        label: FACTOR_LABEL.texture,
        reason: tx(
          `The soil map source (${texFact.sourceId}) does not publish an uncertainty interval for texture (${texMetric?.currentValue}); a jar or feel test confirms topsoil texture.`,
          `Nguồn bản đồ đất (${texFact.sourceId}) không công bố khoảng bất định cho thành phần cơ giới (${texMetric?.currentValue}); thử lắng trong lọ hoặc vê tay giúp xác nhận tại ruộng.`,
        ),
        method: FIELD_METHOD.texture,
        changesAdvice: false,
        scoreSpread: 0,
      });
    }
  }

  // 3. Soil drainage
  const hasGrowerDrainage = gt.drainage != null || Boolean(gt.issues?.includes('waterlogging'));
  if (!hasGrowerDrainage) {
    const drMetric = getMetric('drainage');
    const drFact = findFact(t, 'drainage_class');
    if (drMetric?.status === 'no_data') {
      if (req?.drainage) {
        out.push({
          factor: 'drainage',
          label: FACTOR_LABEL.drainage,
          reason: tx(
            'No reading is held for soil drainage on this parcel, while the selected crop has a drainage requirement.',
            'Chưa có số nào cho khả năng thoát nước trên thửa ruộng này, trong khi cây đang chọn có yêu cầu về thoát nước.',
          ),
          method: FIELD_METHOD.drainage,
          changesAdvice: false,
          scoreSpread: 0,
        });
      }
    } else if (drFact?.value != null) {
      out.push({
        factor: 'drainage',
        label: FACTOR_LABEL.drainage,
        reason: tx(
          `The soil map source (${drFact.sourceId}) does not publish an uncertainty interval for drainage class (${drFact.value}).`,
          `Nguồn bản đồ đất (${drFact.sourceId}) không công bố khoảng bất định cho cấp thoát nước (${drFact.value}).`,
        ),
        method: FIELD_METHOD.drainage,
        changesAdvice: false,
        scoreSpread: 0,
      });
    }
  }

  // 4. Soil depth
  if (gt.soilDepthCm == null) {
    const depthMetric = getMetric('depth');
    const depthFact = findFact(t, 'depth_cm');
    const unc = Array.isArray(depthFact?.uncertainty) ? (depthFact.uncertainty as [number, number]) : null;
    if (depthMetric?.status === 'no_data') {
      if (req?.depth) {
        out.push({
          factor: 'depth',
          label: FACTOR_LABEL.depth,
          reason: tx(
            'No reading is held for rootable soil depth on this parcel, while the selected crop has a depth requirement.',
            'Chưa có số nào cho độ sâu tầng đất trên thửa ruộng này, trong khi cây đang chọn có yêu cầu về độ sâu rễ.',
          ),
          method: FIELD_METHOD.depth,
          changesAdvice: false,
          scoreSpread: 0,
        });
      }
    } else if (unc) {
      const [lo, hi] = unc;
      const planLo = runSoilPlanWithPatch(input, { soilDepthCm: lo });
      const planHi = runSoilPlanWithPatch(input, { soilDepthCm: hi });
      const changesAdvice = planAdviceDiffers(planLo, planHi, 'depth');
      const scoreSpread = computeSpread(input, { soilDepthCm: lo }, { soilDepthCm: hi });
      out.push({
        factor: 'depth',
        label: FACTOR_LABEL.depth,
        reason: tx(
          `Map soil depth (${depthMetric?.currentValue} cm) has an uncertainty interval of ${lo}-${hi} cm (score spread: ${scoreSpread} pts).`,
          `Độ sâu tầng đất bản đồ (${depthMetric?.currentValue} cm) có khoảng bất định ${lo}-${hi} cm (chênh điểm: ${scoreSpread} điểm).`,
        ),
        method: FIELD_METHOD.depth,
        changesAdvice,
        scoreSpread,
      });
    } else if (depthFact?.value != null) {
      out.push({
        factor: 'depth',
        label: FACTOR_LABEL.depth,
        reason: tx(
          `The soil map source (${depthFact.sourceId}) does not publish an uncertainty interval for soil depth (${depthFact.value} cm).`,
          `Nguồn bản đồ đất (${depthFact.sourceId}) không công bố khoảng bất định cho độ sâu tầng đất (${depthFact.value} cm).`,
        ),
        method: FIELD_METHOD.depth,
        changesAdvice: false,
        scoreSpread: 0,
      });
    }
  }

  // 5. Salinity (EC)
  if (gt.ecDsM == null) {
    const salMetric = getMetric('salinity');
    const ecFact = findFact(t, 'ec_dsm');
    const unc = Array.isArray(ecFact?.uncertainty) ? (ecFact.uncertainty as [number, number]) : null;
    if (salMetric?.status === 'no_data') {
      if (req?.salinity) {
        out.push({
          factor: 'salinity',
          label: FACTOR_LABEL.salinity,
          reason: tx(
            'No reading is held for electrical conductivity (salinity) on this parcel, while the selected crop has a salinity threshold.',
            'Chưa có số nào cho độ dẫn điện (độ mặn EC) trên thửa ruộng này, trong khi cây đang chọn có ngưỡng chịu mặn.',
          ),
          method: FIELD_METHOD.salinity,
          changesAdvice: false,
          scoreSpread: 0,
        });
      }
    } else if (unc) {
      const [lo, hi] = unc;
      const planLo = runSoilPlanWithPatch(input, { ecDsM: lo });
      const planHi = runSoilPlanWithPatch(input, { ecDsM: hi });
      const changesAdvice = planAdviceDiffers(planLo, planHi, 'salinity');
      const scoreSpread = computeSpread(input, { ecDsM: lo }, { ecDsM: hi });
      out.push({
        factor: 'salinity',
        label: FACTOR_LABEL.salinity,
        reason: tx(
          `Map EC (${salMetric?.currentValue} dS/m) has an uncertainty interval of ${lo}-${hi} dS/m (score spread: ${scoreSpread} pts).`,
          `Độ dẫn điện EC bản đồ (${salMetric?.currentValue} dS/m) có khoảng bất định ${lo}-${hi} dS/m (chênh điểm: ${scoreSpread} điểm).`,
        ),
        method: FIELD_METHOD.salinity,
        changesAdvice,
        scoreSpread,
      });
    } else if (ecFact?.value != null) {
      out.push({
        factor: 'salinity',
        label: FACTOR_LABEL.salinity,
        reason: tx(
          `The soil map source (${ecFact.sourceId}) does not publish an uncertainty interval for electrical conductivity (${ecFact.value} dS/m).`,
          `Nguồn bản đồ đất (${ecFact.sourceId}) không công bố khoảng bất định cho độ dẫn điện (${ecFact.value} dS/m).`,
        ),
        method: FIELD_METHOD.salinity,
        changesAdvice: false,
        scoreSpread: 0,
      });
    }
  }

  // 6. Soil organic matter (from om_pct if present, else derived from soc_gkg)
  if (gt.organicMatterPct == null) {
    const omFact = findFact(t, 'om_pct');
    const socFact = findFact(t, 'soc_gkg');
    const omUnc = Array.isArray(omFact?.uncertainty) ? (omFact.uncertainty as [number, number]) : null;
    const socUnc =
      omFact?.value == null && Array.isArray(socFact?.uncertainty)
        ? (socFact.uncertainty as [number, number])
        : null;
    const interval: [number, number] | null = omUnc
      ? omUnc
      : socUnc
        ? [r1(socUnc[0] * 0.1724), r1(socUnc[1] * 0.1724)]
        : null;
    if (interval) {
      const [lo, hi] = interval;
      const planLo = runSoilPlanWithPatch(input, { organicMatterPct: lo });
      const planHi = runSoilPlanWithPatch(input, { organicMatterPct: hi });
      const changesAdvice = planAdviceDiffers(planLo, planHi, 'organic_matter');
      const scoreSpread = computeSpread(input, { organicMatterPct: lo }, { organicMatterPct: hi });
      out.push({
        factor: 'organic_matter',
        label: FACTOR_LABEL.organic_matter,
        reason: tx(
          `Map organic matter has a 5-95% uncertainty interval of ${lo}-${hi}% (score spread: ${scoreSpread} pts).`,
          `Chất hữu cơ bản đồ có khoảng bất định 5-95% từ ${lo} đến ${hi}% (chênh điểm: ${scoreSpread} điểm).`,
        ),
        method: FIELD_METHOD.organic_matter,
        changesAdvice,
        scoreSpread,
      });
    } else if (omFact?.value != null) {
      out.push({
        factor: 'organic_matter',
        label: FACTOR_LABEL.organic_matter,
        reason: tx(
          `The soil map source (${omFact.sourceId}) does not publish an uncertainty interval for organic matter (${omFact.value}%).`,
          `Nguồn bản đồ đất (${omFact.sourceId}) không công bố khoảng bất định cho chất hữu cơ (${omFact.value}%).`,
        ),
        method: FIELD_METHOD.organic_matter,
        changesAdvice: false,
        scoreSpread: 0,
      });
    }
  }

  return out.sort((a, b) => {
    if (a.changesAdvice !== b.changesAdvice) return a.changesAdvice ? -1 : 1;
    return b.scoreSpread - a.scoreSpread;
  });
}
