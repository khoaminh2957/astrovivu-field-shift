import type { BaselinePoint, BranchId, ConfidenceBadge, I18nText, ISODate, Parcel, Provenance, Sample, Series } from '@/contracts';
import { tx } from '@/contracts';
import { SAMPLE_PARCELS } from '@/data';
import { mockTelemetry } from '@/data/mock';
import { primarySeries, sampleAt } from '@/lib/series';
import { addDays, dayOfYear, diffDays } from '@/lib/time';
import { confidenceLevel } from '../ConfidenceBadge';
import type { SparkAnomaly } from '../Sparkline';

/*
 * Specimen data for the style guide. Numbers come from `mockTelemetry` (flagged simulated); the
 * source labels and confidence scores are worked out from the real catalogue in ARCHITECTURE.md
 * so the layout is tested with the strings the live adapters will produce.
 */

export const TODAY: ISODate = '2026-11-14';
export const DEMO_PARCEL: Parcel = SAMPLE_PARCELS[0];
export const DEMO_TELEMETRY = mockTelemetry(DEMO_PARCEL, TODAY);
export const WINDOW = DEMO_TELEMETRY.window;

export interface SourceSpecimen {
  name: string;
  provenance: Provenance;
  resolutionM: number | null;
  /** Typical days between observation and availability. */
  latencyDays: number;
}

/** Primary source per branch (ARCHITECTURE.md §5). */
export const SOURCE: Record<BranchId, SourceSpecimen> = {
  soilMoisture: { name: 'SMAP L4', provenance: 'modelled', resolutionM: 9000, latencyDays: 3 },
  vegetation: { name: 'MODIS MOD13Q1', provenance: 'observed', resolutionM: 250, latencyDays: 8 },
  thermal: { name: 'MODIS MOD11A2', provenance: 'observed', resolutionM: 1000, latencyDays: 6 },
  rainfall: { name: 'GPM IMERG', provenance: 'observed', resolutionM: 10000, latencyDays: 2 },
  agromet: { name: 'NASA POWER', provenance: 'modelled', resolutionM: 50000, latencyDays: 3 },
  terrain: { name: 'SRTM', provenance: 'observed', resolutionM: 30, latencyDays: 0 },
  soil: { name: 'SoilGrids', provenance: 'modelled', resolutionM: 250, latencyDays: 0 },
  risk: { name: 'Open-Meteo', provenance: 'forecast', resolutionM: 11000, latencyDays: 0 },
};

const SOURCE_FACTOR: Record<Provenance, number> = { observed: 1, 'ground-truth': 1, modelled: 0.75, derived: 0.7, forecast: 0.6, simulated: 0.3 };

export const fmtRes = (m: number | null): string => (m == null ? '' : m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** Static part of the Confidence Badge (ARCHITECTURE.md §4.3): footprint fit x how it was produced. */
export function specimenConfidence(branch: BranchId): ConfidenceBadge {
  const src = SOURCE[branch];
  const side = Math.sqrt(DEMO_PARCEL.areaHa * 10_000);
  const fit = src.resolutionM == null ? 1 : Math.min(1, side / src.resolutionM);
  const spatial = 0.3 + 0.7 * Math.sqrt(fit);
  const score = Math.round(spatial * SOURCE_FACTOR[src.provenance] * 100) / 100;
  const res = fmtRes(src.resolutionM);
  const sideM = Math.round(side);
  const reasons: I18nText[] = [];
  if (fit >= 1) reasons.push(tx(`${res} pixels resolve the ${sideM} m field.`, `Điểm ảnh ${res} đủ mịn cho thửa ruộng rộng ${sideM} m.`));
  else if (fit > 0.3) reasons.push(tx(`One ${res} pixel is wider than the ${sideM} m field: a mixed pixel.`, `Một điểm ảnh ${res} rộng hơn thửa ruộng ${sideM} m: điểm ảnh hỗn hợp.`));
  else reasons.push(tx(`A ${res} pixel covers far more than this ${sideM} m field: read it as a regional signal.`, `Điểm ảnh ${res} phủ rộng hơn nhiều so với thửa ruộng ${sideM} m: hãy xem là tín hiệu vùng.`));
  if (src.provenance === 'modelled') reasons.push(tx('Produced by a model that assimilates observations, not measured directly.', 'Do mô hình đồng hoá số liệu quan sát tạo ra, không phải đo trực tiếp.'));
  if (src.provenance === 'forecast') reasons.push(tx('A forecast: skill drops after day 7.', 'Là dự báo: độ chính xác giảm sau ngày thứ 7.'));
  if (src.provenance === 'observed') reasons.push(tx('Satellite retrieval, quality flag good.', 'Số liệu thu từ vệ tinh, cờ chất lượng tốt.'));
  return { level: confidenceLevel(score), score, reasons };
}

export const seriesOf = (branch: BranchId): Series | undefined => primarySeries(DEMO_TELEMETRY.branches[branch]);

/**
 * Normal band for the specimen: a day-of-year mean with a p10-p90 envelope, taken from the series
 * itself with a 31-day window. Real baselines come from multi-year history in the adapters.
 */
export function specimenBaseline(samples: Sample[]): BaselinePoint[] {
  const pts = samples.filter((s) => s.v != null).map((s) => ({ doy: dayOfYear(s.t), v: s.v as number }));
  const out: BaselinePoint[] = [];
  for (let doy = 1; doy <= 366; doy++) {
    const near = pts.filter((p) => {
      const d = Math.abs(p.doy - doy);
      return Math.min(d, 366 - d) <= 15;
    });
    if (near.length === 0) continue;
    const vals = near.map((p) => p.v).sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const q = (f: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(f * (vals.length - 1))))];
    // Widen the envelope a little so the specimen band is visible on smooth mock series.
    const spread = Math.max(q(0.9) - q(0.1), Math.abs(mean) * 0.16);
    out.push({ doy, mean, p10: mean - spread * 0.7, p90: mean + spread * 0.7 });
  }
  return out;
}

