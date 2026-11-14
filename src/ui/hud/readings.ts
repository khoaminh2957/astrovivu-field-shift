/**
 * The reading a callout shows at the cursor date, derived from the store's telemetry with the
 * temporal rules of `lib/series` (latest valid observation, hold windows). Display only: the
 * numbers are the adapters' numbers, never re-scored here.
 */
import type {
  BaselinePoint,
  BranchId,
  BranchTelemetry,
  ConfidenceBadge,
  FieldTelemetry,
  GroundTruth,
  ISODate,
  Insight,
  Lang,
  Parcel,
  Provenance,
  Sample,
  Series,
  SourceRef,
  StaticFact,
} from '@/contracts';
import { pick } from '@/contracts';
import { confidenceAt } from '@/data';
import { latencyDaysOf } from '@/data/sources';
import { findSeries, insightsNear, primarySeries, sampleAt, staleAfterDays } from '@/lib/series';
import { addDays, dayOfYear } from '@/lib/time';
import type { Status } from '@/ui/design';
import { digitsFor, fmtDate, fmtNum, fmtRes, unitFor } from './format';

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface BranchReading {
  value: string | null;
  unit: string;
  delta: string;
  status: Status | null;
  /** Satellite value replaced by the farmer's measurement (struck through). */
  estimate?: string;
  badge: ConfidenceBadge;
  provenance: Provenance;
  sourceName: string;
  sourceDetail: string;
  series?: Series;
  ageDays: number | null;
}

export function baselineAt(baseline: BaselinePoint[] | undefined, t: ISODate): BaselinePoint | null {
  if (!baseline?.length) return null;
  const doy = dayOfYear(t);
  let best = baseline[0];
  for (const p of baseline) if (Math.abs(p.doy - doy) < Math.abs(best.doy - doy)) best = p;
  return best;
}

export function factOf(b: BranchTelemetry | undefined, key: string): StaticFact | undefined {
  return b?.facts.find((f) => f.key === key);
}

/** Accumulated rain in the 30 days ending at the cursor; null when no day in that span was observed. */
export function rainSum(samples: Sample[], t: ISODate, days = 30): number | null {
  const from = addDays(t, -days);
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    if (s.t <= from) continue;
    if (s.t > t) break;
    if (s.v != null) {
      sum += s.v;
      n++;
    }
  }
  return n === 0 ? null : sum;
}

/** Provenance of a series as its source declares it; the whole screen is simulated in mock mode. */
export function provenanceOf(src: SourceRef | undefined, mode: FieldTelemetry['mode']): Provenance {
  if (mode === 'mock') return 'simulated';
  return src?.provenance ?? 'derived';
}

/** Branch-level state from the commentary engine: the worst insight within a week of the cursor. */
export function insightStatus(insights: Insight[], branch: BranchId, cursor: ISODate): Status | null {
  let worst: Status | null = null;
  for (const i of insightsNear(insights, cursor, 7)) {
    if (i.branch !== branch) continue;
    if (i.severity === 'alert') return 'alert';
    if (i.severity === 'watch') worst = 'watch';
  }
  return worst;
}

const riskStatus = (sev: number): Status | null => (sev >= 2 ? 'alert' : sev === 1 ? 'watch' : null);

export interface ReadContext {
  telemetry: FieldTelemetry;
  branch: BranchTelemetry;
  cursor: ISODate;
  parcel: Parcel;
  insights: Insight[];
  groundTruth: GroundTruth;
  lang: Lang;
  t: T;
}

