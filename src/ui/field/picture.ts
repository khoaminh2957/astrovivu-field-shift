/**
 * The field picture: the parcel's own shape, filled with its within-field raster at a date (or
 * with one colour when the branch has no raster), drawn to a canvas. Pure drawing; the components
 * decide when to call it (a store subscription, never a React render per frame).
 */
import type { BranchId, FieldRaster, ISODate, LngLat, Parcel, RampId } from '@/contracts';
import { colorForValue, isFieldRange, paintForSeries, rasterRampColor, rasterRampStops } from '@/globe';
import { type RampColor, framesAt, paintRaster } from '@/lib/raster';
import { primarySeries, sampleAt } from '@/lib/series';
import type { MissionState } from '@/state/mission';
import { BRANCH_HEX } from '@/ui/design';

/** The raster each branch prefers when several share it. */
const PREFERRED: Partial<Record<BranchId, string>> = { vegetation: 'ndvi', soilMoisture: 'ndmi', thermal: 'lst', terrain: 'elevation' };
/** Branches that are expected to receive a raster (skeleton while loading). */
export const RASTER_BRANCHES: BranchId[] = ['vegetation', 'soilMoisture', 'thermal', 'terrain'];

export function rasterFor(rasters: FieldRaster[], branch: BranchId): FieldRaster | undefined {
  const mine = rasters.filter((r) => r.branch === branch && r.frames.length > 0);
  return mine.find((r) => r.key === PREFERRED[branch]) ?? mine[0];
}

/**
 * The cards and tiles use the stops the map paints with (`src/globe/fieldRaster`), so a picture in
 * the panel and the field on the map are always the same colours. `relative` selects the ramp for
 * a picture stretched to the field's own range.
 */
export const rampStops = (ramp: RampId, relative = false): readonly string[] => rasterRampStops(ramp, relative);

/** The ramp as a CSS gradient; `dir` turns it for a vertical legend (low at the bottom). */
export const rampGradient = (ramp: RampId, relative = false, dir: 'right' | 'up' = 'right'): string =>
  `linear-gradient(${dir === 'up' ? '0deg' : '90deg'}, ${rampStops(ramp, relative).join(', ')})`;

export const rampColorFn = (ramp: RampId, relative = false): RampColor => rasterRampColor(ramp, relative);

/** True when a raster is shown on the field's own range rather than its fixed one. */
export const isRelative = (raster: FieldRaster, range: readonly [number, number] | undefined): boolean => !!range && isFieldRange(raster, range);

/** Outer ring and holes of the parcel. */
export const ringsOf = (parcel: Pick<Parcel, 'polygon'>): LngLat[][] => parcel.polygon.coordinates as LngLat[][];

export interface Projector {
  toPx(p: LngLat): [number, number];
}

/** Web Mercator, unscaled (the map and the satellite tile use it too, so outlines line up). */
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** Fits the parcel into a w x h box, north up, in Web Mercator. */
export function fitProjector(parcel: Pick<Parcel, 'polygon'>, w: number, h: number, pad: number): Projector {
  const ring = ringsOf(parcel)[0] ?? [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lng, lat] of ring) {
    const x = mercX(lng);
    const y = mercY(lat);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const dx = Math.max(1e-12, x1 - x0);
  const dy = Math.max(1e-12, y1 - y0);
  const k = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy);
  const ox = (w - dx * k) / 2;
  const oy = (h - dy * k) / 2;
  return { toPx: ([lng, lat]) => [ox + (mercX(lng) - x0) * k, oy + (mercY(lat) - y0) * k] };
}

