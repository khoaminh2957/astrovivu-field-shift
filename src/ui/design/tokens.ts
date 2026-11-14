import { interpolateRgb, piecewise } from 'd3-interpolate';
import type { BranchId, Provenance } from '@/contracts';

/*
 * Literal mirror of tokens.css for code that cannot read CSS variables (MapLibre paint, canvas,
 * WebGL). tokens.css is the source of truth; tokens.test.ts fails if the two drift apart.
 */

export const COLOR = {
  void: '#e5e5ea',
  surface0: '#ffffff',
  surface1: '#ffffff',
  surface2: '#f2f2f7',
  surface3: '#e5e5ea',
  inset: '#f2f2f7',
  line1: '#e5e5ea',
  line2: '#d1d1d6',
  line3: '#7c7c80',
  ink1: '#1c1c1e',
  ink2: '#48484a',
  ink3: '#636366',
  ink4: '#8e8e93',
  signal: '#27ae60',
  signalStrong: '#1a7f45',
  onSignal: '#ffffff',
  nominal: '#11703c',
  watch: '#8f5300',
  alert: '#b42a20',
  stale: '#4f5f6e',
  simulated: '#674c83',
  truth: '#15804a',
} as const;

/** Data ink per telemetry branch, as hex (canvas, map) and as a CSS variable (DOM, SVG). */
export const BRANCH_HEX: Record<BranchId, string> = {
  soilMoisture: '#0e8fb0',
  vegetation: '#3f9a2a',
  thermal: '#d9541e',
  rainfall: '#3b6fd6',
  agromet: '#a88600',
  terrain: '#8c7a5b',
  soil: '#a8642b',
  risk: '#c2477f',
};

export const BRANCH_VAR: Record<BranchId, string> = {
  soilMoisture: 'var(--color-branch-soil-moisture)',
  vegetation: 'var(--color-branch-vegetation)',
  thermal: 'var(--color-branch-thermal)',
  rainfall: 'var(--color-branch-rainfall)',
  agromet: 'var(--color-branch-agromet)',
  terrain: 'var(--color-branch-terrain)',
  soil: 'var(--color-branch-soil)',
  risk: 'var(--color-branch-risk)',
};

