import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';

export type CompactionRisk = 'ideal' | 'moderate' | 'severe' | 'unknown';

export interface TextureBulkDensityThresholds {
  /** Upper bound of bulk density optimal for root growth (g/cm³). */
  idealMax: number;
  /** Bulk density threshold where root growth begins to be affected (g/cm³). */
  affectsGrowth: number;
  /** Bulk density threshold that severely restricts root penetration (g/cm³). */
  restrictsRoot: number;
}

export interface CompactionRecommendation {
  type: 'mechanical' | 'biological' | 'cultural' | 'testing';
  title: I18nText;
  description: I18nText;
}

export interface CompactionFieldTest {
  testName: I18nText;
  method: I18nText;
  interpretation: I18nText;
}

export interface CompactionAssessment {
  /** Measured or estimated soil bulk density in g/cm³. */
  bulkDensityGPerCm3: number | null;
  /** 90% confidence interval [Q0.05, Q0.95] from SoilGrids if available. */
  uncertaintySpan?: [number, number];
  /** General texture classification used for threshold lookup. */
  textureClass: 'light' | 'medium' | 'heavy' | 'unknown';
  /** Granular USDA texture if identified (e.g. clay loam, sandy loam). */
  detailedTexture?: string;
  /** Texture-specific bulk density thresholds (USDA NRCS 1999). */
  thresholds: TextureBulkDensityThresholds | null;
  /** Compaction risk classification. */
  risk: CompactionRisk;
  /** Whether bulk density reaches or exceeds the root-restricting threshold. */
  isRestricting: boolean;
  /** Literature reference citation. */
  citation: string;
  /** Bilingual summary of the compaction status. */
  summary: I18nText;
  /** Actionable remediation measures. */
  recommendations: CompactionRecommendation[];
  /** Field validation test instructions for growers. */
  fieldTestProtocol: CompactionFieldTest;
}

/**
 * Bulk density thresholds (g/cm³) based on USDA NRCS Soil Quality Institute (1999):
 * "Soil Quality Information Sheet: Bulk Density" & Pierce et al. (1983).
 */
export const USDA_COMPACTION_THRESHOLDS: Record<'light' | 'medium' | 'heavy', TextureBulkDensityThresholds> = {
  light: {
    idealMax: 1.60,
    affectsGrowth: 1.69,
    restrictsRoot: 1.80,
  },
  medium: {
    idealMax: 1.40,
    affectsGrowth: 1.55,
    restrictsRoot: 1.65,
  },
  heavy: {
    idealMax: 1.10,
    affectsGrowth: 1.40,
    restrictsRoot: 1.47,
  },
};

/**
 * Assesses soil compaction risk and root-limiting bulk density according to
 * USDA NRCS guidelines.
 */
