import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';

export type SomStatus = 'optimal' | 'suboptimal' | 'depleted' | 'unknown';

export interface SomTargetRange {
  /** Minimum target SOM (%) required to sustain structure and water holding capacity. */
  minPct: number;
  /** Upper optimal threshold of SOM (%). */
  optimalPct: number;
}

export interface SomPathway {
  id: 'green_manure' | 'residue_retention' | 'compost' | 'biochar';
  title: I18nText;
  description: I18nText;
  estimatedAnnualGainPct: [min: number, max: number];
}

export interface OrganicMatterAssessment {
  /** Current soil organic matter percentage (%). */
  currentSomPct: number | null;
  /** 90% confidence interval [Q0.05, Q0.95] if derived from SoilGrids. */
  uncertaintySpan?: [min: number, max: number];
  sourceId: string | null;
  sourceName: I18nText;
  fromGrower: boolean;
  textureClass: 'light' | 'medium' | 'heavy' | 'unknown';
  /** True if parcel is in tropical or warm climate (accelerated carbon decomposition). */
  isTropical: boolean;
  targetRange: SomTargetRange | null;
  status: SomStatus;
  /** Difference below target minPct (0 if optimal). */
  deficitPct: number;
  citation: string;
  summary: I18nText;
  pathways: SomPathway[];
}

/**
 * Science-based SOM (%) target matrix derived from FAO Soils Bulletin 80 (2005)
 * and USDA NRCS Soil Quality Indicators (2001).
 */
