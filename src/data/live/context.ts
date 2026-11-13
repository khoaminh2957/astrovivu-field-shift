/**
 * Shared state of one live telemetry load: the window, memoised upstream requests used by several
 * branches (ERA5 history, NASA POWER), the parcel elevation, and the progressive emitter.
 */
import type { BranchId, BranchTelemetry, FieldTelemetry, I18nText, ISODate, Parcel, SourceRef } from '@/contracts';
import { BRANCHES, tx } from '@/contracts';
import { emptyBranch } from '@/lib/series';
import { addDays } from '@/lib/time';
import { staticBadge } from '../confidence';
import { era5Daily, elevation as omElevation, type DailyTable } from '../adapters/openmeteo';
import { powerDaily, type PowerDaily } from '../adapters/power';
import { TTL } from '../cache';
import { SOURCES } from '../sources';

export interface LiveOptions {
  signal?: AbortSignal;
  today: ISODate;
  onProgress?: (partial: FieldTelemetry, branch: BranchId) => void;
  /** Node cache script: slower, fuller sources (MODIS baselines, OpenTopoData, CDL, AppEEARS). */
  full?: boolean;
}

export const ERA5_VARS = [
  'precipitation_sum',
  'temperature_2m_mean',
  'temperature_2m_max',
  'temperature_2m_min',
  'et0_fao_evapotranspiration',
  'soil_moisture_0_to_7cm_mean',
  'soil_moisture_7_to_28cm_mean',
  'soil_moisture_28_to_100cm_mean',
] as const;

export const POWER_VARS = ['T2M', 'T2M_MAX', 'T2M_MIN', 'RH2M', 'WS2M', 'ALLSKY_SFC_PAR_TOT', 'ALLSKY_SFC_SW_DWN', 'GWETTOP', 'GWETROOT'] as const;

/** Years of ERA5 history behind climateHistory and the day-of-year baselines. */
export const HISTORY_YEARS = 20;
export const POWER_BASELINE_YEARS = 10;

export class LiveContext {
  readonly start: ISODate;
  readonly end: ISODate;
  readonly forecastEnd: ISODate;
  readonly thisYear: number;
  readonly telemetry: FieldTelemetry;
  private memo = new Map<string, Promise<unknown>>();
  private resolveElev!: (v: { elevationM: number | null; sourceId: string }) => void;
  /** Parcel elevation, resolved by the terrain branch (or the Open-Meteo DEM fallback). */
  readonly elevation: Promise<{ elevationM: number | null; sourceId: string }>;

  constructor(
    readonly parcel: Parcel,
    readonly opts: LiveOptions,
  ) {
    this.end = opts.today;
    this.start = addDays(opts.today, -364);
    this.forecastEnd = addDays(opts.today, 15);
    this.thisYear = Number(opts.today.slice(0, 4));
    this.telemetry = {
      parcelId: parcel.id,
      generatedAt: new Date().toISOString(),
      window: { start: this.start, end: this.end, today: opts.today, forecastEnd: this.forecastEnd },
      branches: Object.fromEntries(BRANCHES.map((id) => [id, emptyBranch(id)])) as FieldTelemetry['branches'],
      sources: {},
      mode: 'live',
    };
    this.elevation = new Promise((r) => (this.resolveElev = r));
  }

  get signal(): AbortSignal | undefined {
    return this.opts.signal;
  }

  setElevation(elevationM: number | null, sourceId: string): void {
    if (elevationM != null) this.parcel.elevationM = Math.round(elevationM);
    this.resolveElev({ elevationM, sourceId });
  }