/** Thins a daily series so sparse-cadence behaviour (points, holds) can be shown. */
export const everyNth = (samples: Sample[], n: number): Sample[] => samples.filter((_, i) => i % n === 0);

export const between = (samples: Sample[], from: ISODate, to: ISODate): Sample[] => samples.filter((s) => s.t >= from && s.t <= to);

function extreme(samples: Sample[], pick: 'min' | 'max'): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) {
    if (s.v == null) continue;
    if (!best || (pick === 'min' ? s.v < (best.v as number) : s.v > (best.v as number))) best = s;
  }
  return best;
}

export interface SpecimenInsight extends SparkAnomaly {
  branch: BranchId;
  text: I18nText;
}

/** Anomaly Markers for the specimen: the driest root zone, the hottest surface, the wettest day. */
export function specimenInsights(): SpecimenInsight[] {
  const out: SpecimenInsight[] = [];
  const sm = seriesOf('soilMoisture');
  const lst = seriesOf('thermal');
  const rain = seriesOf('rainfall');
  const ndvi = seriesOf('vegetation');
  const dry = sm && extreme(sm.samples, 'min');
  if (dry)
    out.push({
      t: dry.t,
      severity: 'alert',
      branch: 'soilMoisture',
      label: 'Root zone at its driest',
      text: tx(
        `Root-zone moisture fell to ${dry.v?.toFixed(2)} m³/m³, the lowest of the year. Coffee flowers on this water: irrigate before the next dry week.`,
        `Độ ẩm vùng rễ xuống ${dry.v?.toFixed(2)} m³/m³, thấp nhất trong năm. Cà phê ra hoa nhờ lượng nước này: hãy tưới trước tuần khô tiếp theo.`,
      ),
    });
  const hot = lst && extreme(lst.samples, 'max');
  if (hot)
    out.push({
      t: hot.t,
      severity: 'watch',
      branch: 'thermal',
      label: 'Hottest surface of the year',
      text: tx(
        `Land surface reached ${hot.v?.toFixed(1)} °C while the soil was drying: evaporative stress is building.`,
        `Bề mặt đất lên tới ${hot.v?.toFixed(1)} °C trong lúc đất đang khô dần: stress bốc thoát hơi đang tăng.`,
      ),
    });
  const wet = rain && extreme(rain.samples, 'max');
  if (wet)
    out.push({
      t: wet.t,
      severity: 'watch',
      branch: 'rainfall',
      label: 'Heaviest rain day',
      text: tx(
        `${wet.v?.toFixed(0)} mm fell in one day, the heaviest of the year. Check drainage on the lower edge of the field.`,
        `${wet.v?.toFixed(0)} mm mưa trong một ngày, lớn nhất trong năm. Hãy kiểm tra thoát nước ở mép thấp của thửa ruộng.`,
      ),
    });
  const peak = ndvi && extreme(ndvi.samples, 'max');
  if (peak)
    out.push({
      t: peak.t,
      severity: 'info',
      branch: 'vegetation',
      label: 'Canopy at its greenest',
      text: tx(`Canopy greenness peaked at NDVI ${peak.v?.toFixed(2)}.`, `Độ xanh tán cây đạt đỉnh, NDVI ${peak.v?.toFixed(2)}.`),
    });
  return out.sort((a, b) => (a.t < b.t ? -1 : 1));
}