/** What a reading or a field can be flagged as. `nominal` is drawn quietly on purpose. */
export const STATUSES = ['nominal', 'watch', 'alert', 'stale', 'simulated', 'ground-truth'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_VAR: Record<Status, string> = {
  nominal: 'var(--color-nominal)',
  watch: 'var(--color-watch)',
  alert: 'var(--color-alert)',
  stale: 'var(--color-stale)',
  simulated: 'var(--color-simulated)',
  'ground-truth': 'var(--color-truth)',
};

export type Severity = 'info' | 'watch' | 'alert';

/** `RiskEvent.severity` (0-3) to the three marker levels the UI draws. */
export function severityFromRisk(level: 0 | 1 | 2 | 3): Severity {
  return level >= 2 ? 'alert' : level === 1 ? 'watch' : 'info';
}

export const PROVENANCES: Provenance[] = ['observed', 'modelled', 'derived', 'forecast', 'simulated', 'ground-truth'];

// ---------------------------------------------------------------------------------------------
// Map metric ramps, low to high. Vegetation follows the convention of field-monitoring apps;
// the others are ColorBrewer, colour-blind safe.
// ---------------------------------------------------------------------------------------------

export type MapMetric = 'vegetation' | 'moisture' | 'heat' | 'rain';
export type RampMode = 'sequential' | 'diverging';

// NDVI on its fixed 0-1 scale, the twelve stops of the reference product's legend: bare soil brown, yellow, canopy green.
const NDVI = ['#300b05', '#812c14', '#b36127', '#e7bc4c', '#f3da60', '#f8ee64', '#f4f550', '#d1e54a', '#a3cf40', '#4d8f28', '#1e4816', '#123011'];
// Vegetation stretched to one field's own range (the reference's "contrasted" colouring): plum, red, yellow, green, teal.
const NDVI_FIELD = ['#881e4c', '#db3d25', '#f1b54f', '#f7e050', '#eff651', '#80db45', '#4aa069', '#3e8874', '#3d8575'];
// Relative zones of a field (low, medium, high).
const ZONES = ['#d0e3fc', '#8abbf7', '#4392f1'];
const YL_GN_BU = ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'];
const YL_OR_RD = ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'];
const BLUES = ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'];
/** Brown (drier, browner than normal) to blue-green (wetter, greener than normal). */
const DRY_WET = ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e'];
/** Blue (cooler than normal) to red (hotter than normal). */
const COOL_WARM = ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'];

export interface Ramp {
  stops: readonly string[];
  /** CSS custom property holding the same stops as a left-to-right gradient. */
  cssVar: string;
  /** 0..1 to an `rgb()` string. Input is clamped. */
  at: (t: number) => string;
}

function ramp(stops: string[], cssVar: string): Ramp {
  // Piecewise linear in sRGB, exactly what the CSS gradient in the legend draws.
  const f = piecewise(interpolateRgb, stops);
  return { stops, cssVar, at: (t) => f(Math.max(0, Math.min(1, t))) };
}

const anomalyWet = ramp(DRY_WET, 'var(--ramp-anomaly-wet)');

export const RAMPS: Record<MapMetric, Record<RampMode, Ramp>> = {
  vegetation: { sequential: ramp(NDVI, 'var(--ramp-vegetation)'), diverging: anomalyWet },
  moisture: { sequential: ramp(YL_GN_BU, 'var(--ramp-moisture)'), diverging: anomalyWet },
  heat: { sequential: ramp(YL_OR_RD, 'var(--ramp-heat)'), diverging: ramp(COOL_WARM, 'var(--ramp-anomaly-heat)') },
  rain: { sequential: ramp(BLUES, 'var(--ramp-rain)'), diverging: anomalyWet },
};

/** Vegetation when the picture is stretched to the field's own range (relative, not absolute, colours). */
export const RAMP_VEGETATION_FIELD: Ramp = ramp(NDVI_FIELD, 'var(--ramp-vegetation-field)');
/** Low, medium and high zone of a field. */
export const RAMP_ZONES: Ramp = ramp(ZONES, 'var(--ramp-zones)');

/** Which ramp paints the parcel for a branch headline metric. Null means the branch has no map paint. */
export const BRANCH_RAMP: Record<BranchId, MapMetric | null> = {
  soilMoisture: 'moisture',
  vegetation: 'vegetation',
  thermal: 'heat',
  rainfall: 'rain',
  agromet: null,
  terrain: null,
  soil: null,
  risk: null,
};

/**
 * Colour for a value on a metric ramp. Sequential: `value` within [min, max]. Diverging: `value` is
 * a departure from normal and [min, max] is the symmetric range, e.g. [-2, 2] for z-scores.
 */
export function rampColor(metric: MapMetric, value: number, domain: [min: number, max: number], mode: RampMode = 'sequential'): string {
  const [min, max] = domain;
  const t = max === min ? 0.5 : (value - min) / (max - min);
  return RAMPS[metric][mode].at(t);
}

// ---------------------------------------------------------------------------------------------
// Motion and layers, for the `motion` library and inline styles.
// ---------------------------------------------------------------------------------------------

export const MOTION = {
  /** Seconds, matching the --dur-* tokens. */
  dur: { instant: 0.08, fast: 0.14, base: 0.22, slow: 0.42, camera: 1.6, fade: 0.12 },
  ease: {
    out: [0.16, 1, 0.3, 1],
    in: [0.7, 0, 0.84, 0],
    inOut: [0.65, 0, 0.35, 1],
  },
  /** Delay between siblings when a group arrives together (leader lines, callouts). */
  stagger: 0.04,
} as const;

export const Z = {
  globe: 0,
  mapUi: 10,
  leader: 20,
  hud: 30,
  panel: 40,
  dock: 50,
  chrome: 60,
  assistant: 70,
  overlay: 80,
  popover: 90,
  toast: 100,
} as const;

/** Layout breakpoints in CSS pixels (same as the Tailwind `lg`, `xl`, `2xl` variants). */
export const BREAKPOINT = { stack: 1024, compact: 1280, reference: 1440 } as const;

// ---------------------------------------------------------------------------------------------
// Contrast, for the style guide and for anyone adding a colour.
// ---------------------------------------------------------------------------------------------

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