export const SOM_TARGETS: Record<'temperate' | 'tropical', Record<'light' | 'medium' | 'heavy', SomTargetRange>> = {
  temperate: {
    light: { minPct: 1.8, optimalPct: 2.5 },
    medium: { minPct: 2.8, optimalPct: 4.0 },
    heavy: { minPct: 3.5, optimalPct: 5.0 },
  },
  tropical: {
    light: { minPct: 1.2, optimalPct: 2.0 },
    medium: { minPct: 2.2, optimalPct: 3.2 },
    heavy: { minPct: 2.8, optimalPct: 4.0 },
  },
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Van Bemmelen conversion factor relating Soil Organic Carbon (SOC) to Soil Organic Matter (SOM). */
export const VAN_BEMMELEN_FACTOR = 1.724;

/**
 * Evaluates soil organic matter status against texture and climate targets,
 * and proposes rotation-linked soil carbon building pathways (Issue #48 / S7).
 */
export function assessSoilOrganicMatter(
  input: ModelInput,
  overrides?: {
    somPct?: number;
    textureClass?: 'light' | 'medium' | 'heavy';
    isTropical?: boolean;
  }
): OrganicMatterAssessment {
  const gt = input.groundTruth;
  const facts = input.telemetry.branches.soil?.facts ?? [];
  const sources = input.telemetry.sources;

  const omFact = facts.find((f) => f.key === 'om_pct');
  const socFact = facts.find((f) => f.key === 'soc_gkg');
  const textureFact = facts.find((f) => f.key === 'texture_class' || f.key === 'usda_texture');

  // Determine SOM percentage and provenance
  let somVal: number | null = null;
  let sourceId: string | null = null;
  let sourceName = tx('Estimated from soil map', 'Ước tính từ bản đồ đất');
  let fromGrower = false;
  let uncertaintySpan: [number, number] | undefined = undefined;

  if (overrides?.somPct !== undefined) {
    somVal = r2(overrides.somPct);
    sourceId = 'user-override';
    sourceName = tx('User override', 'Nhập ghi đè');
    fromGrower = true;
  } else if (gt.organicMatterPct !== undefined) {
    somVal = r2(gt.organicMatterPct);
    sourceId = 'ground-truth';
    sourceName = tx('Your own measurement', 'Số đo của bạn');
    fromGrower = true;
  } else if (omFact && typeof omFact.value === 'number') {
    somVal = r2(omFact.value);
    sourceId = omFact.sourceId;
    sourceName = sources[omFact.sourceId]?.name ? tx(sources[omFact.sourceId].name, sources[omFact.sourceId].name) : sourceName;
    if (omFact.uncertainty) {
      uncertaintySpan = [r2(omFact.uncertainty[0]), r2(omFact.uncertainty[1])];
    }
  } else if (socFact && typeof socFact.value === 'number') {
    // Convert SOC (g/kg) to SOM (%) using Van Bemmelen factor: (SOC g/kg * 1.724) / 10
    somVal = r2((socFact.value * VAN_BEMMELEN_FACTOR) / 10);
    sourceId = socFact.sourceId;
    sourceName = sources[socFact.sourceId]?.name ? tx(sources[socFact.sourceId].name, sources[socFact.sourceId].name) : sourceName;
    if (socFact.uncertainty) {
      uncertaintySpan = [
        r2((socFact.uncertainty[0] * VAN_BEMMELEN_FACTOR) / 10),
        r2((socFact.uncertainty[1] * VAN_BEMMELEN_FACTOR) / 10),
      ];
    }
  }

  // Determine texture
  let texClass: 'light' | 'medium' | 'heavy' | 'unknown' = 'unknown';
  if (overrides?.textureClass) {
    texClass = overrides.textureClass;
  } else if (gt.texture && gt.texture !== 'organic') {
    texClass = gt.texture;
  } else if (textureFact && typeof textureFact.value === 'string') {
    const val = textureFact.value.toLowerCase();
    if (val.includes('light') || val.includes('sand')) texClass = 'light';
    else if (val.includes('medium') || val.includes('loam') || val.includes('silt')) texClass = 'medium';
    else if (val.includes('heavy') || val.includes('clay')) texClass = 'heavy';
  }

  // Determine climate zone (tropical vs temperate)
  let isTropical = false;
  if (overrides?.isTropical !== undefined) {
    isTropical = overrides.isTropical;
  } else {
    const centroid = input.parcel?.centroid;
    const lat = centroid ? Math.abs(centroid[1]) : 30;
    const countryCode = (input.parcel as { place?: { countryCode?: string } })?.place?.countryCode;
    isTropical = lat < 23.5 || countryCode === 'VN';
  }

  const citation = 'FAO (2005) Soils Bulletin 80; USDA NRCS (2001) Soil Quality Information Sheet: Soil Organic Matter; Six et al. (2002).';

  const pathways: SomPathway[] = [
    {
      id: 'green_manure',
      title: tx('Legume cover crops and green manure in rotation', 'Trồng luân canh cây họ đậu phủ đất và phân xanh'),
      description: tx(
        'Integrate fast-growing nitrogen-fixing legumes (Sesbania, Arachis pintoi, sunn hemp, or crimson clover) between main seasons to produce 2–4 t/ha of active biomass carbon.',
        'Xen vụ bằng các cây họ đậu cố định đạm sinh trưởng nhanh (điên điển, lạc dại, điền thanh, cỏ ba lá) để bổ sung 2–4 tấn/ha sinh khối carbon hoạt tính.'
      ),
      estimatedAnnualGainPct: [0.08, 0.18],
    },
    {
      id: 'residue_retention',
      title: tx('100% crop residue retention & reduced tillage', 'Giữ lại 100% tàn dư rơm rạ / bã ngô và giảm thiểu cày xới'),
      description: tx(
        'Leave harvest residues and stover spread uniformly on the surface rather than burning or removing; reduces oxidation and erosion losses.',
        'Để lại toàn bộ gốc rạ và thân lá ngô rải đều trên ruộng thay vì đốt hoặc gom sạch; giúp giảm thoái hóa carbon do rửa trôi và oxy hóa.'
      ),
      estimatedAnnualGainPct: [0.05, 0.12],
    },
    {
      id: 'compost',
      title: tx('Targeted application of aged compost or farmyard manure', 'Bón bổ sung phân chuồng hoai mục hoặc phân ủ compost'),
      description: tx(
        'Apply 5–10 t/ha of mature compost or decomposed manure prior to primary tillage to build humus reserves and microbial activity.',
        'Bón 5–10 tấn/ha phân ủ hoai mục hoặc phân chuồng trước khi gieo trồng để bổ sung lượng mùn bền vững và kích hoạt vi sinh vật có ích.'
      ),
      estimatedAnnualGainPct: [0.10, 0.25],
    },
    {
      id: 'biochar',
      title: tx('Biochar application for stable recalcitrant carbon', 'Bón than sinh học (biochar) tạo carbon bền vững lâu dài'),
      description: tx(
        'In tropical and sandy soils where organic matter decomposes rapidly, apply 2–5 t/ha of pyrolyzed biochar to lock carbon for decades and boost CEC.',
        'Ở vùng nhiệt đới và đất cát nơi chất hữu cơ bị phân giải rất nhanh, bón 2–5 tấn/ha than sinh học giúp cố định carbon hàng chục năm và tăng dung tích CEC.'
      ),
      estimatedAnnualGainPct: [0.15, 0.35],
    },
  ];

  if (somVal === null || texClass === 'unknown') {
    return {
      currentSomPct: somVal,
      sourceId,
      sourceName,
      fromGrower,
      textureClass: texClass,
      isTropical,
      targetRange: null,
      status: 'unknown',
      deficitPct: 0,
      citation,
      summary: tx(
        'Soil organic matter or texture data is missing. Laboratory soil organic carbon testing is recommended.',
        'Thiếu số liệu chất hữu cơ hoặc thành phần cơ giới đất. Khuyến nghị gửi mẫu thử hàm lượng carbon hữu cơ tại phòng thí nghiệm.'
      ),
      pathways,
    };
  }

  const climateKey = isTropical ? 'tropical' : 'temperate';
  const targetRange = SOM_TARGETS[climateKey][texClass];

  let status: SomStatus = 'optimal';
  let deficitPct = 0;

  if (somVal >= targetRange.minPct) {
    status = 'optimal';
    deficitPct = 0;
  } else if (somVal >= targetRange.minPct * 0.7) {
    status = 'suboptimal';
    deficitPct = r2(targetRange.minPct - somVal);
  } else {
    status = 'depleted';
    deficitPct = r2(targetRange.minPct - somVal);
  }

  let summary: I18nText;
  if (status === 'optimal') {
    summary = tx(
      `Soil organic matter of ${somVal}% meets or exceeds the target range (${targetRange.minPct}–${targetRange.optimalPct}%) for ${texClass} soil in a ${climateKey} climate.`,
      `Hàm lượng chất hữu cơ ${somVal}% đạt hoặc vượt ngưỡng mục tiêu (${targetRange.minPct}–${targetRange.optimalPct}%) đối với đất cơ giới ${texClass} vùng khí hậu ${climateKey === 'tropical' ? 'nhiệt đới' : 'ôn đới'}.`
    );
  } else if (status === 'suboptimal') {
    summary = tx(
      `Soil organic matter of ${somVal}% is below the target minimum (${targetRange.minPct}%), with a deficit of ${deficitPct}%. Cover crops and residue retention are recommended.`,
      `Hàm lượng chất hữu cơ ${somVal}% thấp hơn mức khuyến nghị tối thiểu (${targetRange.minPct}%), thiếu hụt ${deficitPct}%. Khuyến nghị trồng cây phân xanh và giữ lại tàn dư cây trồng.`
    );
  } else {
    summary = tx(
      `Soil organic matter of ${somVal}% is critically depleted compared to the ${targetRange.minPct}% threshold (deficit of ${deficitPct}%). Urgent compost and organic replenishment required.`,
      `Hàm lượng chất hữu cơ ${somVal}% ở mức suy kiệt nghiêm trọng so với ngưỡng ${targetRange.minPct}% (thiếu hụt ${deficitPct}%). Cần bón phân hữu cơ và phân ủ cải tạo đất khẩn cấp.`
    );
  }

  return {
    currentSomPct: somVal,
    uncertaintySpan,
    sourceId,
    sourceName,
    fromGrower,
    textureClass: texClass,
    isTropical,
    targetRange,
    status,
    deficitPct,
    citation,
    summary,
    pathways,
  };
}