function deltaFor(series: Series, cursor: ISODate, t: T, latency: number | null): { text: string; stale: boolean; age: number | null; value: number | null } {
  const at = sampleAt(series, cursor, latency);
  const v = at.sample?.v ?? null;
  if (v == null) return { text: t('hud.delta.none'), stale: false, age: null, value: null };
  if (at.stale) return { text: t('hud.delta.stale', { n: at.ageDays ?? 0, h: staleAfterDays(series.cadence, latency) }), stale: true, age: at.ageDays, value: v };
  // Older than the hold window only because the source publishes late: the latest there is, said quietly.
  if (at.latest) return { text: t('hud.delta.latest', { n: at.ageDays ?? 0 }), stale: false, age: at.ageDays, value: v };
  const band = baselineAt(series.baseline, cursor);
  const d = digitsFor(series.unit, series.key);
  if (band) {
    if (v < band.p10) return { text: t('hud.delta.below', { p: fmtNum(band.p10, d) }), stale: false, age: at.ageDays, value: v };
    if (v > band.p90) return { text: t('hud.delta.above', { p: fmtNum(band.p90, d) }), stale: false, age: at.ageDays, value: v };
    return { text: t('hud.delta.normal'), stale: false, age: at.ageDays, value: v };
  }
  return { text: at.ageDays ? t('hud.delta.age', { n: at.ageDays }) : t('hud.delta.age0'), stale: false, age: at.ageDays, value: v };
}

