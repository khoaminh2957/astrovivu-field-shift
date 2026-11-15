import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { factNum } from './buffer';
import { amendmentTHa, CACO3_G_PER_CMOLC, DOSE_DEPTH_M } from './mass';

/**
 * Exchangeable aluminium on acid soils: what is known, what must be measured, and the lime that
 * neutralises a measured amount.
 *
 * The only coefficient here is Kamprath's: lime equivalent to 1.5 to 2 times the exchangeable
 * aluminium, both in cmol(+) per kg of soil (Kamprath, E.J. 1970. Exchangeable aluminum as a
 * criterion for liming leached mineral soils. Soil Science Society of America Proceedings 34:
 * 252-254). It is turned into tonnes per hectare with the bulk density of the field and a stated
 * depth, never with a fixed mass of soil.
 *
 * What this module does NOT hold, and therefore does not say:
 * - an aluminium saturation above which a crop is harmed. No threshold with a table and page is
 *   recorded, neither a general one nor one per crop, so no result is called "toxic";
 * - a pH below which aluminium is assumed present. Without a measurement the status is unknown.
 */

/** `safe`: measured, none found. `potential_risk`: measured and present. `unknown`: not measured. */
export type AluminiumStatus = 'safe' | 'potential_risk' | 'unknown';

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
  /** Exchangeable Ca + Mg + K + Na, cmol(+)/kg, when the laboratory reported them. */
  exchBasesCmolKg: number | null;
  /** Al / (Al + bases) x 100. Null without the exchangeable bases: CEC is not a substitute. */
  alSaturationPct: number | null;
  cropTolerance: AluminiumCropTolerance;
  limeRequirementTHa: [lo: number, hi: number] | null;
  /** Readings the dose was computed from. */
  bulkDensityTM3: number | null;
  depthM: number;
  requiredMeasurements: I18nText[];
  method: string;
  summary: I18nText;
  recommendations: I18nText[];
  caveats: I18nText[];
  needsLocalReview: boolean;
}

/** Kamprath (1970): cmol(+) of CaCO3 per cmol(+) of exchangeable Al, lower and upper factor. */
export const KAMPRATH_FACTOR: readonly [lo: number, hi: number] = [1.5, 2];

export const KAMPRATH_METHOD = 'Kamprath (1970), Soil Science Society of America Proceedings 34: 252-254';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Tonnes of CaCO3 per hectare that supply `factor` x Al cmol(+) to every kg of soil in the layer. */
export function kamprathLimeTHa(exchAlCmolKg: number, factor: number, bulkDensityTM3: number, depthM: number = DOSE_DEPTH_M): number {
  return amendmentTHa(factor * exchAlCmolKg, CACO3_G_PER_CMOLC, depthM, bulkDensityTM3);
}

const AL_TEST = tx(
  'Exchangeable aluminium (Al3+) of a composite topsoil sample (0-20 cm), 1M KCl extract, in cmol(+)/kg',
  'Nhôm trao đổi (Al3+) của mẫu đất hỗn hợp tầng mặt (0-20 cm), trích ly bằng 1M KCl, tính bằng cmol(+)/kg',
);
const BASES_TEST = tx(
  'Exchangeable bases of the same sample (Ca, Mg, K, Na in cmol(+)/kg), to compute the aluminium saturation',
  'Các bazơ trao đổi của cùng mẫu đất (Ca, Mg, K, Na tính bằng cmol(+)/kg), để tính độ bão hòa nhôm',
);
const BULK_DENSITY_TEST = tx('Bulk density of the 0-20 cm layer (g/cm3)', 'Dung trọng lớp đất 0-20 cm (g/cm3)');

/**
 * Exchangeable aluminium of the field and the lime that neutralises it.
 *
 * @param input ModelInput of the field and crop
 * @param measured Laboratory readings: exchangeable Al and, to compute the saturation, the sum of
 *   the exchangeable bases (Ca + Mg + K + Na), both in cmol(+)/kg
 */
