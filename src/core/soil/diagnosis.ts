import type { DepthClass, DrainageClass, I18nText, ModelInput, TextureClass } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { MAAS_HOFFMAN_PARAMS } from '@/core/scoring/literature';
import { factNum, findFact } from './buffer';
import type { SoilDiagnosis, SoilMetricDiagnosis, SoilMetricStatus } from './types';

/**
 * Soil diagnosis: each soil reading of the field next to what the selected crop needs.
 *
 * The requirement of a crop is read from the crop catalogue (`CropProfile.req`: pH, texture,
 * drainage, depth, salinity) with the same rules as the suitability model (`src/core/scoring`,
 * `fitFor`), so that a row is `optimal` exactly when the model scores that factor 1. A test holds
 * the two together on the four sample fields.
 *
 * A reading with no requirement in the catalogue (organic matter, CEC, available water, nitrogen)
 * is listed as a reading, without a verdict. A factor with no reading is `no_data`: no value is
 * put in its place.
 */

const r1 = (v: number) => Math.round(v * 10) / 10;

const TEXTURE_CLASSES: readonly TextureClass[] = ['heavy', 'medium', 'light', 'organic'];
const TEXTURE_LABEL: Record<TextureClass, I18nText> = {
  heavy: tx('heavy (clayey)', 'nặng (nhiều sét)'),
  medium: tx('medium (loamy)', 'thịt trung bình'),
  light: tx('light (sandy)', 'nhẹ (nhiều cát)'),
  organic: tx('organic', 'hữu cơ'),
};

/** The twelve USDA texture names, for a Vietnamese sentence that would otherwise carry the English one. */
const USDA_TEXTURE_VI: Record<string, string> = {
  sand: 'cát',
  'loamy sand': 'cát pha',
  'sandy loam': 'thịt pha cát',
  loam: 'thịt',
  'silt loam': 'thịt pha limon',
  silt: 'limon',
  'sandy clay loam': 'thịt pha sét và cát',
  'clay loam': 'thịt pha sét',
  'silty clay loam': 'thịt pha sét và limon',
  'sandy clay': 'sét pha cát',
  'silty clay': 'sét pha limon',
  clay: 'sét',
};

const DRAINAGE_LABEL: Record<DrainageClass, I18nText> = {
  poor: tx('poorly drained', 'thoát nước kém'),
  well: tx('well drained', 'thoát nước tốt'),
  excessive: tx('excessively drained', 'thoát nước quá nhanh'),
};

/** Soil depth classes of FAO EcoCrop, with the bounds the suitability model uses (cm). */
const DEPTH_ORDER: readonly DepthClass[] = ['very-shallow', 'shallow', 'medium', 'deep'];
const DEPTH_LABEL: Record<DepthClass, I18nText> = {
  'very-shallow': tx('very shallow (under 20 cm)', 'rất nông (dưới 20 cm)'),
  shallow: tx('shallow (20-50 cm)', 'nông (20-50 cm)'),
  medium: tx('medium (50-150 cm)', 'trung bình (50-150 cm)'),
  deep: tx('deep (over 150 cm)', 'sâu (trên 150 cm)'),
};
const depthClassOf = (cm: number): DepthClass => (cm < 20 ? 'very-shallow' : cm < 50 ? 'shallow' : cm <= 150 ? 'medium' : 'deep');

const STATUS_LABEL: Record<SoilMetricStatus, I18nText> = {
  optimal: tx('in the optimal range', 'trong khoảng tối ưu'),
  tolerable: tx('tolerated, outside the optimum', 'chịu được, ngoài khoảng tối ưu'),
  outside: tx('outside what the crop tolerates', 'ngoài mức cây chịu được'),
  uncertain: tx('uncertain: the estimate straddles a limit', 'chưa chắc chắn: ước tính vắt qua một ngưỡng'),
  no_data: tx('no data', 'chưa có số liệu'),
  reading_only: tx('reading only, no requirement to compare with', 'chỉ có số đo, không có yêu cầu để so'),
};

/** How a status reads in a sentence, in both languages. */
export function soilStatusLabel(status: SoilMetricStatus): I18nText {
  return STATUS_LABEL[status];
}

const classList = <T extends string>(xs: readonly T[], label: Record<T, I18nText>, lang: 'en' | 'vi'): string => xs.map((x) => label[x][lang]).join(', ');