  /** Parcel elevation, but never wait more than `ms` for the terrain branch. */
  async elevationWithin(ms = 6000): Promise<number | null> {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), ms));
    const v = await Promise.race([this.elevation.then((e) => e.elevationM), timeout]);
    if (v != null) return v;
    try {
      return await omElevation(this.parcel.centroid, this.signal);
    } catch {
      return null;
    }
  }

  once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn();
      // Shared promises are awaited by several branches; keep an unobserved rejection quiet.
      p.catch(() => undefined);
      this.memo.set(key, p);
    }
    return p;
  }

  /** ERA5 daily from Jan 1st HISTORY_YEARS ago to today: climate history, baselines and window. */
  era5History(): Promise<DailyTable> {
    return this.once('era5', () =>
      era5Daily(this.parcel.centroid, `${this.thisYear - HISTORY_YEARS}-01-01`, this.end, [...ERA5_VARS], this.signal, TTL.day),
    );
  }

  powerWindow(): Promise<PowerDaily> {
    return this.once('power', () => powerDaily(this.parcel.centroid, this.start, this.end, [...POWER_VARS], this.signal));
  }

  /** POWER daily for the years before the window, for baselines only (one request). */
  powerBaseline(): Promise<PowerDaily> {
    const vars = ['T2M', 'T2M_MAX', 'T2M_MIN', 'RH2M', 'WS2M', 'ALLSKY_SFC_PAR_TOT', 'GWETTOP', 'GWETROOT'];
    return this.once('powerbase', () =>
      powerDaily(this.parcel.centroid, addDays(this.start, -365 * POWER_BASELINE_YEARS), addDays(this.start, -1), vars, this.signal),
    );
  }

  addSource(s: SourceRef): void {
    this.telemetry.sources[s.id] = s;
  }

  /** Publish a branch and report progress with a snapshot (the store keeps references). */
  emit(b: BranchTelemetry): void {
    if (this.signal?.aborted) return;
    this.telemetry.branches[b.id] = b;
    this.opts.onProgress?.(this.snapshot(), b.id);
  }

  snapshot(): FieldTelemetry {
    return { ...this.telemetry, branches: { ...this.telemetry.branches }, sources: { ...this.telemetry.sources } };
  }

  /** Assemble a branch: status from what arrived, static confidence from the primary source. */
  branch(
    id: BranchId,
    parts: Pick<BranchTelemetry, 'series' | 'facts'> & { events?: BranchTelemetry['events']; notes?: I18nText[]; primarySource?: string; expected: number },
  ): BranchTelemetry {
    const used = new Set<string>();
    // Only sources that actually delivered a value count as used.
    for (const s of parts.series) if (s.samples.some((x) => x.v != null)) used.add(s.sourceId);
    for (const f of parts.facts) if (f.value != null) used.add(f.sourceId);
    for (const e of parts.events ?? []) used.add(e.sourceId);
    const all = Object.values(SOURCES) as SourceRef[];
    for (const sid of used) {
      const ref = all.find((s) => s.id === sid);
      if (ref) this.addSource(ref);
    }
    const primaryId = parts.primarySource ?? parts.series.find((s) => s.primary)?.sourceId ?? parts.series[0]?.sourceId ?? parts.facts[0]?.sourceId;
    const primary = all.find((s) => s.id === primaryId);
    const got = parts.series.filter((s) => s.samples.some((x) => x.v != null)).length + parts.facts.filter((f) => f.value != null).length;
    const status: BranchTelemetry['status'] = got === 0 ? 'unavailable' : got >= parts.expected ? 'ok' : 'partial';
    const notes = [...(parts.notes ?? [])];
    if (status === 'unavailable' && notes.length === 0) notes.push(tx('No source returned data for this branch.', 'Không nguồn nào trả dữ liệu cho nhánh này.'));
    return {
      id,
      title: emptyBranch(id).title,
      series: parts.series,
      facts: parts.facts,
      ...(parts.events ? { events: parts.events } : {}),
      sources: [...used],
      status,
      confidence: status === 'unavailable' ? { level: 'low', score: 0, reasons: notes } : staticBadge(primary, this.parcel),
      ...(notes.length ? { notes } : {}),
    };
  }
}
