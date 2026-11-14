import type {
  BranchId,
  BranchTelemetry,
  Cadence,
  I18nText,
  ISODate,
  Insight,
  Sample,
  ScoreSnapshot,
  ScoreTimeline,
  Series,
} from '@/contracts';
import { tx } from '@/contracts';
import { diffDays } from './time';

/**
 * Temporal sync rule (ARCHITECTURE.md §4): at cursor date `t` every series shows its most recent
 * valid observation at or before `t`. If that observation is older than the hold window of its
 * cadence plus the source's normal publication delay, the reading is flagged stale instead of being
 * silently carried forward. Between the hold window and that limit it is the latest the source has
 * published: shown, with its age, but not stale.
 */
export const HOLD_DAYS: Record<Cadence, number> = {
  daily: 3,
  weekly: 10,
  '8-day': 12,
  '16-day': 24,
  monthly: 45,
  static: Number.POSITIVE_INFINITY,
};

export interface SampleAt {
  sample: Sample | null;
  ageDays: number | null;
  stale: boolean;
  /** Older than the hold window but within the source's normal latency: the latest available reading. */
  latest?: boolean;
}

/** Days after which a reading is stale: the cadence hold plus the source's normal latency. */
export const staleAfterDays = (cadence: Cadence, latencyDays?: number | null): number => HOLD_DAYS[cadence] + Math.max(0, latencyDays ?? 0);

/** `latencyDays` is the source's normal publication delay (`SourceRef.latencyDays`); 0 keeps the old rule. */
export function sampleAt(series: Series, t: ISODate, latencyDays?: number | null): SampleAt {
  const s = series.samples;
  let lo = 0;
  let hi = s.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  while (idx >= 0 && s[idx].v == null) idx--;
  if (idx < 0) return { sample: null, ageDays: null, stale: true };
  const ageDays = diffDays(t, s[idx].t);
  const stale = ageDays > staleAfterDays(series.cadence, latencyDays);
  return { sample: s[idx], ageDays, stale, latest: !stale && ageDays > HOLD_DAYS[series.cadence] };
}

export const primarySeries = (b: BranchTelemetry): Series | undefined => b.series.find((x) => x.primary) ?? b.series[0];
export const findSeries = (b: BranchTelemetry | undefined, key: string): Series | undefined =>
  b?.series.find((x) => x.key === key);

export function scoreAt(timeline: ScoreTimeline | null, t: ISODate): ScoreSnapshot | null {
  if (!timeline || timeline.snapshots.length === 0) return null;
  const s = timeline.snapshots;
  let lo = 0;
  let hi = s.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return s[idx];
}

export const insightsNear = (insights: Insight[], t: ISODate, windowDays = 8): Insight[] =>
  insights.filter((i) => Math.abs(diffDays(i.t, t)) <= windowDays);

export const BRANCH_TITLES: Record<BranchId, I18nText> = {
  soilMoisture: tx('Soil moisture', 'Độ ẩm đất'),
  vegetation: tx('Vegetation vigour', 'Sức khoẻ thảm thực vật'),
  thermal: tx('Surface heat & water stress', 'Nhiệt bề mặt & stress nước'),
  rainfall: tx('Rainfall', 'Lượng mưa'),
  agromet: tx('Light & agro-weather', 'Bức xạ & khí tượng nông nghiệp'),
  terrain: tx('Terrain & drainage', 'Địa hình & thoát nước'),
  soil: tx('Soil properties', 'Đặc tính đất'),
  risk: tx('Weather & pest risk', 'Rủi ro thời tiết & sâu bệnh'),
};

export function emptyBranch(id: BranchId): BranchTelemetry {
  return {
    id,
    title: BRANCH_TITLES[id],
    series: [],
    facts: [],
    sources: [],
    status: 'unavailable',
    confidence: { level: 'low', score: 0, reasons: [] },
  };
}