/** SVG path of the parcel in a w x h box, for thumbnails. */
export function shapePath(parcel: Pick<Parcel, 'polygon'>, w: number, h: number, pad = 2): string {
  const pr = fitProjector(parcel, w, h, pad);
  return ringsOf(parcel)
    .map((ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${pr.toPx(p).map((v) => v.toFixed(1)).join(' ')}`).join('') + 'Z')
    .join('');
}

const offscreen = new WeakMap<FieldRaster, { canvas: HTMLCanvasElement; img: ImageData }>();

function rasterCanvas(raster: FieldRaster): { canvas: HTMLCanvasElement; img: ImageData } {
  let hit = offscreen.get(raster);
  if (!hit) {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    hit = { canvas, img: new ImageData(raster.width, raster.height) };
    offscreen.set(raster, hit);
  }
  return hit;
}

export type PictureKind = 'raster' | 'single' | 'none' | 'loading';

/** Colour of one value for the whole field (no raster): the branch's ramp when it has one, else its hue. */
export function singleColor(s: Pick<MissionState, 'telemetry'>, branch: BranchId, t: ISODate): { color: string; alpha: number } | null {
  const b = s.telemetry?.branches[branch];
  if (!b) return null;
  const series = primarySeries(b);
  if (series) {
    const paint = paintForSeries(series);
    const v = sampleAt(series, t).sample?.v;
    if (paint && v != null) return { color: colorForValue(paint, v), alpha: 0.85 };
    if (v == null && series.cadence !== 'static') return null;
  }
  return { color: BRANCH_HEX[branch], alpha: 0.4 };
}

export interface DrawOptions {
  parcel: Parcel;
  raster?: FieldRaster;
  /** Exact frame (filmstrip) instead of the blended state at `t`. */
  blend?: boolean;
  t: ISODate;
  /** Used when there is no raster. */
  fill?: { color: string; alpha: number } | null;
  pad?: number;
  outline?: boolean;
  /** Overrides the raster ramp (binned zones). */
  color?: RampColor;
  /** Display range (fixed or field stretch); defaults to the raster's own. */
  range?: [number, number];
}

/** Draws into a canvas whose backing size is already set (CSS size x DPR). Returns what it drew. */
export function drawFieldPicture(canvas: HTMLCanvasElement, o: DrawOptions): PictureKind {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'none';
  const w = canvas.width;
  const h = canvas.height;
  const dpr = w / Math.max(1, canvas.clientWidth || w);
  ctx.clearRect(0, 0, w, h);
  const pr = fitProjector(o.parcel, w, h, (o.pad ?? 8) * dpr);
  const path = new Path2D();
  for (const ring of ringsOf(o.parcel)) {
    ring.forEach((p, i) => {
      const [x, y] = pr.toPx(p);
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
    });
    path.closePath();
  }

  let kind: PictureKind = 'none';
  ctx.save();
  ctx.clip(path, 'evenodd');
  ctx.fillStyle = '#3a3a3c';
  ctx.fill(path, 'evenodd');
  if (o.raster) {
    const r = o.raster;
    const { canvas: off, img } = rasterCanvas(r);
    if (paintRaster(r, o.t, o.color ?? rampColorFn(r.ramp, isRelative(r, o.range)), img.data, o.blend ?? true, o.range)) {
      off.getContext('2d')?.putImageData(img, 0, 0);
      const [x0, y0] = pr.toPx(r.corners[0]);
      const [x1, y1] = pr.toPx(r.corners[2]);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, x0, y0, x1 - x0, y1 - y0);
      kind = 'raster';
    }
  } else if (o.fill) {
    ctx.globalAlpha = o.fill.alpha;
    ctx.fillStyle = o.fill.color;
    ctx.fill(path, 'evenodd');
    ctx.globalAlpha = 1;
    kind = 'single';
  }
  ctx.restore();

  if (o.outline !== false) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3 * dpr;
    ctx.stroke(path);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke(path);
  }
  return kind;
}

/** Date of the real frame the picture shows at `t`, and its age in days. */
export function frameShown(raster: FieldRaster | undefined, t: ISODate): { date: ISODate; ageDays: number } | null {
  if (!raster) return null;
  const pair = framesAt(raster, t);
  return pair ? { date: pair.a.t, ageDays: pair.ageDays } : null;
}
