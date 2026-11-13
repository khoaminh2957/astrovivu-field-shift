/**
 * Confidence Badge, ARCHITECTURE.md §4.3.
 *
 *   spatial = 0.30 + 0.70·sqrt(fit)       fit = min(1, sqrt(area)/resolution)
 *   fresh   = 1 if age <= cadence, linear to 0.3 at 3×cadence, 0.3 beyond (static: 1)
 *   source  = observed 1 | ground-truth 1 | modelled .75 | derived .70 | forecast .60 | simulated .30
 *   quality = good 1 | fair .85 | filled .70 | poor .50
 *   score   = spatial·fresh·source·quality;  high >= .70, medium >= .45, low below
 *
 * `staticBadge` is stored on each branch (spatial × source); the UI calls `confidenceAt` to
 * multiply in freshness and sample quality for the cursor date.
 */
import type { BranchTelemetry, ConfidenceBadge, I18nText, ISODate, Parcel, Provenance, Quality, Series, SourceRef } from '@/contracts';
import { tx } from '@/contracts';
import { sampleAt } from '@/lib/series';
import { footprintFit } from './harmonize/zonal';

export const SOURCE_FACTOR: Record<Provenance, number> = {
  observed: 1,
  'ground-truth': 1,
  modelled: 0.75,
  derived: 0.7,
  forecast: 0.6,
  simulated: 0.3,
};
export const QUALITY_FACTOR: Record<Quality, number> = { good: 1, fair: 0.85, filled: 0.7, poor: 0.5 };

export const levelOf = (score: number): ConfidenceBadge['level'] => (score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low');
const r2 = (v: number) => Math.round(v * 100) / 100;

export function spatialFactor(areaHa: number, resolutionM: number | null): number {
  return 0.3 + 0.7 * Math.sqrt(footprintFit(areaHa, resolutionM));
}

export function freshnessFactor(ageDays: number | null, cadenceDays: number | null): number {
  if (cadenceDays == null) return 1;
  if (ageDays == null) return 0.3;
  if (ageDays <= cadenceDays) return 1;
  if (ageDays >= 3 * cadenceDays) return 0.3;
  return 1 - (0.7 * (ageDays - cadenceDays)) / (2 * cadenceDays);
}

const PROV_TEXT: Record<Provenance, I18nText> = {
  observed: tx('satellite or survey observation', 'quan trắc vệ tinh hoặc điều tra'),
  'ground-truth': tx('farmer measurement', 'số đo của nông dân'),
  modelled: tx('model or reanalysis estimate', 'ước tính từ mô hình / tái phân tích'),
  derived: tx('derived from other observations', 'suy ra từ quan trắc khác'),
  forecast: tx('forecast, not an observation', 'dự báo, không phải quan trắc'),
  simulated: tx('simulated placeholder', 'dữ liệu giả lập'),
};

function resText(res: number | null): string {
  if (res == null) return 'map-unit polygons';
  return res >= 1000 ? `${Math.round(res / 100) / 10} km` : `${res} m`;
}

export function staticBadge(src: SourceRef | undefined, parcel: Pick<Parcel, 'areaHa'>, extraReasons: I18nText[] = []): ConfidenceBadge {
  if (!src) return { level: 'low', score: 0, reasons: [tx('No source delivered data.', 'Không có nguồn nào trả dữ liệu.')] };
  const fit = footprintFit(parcel.areaHa, src.resolutionM);
  const spatial = spatialFactor(parcel.areaHa, src.resolutionM);
  const source = SOURCE_FACTOR[src.provenance];
  const score = r2(spatial * source);
  const side = Math.round(Math.sqrt(parcel.areaHa * 10_000));
  const reasons: I18nText[] = [
    fit >= 1
      ? tx(`${resText(src.resolutionM)} data resolves a ${side} m parcel.`, `Độ phân giải ${resText(src.resolutionM)} đủ cho thửa ${side} m.`)
      : tx(
          `One ${resText(src.resolutionM)} pixel covers the ${side} m parcel and its surroundings (fit ${r2(fit)}).`,
          `Một điểm ảnh ${resText(src.resolutionM)} bao cả thửa ${side} m và vùng xung quanh (độ khớp ${r2(fit)}).`,
        ),
    tx(`${src.name}: ${PROV_TEXT[src.provenance].en}.`, `${src.name}: ${PROV_TEXT[src.provenance].vi}.`),
    ...extraReasons,
  ];
  return { level: levelOf(score), score, reasons };
}

/**
 * Full badge for a reading at the cursor date. Ground truth always shows high. Static branches
 * (no series) keep their static score.
 */
export function confidenceAt(
  branch: BranchTelemetry,
  series: Series | undefined,
  cursorDate: ISODate,
  parcel: Pick<Parcel, 'areaHa'>,
  sources?: Record<string, SourceRef>,
): ConfidenceBadge {
  if (!series) return branch.confidence;
  const src = sources?.[series.sourceId];
  if (src?.provenance === 'ground-truth') return { level: 'high', score: 1, reasons: [tx('Measured on the field.', 'Đo trên đồng ruộng.')] };
  const base = src ? staticBadge(src, parcel) : branch.confidence;
  if (series.cadence === 'static') return base;
  const at = sampleAt(series, cursorDate);
  const cadenceDays = src?.cadenceDays ?? CADENCE_DAYS[series.cadence];
  const fresh = freshnessFactor(at.ageDays, cadenceDays);
  const quality = QUALITY_FACTOR[at.sample?.q ?? 'good'];
  const score = r2(base.score * fresh * quality);
  const reasons = [...base.reasons];
  if (at.ageDays == null) reasons.push(tx('No observation yet at this date.', 'Chưa có quan trắc tại ngày này.'));
  else if (fresh < 1)
    reasons.push(tx(`Latest reading is ${at.ageDays} days old.`, `Số đo gần nhất đã cách ${at.ageDays} ngày.`));
  if (quality < 1) reasons.push(tx(`Sample quality: ${at.sample?.q}.`, `Chất lượng mẫu: ${at.sample?.q}.`));
  return { level: levelOf(score), score, reasons };
}

export const CADENCE_DAYS: Record<Series['cadence'], number | null> = {
  daily: 1,
  weekly: 7,
  '8-day': 8,
  '16-day': 16,
  monthly: 30,
  static: null,
};
