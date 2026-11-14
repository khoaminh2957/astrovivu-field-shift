/**
 * The within-field picture: a `FieldRaster` painted inside the parcel, the way field-monitoring
 * apps show an index map over the satellite image.
 *
 * The raster is a few dozen cells a side. It is painted at its own size, upscaled with smoothing
 * into a canvas about 384 px on its long side, clipped there to the parcel polygon, and that
 * canvas is placed on the map with a CSS `matrix3d` homography computed from its four projected
 * corners. So a repaint happens only when the date changes; following the camera costs one
 * transform write per frame, done by the compositor, and the terrain texture cache is untouched.
 * The plane through the four corners ignores relief inside the field (a few metres over a few
 * hundred: invisible at field scale).
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FieldRaster, ISODate, LngLat, RampId } from '@/contracts';
import { framesAt, paintRaster, type RampColor } from '@/lib/raster';
import { RAMPS, type MapMetric } from '@/ui/design/tokens';

const TARGET_PX = 384;

/** Stops for the ramps the design system does not define for the map (static layers, risk). */
const EXTRA_STOPS: Record<Exclude<RampId, MapMetric>, string[]> = {
  terrain: ['#2b6b47', '#6f9e4f', '#c9c27a', '#b98b52', '#8a5a3c', '#efe9e1'],
  soil: ['#f6e8c3', '#dfc27d', '#bf812d', '#8c510a', '#543005'],
  light: ['#1a1a2e', '#5c3c7a', '#c0587e', '#f79a5a', '#fde58a'],
  risk: ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'],
};

const isMapMetric = (id: RampId): id is MapMetric => id in RAMPS;

export function rampStops(id: RampId): readonly string[] {
  return isMapMetric(id) ? RAMPS[id].sequential.stops : EXTRA_STOPS[id];
}

/** Legend bar for a raster ramp: the design-system variable where there is one. */
export function rasterRampCss(id: RampId): string {
  return isMapMetric(id) ? RAMPS[id].sequential.cssVar : `linear-gradient(90deg, ${EXTRA_STOPS[id].join(', ')})`;
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const colorFns = new Map<RampId, RampColor>();

/** Piecewise linear in sRGB over the stops, the same interpolation the CSS gradient legend draws. */
export function rampColor(id: RampId): RampColor {
  let fn = colorFns.get(id);
  if (!fn) {
    const stops = rampStops(id).map(hexRgb);
    fn = (pos) => {
      const x = Math.max(0, Math.min(1, pos)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(x));
      const f = x - i;
      const a = stops[i];
      const b = stops[i + 1];
      return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
    };
    colorFns.set(id, fn);
  }
  return fn;
}

/** Projective map of the unit square onto a quad (p0 at u=v=0, p1 u=1, p2 u=v=1, p3 v=1), as CSS matrix3d for a W x H element. */
export function quadMatrix3d(p: [number, number][], w: number, h: number): string | null {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  if (!m.every(Number.isFinite)) return null;
  return `matrix3d(${m.map((v) => +v.toPrecision(9)).join(',')})`;
}

export interface RasterFrameInfo {
  date: ISODate;
  nextDate: ISODate | null;
}

export class FieldRasterView {
  readonly el: HTMLCanvasElement;
  private readonly small = document.createElement('canvas');
  private raster: FieldRaster | null = null;
  private image: ImageData | null = null;
  private clip: Path2D | null = null;
  private paintedKey = '';
  private lastTransform = '';
  private shown = false;

  constructor(
    private readonly map: MapLibreMap,
    before: Element,
  ) {
    this.el = document.createElement('canvas');
    this.el.className = 'globe-raster';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.display = 'none';
    before.parentElement?.insertBefore(this.el, before);
  }

  get current(): FieldRaster | null {
    return this.raster;
  }

  /** Sets the raster and the parcel ring it is clipped to; null removes the picture. */
  set(raster: FieldRaster | null, ring: LngLat[]): void {
    if (raster === this.raster) return;
    this.raster = raster;
    this.paintedKey = '';
    this.lastTransform = '';
    if (!raster || raster.width < 1 || raster.height < 1) {
      this.raster = null;
      this.hide();
      return;
    }
    this.small.width = raster.width;
    this.small.height = raster.height;
    this.image = new ImageData(raster.width, raster.height);
    const s = Math.max(1, Math.round(TARGET_PX / Math.max(raster.width, raster.height)));
    this.el.width = raster.width * s;
    this.el.height = raster.height * s;
    // The grid is north-up in lng/lat: the polygon maps to canvas pixels linearly.
    const [nw, , se] = raster.corners;
    const W = this.el.width;
    const H = this.el.height;
    const path = new Path2D();
    ring.forEach(([lng, lat], i) => {
      const x = ((lng - nw[0]) / (se[0] - nw[0])) * W;
      const y = ((nw[1] - lat) / (nw[1] - se[1])) * H;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    this.clip = path;
  }

  /** Paints the picture at date `t`; does nothing when that day is already on screen. */
  paint(t: ISODate): RasterFrameInfo | null {
    const { raster, image, clip } = this;
    if (!raster || !image || !clip) return null;
    const pair = framesAt(raster, t);
    if (!pair) return null;
    const info = { date: pair.a.t, nextDate: pair.b && pair.mix > 0 ? pair.b.t : null };
    if (t === this.paintedKey) return info;
    this.paintedKey = t;
    paintRaster(raster, t, rampColor(raster.ramp), image.data);
    this.small.getContext('2d')?.putImageData(image, 0, 0);
    const ctx = this.el.getContext('2d');
    if (!ctx) return info;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.save();
    ctx.clip(clip);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.small, 0, 0, this.el.width, this.el.height);
    ctx.restore();
    return info;
  }

  /** Follows the camera: one transform write per frame, only when it changed. */
  position(visible: boolean): void {
    if (!this.raster || !visible) {
      this.hide();
      return;
    }
    const pts = this.raster.corners.map((c) => {
      const p = this.map.project(c);
      return [p.x, p.y] as [number, number];
    });
    const m = pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e5 && Math.abs(y) < 1e5)
      ? quadMatrix3d(pts, this.el.width, this.el.height)
      : null;
    if (!m) {
      this.hide();
      return;
    }
    if (m !== this.lastTransform) {
      this.lastTransform = m;
      this.el.style.transform = m;
    }
    if (!this.shown) {
      this.shown = true;
      this.el.style.display = '';
    }
  }

  destroy(): void {
    this.el.remove();
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.style.display = 'none';
  }
}