export function assessSoilCompaction(
  input: ModelInput,
  overrides?: {
    bulkDensityGPerCm3?: number;
    textureClass?: 'light' | 'medium' | 'heavy';
  }
): CompactionAssessment {
  const facts = input.telemetry.branches.soil?.facts ?? [];
  const bdFact = facts.find((f) => f.key === 'bulk_density' || f.key === 'bdod');
  const textureFact = facts.find((f) => f.key === 'texture_class' || f.key === 'usda_texture');
  const detailedFact = facts.find((f) => f.key === 'usda_texture');

  // Determine bulk density
  let bdVal: number | null = null;
  if (overrides?.bulkDensityGPerCm3 !== undefined) {
    bdVal = overrides.bulkDensityGPerCm3;
  } else if (bdFact && typeof bdFact.value === 'number') {
    // SoilGrids raw bdod is usually cg/cm³, but in Astrovivu samples it is formatted as g/cm³
    bdVal = bdFact.value > 10 ? bdFact.value / 100 : bdFact.value;
  }

  // Determine texture class
  let texClass: 'light' | 'medium' | 'heavy' | 'unknown' = 'unknown';
  if (overrides?.textureClass) {
    texClass = overrides.textureClass;
  } else if (input.groundTruth.texture && input.groundTruth.texture !== 'organic') {
    texClass = input.groundTruth.texture;
  } else if (textureFact && typeof textureFact.value === 'string') {
    const val = textureFact.value.toLowerCase();
    if (val.includes('light') || val.includes('sand')) texClass = 'light';
    else if (val.includes('medium') || val.includes('loam') || val.includes('silt')) texClass = 'medium';
    else if (val.includes('heavy') || val.includes('clay')) texClass = 'heavy';
  }

  const detailedTexture = typeof detailedFact?.value === 'string' ? detailedFact.value : undefined;
  const citation = 'USDA NRCS (1999). Soil Quality Information Sheet: Bulk Density; Pierce et al. (1983).';

  const defaultTest: CompactionFieldTest = {
    testName: tx('Wire flag / penetrometer resistance test', 'Thử nghiệm cắm que cờ / đồng hồ đo độ nén'),
    method: tx(
      'Push a straight 3 mm steel wire flag or penetrometer into moist soil at field capacity. Note the depth (cm) where resistance sharply increases.',
      'Cắm thẳng một que cờ thép 3 mm hoặc đồng hồ đo lực nén vào đất ẩm ở trạng thái ẩm độ đồng ruộng. Ghi lại độ sâu (cm) khi lực cản tăng đột ngột.'
    ),
    interpretation: tx(
      'Resistance exceeding 2.0 MPa (300 psi) or sudden bending of wire indicates the plow pan (compacted layer) requiring alleviation.',
      'Lực cản vượt quá 2,0 MPa (300 psi) hoặc que thép bị uốn cong cho thấy đã chạm tầng đế cày bị nén dẽ cần được phá vỡ.'
    ),
  };

  if (bdVal === null || texClass === 'unknown') {
    return {
      bulkDensityGPerCm3: bdVal,
      textureClass: texClass,
      detailedTexture,
      thresholds: texClass !== 'unknown' ? USDA_COMPACTION_THRESHOLDS[texClass] : null,
      risk: 'unknown',
      isRestricting: false,
      citation,
      summary: tx(
        'Soil bulk density or texture data is missing. Field test recommended before deep tillage.',
        'Thiếu số liệu dung trọng hoặc thành phần cơ giới đất. Cần kiểm tra độ nén ngoài đồng trước khi cày xới sâu.'
      ),
      recommendations: [
        {
          type: 'testing',
          title: tx('Verify soil compaction on-site', 'Đo kiểm độ nén đất tại ruộng'),
          description: tx(
            'Conduct penetrometer or wire flag tests to verify whether a hard plow pan exists.',
            'Dùng que thử hoặc đồng hồ đo lực đâm xuyên để xác định vị trí tầng đất bị nén dẽ.'
          ),
        },
      ],
      fieldTestProtocol: defaultTest,
    };
  }

  const thresholds = USDA_COMPACTION_THRESHOLDS[texClass];
  let risk: CompactionRisk = 'ideal';
  if (bdVal >= thresholds.restrictsRoot) {
    risk = 'severe';
  } else if (bdVal >= thresholds.affectsGrowth) {
    risk = 'moderate';
  } else {
    risk = 'ideal';
  }

  const isRestricting = bdVal >= thresholds.restrictsRoot;
  const recommendations: CompactionRecommendation[] = [];

  if (risk === 'severe' || risk === 'moderate') {
    recommendations.push({
      type: 'mechanical',
      title: tx('Targeted subsoiling / deep ripping', 'Cày sâu / xới phá tầng đế cày'),
      description: tx(
        'Rip 5–10 cm beneath the compacted pan only when the soil is dry and friable; ripping wet soil causes smearing and re-compaction.',
        'Cày sâu dưới tầng nén 5–10 cm chỉ khi đất khô ráo và bở vụn; cày khi đất ướt sẽ làm miết dẽ đất nặng hơn.'
      ),
    });

    recommendations.push({
      type: 'biological',
      title: tx('Biological tillage with deep-taproot cover crops', 'Cày sinh học bằng cây rễ cọc đâm sâu'),
      description: tx(
        'Plant aggressive taproot crops (forage radish, daikon, alfalfa, or sorghum-sudangrass) in rotation to naturally perforate compacted layers.',
        'Trồng luân canh cây có rễ cọc khoẻ (củ cải daikon, cỏ linh lăng alfalfa, cỏ sudan) để đục thủng tự nhiên các tầng nén dẽ.'
      ),
    });

    recommendations.push({
      type: 'cultural',
      title: tx('Permanent raised beds & Controlled Traffic Farming (CTF)', 'Lên luống cố định và kiểm soát vệt bánh xe cơ giới'),
      description: tx(
        'Confine heavy machinery traffic to designated wheel paths and avoid field operations during moist soil conditions.',
        'Hạn chế máy móc nặng đi lại trên mặt luống, định hình vệt bánh xe cố định và tránh đưa cơ giới vào ruộng khi đất còn ướt ẩm.'
      ),
    });
  } else {
    recommendations.push({
      type: 'cultural',
      title: tx('Maintain soil structure and prevent compaction', 'Duy trì cấu trúc đất và phòng ngừa nén dẽ'),
      description: tx(
        'Bulk density is in the optimal range. Maintain organic amendments and avoid driving heavy tractors on saturated soil.',
        'Dung trọng đang ở mức tối ưu cho rễ phát triển. Duy trì bón chất hữu cơ và tránh đưa máy kéo nặng vào ruộng khi đất bão hoà nước.'
      ),
    });
  }

  const uncertaintySpan = bdFact?.uncertainty
    ? [
        bdFact.uncertainty[0] > 10 ? bdFact.uncertainty[0] / 100 : bdFact.uncertainty[0],
        bdFact.uncertainty[1] > 10 ? bdFact.uncertainty[1] / 100 : bdFact.uncertainty[1],
      ] as [number, number]
    : undefined;

  let summary: I18nText;
  if (risk === 'severe') {
    summary = tx(
      `Bulk density of ${bdVal.toFixed(2)} g/cm³ exceeds root restriction threshold (${thresholds.restrictsRoot} g/cm³) for ${texClass} soil. Alleviation required.`,
      `Dung trọng ${bdVal.toFixed(2)} g/cm³ vượt ngưỡng cản rễ (${thresholds.restrictsRoot} g/cm³) đối với đất cơ giới ${texClass}. Cần phá nén dẽ.`
    );
  } else if (risk === 'moderate') {
    summary = tx(
      `Bulk density of ${bdVal.toFixed(2)} g/cm³ is in the range that affects root elongation (${thresholds.affectsGrowth}–${thresholds.restrictsRoot} g/cm³). Bio-tillage or subsoiling advised.`,
      `Dung trọng ${bdVal.toFixed(2)} g/cm³ nằm trong khoảng làm chậm phát triển rễ (${thresholds.affectsGrowth}–${thresholds.restrictsRoot} g/cm³). Khuyến nghị cày sinh học hoặc xới sâu.`
    );
  } else {
    summary = tx(
      `Bulk density of ${bdVal.toFixed(2)} g/cm³ is ideal for root growth (threshold ≤ ${thresholds.idealMax} g/cm³).`,
      `Dung trọng ${bdVal.toFixed(2)} g/cm³ ở mức lý tưởng cho rễ cây phát triển (ngưỡng ≤ ${thresholds.idealMax} g/cm³).`
    );
  }

  return {
    bulkDensityGPerCm3: bdVal,
    uncertaintySpan,
    textureClass: texClass,
    detailedTexture,
    thresholds,
    risk,
    isRestricting,
    citation,
    summary,
    recommendations,
    fieldTestProtocol: defaultTest,
  };
}
