import type { I18nText, SoilPlan, SoilPlanItem } from '@/contracts';
import { tx } from '@/contracts';

export type AmendmentMaterial = 'lime' | 'sulfur' | 'gypsum';

export interface AmendmentPriceQuote {
  usdPerT: number;
  source: string;
  year: number;
  url?: string;
}

export type AmendmentPriceMap = Partial<Record<AmendmentMaterial | string, AmendmentPriceQuote>>;

export interface AmendmentCostItem {
  metric: string;
  material: AmendmentMaterial | null;
  rateRangeTHa: [number, number] | null;
  areaHa: number;
  /** Total cost range [lo, hi] in USD for the parcel (`rateRange * usdPerT * areaHa`). Null when price or rate is missing. */
  costUsd: [number, number] | null;
  /** Per-hectare cost range [lo, hi] in USD/ha (`rateRange * usdPerT`). Null when price or rate is missing. */
  costPerHaUsd: [number, number] | null;
  /** Estimated payback in seasons [lo, hi] when a positive margin delta per season (USD/ha) is supplied by the model. */
  paybackSeasons: [number, number] | null;
  source: string | null;
  year: number | null;
  reason: I18nText;
  caveats: I18nText[];
}

export interface AmendmentCostSummary {
  items: AmendmentCostItem[];
  totalCostUsd: [number, number] | null;
  caveats: I18nText[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r1 = (v: number): number => Math.round(v * 10) / 10;

function inferMaterial(item: SoilPlanItem): AmendmentMaterial | null {
  const text = `${item.metric} ${item.title.en} ${item.action.en}`.toLowerCase();
  if (text.includes('sulfur') || text.includes('sulphur')) return 'sulfur';
  if (text.includes('gypsum')) return 'gypsum';
  if (item.metric === 'ph' || text.includes('lime') || text.includes('liming') || text.includes('caco3') || text.includes('dolomite')) {
    return 'lime';
  }
  return null;
}

const BASE_CAVEATS: I18nText[] = [
  tx(
    'Spreading labour and transport costs are not included in the material cost range.',
    'Chi phí nhân công rải và vận chuyển chưa được tính trong khoảng chi phí vật tư.',
  ),
  tx(
    'Material costs are not amortised across multiple years because multi-year residual duration depends on local soil buffering and rainfall.',
    'Chi phí vật tư không tự chia đều cho nhiều năm vì thời gian hiệu lực tồn dư phụ thuộc khả năng đệm và lượng mưa tại chỗ.',
  ),
  tx(
    'Payback seasons (when shown) are model estimates from expected margin gain and have not been verified by on-farm trials.',
    'Số vụ hoàn vốn (khi hiển thị) là ước tính từ mô hình dựa trên mức tăng lãi kỳ vọng và chưa được kiểm chứng ngoài đồng.',
  ),
];

/**
 * Computes material cost ranges and indicative payback seasons for every dosed item in a `SoilPlan`.
 *
 * - Pure function: prices are passed in via `prices` (`material -> { usdPerT, source, year }`).
 * - No price figures are stored inside `src/core/soil`.
 * - Cost at each end of the interval equals `dose * usdPerT * areaHa`.
 * - Missing price for the required material yields `costUsd: null` with a bilingual explanation.
 * - Missing or non-positive `marginDeltaUsdPerHa` yields `paybackSeasons: null`.
 */
export function amendmentCost(
  plan: SoilPlan,
  prices: AmendmentPriceMap,
  areaHa: number,
  marginDeltaUsdPerHa?: number | [number, number] | null,
): AmendmentCostSummary {
  const dosedItems = plan.items.filter((item) => item.rateRange != null);
  const items: AmendmentCostItem[] = [];

  for (const item of dosedItems) {
    const rate = item.rateRange!;
    const material = inferMaterial(item);
    const quote = (material ? prices[material] : undefined) ?? prices[item.metric];

    if (!material || !quote || !(quote.usdPerT > 0) || !(areaHa > 0)) {
      items.push({
        metric: item.metric,
        material,
        rateRangeTHa: [rate.min, rate.max],
        areaHa,
        costUsd: null,
        costPerHaUsd: null,
        paybackSeasons: null,
        source: null,
        year: null,
        reason: !(areaHa > 0)
          ? tx(
              'Parcel area must be greater than zero to compute material cost.',
              'Diện tích thửa ruộng phải lớn hơn 0 để tính chi phí vật tư.',
            )
          : tx(
              `No sourced unit price is available for ${material ?? item.metric}; no cost is computed.`,
              `Chưa có đơn giá có nguồn cho vật tư ${material ?? item.metric}; không tính chi phí.`,
            ),
        caveats: BASE_CAVEATS,
      });
      continue;
    }

    const costPerHaLo = r2(rate.min * quote.usdPerT);
    const costPerHaHi = r2(rate.max * quote.usdPerT);
    const costLo = r2(rate.min * quote.usdPerT * areaHa);
    const costHi = r2(rate.max * quote.usdPerT * areaHa);

    let paybackSeasons: [number, number] | null = null;
    if (marginDeltaUsdPerHa != null) {
      const [gainLo, gainHi] = Array.isArray(marginDeltaUsdPerHa)
        ? [Math.min(marginDeltaUsdPerHa[0], marginDeltaUsdPerHa[1]), Math.max(marginDeltaUsdPerHa[0], marginDeltaUsdPerHa[1])]
        : [marginDeltaUsdPerHa, marginDeltaUsdPerHa];
      if (gainLo > 0 && gainHi > 0) {
        paybackSeasons = [r1(costPerHaLo / gainHi), r1(costPerHaHi / gainLo)];
      }
    }

    const reason = paybackSeasons
      ? tx(
          `Material cost ${costLo}-${costHi} USD (${costPerHaLo}-${costPerHaHi} USD/ha) at ${quote.usdPerT} USD/t (${quote.source}, ${quote.year}); estimated payback ${paybackSeasons[0]}-${paybackSeasons[1]} seasons (model estimate, not field-verified).`,
          `Chi phí vật tư ${costLo}-${costHi} USD (${costPerHaLo}-${costPerHaHi} USD/ha) theo đơn giá ${quote.usdPerT} USD/tấn (${quote.source}, ${quote.year}); ước tính hoàn vốn ${paybackSeasons[0]}-${paybackSeasons[1]} vụ (ước tính từ mô hình, chưa kiểm chứng ngoài đồng).`,
        )
      : tx(
          `Material cost ${costLo}-${costHi} USD (${costPerHaLo}-${costPerHaHi} USD/ha) at ${quote.usdPerT} USD/t (${quote.source}, ${quote.year}); payback seasons are not computed because no margin gain per season was provided.`,
          `Chi phí vật tư ${costLo}-${costHi} USD (${costPerHaLo}-${costPerHaHi} USD/ha) theo đơn giá ${quote.usdPerT} USD/tấn (${quote.source}, ${quote.year}); chưa tính số vụ hoàn vốn vì chưa có ước tính lãi tăng thêm mỗi vụ.`,
        );

    items.push({
      metric: item.metric,
      material,
      rateRangeTHa: [rate.min, rate.max],
      areaHa,
      costUsd: [costLo, costHi],
      costPerHaUsd: [costPerHaLo, costPerHaHi],
      paybackSeasons,
      source: quote.source,
      year: quote.year,
      reason,
      caveats: BASE_CAVEATS,
    });
  }

  const allPriced = items.length > 0 && items.every((i) => i.costUsd != null);
  const totalCostUsd: [number, number] | null = allPriced
    ? [
        r2(items.reduce((acc, i) => acc + i.costUsd![0], 0)),
        r2(items.reduce((acc, i) => acc + i.costUsd![1], 0)),
      ]
    : null;

  return {
    items,
    totalCostUsd,
    caveats: BASE_CAVEATS,
  };
}