export function aluminiumRisk(
  input: ModelInput,
  measured?: { exchAlCmolKg?: number; exchBasesCmolKg?: number },
): AluminiumDiagnosis {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const gt = input.groundTruth as { ph?: number; exchAlCmolKg?: number; exchBasesCmolKg?: number };
  const cropEn = c ? c.names.en : 'the selected crop';
  const cropVi = c ? (c.names.vi ?? c.names.en) : 'cây đang chọn';

  const currentPh = gt.ph ?? factNum(t, 'ph');
  const bulkDensity = factNum(t, 'bulk_density');
  const alGiven = measured?.exchAlCmolKg ?? gt.exchAlCmolKg ?? null;
  const alInvalid = alGiven != null && !(Number.isFinite(alGiven) && alGiven >= 0);
  const exchAl = alGiven != null && !alInvalid ? alGiven : null;
  const basesGiven = measured?.exchBasesCmolKg ?? gt.exchBasesCmolKg ?? null;
  const exchBases = basesGiven != null && Number.isFinite(basesGiven) && basesGiven >= 0 ? basesGiven : null;

  // No crop tolerance is held with a checkable source, so none is reported for any crop.
  const cropTolerance: AluminiumCropTolerance = {
    hasData: false,
    optMaxPct: null,
    absMaxPct: null,
    note: tx(
      `No published aluminum saturation tolerance threshold with a checkable source (table and page) is recorded for ${cropEn}. None is assumed and none is inferred from other crops.`,
      `Chưa ghi nhận ngưỡng chịu độ bão hòa nhôm đã công bố, có nguồn kiểm được (bảng và trang), cho ${cropVi}. Không đặt số giả định. Không tự suy diễn từ cây khác.`,
    ),
  };

  const caveats: I18nText[] = [
    tx(
      'Indicative estimate: on-site verification with laboratory soil testing (1M KCl extract) is required.',
      'Ước tính định hướng: cần kiểm tra tại chỗ bằng phân tích đất phòng thí nghiệm (trích ly 1M KCl).',
    ),
  ];
  const requiredMeasurements: I18nText[] = [];
  const phEn = currentPh != null ? ` Soil pH held for the field: ${currentPh}.` : '';
  const phVi = currentPh != null ? ` pH đất đang có của thửa: ${currentPh}.` : '';

  // 1. Not measured (or the value entered is not a reading): unknown, and what to measure.
  if (exchAl == null) {
    requiredMeasurements.push(AL_TEST, BASES_TEST);
    const invalidEn = alInvalid ? ` The value entered (${alGiven}) is not a valid reading: an amount cannot be negative.` : '';
    const invalidVi = alInvalid ? ` Giá trị đã nhập (${alGiven}) không phải số đo hợp lệ: lượng nhôm không thể âm.` : '';
    return {
      status: 'unknown',
      currentPh,
      exchAlCmolKg: null,
      exchBasesCmolKg: exchBases,
      alSaturationPct: null,
      cropTolerance,
      limeRequirementTHa: null,
      bulkDensityTM3: bulkDensity,
      depthM: DOSE_DEPTH_M,
      requiredMeasurements,
      method: `${KAMPRATH_METHOD}: needs a measured exchangeable Al`,
      summary: tx(
        `Exchangeable aluminium has not been measured on this field: whether it limits ${cropEn} is not known, and no lime dose is given for it.${invalidEn}${phEn}`,
        `Chưa đo nhôm trao đổi trên thửa này: chưa biết nhôm có hạn chế ${cropVi} hay không, và không đưa ra liều vôi cho việc này.${invalidVi}${phVi}`,
      ),
      recommendations: [
        tx(
          'Submit a composite topsoil sample (0-20 cm) for 1M KCl-extractable exchangeable aluminum (Al3+) laboratory analysis, with the exchangeable bases (Ca, Mg, K, Na) of the same sample.',
          'Lấy mẫu đất hỗn hợp tầng mặt (0-20 cm) gửi phòng phân tích để đo nhôm trao đổi (Al3+ trích ly bằng 1M KCl), kèm các bazơ trao đổi (Ca, Mg, K, Na) của cùng mẫu.',
        ),
      ],
      caveats,
      needsLocalReview: true,
    };
  }

  // 2. Measured. Saturation needs the effective CEC = Al + exchangeable bases; the CEC of a soil
  //    map (measured at pH 7) is a different quantity and is not used in its place.
  const alSaturationPct = exchBases != null && exchAl + exchBases > 0 ? r1((exchAl / (exchAl + exchBases)) * 100) : null;
  if (exchBases == null) requiredMeasurements.push(BASES_TEST);
  const satEn =
    alSaturationPct != null
      ? ` Aluminium saturation: ${alSaturationPct}% of the effective CEC (Al ${exchAl} + bases ${exchBases} cmol(+)/kg).`
      : ' Aluminium saturation cannot be computed: the exchangeable bases (Ca, Mg, K, Na) were not measured, and the CEC of the soil map is not the effective CEC.';
  const satVi =
    alSaturationPct != null
      ? ` Độ bão hòa nhôm: ${alSaturationPct}% của CEC hữu hiệu (Al ${exchAl} + bazơ ${exchBases} cmol(+)/kg).`
      : ' Chưa tính được độ bão hòa nhôm: chưa đo các bazơ trao đổi (Ca, Mg, K, Na), và CEC của bản đồ đất không phải CEC hữu hiệu.';

  // 2a. None found: nothing to neutralise, so no lime is recommended for aluminium.
  if (exchAl === 0) {
    return {
      status: 'safe',
      currentPh,
      exchAlCmolKg: 0,
      exchBasesCmolKg: exchBases,
      alSaturationPct,
      cropTolerance,
      limeRequirementTHa: null,
      bulkDensityTM3: bulkDensity,
      depthM: DOSE_DEPTH_M,
      requiredMeasurements: [],
      method: KAMPRATH_METHOD,
      summary: tx(
        `Measured exchangeable aluminium is 0 cmol(+)/kg: there is none to neutralise, and no lime is needed for aluminium.${phEn}`,
        `Nhôm trao đổi đo được là 0 cmol(+)/kg: không có nhôm cần trung hòa, và không cần bón vôi vì nhôm.${phVi}`,
      ),
      recommendations: [],
      caveats,
      needsLocalReview: true,
    };
  }

  // 2b. Present. Whether it harms this crop is not stated (no sourced tolerance); the lime that
  //     neutralises it is, when the bulk density of the field is known.
  const depthCm = Math.round(DOSE_DEPTH_M * 100);
  const recommendations: I18nText[] = [];
  let limeRequirementTHa: [lo: number, hi: number] | null = null;
  let doseEn: string;
  let doseVi: string;

  if (bulkDensity == null || bulkDensity <= 0) {
    requiredMeasurements.push(BULK_DENSITY_TEST);
    doseEn = ' No lime dose is given: the bulk density of the field is missing, and the dose per hectare depends on it. Measure first.';
    doseVi = ' Không đưa ra liều vôi: thiếu dung trọng của thửa ruộng, mà liều trên mỗi hecta phụ thuộc vào số đó. Cần đo trước.';
    recommendations.push(
      tx(
        `Measure first: ${BULK_DENSITY_TEST.en}.`,
        `Cần đo trước: ${BULK_DENSITY_TEST.vi}.`,
      ),
    );
  } else {
    const lo = r1(kamprathLimeTHa(exchAl, KAMPRATH_FACTOR[0], bulkDensity));
    const hi = r1(kamprathLimeTHa(exchAl, KAMPRATH_FACTOR[1], bulkDensity));
    limeRequirementTHa = [lo, hi];
    doseEn = ` Lime that neutralises it: ${lo}-${hi} t/ha of CaCO3 equivalent, that is ${KAMPRATH_FACTOR[0]} to ${KAMPRATH_FACTOR[1]} cmol(+) of CaCO3 per cmol(+) of Al (${KAMPRATH_METHOD}) in the top ${depthCm} cm at a bulk density of ${bulkDensity} t/m3.`;
    doseVi = ` Lượng vôi trung hòa: ${lo}-${hi} tấn/ha tính theo CaCO3, tức ${KAMPRATH_FACTOR[0]} đến ${KAMPRATH_FACTOR[1]} cmol(+) CaCO3 cho mỗi cmol(+) Al (Kamprath 1970, Soil Science Society of America Proceedings 34: 252-254) trong lớp đất ${depthCm} cm trên cùng với dung trọng ${bulkDensity} t/m3.`;
    recommendations.push(
      tx(
        `Apply ${lo}-${hi} t/ha agricultural limestone (CaCO3 equivalent), worked into the top ${depthCm} cm, to neutralise the exchangeable Al3+.`,
        `Bón ${lo}-${hi} tấn/ha vôi nông nghiệp (tính theo CaCO3), trộn vào lớp đất ${depthCm} cm trên cùng, để trung hòa Al3+ trao đổi.`,
      ),
    );
    caveats.push(
      tx(
        `The dose uses the bulk density held for this field (${bulkDensity} t/m3) and a depth of ${depthCm} cm; adjust it for the neutralising value of the product.`,
        `Liều dùng dung trọng đang có của thửa này (${bulkDensity} t/m3) và độ sâu ${depthCm} cm; cần hiệu chỉnh theo khả năng trung hòa của sản phẩm vôi.`,
      ),
    );
  }
  if (exchBases == null) {
    recommendations.push(tx(`Measure also: ${BASES_TEST.en}.`, `Cần đo thêm: ${BASES_TEST.vi}.`));
  }

  return {
    status: 'potential_risk',
    currentPh,
    exchAlCmolKg: exchAl,
    exchBasesCmolKg: exchBases,
    alSaturationPct,
    cropTolerance,
    limeRequirementTHa,
    bulkDensityTM3: bulkDensity,
    depthM: DOSE_DEPTH_M,
    requiredMeasurements,
    method: KAMPRATH_METHOD,
    summary: tx(
      `Measured exchangeable aluminium is ${exchAl} cmol(+)/kg.${satEn} Whether this harms ${cropEn} is not stated: no tolerance threshold with a checkable source is recorded.${doseEn}`,
      `Nhôm trao đổi đo được là ${exchAl} cmol(+)/kg.${satVi} Không kết luận mức này có hại cho ${cropVi} hay không: chưa ghi nhận ngưỡng chịu đựng nào có nguồn kiểm được.${doseVi}`,
    ),
    recommendations,
    caveats,
    needsLocalReview: true,
  };
}
