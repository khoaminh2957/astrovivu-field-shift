import type { I18nText, ModelInput } from '@/contracts';
import { tx } from '@/contracts';
import type { SoilFact } from './types';

const OVERRIDES: Record<string, keyof ModelInput['groundTruth']> = {
  ph: 'ph',
  om_pct: 'organicMatterPct',
  texture_class: 'texture',
  drainage_class: 'drainage',
  ec_dsm: 'ecDsM',
  depth_cm: 'soilDepthCm',
};

const LABELS: Record<string, I18nText> = {
  ec_dsm: tx('Electrical conductivity', 'Độ dẫn điện'),
  depth_cm: tx('Soil depth', 'Độ sâu tầng đất'),
  om_pct: tx('Organic matter', 'Chất hữu cơ'),
  ph: tx('Soil reaction (pH)', 'Độ phản ứng của đất (pH)'),
  texture_class: tx('Soil texture', 'Thành phần cơ giới đất'),
  drainage_class: tx('Soil drainage', 'Khả năng thoát nước'),
};

/** Reads soil values once and records when a grower measurement replaced an estimate. */
export function soilFacts(input: ModelInput): SoilFact[] {
  const facts = input.telemetry.branches.soil?.facts ?? [];
  const result: SoilFact[] = facts.map((fact) => {
    const source = input.telemetry.sources[fact.sourceId];
    const overrideKey = OVERRIDES[fact.key];
    const override = overrideKey ? input.groundTruth[overrideKey] : undefined;
    const hasOverride = override !== undefined;

    return {
      key: fact.key,
      label: fact.label,
      value: hasOverride ? (override as number | string) : fact.value,
      unit: fact.unit,
      sourceId: hasOverride ? 'ground-truth' : fact.sourceId,
      sourceName: hasOverride
        ? tx('Your own measurement', 'Số đo của bạn')
        : tx(source?.name ?? fact.sourceId, source?.name ?? fact.sourceId),
      uncertainty: hasOverride ? undefined : fact.uncertainty,
      fromGrower: hasOverride,
      estimate: hasOverride ? fact.value : undefined,
    };
  });

  for (const [key, groundTruthKey] of Object.entries(OVERRIDES)) {
    const value = input.groundTruth[groundTruthKey];
    if (value === undefined || result.some((fact) => fact.key === key)) continue;
    result.push({
      key,
      label: LABELS[key] ?? tx(key, key),
      value: value as number | string,
      sourceId: 'ground-truth',
      sourceName: tx('Your own measurement', 'Số đo của bạn'),
      fromGrower: true,
    });
  }

  return result;
}