export function diagnoseSoil(input: ModelInput): SoilDiagnosis {
  const c = getCrop(input.cropId);
  const req = c?.req;
  const t = input.telemetry;
  const gt = input.groundTruth;
  const cropEn = c ? c.names.en : 'the crop';
  const cropVi = c ? (c.names.vi ?? c.names.en) : 'cây trồng';
  const noCropNote = tx('No crop is selected: the reading is listed without a verdict.', 'Chưa chọn cây: chỉ liệt kê số đo, không đánh giá.');

  const metrics: SoilMetricDiagnosis[] = [];

  // 1. pH: optimal inside [optLo, optHi], tolerated inside [absLo, absHi], as the model's trapezoid.
  {
    const label = tx('Soil reaction (pH)', 'Độ phản ứng của đất (pH)');
    const phFact = findFact(t, 'ph');
    const phVal = gt.ph ?? factNum(t, 'ph');
    const phUncert = gt.ph == null && Array.isArray(phFact?.uncertainty) ? (phFact.uncertainty as [number, number]) : null;
    const sourceId = gt.ph != null ? undefined : phFact?.sourceId;
    if (phVal == null) {
      metrics.push({ key: 'ph', label, currentValue: null, status: 'no_data', note: tx('No pH data available for this parcel.', 'Chưa có số liệu đo hoặc ước tính pH cho thửa này.'), isLimiting: false });
    } else if (!req || c?.flags?.includes('ph-missing')) {
      metrics.push({
        key: 'ph',
        label,
        currentValue: phVal,
        sourceId,
        uncertainty: phUncert,
        status: 'reading_only',
        note: req ? tx(`pH ${phVal}. The crop catalogue holds no pH range for ${cropEn}: no verdict.`, `pH ${phVal}. Danh mục cây trồng không có khoảng pH cho ${cropVi}: không đánh giá.`) : noCropNote,
        isLimiting: false,
      });
    } else {
      const [absLo, optLo, optHi, absHi] = req.ph;
      let status: SoilMetricStatus;
      let deficit: number;
      let note: I18nText;

      if (phVal >= optLo && phVal <= optHi) {
        status = 'optimal';
        deficit = 0;
        note = tx(`pH ${phVal} is in the optimal range (${optLo}-${optHi}) for ${cropEn}.`, `pH ${phVal} nằm trong khoảng tối ưu (${optLo}-${optHi}) của ${cropVi}.`);
      } else if (phVal >= absLo && phVal <= absHi) {
        status = 'tolerable';
        deficit = phVal < optLo ? r1(optLo - phVal) : r1(phVal - optHi);
        note = tx(
          `pH ${phVal} is tolerable (${absLo}-${absHi}) but outside optimal (${optLo}-${optHi}).`,
          `pH ${phVal} ở mức chấp nhận được (${absLo}-${absHi}) nhưng nằm ngoài khoảng tối ưu (${optLo}-${optHi}).`,
        );
      } else {
        status = 'outside';
        deficit = phVal < absLo ? r1(optLo - phVal) : r1(phVal - optHi);
        note = tx(
          `pH ${phVal} is outside tolerable bounds (${absLo}-${absHi}) for ${cropEn}.`,
          `pH ${phVal} nằm ngoài ngưỡng chịu đựng (${absLo}-${absHi}) của ${cropVi}.`,
        );
      }

      // A map estimate whose interval reaches across a limit cannot carry the verdict of its centre.
      if (phUncert) {
        const [uLo, uHi] = phUncert;
        if ((uLo < optLo && uHi >= optLo) || (uLo <= optHi && uHi > optHi) || (uLo < absLo && uHi >= absLo) || (uLo <= absHi && uHi > absHi)) {
          status = 'uncertain';
          note = tx(
            `Estimated pH is ${phVal}, but the interval of the estimate [${uLo}, ${uHi}] reaches across the limits of ${cropEn} (optimal ${optLo}-${optHi}, tolerated ${absLo}-${absHi}). Measure pH on the field.`,
            `pH ước tính là ${phVal}, nhưng khoảng của ước tính [${uLo}, ${uHi}] vắt qua các ngưỡng của ${cropVi} (tối ưu ${optLo}-${optHi}, chịu được ${absLo}-${absHi}). Cần đo pH tại ruộng.`,
          );
        }
      }

      metrics.push({
        key: 'ph',
        label,
        currentValue: phVal,
        sourceId,
        uncertainty: phUncert,
        targetRange: { optLo, optHi, absLo, absHi },
        status,
        deficit,
        note,
        isLimiting: deficit > 0,
      });
    }
  }

  // 2. Texture class against the classes the crop grows best in and the ones it tolerates.
  {
    const label = tx('Soil texture', 'Thành phần cơ giới đất');
    const classFact = findFact(t, 'texture_class');
    const usdaFact = findFact(t, 'usda_texture');
    const held = gt.texture ?? classFact?.value;
    const texture = TEXTURE_CLASSES.find((x) => x === held) ?? null;
    const usda = gt.texture == null && typeof usdaFact?.value === 'string' ? usdaFact.value : null;
    const sourceId = gt.texture != null ? undefined : (classFact?.sourceId ?? usdaFact?.sourceId);
    if (texture == null) {
      metrics.push({
        key: 'texture',
        label,
        currentValue: null,
        status: 'no_data',
        note: tx('No texture class is held for this parcel: it is not assumed to be medium.', 'Chưa có lớp thành phần cơ giới cho thửa này: không mặc định là đất thịt trung bình.'),
        isLimiting: false,
      });
    } else {
      const nameEn = usda ? `${TEXTURE_LABEL[texture].en}, ${usda}` : TEXTURE_LABEL[texture].en;
      const usdaVi = usda ? USDA_TEXTURE_VI[usda.toLowerCase()] : undefined;
      const nameVi = usdaVi ? `${TEXTURE_LABEL[texture].vi}, ${usdaVi}` : TEXTURE_LABEL[texture].vi;
      const need = req?.texture;
      if (!need) {
        metrics.push({
          key: 'texture',
          label,
          currentValue: usda ?? texture,
          sourceId,
          status: 'reading_only',
          note: req ? tx(`Texture: ${nameEn}. The crop catalogue holds no texture requirement for ${cropEn}: no verdict.`, `Thành phần cơ giới: ${nameVi}. Danh mục cây trồng không có yêu cầu thành phần cơ giới cho ${cropVi}: không đánh giá.`) : noCropNote,
          isLimiting: false,
        });
      } else {
        const status: SoilMetricStatus = need.opt.includes(texture) ? 'optimal' : need.abs.includes(texture) ? 'tolerable' : 'outside';
        const optEn = classList(need.opt, TEXTURE_LABEL, 'en');
        const optVi = classList(need.opt, TEXTURE_LABEL, 'vi');
        const note =
          status === 'optimal'
            ? tx(`Texture (${nameEn}) is one ${cropEn} grows best in (${optEn}).`, `Thành phần cơ giới (${nameVi}) thuộc nhóm ${cropVi} phát triển tốt nhất (${optVi}).`)
            : status === 'tolerable'
              ? tx(`Texture (${nameEn}) is tolerated by ${cropEn}; it grows best in: ${optEn}.`, `Thành phần cơ giới (${nameVi}) ở mức ${cropVi} chịu được; cây phát triển tốt nhất trên đất: ${optVi}.`)
              : tx(`Texture (${nameEn}) is outside what ${cropEn} tolerates (${classList(need.abs, TEXTURE_LABEL, 'en')}).`, `Thành phần cơ giới (${nameVi}) nằm ngoài mức ${cropVi} chịu được (${classList(need.abs, TEXTURE_LABEL, 'vi')}).`);
        metrics.push({
          key: 'texture',
          label,
          currentValue: usda ?? texture,
          sourceId,
          targetRange: { optLo: need.opt.join(', '), absLo: need.abs.join(', ') },
          status,
          note,
          isLimiting: status === 'outside',
        });
      }
    }
  }

  // 3. Drainage, brought to the three classes of the catalogue the way the model does.
  {
    const label = tx('Soil drainage', 'Khả năng thoát nước');
    const drainFact = findFact(t, 'drainage_class');
    const raw = typeof drainFact?.value === 'string' ? drainFact.value : null;
    const fromMap: DrainageClass | null = raw == null ? null : raw.toLowerCase().includes('poor') ? 'poor' : raw.toLowerCase().includes('excess') ? 'excessive' : 'well';
    const fromGrower: DrainageClass | undefined = gt.drainage ?? (gt.issues?.includes('waterlogging') ? 'poor' : undefined);
    const drainage = fromGrower ?? fromMap;
    if (drainage == null) {
      metrics.push({
        key: 'drainage',
        label,
        currentValue: null,
        status: 'no_data',
        note: tx(
          'No direct soil drainage classification data for this parcel (common outside USA / SSURGO).',
          'Chưa có dữ liệu phân loại cấp thoát nước cho thửa này (thường thấy ngoài vùng phủ SSURGO).',
        ),
        isLimiting: false,
      });
    } else {
      const need = req?.drainage;
      const currentValue = fromGrower == null && raw != null ? raw : drainage;
      const sourceId = fromGrower == null ? drainFact?.sourceId : undefined;
      if (!need) {
        metrics.push({
          key: 'drainage',
          label,
          currentValue,
          sourceId,
          status: 'reading_only',
          note: req ? tx(`The soil is ${DRAINAGE_LABEL[drainage].en}. The crop catalogue holds no drainage requirement for ${cropEn}: no verdict.`, `Đất ${DRAINAGE_LABEL[drainage].vi}. Danh mục cây trồng không có yêu cầu thoát nước cho ${cropVi}: không đánh giá.`) : noCropNote,
          isLimiting: false,
        });
      } else {
        const status: SoilMetricStatus = need.opt.includes(drainage) ? 'optimal' : need.abs.includes(drainage) ? 'tolerable' : 'outside';
        const optEn = classList(need.opt, DRAINAGE_LABEL, 'en');
        const optVi = classList(need.opt, DRAINAGE_LABEL, 'vi');
        const note =
          status === 'optimal'
            ? tx(`The soil is ${DRAINAGE_LABEL[drainage].en}, which is what ${cropEn} grows best in (${optEn}).`, `Đất ${DRAINAGE_LABEL[drainage].vi}, đúng điều kiện ${cropVi} phát triển tốt nhất (${optVi}).`)
            : status === 'tolerable'
              ? tx(`The soil is ${DRAINAGE_LABEL[drainage].en}: tolerated by ${cropEn}, which grows best in soil that is ${optEn}.`, `Đất ${DRAINAGE_LABEL[drainage].vi}: ${cropVi} chịu được, nhưng phát triển tốt nhất trên đất ${optVi}.`)
              : tx(`The soil is ${DRAINAGE_LABEL[drainage].en}: outside what ${cropEn} tolerates (${classList(need.abs, DRAINAGE_LABEL, 'en')}).`, `Đất ${DRAINAGE_LABEL[drainage].vi}: nằm ngoài mức ${cropVi} chịu được (${classList(need.abs, DRAINAGE_LABEL, 'vi')}).`);
        metrics.push({
          key: 'drainage',
          label,
          currentValue,
          sourceId,
          targetRange: { optLo: need.opt.join(', '), absLo: need.abs.join(', ') },
          status,
          note,
          isLimiting: status === 'outside',
        });
      }
    }
  }

  // 4. Soil depth: the depth class of the field against the least depth the crop needs.
  {
    const label = tx('Soil depth', 'Độ sâu tầng đất');
    const depthFact = findFact(t, 'depth_cm');
    const depthCm = gt.soilDepthCm ?? factNum(t, 'depth_cm');
    if (depthCm == null) {
      metrics.push({
        key: 'depth',
        label,
        currentValue: null,
        unit: 'cm',
        status: 'no_data',
        note: tx('No soil depth is held for this parcel.', 'Chưa có số liệu độ sâu tầng đất cho thửa này.'),
        isLimiting: false,
      });
    } else {
      const have = depthClassOf(depthCm);
      const need = req?.depth;
      const sourceId = gt.soilDepthCm != null ? undefined : depthFact?.sourceId;
      if (!need) {
        metrics.push({
          key: 'depth',
          label,
          currentValue: depthCm,
          unit: 'cm',
          sourceId,
          status: 'reading_only',
          note: req ? tx(`Soil depth ${depthCm} cm: ${DEPTH_LABEL[have].en}. The crop catalogue holds no depth requirement for ${cropEn}: no verdict.`, `Tầng đất sâu ${depthCm} cm: ${DEPTH_LABEL[have].vi}. Danh mục cây trồng không có yêu cầu độ sâu cho ${cropVi}: không đánh giá.`) : noCropNote,
          isLimiting: false,
        });
      } else {
        const [h, o, a] = [DEPTH_ORDER.indexOf(have), DEPTH_ORDER.indexOf(need.opt), DEPTH_ORDER.indexOf(need.abs)];
        const status: SoilMetricStatus = h >= o ? 'optimal' : h >= a ? 'tolerable' : 'outside';
        const note =
          status === 'optimal'
            ? tx(`Soil depth ${depthCm} cm (${DEPTH_LABEL[have].en}) meets what ${cropEn} grows best in: ${DEPTH_LABEL[need.opt].en} or deeper.`, `Tầng đất sâu ${depthCm} cm (${DEPTH_LABEL[have].vi}) đạt mức ${cropVi} phát triển tốt nhất: ${DEPTH_LABEL[need.opt].vi} trở lên.`)
            : status === 'tolerable'
              ? tx(`Soil depth ${depthCm} cm (${DEPTH_LABEL[have].en}) is tolerated by ${cropEn}, which grows best in soil that is ${DEPTH_LABEL[need.opt].en} or deeper.`, `Tầng đất sâu ${depthCm} cm (${DEPTH_LABEL[have].vi}) ở mức ${cropVi} chịu được; cây phát triển tốt nhất khi tầng đất ${DEPTH_LABEL[need.opt].vi} trở lên.`)
              : tx(`Soil depth ${depthCm} cm (${DEPTH_LABEL[have].en}) is less than ${cropEn} tolerates: ${DEPTH_LABEL[need.abs].en} at least.`, `Tầng đất sâu ${depthCm} cm (${DEPTH_LABEL[have].vi}) nông hơn mức ${cropVi} chịu được: ít nhất ${DEPTH_LABEL[need.abs].vi}.`);
        metrics.push({
          key: 'depth',
          label,
          currentValue: depthCm,
          unit: 'cm',
          sourceId,
          targetRange: { optLo: need.opt, absLo: need.abs },
          status,
          note,
          isLimiting: status === 'outside',
        });
      }
    }
  }

  // 5. Salinity: the threshold of the crop's salinity class, as the model's Maas-Hoffman response.
  {
    const label = tx('Electrical conductivity / salinity', 'Độ dẫn điện / độ mặn (EC)');
    const ecFact = findFact(t, 'ec_dsm');
    const ecVal = gt.ecDsM ?? factNum(t, 'ec_dsm');
    if (ecVal == null) {
      metrics.push({
        key: 'salinity',
        label,
        currentValue: null,
        unit: 'dS/m',
        status: 'no_data',
        note: tx(
          'No electrical conductivity data recorded (SoilGrids does not map EC; requires field test or SSURGO).',
          'Chưa có dữ liệu độ dẫn điện (SoilGrids không đo EC; cần kiểm tra tại chỗ hoặc SSURGO).',
        ),
        isLimiting: false,
      });
    } else {
      const need = req?.salinity;
      const sourceId = gt.ecDsM != null ? undefined : ecFact?.sourceId;
      if (!need) {
        metrics.push({
          key: 'salinity',
          label,
          currentValue: ecVal,
          unit: 'dS/m',
          sourceId,
          status: 'reading_only',
          note: req ? tx(`EC ${ecVal} dS/m. The crop catalogue holds no salinity class for ${cropEn}: no threshold is known, no verdict.`, `EC ${ecVal} dS/m. Danh mục cây trồng không có lớp chịu mặn cho ${cropVi}: chưa biết ngưỡng, không đánh giá.`) : noCropNote,
          isLimiting: false,
        });
      } else {
        // Yield loss begins above the threshold of the class the crop grows best in; the crop is
        // listed as tolerating soils up to the threshold of its tolerated class.
        const optMax = MAAS_HOFFMAN_PARAMS[need.opt].thresholdDsM;
        const absMax = Math.max(optMax, MAAS_HOFFMAN_PARAMS[need.abs].thresholdDsM);
        const status: SoilMetricStatus = ecVal <= optMax ? 'optimal' : ecVal <= absMax ? 'tolerable' : 'outside';
        const note =
          status === 'optimal'
            ? tx(`EC ${ecVal} dS/m does not exceed ${optMax} dS/m, the level at which the yield of ${cropEn} begins to fall.`, `EC ${ecVal} dS/m không vượt ${optMax} dS/m, mức mà năng suất ${cropVi} bắt đầu giảm.`)
            : status === 'tolerable'
              ? tx(`EC ${ecVal} dS/m is above ${optMax} dS/m, where the yield of ${cropEn} begins to fall, and within the ${absMax} dS/m the crop is listed as tolerating.`, `EC ${ecVal} dS/m cao hơn ${optMax} dS/m, mức năng suất ${cropVi} bắt đầu giảm, và còn trong mức ${absMax} dS/m mà cây được ghi nhận là chịu được.`)
              : tx(`EC ${ecVal} dS/m is above the ${absMax} dS/m ${cropEn} is listed as tolerating.`, `EC ${ecVal} dS/m cao hơn mức ${absMax} dS/m mà ${cropVi} được ghi nhận là chịu được.`);
        metrics.push({
          key: 'salinity',
          label,
          currentValue: ecVal,
          unit: 'dS/m',
          sourceId,
          targetRange: { optHi: optMax, absHi: absMax },
          status,
          deficit: ecVal > optMax ? r1(ecVal - optMax) : 0,
          note,
          isLimiting: status === 'outside',
        });
      }
    }
  }

  // Readings the catalogue has no requirement for: listed with their source, without a verdict.
  const noRequirement = tx(
    'The crop catalogue holds no requirement for this reading, so it is listed without a verdict.',
    'Danh mục cây trồng không có yêu cầu cho chỉ tiêu này nên chỉ liệt kê số đo, không đánh giá.',
  );

  // 6. Organic matter (a reading, or organic carbon x 1.724, the factor the model also uses).
  {
    const label = tx('Soil organic matter', 'Chất hữu cơ trong đất');
    const socFact = findFact(t, 'soc_gkg');
    const socGkg = factNum(t, 'soc_gkg');
    const omFact = findFact(t, 'om_pct');
    const omRead = gt.organicMatterPct ?? factNum(t, 'om_pct');
    const omPercent = omRead ?? (socGkg != null ? r1(socGkg * 0.1724) : null);
    if (omPercent == null) {
      metrics.push({ key: 'organic_matter', label, currentValue: null, unit: '%', status: 'no_data', note: tx('No organic matter data available.', 'Chưa có số liệu hàm lượng hữu cơ.'), isLimiting: false });
    } else {
      const derived = omRead == null;
      metrics.push({
        key: 'organic_matter',
        label,
        currentValue: omPercent,
        unit: '%',
        sourceId: gt.organicMatterPct != null ? undefined : derived ? socFact?.sourceId : omFact?.sourceId,
        status: 'reading_only',
        note: tx(
          `Organic matter ${omPercent}%${derived ? ` (organic carbon ${socGkg} g/kg x 1.724)` : ''}. ${noRequirement.en}`,
          `Chất hữu cơ ${omPercent}%${derived ? ` (cacbon hữu cơ ${socGkg} g/kg x 1,724)` : ''}. ${noRequirement.vi}`,
        ),
        isLimiting: false,
      });
    }
  }

  // 7. Cation exchange capacity.
  {
    const label = tx('Cation exchange capacity (CEC)', 'Dung tích trao đổi cation (CEC)');
    const cecFact = findFact(t, 'cec_cmolkg');
    const cecVal = factNum(t, 'cec_cmolkg');
    if (cecVal == null) {
      metrics.push({ key: 'cec', label, currentValue: null, unit: 'cmol(+)/kg', status: 'no_data', note: tx('No CEC data recorded.', 'Chưa có số liệu dung tích trao đổi cation (CEC).'), isLimiting: false });
    } else {
      metrics.push({
        key: 'cec',
        label,
        currentValue: cecVal,
        unit: 'cmol(+)/kg',
        sourceId: cecFact?.sourceId,
        uncertainty: Array.isArray(cecFact?.uncertainty) ? (cecFact.uncertainty as [number, number]) : null,
        status: 'reading_only',
        note: tx(`CEC ${cecVal} cmol(+)/kg. ${noRequirement.en}`, `CEC ${cecVal} cmol(+)/kg. ${noRequirement.vi}`),
        isLimiting: false,
      });
    }
  }

  // 8. Available water capacity, in mm of water per metre of soil (cm/cm x 1,000).
  {
    const label = tx('Available water capacity (AWC)', 'Khả năng giữ nước hữu dụng (AWC)');
    const awcFact = findFact(t, 'awc_cmcm');
    const awcCmCm = factNum(t, 'awc_cmcm');
    if (awcCmCm == null) {
      metrics.push({
        key: 'awc',
        label,
        currentValue: null,
        unit: 'mm/m',
        status: 'no_data',
        note: tx('No available water capacity is held for this parcel: none is derived from a soil group.', 'Chưa có số liệu khả năng giữ nước hữu dụng cho thửa này: không suy ra từ nhóm đất.'),
        isLimiting: false,
      });
    } else {
      const awcMmM = Math.round(awcCmCm * 1000);
      metrics.push({
        key: 'awc',
        label,
        currentValue: awcMmM,
        unit: 'mm/m',
        sourceId: awcFact?.sourceId,
        status: 'reading_only',
        note: tx(`Available water capacity ${awcMmM} mm of water per metre of soil. ${noRequirement.en}`, `Khả năng giữ nước hữu dụng ${awcMmM} mm nước trên mỗi mét đất. ${noRequirement.vi}`),
        isLimiting: false,
      });
    }
  }

  // 9. Total nitrogen, when the soil map carries it.
  {
    const nitrogenFact = findFact(t, 'nitrogen_gkg');
    const nitrogenVal = factNum(t, 'nitrogen_gkg');
    if (nitrogenVal != null) {
      metrics.push({
        key: 'nitrogen',
        label: tx('Total nitrogen', 'Đạm tổng số (N)'),
        currentValue: nitrogenVal,
        unit: 'g/kg',
        sourceId: nitrogenFact?.sourceId,
        uncertainty: Array.isArray(nitrogenFact?.uncertainty) ? (nitrogenFact.uncertainty as [number, number]) : null,
        status: 'reading_only',
        note: tx(`Total nitrogen ${nitrogenVal} g/kg. ${noRequirement.en}`, `Đạm tổng số ${nitrogenVal} g/kg. ${noRequirement.vi}`),
        isLimiting: false,
      });
    }
  }

  // The limiting factor: among the rows marked limiting, in the order a grower can act on them;
  // failing that, the first row that is tolerated or uncertain.
  const rank: Record<string, number> = { ph: 5, salinity: 4, drainage: 3, depth: 2, texture: 1 };
  const limitingList = metrics.filter((m) => m.isLimiting).sort((a, b) => (rank[b.key] ?? 0) - (rank[a.key] ?? 0));
  const mostLimitingFactor = limitingList[0] ?? metrics.find((m) => m.status === 'tolerable' || m.status === 'uncertain') ?? null;
  const missing = metrics.filter((m) => m.status === 'no_data');

  const missingEn = missing.length ? ` No data for: ${missing.map((m) => m.label.en).join('; ')}.` : '';
  const missingVi = missing.length ? ` Chưa có số liệu: ${missing.map((m) => m.label.vi).join('; ')}.` : '';
  const summary = !c
    ? tx(`No crop is selected: the soil readings are listed without a verdict.${missingEn}`, `Chưa chọn cây: các số đo đất được liệt kê mà không đánh giá.${missingVi}`)
    : mostLimitingFactor
      ? tx(
          `For ${cropEn}, the soil factor to look at first is ${mostLimitingFactor.label.en}: ${STATUS_LABEL[mostLimitingFactor.status].en}.${missingEn}`,
          `Với ${cropVi}, chỉ tiêu đất cần xem trước là ${mostLimitingFactor.label.vi}: ${STATUS_LABEL[mostLimitingFactor.status].vi}.${missingVi}`,
        )
      : tx(
          `No soil reading of this field is outside what ${cropEn} grows best in.${missingEn}`,
          `Không có số đo đất nào của thửa này nằm ngoài điều kiện ${cropVi} phát triển tốt nhất.${missingVi}`,
        );

  return {
    fieldId: input.parcel.id,
    cropId: input.cropId,
    metrics,
    mostLimitingFactor,
    summary,
  };
}
