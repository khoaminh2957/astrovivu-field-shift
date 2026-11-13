/**
 * NASA GIBS overlays: what the layer panel can list, how a cursor date maps to a tile date.
 *
 * Pure module (no DOM, no MapLibre) so the snapping rules are unit-tested. Layer ids, formats,
 * tile matrix sets and colour maps were read from the GIBS WMTS GetCapabilities and colour-map
 * documents on 2026-11-14.
 */
import type { Cadence, I18nText, ISODate, OverlayId, OverlayInfo } from '@/contracts';
import { tx } from '@/contracts';
import { HOLD_DAYS } from '@/lib/series';
import { addDays, diffDays } from '@/lib/time';

export const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export interface LegendStop {
  value: number;
  color: string;
}

/** `OverlayInfo` plus what the map and a legend need. Everything beyond the contract is optional for consumers. */
export interface GlobeOverlayInfo extends OverlayInfo {
  format: 'png' | 'jpeg';
  /** GIBS tile matrix set; the level in its name is the deepest zoom that exists. */
  matrixSet: string;
  maxZoom: number;
  /** Native ground resolution of the product, metres. */
  resolutionM: number | null;
  /** Used only when the layer's time domain cannot be fetched: newest date assumed to exist is today minus this. */
  latencyDays: number;
  /** Colours of the GIBS colour map at round values, low to high, for a legend bar. */
  legendStops: LegendStop[];
  legendScale: 'linear' | 'log';
  /** What one colour means, shown under the legend. */
  note: I18nText;
  /** Coarse grids keep hard pixel edges when magnified: the footprint is part of the message. */
  resampling: 'linear' | 'nearest';
}

const info = (o: GlobeOverlayInfo): GlobeOverlayInfo => o;