/** The insight closest to the cursor within a fortnight: the "automatic commentary" line. */
export function insightNear(insights: SpecimenInsight[], cursor: ISODate): SpecimenInsight | null {
  let best: SpecimenInsight | null = null;
  let bestD = 15;
  for (const i of insights) {
    const d = Math.abs(diffDays(i.t, cursor));
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** A plausible productivity score for the specimen hub, driven by root-zone moisture at the cursor. */
export function specimenScore(cursor: ISODate): { productivity: number; compatibility: number; limiting: I18nText } {
  const sm = seriesOf('soilMoisture');
  const s = sm?.samples.filter((x) => x.t <= cursor && x.v != null).pop();
  const wet = s?.v != null ? Math.max(0, Math.min(1, (s.v - 0.14) / 0.2)) : 0.5;
  const productivity = Math.round(34 + 54 * wet);
  return {
    productivity,
    compatibility: 82,
    limiting: wet < 0.5 ? tx('Water', 'Nước') : tx('Soil pH', 'pH đất'),
  };
}

export const MONTHS: Record<'en' | 'vi', string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  vi: ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'],
};

/** "14 Nov 2026" / "14 Th11 2026": dates are written day-month-year in both languages. */
export function fmtDate(t: ISODate, lang: 'en' | 'vi'): string {
  const [y, m, d] = t.split('-').map(Number);
  return `${d} ${MONTHS[lang][m - 1]} ${y}`;
}

export const FORECAST_END = addDays(TODAY, 15);

// ---------------------------------------------------------------------------------------------
// Readings at the cursor, shared by the instrument specimens and the HUD composition.
// ---------------------------------------------------------------------------------------------

const DECIMALS: Record<BranchId, number> = { soilMoisture: 2, vegetation: 2, thermal: 1, rainfall: 1, agromet: 1, terrain: 0, soil: 1, risk: 1 };

const baselineCache = new Map<BranchId, BaselinePoint[]>();

export function baselineOf(branch: BranchId): BaselinePoint[] | undefined {
  const s = seriesOf(branch);
  if (!s) return undefined;
  let b = baselineCache.get(branch);
  if (!b) {
    b = specimenBaseline(s.samples);
    baselineCache.set(branch, b);
  }
  return b;
}

export interface SpecimenReading {
  /** Formatted value, or null when nothing has been observed yet. */
  text: string | null;
  value: number | null;
  unit: string;
  ageDays: number | null;
  stale: boolean;
  /** Percent departure from the specimen baseline mean, rounded. */
  deltaPct: number | null;
}

export function readingAt(branch: BranchId, cursor: ISODate): SpecimenReading {
  const s = seriesOf(branch);
  if (!s) return { text: null, value: null, unit: '', ageDays: null, stale: false, deltaPct: null };
  const at = sampleAt(s, cursor);
  const v = at.sample?.v ?? null;
  const base = baselineOf(branch)?.find((b) => b.doy === dayOfYear(cursor));
  const deltaPct = v != null && base && Math.abs(base.mean) > 1e-6 ? Math.round(((v - base.mean) / Math.abs(base.mean)) * 100) : null;
  return { text: v == null ? null : v.toFixed(DECIMALS[branch]), value: v, unit: s.unit, ageDays: at.ageDays, stale: at.stale, deltaPct };
}

/** Rain total over the 30 days ending at the cursor. */
export function rain30(cursor: ISODate): number {
  const s = seriesOf('rainfall');
  if (!s) return 0;
  const from = addDays(cursor, -29);
  return Math.round(s.samples.reduce((sum, x) => (x.t >= from && x.t <= cursor && x.v != null ? sum + x.v : sum), 0));
}

export const factOf = (branch: BranchId, key: string) => DEMO_TELEMETRY.branches[branch].facts.find((f) => f.key === key);