/** Headline reading of one branch at the cursor. Terrain and soil read static facts. */
export function readBranch(ctx: ReadContext): BranchReading {
  const { telemetry, branch, cursor, parcel, insights, groundTruth, lang, t } = ctx;
  const mode = telemetry.mode;
  const sim = mode === 'mock';
  const firstSource = telemetry.sources[branch.sources[0]];

  if (branch.id === 'terrain') {
    const elev = factOf(branch, 'elevation_m');
    const src = telemetry.sources[elev?.sourceId ?? ''] ?? firstSource;
    return {
      value: typeof elev?.value === 'number' ? fmtNum(elev.value, 0) : null,
      unit: 'm',
      delta: pick(factOf(branch, 'flow_dir_label')?.detail, lang) || t('hud.fact.elevation'),
      status: sim ? 'simulated' : null,
      badge: branch.confidence,
      provenance: provenanceOf(src, mode),
      sourceName: src?.name ?? '',
      sourceDetail: fmtRes(src?.resolutionM) ?? '',
      ageDays: null,
    };
  }

  if (branch.id === 'soil') {
    const ph = factOf(branch, 'ph');
    const src = telemetry.sources[ph?.sourceId ?? ''] ?? firstSource;
    const est = typeof ph?.value === 'number' ? fmtNum(ph.value, 1) : null;
    const truth = groundTruth.ph != null;
    const tex = groundTruth.texture ?? (factOf(branch, 'texture_class')?.value as string | undefined);
    return {
      value: truth ? fmtNum(groundTruth.ph, 1) : est,
      unit: 'pH',
      estimate: truth ? (est ?? '--') : undefined,
      delta: tex ? `${t('hud.fact.texture')}: ${['heavy', 'medium', 'light', 'organic'].includes(tex) ? t(`hud.texture.${tex}`) : tex}` : t('hud.fact.texture'),
      status: truth ? 'ground-truth' : sim ? 'simulated' : null,
      badge: truth ? { level: 'high', score: 1, reasons: [{ en: 'Measured on the field.', vi: 'Đo trên đồng ruộng.' }] } : branch.confidence,
      provenance: truth ? 'ground-truth' : provenanceOf(src, mode),
      sourceName: truth ? t('hud.gt.source') : (src?.name ?? ''),
      sourceDetail: truth ? '' : (fmtRes(src?.resolutionM) ?? ''),
      ageDays: null,
    };
  }

  if (branch.id === 'risk') {
    const fc = primarySeries(branch);
    const src = telemetry.sources[fc?.sourceId ?? ''] ?? firstSource;
    let peak = -Infinity;
    for (const s of fc?.samples ?? []) if (s.v != null && s.t >= telemetry.window.today && s.v > peak) peak = s.v;
    const events = (branch.events ?? []).filter((e) => e.severity > 0).sort((a, b) => b.severity - a.severity || a.start.localeCompare(b.start));
    const top = events[0];
    return {
      value: Number.isFinite(peak) ? fmtNum(peak, 1) : null,
      unit: t('hud.unit.peak'),
      delta: top ? `${pick(top.title, lang)} · ${fmtDate(top.start, lang, false)}` : t('hud.delta.forecastQuiet'),
      status: top ? riskStatus(top.severity) : sim ? 'simulated' : null,
      badge: fc ? confidenceAt(branch, fc, telemetry.window.today, parcel, telemetry.sources) : branch.confidence,
      provenance: sim ? 'simulated' : 'forecast',
      sourceName: src?.name ?? '',
      sourceDetail: telemetry.window.forecastEnd ? `→ ${fmtDate(telemetry.window.forecastEnd, lang, false)}` : '',
      series: fc,
      ageDays: null,
    };
  }

  const primary = primarySeries(branch);
  if (!primary) {
    return { value: null, unit: '', delta: t('hud.delta.none'), status: null, badge: branch.confidence, provenance: 'derived', sourceName: '', sourceDetail: '', ageDays: null };
  }
  const latencyOf = (s: Series) => latencyDaysOf(s.sourceId, telemetry.sources[s.sourceId]);
  const usable = (s: Series) => {
    const at = sampleAt(s, cursor, latencyOf(s));
    return at.sample?.v != null && !at.stale && (branch.id !== 'rainfall' || rainSum(s.samples, cursor) != null);
  };
  // When the primary series has nothing usable at the cursor, another series of the same quantity
  // (same unit, key extending the primary's, e.g. rain_era5 beside CHIRPS rain) stands in, with its own source.
  const standIn = usable(primary) ? undefined : branch.series.find((s) => s !== primary && s.unit === primary.unit && s.key.startsWith(primary.key) && usable(s));
  const series = standIn ?? primary;
  const src = telemetry.sources[series.sourceId];
  const primaryName = telemetry.sources[primary.sourceId]?.name ?? primary.sourceId;
  const d0 = deltaFor(series, cursor, t, latencyOf(series));
  const d = standIn ? { ...d0, text: t('hud.delta.standIn', { primary: primaryName }) } : d0;
  const badge = confidenceAt(branch, series, cursor, parcel, telemetry.sources);
  const flagged = insightStatus(insights, branch.id, cursor);
  const status: Status | null = flagged ?? (d.stale ? 'stale' : sim ? 'simulated' : null);
  const age = d.age != null ? `${d.age} d` : null;

  if (branch.id === 'rainfall') {
    const sum = rainSum(series.samples, cursor);
    return {
      value: sum == null ? null : fmtNum(sum, 0),
      unit: t('hud.unit.rain30'),
      delta: d.value == null || standIn ? d.text : t('hud.delta.rainDay', { v: fmtNum(d.value, 1) }),
      status,
      badge,
      provenance: provenanceOf(src, mode),
      sourceName: src?.name ?? series.sourceId,
      sourceDetail: [fmtRes(src?.resolutionM), age].filter(Boolean).join(' · '),
      series,
      ageDays: d.age,
    };
  }

  return {
    value: d.value == null ? null : fmtNum(d.value, digitsFor(series.unit, series.key)),
    unit: unitFor(series.unit, series.key),
    delta: d.text,
    status,
    badge,
    provenance: provenanceOf(src, mode),
    sourceName: src?.name ?? series.sourceId,
    sourceDetail: [fmtRes(src?.resolutionM), age].filter(Boolean).join(' · '),
    series,
    ageDays: d.age,
  };
}

/** Past air temperature shown before the forecast on the risk sparkline (today − 45 d). */
export function riskHistory(telemetry: FieldTelemetry): Sample[] {
  const tmax = findSeries(telemetry.branches.agromet, 't2m_max');
  const from = addDays(telemetry.window.today, -45);
  return (tmax?.samples ?? []).filter((s) => s.t >= from && s.t <= telemetry.window.today);
}