export const OVERLAYS: GlobeOverlayInfo[] = [
  info({
    id: 'none',
    label: tx('No overlay', 'Không phủ lớp'),
    gibsLayer: null,
    cadence: 'static',
    sourceId: '',
    format: 'png',
    matrixSet: '',
    maxZoom: 0,
    resolutionM: null,
    latencyDays: 0,
    legendStops: [],
    legendScale: 'linear',
    note: tx('Satellite base map only.', 'Chỉ ảnh nền vệ tinh.'),
    resampling: 'linear',
  }),
  info({
    id: 'truecolor',
    label: tx('True colour, that day', 'Ảnh màu thật theo ngày'),
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    cadence: 'daily',
    sourceId: 'modis-terra-truecolor',
    format: 'jpeg',
    matrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    resolutionM: 250,
    latencyDays: 1,
    legendStops: [],
    legendScale: 'linear',
    note: tx(
      'What MODIS Terra saw on the cursor date, clouds included (250 m).',
      'Hình MODIS Terra chụp đúng ngày con trỏ, kể cả mây (250 m).',
    ),
    resampling: 'linear',
  }),
  info({
    id: 'ndvi',
    label: tx('Vegetation index (NDVI)', 'Chỉ số thực vật (NDVI)'),
    gibsLayer: 'MODIS_Terra_L3_NDVI_16Day',
    cadence: '16-day',
    sourceId: 'modis-mod13q1',
    legend: { min: 0, max: 1, unit: '' },
    format: 'png',
    matrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    resolutionM: 250,
    latencyDays: 32,
    legendStops: [
      { value: 0, color: '#e1e1e2' },
      { value: 0.1, color: '#dfcec2' },
      { value: 0.2, color: '#b09b8a' },
      { value: 0.3, color: '#965a47' },
      { value: 0.4, color: '#8fb716' },
      { value: 0.5, color: '#56a100' },
      { value: 0.6, color: '#3e8a01' },
      { value: 0.7, color: '#217801' },
      { value: 0.8, color: '#086701' },
      { value: 0.9, color: '#005401' },
      { value: 1, color: '#001801' },
    ],
    legendScale: 'linear',
    note: tx(
      'Greenness over 16 days, MODIS Terra, 250 m pixels.',
      'Độ xanh trong 16 ngày, MODIS Terra, điểm ảnh 250 m.',
    ),
    resampling: 'nearest',
  }),
  info({
    id: 'soilMoisture',
    label: tx('Root-zone soil moisture', 'Độ ẩm đất vùng rễ'),
    gibsLayer: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
    cadence: 'daily',
    sourceId: 'smap-l4',
    legend: { min: 0, max: 0.6, unit: 'm³/m³' },
    format: 'png',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    resolutionM: 9000,
    latencyDays: 4,
    legendStops: [
      { value: 0, color: '#ffa200' },
      { value: 0.1, color: '#fff800' },
      { value: 0.2, color: '#4da600' },
      { value: 0.3, color: '#00ca95' },
      { value: 0.4, color: '#009aff' },
      { value: 0.5, color: '#0000db' },
      { value: 0.6, color: '#060664' },
    ],
    legendScale: 'linear',
    note: tx(
      'SMAP L4 model analysis at 12:00 UTC, 9 km pixels: a regional signal, not a field reading.',
      'Phân tích mô hình SMAP L4 lúc 12:00 UTC, điểm ảnh 9 km: tín hiệu vùng, không phải số đo của thửa.',
    ),
    resampling: 'nearest',
  }),
  info({
    id: 'rain',
    label: tx('Rain rate (IMERG)', 'Cường độ mưa (IMERG)'),
    gibsLayer: 'IMERG_Precipitation_Rate',
    cadence: 'daily',
    sourceId: 'gpm-imerg',
    legend: { min: 0.1, max: 50, unit: 'mm/h' },
    format: 'png',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxZoom: 6,
    resolutionM: 10000,
    latencyDays: 2,
    legendStops: [
      { value: 0.1, color: '#00764e' },
      { value: 0.25, color: '#009f0f' },
      { value: 0.5, color: '#45c000' },
      { value: 1, color: '#c3e400' },
      { value: 2.5, color: '#ff980f' },
      { value: 5, color: '#ff4730' },
      { value: 10, color: '#e70000' },
      { value: 25, color: '#8a0000' },
      { value: 50, color: '#3f0000' },
    ],
    legendScale: 'log',
    note: tx(
      'GPM IMERG rain rate for the day, 10 km pixels. Below 0.1 mm/h is left clear.',
      'Cường độ mưa GPM IMERG trong ngày, điểm ảnh 10 km. Dưới 0,1 mm/giờ để trống.',
    ),
    resampling: 'nearest',
  }),
  info({
    id: 'lst',
    label: tx('Land surface temperature', 'Nhiệt độ bề mặt đất'),
    // The 8-day composite, not the daily swath: it is the product the thermal branch samples
    // (MOD11A2) and it is not riddled with cloud and orbit gaps.
    gibsLayer: 'MODIS_Terra_L3_Land_Surface_Temp_8Day_Day',
    cadence: '8-day',
    sourceId: 'modis-mod11a2',
    legend: { min: -20, max: 60, unit: '°C' },
    format: 'png',
    matrixSet: 'GoogleMapsCompatible_Level7',
    maxZoom: 7,
    resolutionM: 1000,
    latencyDays: 14,
    legendStops: [
      { value: -20, color: '#00ccff' },
      { value: -10, color: '#1dffbc' },
      { value: 0, color: '#57ff34' },
      { value: 10, color: '#95ff00' },
      { value: 20, color: '#d7ff00' },
      { value: 30, color: '#fff100' },
      { value: 40, color: '#ffbe00' },
      { value: 50, color: '#ff8800' },
      { value: 60, color: '#ff5800' },
    ],
    legendScale: 'linear',
    note: tx(
      'Daytime skin temperature of the ground, 8-day mean, MODIS Terra, 1 km pixels.',
      'Nhiệt độ bề mặt ban ngày, trung bình 8 ngày, MODIS Terra, điểm ảnh 1 km.',
    ),
    resampling: 'nearest',
  }),
];

export const getOverlay = (id: OverlayId): GlobeOverlayInfo => OVERLAYS.find((o) => o.id === id) ?? OVERLAYS[0];

/** MapLibre tile template for one overlay date. `scheme` lets the caller route through its own fetch protocol. */
export function overlayTileUrl(o: GlobeOverlayInfo, date: ISODate, base: string = GIBS_BASE): string {
  return `${base}/${o.gibsLayer}/default/${date}/${o.matrixSet}/{z}/{y}/{x}.${o.format}`;
}

/** DescribeDomains request: a few hundred bytes listing the dates that exist between two days. */
export function overlayDomainUrl(o: GlobeOverlayInfo, start: ISODate, end: ISODate): string {
  return `${GIBS_BASE}/1.0.0/${o.gibsLayer}/default/${o.matrixSet}/all/${start}--${end}.xml`;
}

// ---------------------------------------------------------------------------------------------
// Time domains
// ---------------------------------------------------------------------------------------------

