import type { I18nText, ISODate } from './common';

/** The eight telemetry branches of the Radial HUD, in display order (first four left, last four right). */
export const BRANCHES = [
  'soilMoisture',
  'vegetation',
  'thermal',
  'rainfall',
  'agromet',
  'terrain',
  'soil',
  'risk',
] as const;
export type BranchId = (typeof BRANCHES)[number];

export const BRANCH_SIDE: Record<BranchId, 'left' | 'right'> = {
  soilMoisture: 'left',
  vegetation: 'left',
  thermal: 'left',
  rainfall: 'left',
  agromet: 'right',
  terrain: 'right',
  soil: 'right',
  risk: 'right',
};

/**
 * Where a number comes from. Drives the Confidence Badge and the honesty labels in the UI:
 * a satellite retrieval, a reanalysis/model, a forecast, something we derived, a clearly
 * labelled simulation, or a measurement the farmer typed in.
 */
export type Provenance = 'observed' | 'modelled' | 'forecast' | 'derived' | 'simulated' | 'ground-truth';

export interface SourceRef {
  /** Stable id, e.g. `nasa-power`, `modis-mod13q1`, `gpm-imerg`, `smap-l4`, `soilgrids`, `srtm`. */
  id: string;
  name: string;
  /** Exact name used on the challenge Resources page, when the dataset is listed there. */
  resourceName?: string;
  agency: string;
  provenance: Provenance;
  /** Native ground resolution in metres (null when not gridded). */
  resolutionM: number | null;
  /** Native revisit or composite period in days (null for static layers). */
  cadenceDays: number | null;
  /** Typical delay between observation and availability, in days. */
  latencyDays: number | null;
  /** Which service actually delivered the values, e.g. `ORNL DAAC subset API`. */
  access: string;
  url: string;
  license?: string;
}

export type Cadence = 'daily' | 'weekly' | '8-day' | '16-day' | 'monthly' | 'static';
export type Quality = 'good' | 'fair' | 'poor' | 'filled';

export interface Sample {
  t: ISODate;
  v: number | null;
  q?: Quality;
}

/** Multi-year climatology for one day of year: the "normal band" drawn behind a sparkline. */
export interface BaselinePoint {
  doy: number;
  mean: number;
  p10: number;
  p90: number;
}

/**
 * Canonical metric keys. Adapters MUST emit these keys so the HUD, the scorer and the advisory
 * engine can find a metric without knowing which source delivered it. `Series.unit` is
 * authoritative (soil moisture may be volumetric m3/m3 or % of saturation depending on source).
 */
export const METRICS = {
  sm_surface: { branch: 'soilMoisture', unit: 'm³/m³' },
  sm_root: { branch: 'soilMoisture', unit: 'm³/m³' },
  ndvi: { branch: 'vegetation', unit: '' },
  evi: { branch: 'vegetation', unit: '' },
  lst_day: { branch: 'thermal', unit: '°C' },
  lst_night: { branch: 'thermal', unit: '°C' },
  esi: { branch: 'thermal', unit: 'σ' },
  et: { branch: 'thermal', unit: 'mm/day' },
  rain: { branch: 'rainfall', unit: 'mm/day' },
  rain_anom: { branch: 'rainfall', unit: '%' },
  par: { branch: 'agromet', unit: 'MJ/m²/day' },
  t2m_max: { branch: 'agromet', unit: '°C' },
  t2m_min: { branch: 'agromet', unit: '°C' },
  t2m: { branch: 'agromet', unit: '°C' },
  rh: { branch: 'agromet', unit: '%' },
  wind: { branch: 'agromet', unit: 'm/s' },
  et0: { branch: 'agromet', unit: 'mm/day' },
  fc_tmax: { branch: 'risk', unit: '°C' },
  fc_tmin: { branch: 'risk', unit: '°C' },
  fc_rain: { branch: 'risk', unit: 'mm/day' },
} as const satisfies Record<string, { branch: BranchId; unit: string }>;
export type MetricKey = keyof typeof METRICS;

/** Canonical keys for static facts (terrain and soil branches). */
export const TERRAIN_FACTS = ['elevation_m', 'slope_deg', 'aspect_deg', 'aspect_label', 'flow_dir_label', 'relief_m'] as const;
export const SOIL_FACTS = [
  'ph',
  'soc_gkg',
  'clay_pct',
  'sand_pct',
  'silt_pct',
  'texture_class',
  'cec_cmolkg',
  'nitrogen_gkg',
  'bulk_density',
  'drainage_class',
  'awc_cmcm',
  'ec_dsm',
  'depth_cm',
] as const;

export interface Series {
  /** A MetricKey whenever one applies; adapters may add extra keys for secondary metrics. */
  key: string;
  branch: BranchId;
  label: I18nText;
  unit: string;
  sourceId: string;
  cadence: Cadence;
  /** Native cadence, ascending by `t`, never resampled. Gaps are `v: null`. */
  samples: Sample[];
  baseline?: BaselinePoint[];
  /** Suggested display range for sparklines and colour ramps. */
  range?: [min: number, max: number];
  /** The branch headline metric shown on the HUD callout. */
  primary?: boolean;
}

export interface StaticFact {
  key: string;
  branch: BranchId;
  label: I18nText;
  value: number | string | null;
  unit?: string;
  sourceId: string;
  detail?: I18nText;
  /** 5th-95th percentile when the source publishes uncertainty (e.g. SoilGrids). */
  uncertainty?: [lo: number, hi: number];
}

export type RiskKind = 'heat' | 'frost' | 'heavy-rain' | 'dry-spell' | 'flood' | 'wind' | 'pest' | 'disease';

export interface RiskEvent {
  id: string;
  kind: RiskKind;
  start: ISODate;
  end: ISODate;
  /** 0 none, 1 watch, 2 warning, 3 severe. */
  severity: 0 | 1 | 2 | 3;
  title: I18nText;
  detail: I18nText;
  sourceId: string;
}

/**
 * Why a reading can (or cannot) be trusted at parcel scale. `score` combines how well the pixel
 * fits the parcel, how fresh the observation is and how it was produced; see ARCHITECTURE.md §4.
 */
export interface ConfidenceBadge {
  level: 'high' | 'medium' | 'low';
  score: number;
  reasons: I18nText[];
}

export interface BranchTelemetry {
  id: BranchId;
  title: I18nText;
  series: Series[];
  facts: StaticFact[];
  events?: RiskEvent[];
  /** SourceRef ids actually used (after fallbacks). */
  sources: string[];
  status: 'ok' | 'partial' | 'unavailable';
  /** Spatial + provenance part of the badge; the UI degrades it further with observation age. */
  confidence: ConfidenceBadge;
  /** Caveats the user must see: fallback used, mixed pixel, masked pixel, source outage. */
  notes?: I18nText[];
}

export interface TelemetryWindow {
  /** 365-day look-back window ending today. */
  start: ISODate;
  end: ISODate;
  today: ISODate;
  /** End of the forecast horizon (risk branch), if any. */
  forecastEnd?: ISODate;
}

export type TelemetryMode = 'live' | 'cached' | 'mock';

export interface FieldTelemetry {
  parcelId: string;
  generatedAt: string;
  window: TelemetryWindow;
  branches: Record<BranchId, BranchTelemetry>;
  sources: Record<string, SourceRef>;
  mode: TelemetryMode;
}
