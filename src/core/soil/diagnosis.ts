import type { CropProfile, I18nText, ModelInput, TextureClass } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { MAAS_HOFFMAN_PARAMS, oldfieldFertilityIndex, scoreFertilityContinuous } from '@/core/scoring/literature';
import { factNum, findFact } from './buffer';
import { classifyReferenceSoilType, SOIL_TYPE_REFERENCES } from './reference';
import type { SoilDiagnosis, SoilMetricDiagnosis, SoilStatus } from './types';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function diagnoseSoil(input: ModelInput): SoilDiagnosis {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const gt = input.groundTruth;

  // Extract base soil properties
  const phFact = findFact(t, 'ph');
  const phVal = gt.ph ?? factNum(t, 'ph');
  const phUncert = gt.ph == null && Array.isArray(phFact?.uncertainty) ? phFact.uncertainty : null;

  const textureClass = gt.texture ?? (findFact(t, 'texture_class')?.value as TextureClass | undefined);
  const usdaTextureFact = findFact(t, 'usda_texture');
  const usdaTexture = usdaTextureFact?.value as string | undefined;

  const socFact = findFact(t, 'soc_gkg');
  const socGkg = factNum(t, 'soc_gkg');
  const omFact = findFact(t, 'om_pct');
  const omVal = gt.organicMatterPct ?? factNum(t, 'om_pct') ?? (socGkg != null ? r1(socGkg * 0.1724) : null);

  const cecFact = findFact(t, 'cec_cmolkg');
  const cecVal = factNum(t, 'cec_cmolkg');

  const awcFact = findFact(t, 'awc_cmcm');
  const awcCmCm = factNum(t, 'awc_cmcm');

  const ecFact = findFact(t, 'ec_dsm');
  const ecVal = gt.ecDsM ?? factNum(t, 'ec_dsm');

  const drainFact = findFact(t, 'drainage_class');
  const drainVal = gt.drainage ?? (drainFact?.value as string | undefined);

  const nitrogenFact = findFact(t, 'nitrogen_gkg');
  const nitrogenVal = factNum(t, 'nitrogen_gkg');

  const bdFact = findFact(t, 'bulk_density');
  const bdVal = factNum(t, 'bulk_density');

  const refType = classifyReferenceSoilType(textureClass, usdaTexture, phVal, socGkg);
  const ref = SOIL_TYPE_REFERENCES[refType];

  const metrics: SoilMetricDiagnosis[] = [];

  // 1. pH
  if (phVal == null) {
    metrics.push({
      key: 'ph',
      label: tx('Soil Reaction (pH)', 'Độ phản ứng của đất (pH)'),
      currentValue: null,
      unit: '',
      status: 'no_data',
      note: tx('No pH data available for this parcel.', 'Chưa có số liệu đo hoặc ước tính pH cho thửa này.'),
      isLimiting: false,
    });
  } else {
    const [absLo, optLo, optHi, absHi] = c?.req.ph ?? [ref.ph.min, ref.ph.opt - 0.5, ref.ph.opt + 0.5, ref.ph.max];
    let status: SoilStatus;
    let deficit: number | null = null;
    let note: I18nText;

    if (phVal >= optLo && phVal <= optHi) {
      status = 'optimal';
      deficit = 0;
      note = tx(
        `pH ${phVal} is in the optimal range (${optLo}-${optHi}) for ${c ? c.names.en : 'selected crops'}.`,
        `pH ${phVal} nằm trọn trong khoảng tối ưu (${optLo}-${optHi}) cho ${c ? (c.names.vi ?? c.names.en) : 'cây trồng'}.`,
      );
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
        `pH ${phVal} is outside tolerable bounds (${absLo}-${absHi}); severely restricts development.`,
        `pH ${phVal} nằm ngoài ngưỡng chịu đựng (${absLo}-${absHi}); cản trở nghiêm trọng sự phát triển của cây.`,
      );
    }

    // Check uncertainty span
    if (phUncert && phUncert.length === 2 && gt.ph == null) {
      const [uLo, uHi] = phUncert;
      if ((uLo < optLo && uHi >= optLo) || (uLo <= optHi && uHi > optHi) || (uLo < absLo && uHi >= absLo)) {
        status = 'uncertain';
        note = tx(
          `Estimated pH is ${phVal}, but 90% confidence interval [${uLo}, ${uHi}] crosses critical agronomic thresholds. On-site verification recommended.`,
          `pH ước tính là ${phVal}, nhưng khoảng tin cậy 90% [${uLo}, ${uHi}] vắt qua ngưỡng nông học tới hạn. Cần kiểm tra thực địa.`,
        );
      }
    }

    metrics.push({
      key: 'ph',
      label: tx('Soil Reaction (pH)', 'Độ phản ứng của đất (pH)'),
      currentValue: phVal,
      unit: '',
      sourceId: phFact?.sourceId,
      uncertainty: phUncert,
      targetRange: { optLo, optHi, absLo, absHi },
      status,
      deficit,
      note,
      isLimiting: status === 'outside' || (deficit != null && deficit > 0),
    });
  }

  // 2. Texture Class
  const currentTexture = textureClass;
  const cropTextureOpt = c?.req.texture?.opt;
  const cropTextureAbs = c?.req.texture?.abs;
  let texStatus: SoilStatus = 'optimal';
  let texNote: I18nText;

  if (currentTexture == null) {
    texStatus = 'no_data';
    texNote = tx(
      'No soil texture classification is available for this parcel.',
      'Chưa có dữ liệu phân loại thành phần cơ giới của thửa này.',
    );
  } else if (cropTextureOpt && cropTextureOpt.length > 0) {
    if (cropTextureOpt.includes(currentTexture)) {
      texStatus = 'optimal';
      texNote = tx(
        `Texture (${currentTexture}) matches optimal requirements for ${c?.names.en}.`,
        `Cơ giới đất (${currentTexture}) phù hợp tối ưu với ${c?.names.vi ?? c?.names.en}.`,
      );
    } else if (cropTextureAbs && cropTextureAbs.includes(currentTexture)) {
      texStatus = 'tolerable';
      texNote = tx(
        `Texture (${currentTexture}) is tolerable for ${c?.names.en}.`,
        `Cơ giới đất (${currentTexture}) ở mức cây có thể chịu được.`,
      );
    } else {
      texStatus = 'outside';
      texNote = tx(
        `Texture (${currentTexture}) is outside ideal tolerance for ${c?.names.en}.`,
        `Cơ giới đất (${currentTexture}) không thuận lợi cho ${c?.names.vi ?? c?.names.en}.`,
      );
    }
  } else {
    texNote = tx(
      `Classified as ${refType} based on clay/sand proportions (${usdaTexture ?? currentTexture}).`,
      `Phân loại nhóm ${refType} dựa trên tỷ lệ sét/cát (${usdaTexture ?? currentTexture}).`,
    );
  }

  metrics.push({
    key: 'texture',
    label: tx('Soil Texture', 'Thành phần cơ giới đất'),
    currentValue: currentTexture == null ? null : usdaTexture ?? currentTexture,
    unit: '',
    sourceId: usdaTextureFact?.sourceId ?? findFact(t, 'texture_class')?.sourceId,
    status: texStatus,
    note: texNote,
    isLimiting: texStatus === 'outside',
  });

  // 3. Drainage
  if (drainVal == null) {
    metrics.push({
      key: 'drainage',
      label: tx('Soil Drainage', 'Khả năng thoát nước'),
      currentValue: null,
      unit: '',
      status: 'no_data',
      note: tx(
        'No direct soil drainage classification data for this parcel (common outside USA / SSURGO).',
        'Chưa có dữ liệu phân loại cấp thoát nước cho thửa này (thường thấy ngoài vùng phủ SSURGO).',
      ),
      isLimiting: false,
    });
  } else {
    const drainNorm = drainVal.toLowerCase();
    const isPoor = drainNorm.includes('poor');
    const isExcess = drainNorm.includes('excess');
    const isWell = drainNorm.includes('well') || drainNorm.includes('moderate');

    const drainageClass = isPoor ? 'poor' : isExcess ? 'excessive' : isWell ? 'well' : null;
    let dStatus: SoilStatus = 'no_data';
    if (drainageClass != null && c?.req.drainage) {
      if (c.req.drainage.opt.includes(drainageClass)) dStatus = 'optimal';
      else if (c.req.drainage.abs.includes(drainageClass)) dStatus = 'tolerable';
      else dStatus = 'outside';
    }

    metrics.push({
      key: 'drainage',
      label: tx('Soil Drainage', 'Khả năng thoát nước'),
      currentValue: drainVal,
      sourceId: drainFact?.sourceId,
      status: dStatus,
      note: tx(
        `Drainage status is categorized as ${drainVal}.`,
        `Hiện trạng thoát nước được đánh giá ở mức: ${drainVal}.`,
      ),
      isLimiting: dStatus === 'outside',
    });
  }

  // 4. Soil depth. Keep the same class boundaries as the scoring model.
  const depthFact = findFact(t, 'depth_cm');
  const depthCm = gt.soilDepthCm ?? factNum(t, 'depth_cm');
  const depthClass = depthCm == null ? null : depthCm < 20 ? 'very-shallow' : depthCm < 50 ? 'shallow' : depthCm <= 150 ? 'medium' : 'deep';
  if (depthClass == null || !c?.req.depth) {
    metrics.push({
      key: 'depth',
      label: tx('Soil depth', 'Độ sâu tầng đất'),
      currentValue: depthCm,
      unit: 'cm',
      sourceId: depthFact?.sourceId,
      status: 'no_data',
      note: tx('No crop-comparable soil depth requirement or measurement is available.', 'Chưa có số đo độ sâu hoặc yêu cầu độ sâu tương ứng của cây.'),
      isLimiting: false,
    });
  } else {
    const depthOrder = ['very-shallow', 'shallow', 'medium', 'deep'];
    const actualRank = depthOrder.indexOf(depthClass);
    const optRank = depthOrder.indexOf(c.req.depth.opt);
    const absRank = depthOrder.indexOf(c.req.depth.abs);
    const dStatus: SoilStatus = actualRank >= optRank ? 'optimal' : actualRank >= absRank ? 'tolerable' : 'outside';
    metrics.push({
      key: 'depth',
      label: tx('Soil depth', 'Độ sâu tầng đất'),
      currentValue: depthCm,
      unit: 'cm',
      sourceId: depthFact?.sourceId,
      targetRange: { optLo: c.req.depth.opt, absLo: c.req.depth.abs },
      status: dStatus,
      note: tx(`Soil depth is ${depthCm} cm (${depthClass}); crop requirement is ${c.req.depth.opt} optimal and ${c.req.depth.abs} tolerated.`, `Độ sâu đất là ${depthCm} cm (${depthClass}); cây cần mức ${c.req.depth.opt} tối ưu và ${c.req.depth.abs} có thể chịu.`),
      isLimiting: dStatus === 'outside',
    });
  }

  // 5. Salinity / EC
  if (ecVal == null) {
    metrics.push({
      key: 'salinity',
      label: tx('Electrical Conductivity / Salinity', 'Độ dẫn điện / Độ mặn (EC)'),
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
    let sStatus: SoilStatus = 'optimal';
    let sLimit = false;
    let sNote: I18nText;

    const salinityNeed = c?.req.salinity;
    const optThreshold = salinityNeed ? MAAS_HOFFMAN_PARAMS[salinityNeed.opt].thresholdDsM : null;
    const absThreshold = salinityNeed ? MAAS_HOFFMAN_PARAMS[salinityNeed.abs].thresholdDsM : null;

    if (optThreshold == null || absThreshold == null) {
      sStatus = 'no_data';
      sNote = tx(
        'The selected crop has no published salinity tolerance class; salinity is not classified.',
        'Cây đã chọn chưa có lớp chịu mặn được công bố; không phân loại độ mặn.',
      );
    } else if (ecVal <= optThreshold) {
      sStatus = 'optimal';
      sNote = tx(`Salinity level (${ecVal} dS/m) is within the crop's optimal tolerance (${optThreshold} dS/m).`, `Độ mặn (${ecVal} dS/m) nằm trong ngưỡng chịu tối ưu của cây (${optThreshold} dS/m).`);
    } else if (ecVal <= absThreshold) {
      sStatus = 'tolerable';
      sNote = tx(`Salinity (${ecVal} dS/m) is tolerated but above the crop's optimal threshold (${optThreshold} dS/m).`, `Độ mặn (${ecVal} dS/m) còn chịu được nhưng cao hơn ngưỡng tối ưu của cây (${optThreshold} dS/m).`);
    } else {
      sStatus = 'outside';
      sLimit = true;
      sNote = tx(`Salinity (${ecVal} dS/m) is outside the crop's tolerated threshold (${absThreshold} dS/m).`, `Độ mặn (${ecVal} dS/m) vượt ngưỡng chịu đựng của cây (${absThreshold} dS/m).`);
    }

    metrics.push({
      key: 'salinity',
      label: tx('Electrical Conductivity / Salinity', 'Độ dẫn điện / Độ mặn (EC)'),
      currentValue: ecVal,
      unit: 'dS/m',
      sourceId: ecFact?.sourceId,
      status: sStatus,
      deficit: optThreshold == null ? null : ecVal > optThreshold ? r1(ecVal - optThreshold) : 0,
      note: sNote,
      isLimiting: sLimit,
    });
  }

  // 5. Soil Organic Carbon / Organic Matter
  if (omVal == null && socGkg == null) {
    metrics.push({
      key: 'organic_matter',
      label: tx('Soil Organic Matter', 'Chất hữu cơ trong đất (SOM)'),
      currentValue: null,
      unit: '%',
      status: 'no_data',
      note: tx('No organic matter data available.', 'Chưa có số liệu hàm lượng hữu cơ.'),
      isLimiting: false,
    });
  } else {
    const omPercent = omVal ?? (socGkg != null ? r1(socGkg * 0.1724) : null);
    if (omPercent == null) {
      metrics.push({
        key: 'organic_matter',
        label: tx('Soil Organic Matter', 'Chất hữu cơ trong đất (SOM)'),
        currentValue: null,
        unit: '%',
        status: 'no_data',
        note: tx('No organic matter data available.', 'Chưa có số liệu hàm lượng hữu cơ.'),
        isLimiting: false,
      });
    } else {
    let omStatus: SoilStatus = 'optimal';
    let omNote: I18nText;

    if (omPercent >= 2.5) {
      omStatus = 'optimal';
      omNote = tx(`Good organic matter content (${omPercent}%). Sustains biological activity and water holding.`, `Hàm lượng hữu cơ tốt (${omPercent}%). Duy trì hoạt tính vi sinh và giữ ẩm.`);
    } else if (omPercent >= 1.5) {
      omStatus = 'tolerable';
      omNote = tx(`Moderate organic matter (${omPercent}%). Supplemental compost/cover crops will improve structure.`, `Hàm lượng hữu cơ trung bình (${omPercent}%). Bổ sung phân compost/cây phân xanh để cải thiện kết cấu.`);
    } else {
      omStatus = 'outside';
      omNote = tx(`Low organic matter (${omPercent}%). Accelerated mineralisation risk; prioritize organic inputs.`, `Hàm lượng hữu cơ nghèo (${omPercent}%). Nguy cơ thoái hóa đất; cần ưu tiên bón phân hữu cơ.`);
    }

    metrics.push({
      key: 'organic_matter',
      label: tx('Soil Organic Matter', 'Chất hữu cơ trong đất (SOM)'),
      currentValue: omPercent,
      unit: '%',
      sourceId: omFact?.sourceId ?? socFact?.sourceId,
      status: omStatus,
      deficit: omPercent < 2.5 ? r1(2.5 - omPercent) : 0,
      note: omNote,
      isLimiting: omStatus === 'outside',
    });
    }
  }

  // 6. Cation Exchange Capacity (CEC)
  if (cecVal == null) {
    metrics.push({
      key: 'cec',
      label: tx('Cation Exchange Capacity (CEC)', 'Dung tích hấp phụ / trao đổi cation (CEC)'),
      currentValue: null,
      unit: 'meq/100g',
      status: 'no_data',
      note: tx('No CEC data recorded.', 'Chưa có số liệu dung tích trao đổi cation (CEC).'),
      isLimiting: false,
    });
  } else {
    const { min: cecMin, opt: cecOpt, max: cecMax } = ref.cecMeq100g;
    let cecStatus: SoilStatus = 'optimal';
    if (cecVal < cecMin) cecStatus = 'outside';
    else if (cecVal < cecOpt) cecStatus = 'tolerable';
    else cecStatus = 'optimal';

    metrics.push({
      key: 'cec',
      label: tx('Cation Exchange Capacity (CEC)', 'Dung tích trao đổi cation (CEC)'),
      currentValue: cecVal,
      unit: 'meq/100g',
      sourceId: cecFact?.sourceId,
      targetRange: { optLo: cecOpt, optHi: cecMax, absLo: cecMin, absHi: cecMax },
      status: cecStatus,
      deficit: cecVal < cecOpt ? r1(cecOpt - cecVal) : 0,
      note: tx(
        `CEC is ${cecVal} meq/100g (Baseline for ${refType}: min ${cecMin}, opt ${cecOpt}). ${cecVal < cecOpt ? 'Nutrient retention capacity is modest.' : 'High nutrient buffer capacity.'}`,
        `CEC đạt ${cecVal} meq/100g (Chuẩn nhóm ${refType}: tối thiểu ${cecMin}, tối ưu ${cecOpt}). ${cecVal < cecOpt ? 'Khả năng giữ phân bón ở mức khiêm tốn.' : 'Khả năng đệm và giữ dinh dưỡng tốt.'}`,
      ),
      isLimiting: cecStatus === 'outside',
    });
  }

  // 7. Fertility. Use the same continuous index and crop requirement thresholds
  // as the scoring model; do not substitute the reference soil table.
  const fertilityIndex = oldfieldFertilityIndex(socGkg, cecVal);
  const fertilityScore = scoreFertilityContinuous(fertilityIndex, c?.req.fertility);
  const fertilityStatus: SoilStatus = fertilityScore == null
    ? 'no_data'
    : fertilityScore === 1
      ? 'optimal'
      : fertilityScore >= 0.7
        ? 'tolerable'
        : 'outside';
  metrics.push({
    key: 'fertility',
    label: tx('Soil fertility (organic carbon, CEC)', 'Độ phì (carbon hữu cơ, CEC)'),
    currentValue: fertilityIndex,
    unit: 'index',
    sourceId: socFact?.sourceId ?? cecFact?.sourceId,
    status: fertilityStatus,
    deficit: fertilityScore == null ? null : r2(1 - fertilityScore),
    note: fertilityScore == null
      ? tx('Organic carbon and/or CEC data required for the crop fertility model.', 'Cần có dữ liệu carbon hữu cơ và/hoặc CEC để dùng mô hình độ phì của cây.')
      : tx(`Model fertility index is ${r2(fertilityIndex ?? 0)} and the crop factor score is ${r2(fertilityScore)}.`, `Chỉ số độ phì theo mô hình là ${r2(fertilityIndex ?? 0)} và điểm yếu tố của cây là ${r2(fertilityScore)}.`),
    isLimiting: fertilityStatus === 'outside',
  });

  // 8. Available Water Capacity (AWC)
  if (awcCmCm == null) {
    metrics.push({
      key: 'awc',
      label: tx('Available Water Capacity (AWC)', 'Khả năng giữ nước hữu dụng (AWC)'),
      currentValue: null,
      unit: 'in/ft',
      status: 'no_data',
      note: tx('No available water capacity measurement is available for this parcel.', 'Chưa có số liệu khả năng giữ nước hữu dụng của thửa này.'),
      isLimiting: false,
    });
  } else {
    // Convert cm/cm to in/ft: 1 cm/cm = 12 in/ft
    const awcInFt = r2(awcCmCm * 12);
    const { min: aMin, opt: aOpt, max: aMax } = ref.awcInFt;
    let aStatus: SoilStatus = 'optimal';
    if (awcInFt < aMin) aStatus = 'outside';
    else if (awcInFt < aOpt) aStatus = 'tolerable';

    metrics.push({
      key: 'awc',
      label: tx('Available Water Capacity (AWC)', 'Khả năng giữ nước hữu dụng (AWC)'),
      currentValue: awcInFt,
      unit: 'in/ft',
      sourceId: awcFact?.sourceId,
      targetRange: { optLo: aOpt, optHi: aMax, absLo: aMin, absHi: aMax },
      status: aStatus,
      note: tx(
        `Available water capacity is ${awcInFt} in/ft (Baseline for ${refType}: ${aOpt} in/ft).`,
        `Khả năng giữ ẩm hữu dụng đạt ${awcInFt} in/ft (Chuẩn nhóm đất ${refType}: ${aOpt} in/ft).`,
      ),
      isLimiting: aStatus === 'outside',
    });
  }

  // 9. Primary Nitrogen observation
  if (nitrogenVal != null) {
    metrics.push({
      key: 'nitrogen',
      label: tx('Total Nitrogen', 'Đạm tổng số (N)'),
      currentValue: nitrogenVal,
      unit: 'g/kg',
      sourceId: nitrogenFact?.sourceId,
      status: nitrogenVal >= 1.5 ? 'optimal' : 'tolerable',
      note: tx(
        `Total soil nitrogen is ${nitrogenVal} g/kg. Reference maintenance application for ${refType}: ${ref.macronutrientsKgHa.n} kg N/ha/yr. (IFA World Fertilizer Use Manual).`,
        `Đạm tổng số trong đất đạt ${nitrogenVal} g/kg. Nhu cầu bón bổ sung định mức cho đất ${refType}: ${ref.macronutrientsKgHa.n} kg N/ha/năm. (Cẩm nang IFA).`,
      ),
      isLimiting: false,
    });
  }

  // Determine most limiting factor
  const limitingList = metrics.filter((m) => m.isLimiting);
  let mostLimitingFactor: SoilMetricDiagnosis | null = null;
  if (limitingList.length > 0) {
    // Priority of limitations: pH > salinity > drainage > texture > cec
    const rank: Record<string, number> = { ph: 5, salinity: 4, drainage: 3, texture: 2, cec: 1 };
    limitingList.sort((a, b) => (rank[b.key] ?? 0) - (rank[a.key] ?? 0));
    mostLimitingFactor = limitingList[0];
  } else {
    // If none are strictly outside, pick tolerable with largest deficit or uncertainty
    const tolerable = metrics.filter((m) => m.status === 'tolerable' || m.status === 'uncertain');
    if (tolerable.length > 0) {
      mostLimitingFactor = tolerable[0];
    }
  }

  const summary = mostLimitingFactor
    ? tx(
        `Soil categorized as ${refType}. Primary constraint is ${mostLimitingFactor.label.en} (${mostLimitingFactor.status}).`,
        `Đất thuộc nhóm ${refType}. Yếu tố hạn chế chính là ${mostLimitingFactor.label.vi} (${mostLimitingFactor.status}).`,
      )
    : tx(
        `Soil categorized as ${refType}. Physical and chemical metrics align well with crop targets.`,
        `Đất thuộc nhóm ${refType}. Các chỉ tiêu lý hóa cơ bản phù hợp với cây trồng mục tiêu.`,
      );

  return {
    fieldId: input.parcel.id,
    cropId: input.cropId,
    soilType: refType,
    metrics,
    mostLimitingFactor,
    summary,
  };
}