export interface DateRange {
  start: ISODate;
  end: ISODate;
  stepDays: number;
}
/** Ascending, non-overlapping. Dates between ranges do not exist on the server (HTTP 404). */
export type TimeDomain = DateRange[];

const PERIOD = /^P(\d+)D$/;

/** Parses the `<Domain>` of a GIBS DescribeDomains answer, e.g. `2026-01-01/2026-10-16/P16D,…`. */
export function parseTimeDomain(xml: string): TimeDomain {
  const body = /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1];
  if (!body) return [];
  const out: TimeDomain = [];
  for (const part of body.split(',')) {
    const [start, end, period] = part.trim().split('/');
    const step = PERIOD.exec(period ?? '');
    // Sub-daily layers (PT30M) are not used here; a date-only request would hit one half hour.
    if (!start || !end || !step || start.length !== 10 || end.length !== 10) continue;
    out.push({ start, end, stepDays: Number(step[1]) });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export const CADENCE_DAYS: Record<Cadence, number> = { daily: 1, weekly: 7, '8-day': 8, '16-day': 16, monthly: 30, static: 0 };

/**
 * What we assume exists when DescribeDomains cannot be reached: the product cadence, anchored at
 * 1 January as MODIS composites are, up to today minus the usual publication delay.
 */
export function fallbackTimeDomain(o: GlobeOverlayInfo, windowStart: ISODate, today: ISODate): TimeDomain {
  const step = CADENCE_DAYS[o.cadence] || 1;
  const newest = addDays(today, -o.latencyDays);
  const out: TimeDomain = [];
  for (let year = Number(windowStart.slice(0, 4)); year <= Number(newest.slice(0, 4)); year++) {
    const start = `${year}-01-01`;
    if (start > newest) break;
    const last = `${year}-12-31` < newest ? `${year}-12-31` : newest;
    const k = Math.floor(diffDays(last, start) / step);
    out.push({ start, end: addDays(start, k * step), stepDays: step });
  }
  return out;
}

/** The most recent date at or before `t` that the server has, or null when `t` precedes the domain. */
export function snapToDomain(domain: TimeDomain, t: ISODate): ISODate | null {
  for (let i = domain.length - 1; i >= 0; i--) {
    const r = domain[i];
    if (t < r.start) continue;
    if (t >= r.end) return r.end;
    return addDays(r.start, Math.floor(diffDays(t, r.start) / r.stepDays) * r.stepDays);
  }
  return null;
}

/**
 * Beyond this age the last picture says nothing about the cursor date (a source outage, not
 * ordinary latency), so the overlay is hidden instead of being held.
 */
export const HIDE_AFTER_DAYS: Record<Cadence, number> = {
  daily: 10,
  weekly: 21,
  '8-day': 24,
  '16-day': 48,
  monthly: 90,
  static: Number.POSITIVE_INFINITY,
};

export interface OverlayDate {
  /** Tile date to request, or null when nothing recent enough exists. */
  date: ISODate | null;
  /** Days between the cursor and the start of the picture shown. */
  ageDays: number | null;
  /** Older than the hold window of its cadence (ARCHITECTURE.md §4.2, T3). */
  stale: boolean;
}

/** Temporal rule T2 for the map: the newest picture at or before the cursor, held for a bounded time. */
export function resolveOverlayDate(o: GlobeOverlayInfo, domain: TimeDomain, cursor: ISODate): OverlayDate {
  const date = snapToDomain(domain, cursor);
  if (!date) return { date: null, ageDays: null, stale: true };
  const ageDays = diffDays(cursor, date);
  if (ageDays > HIDE_AFTER_DAYS[o.cadence]) return { date: null, ageDays, stale: true };
  return { date, ageDays, stale: ageDays > HOLD_DAYS[o.cadence] };
}

/** CSS gradient of an overlay legend, for the layer panel. Log scales are spaced by log(value). */
export function overlayLegendCss(o: GlobeOverlayInfo): string | null {
  const s = o.legendStops;
  if (s.length < 2) return null;
  const pos = (v: number) => (o.legendScale === 'log' ? Math.log(v) : v);
  const lo = pos(s[0].value);
  const span = pos(s[s.length - 1].value) - lo || 1;
  return `linear-gradient(90deg, ${s.map((x) => `${x.color} ${(((pos(x.value) - lo) / span) * 100).toFixed(1)}%`).join(', ')})`;
}
