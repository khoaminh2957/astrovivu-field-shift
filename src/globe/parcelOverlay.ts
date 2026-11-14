/**
 * The locked parcel: outline, glow, metric fill and the screen anchor the HUD hangs from.
 *
 * It is drawn as SVG over the WebGL canvas, from the same projected ring that yields the anchor.
 * Two reasons. A fill draped on 3D terrain lives in MapLibre's terrain texture cache, and every
 * recolour would redraw that cache for the whole view: the timeline could not scrub at 60 fps.
 * And a vector stroke stays crisp at any pitch, where a draped line thins out toward the horizon.
 * The ring is densified first, so the outline still follows the relief.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FieldRaster, ISODate, LngLat, Parcel, ScreenAnchor } from '@/contracts';
import { FieldRasterView, type RasterFrameInfo } from './fieldRaster';
import { densifyRing, openRing } from './draft';
import { facesCamera, projectRing, ringPath, svgEl, type ScreenRing } from './svg';

/** Honesty textures of the design system: dotted = simulated, hatched = not received / held too long. */
export type FillTexture = 'none' | 'simulated' | 'pending';

export interface ParcelFill {
  /** CSS colour, or null for no fill (outline only). */
  color: string | null;
  texture: FillTexture;
}

const FILL_OPACITY = 0.62;
/** Below this on-screen size the parcel is a speck: a reticle marks it instead of its outline. */
const RETICLE_BELOW_PX = 22;
const MAX_RING_POINTS = 120;

let patternSeq = 0;

export class ParcelOverlay {
  private readonly group: SVGGElement;
  private readonly glow: SVGPathElement;
  private readonly fill: SVGPathElement;
  private readonly texture: SVGPathElement;
  private readonly casing: SVGPathElement;
  private readonly line: SVGPathElement;
  private readonly reticle: SVGGElement;
  private readonly dotsId: string;
  private readonly hatchId: string;

  private ring: LngLat[] = [];
  private centroid: LngLat | null = null;
  private screen: ScreenRing | undefined;
  private last: ScreenAnchor | null = null;
  private lastPath = '';
  private shown = false;
  private corners: LngLat[] = [];
  private readonly raster: FieldRasterView;
  private lastEmitAt = 0;
  /** Minimum interval between anchor publications (ms); 0 = every frame that changes it. */
  anchorEveryMs = 0;

  constructor(
    private readonly map: MapLibreMap,
    svg: SVGSVGElement,
    private readonly publish: (anchor: ScreenAnchor | null) => void,
  ) {
    const n = ++patternSeq;
    this.dotsId = `globe-dots-${n}`;
    this.hatchId = `globe-hatch-${n}`;
    const defs = svgEl('defs', {}, svg);
    const dots = svgEl('pattern', { id: this.dotsId, width: 7, height: 7, patternUnits: 'userSpaceOnUse' }, defs);
    svgEl('circle', { cx: 2, cy: 2, r: 1.1, class: 'globe-parcel__ink' }, dots);
    svgEl('circle', { cx: 5.5, cy: 5.5, r: 1.1, class: 'globe-parcel__ink' }, dots);
    const hatch = svgEl('pattern', { id: this.hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    svgEl('line', { x1: 0.5, y1: 0, x2: 0.5, y2: 6, class: 'globe-parcel__ink-line' }, hatch);
    const blur = svgEl('filter', { id: `globe-glow-${n}`, x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
    svgEl('feGaussianBlur', { stdDeviation: 5 }, blur);

    this.raster = new FieldRasterView(map, svg);
    this.group = svgEl('g', { class: 'globe-parcel' }, svg);
    this.glow = svgEl('path', { class: 'globe-parcel__glow', filter: `url(#globe-glow-${n})` }, this.group);
    this.fill = svgEl('path', { class: 'globe-parcel__fill', 'fill-opacity': FILL_OPACITY }, this.group);
    this.texture = svgEl('path', { class: 'globe-parcel__texture' }, this.group);
    this.casing = svgEl('path', { class: 'globe-parcel__casing' }, this.group);
    this.line = svgEl('path', { class: 'globe-parcel__line' }, this.group);
    this.reticle = svgEl('g', { class: 'globe-reticle' }, svg);
    svgEl('circle', { r: 15, class: 'globe-reticle__ring' }, this.reticle);
    svgEl('circle', { r: 3, class: 'globe-reticle__dot' }, this.reticle);
    this.group.style.display = 'none';
    this.reticle.style.display = 'none';
  }

  setParcel(parcel: Parcel | null): void {
    if (!parcel) {
      this.ring = [];
      this.corners = [];
      this.centroid = null;
      this.raster.set(null, []);
      this.hide();
      this.emit(null);
      return;
    }
    const corners = openRing(parcel.polygon.coordinates[0]);
    this.corners = corners;
    this.raster.set(null, []);
    // Split long edges so each stretch is short enough to follow the ground.
    let ring = densifyRing(corners, 30);
    if (ring.length > MAX_RING_POINTS) ring = densifyRing(corners, 30 * Math.ceil(ring.length / MAX_RING_POINTS));
    this.ring = ring;
    this.centroid = parcel.centroid;
    this.lastPath = '';
    const c = this.map.getContainer();
    this.update(c.clientWidth, c.clientHeight, true);
  }

  /** The within-field picture to show instead of the single-colour fill, or null. */
  setRaster(raster: FieldRaster | null): void {
    this.raster.set(raster, this.corners);
    this.group.classList.toggle('has-raster', !!this.raster.current);
  }

  get rasterOn(): boolean {
    return !!this.raster.current;
  }

  /** Repaints the picture for a date (no-op when that day is already painted). */
  paintRaster(t: ISODate): RasterFrameInfo | null {
    return this.raster.paint(t);
  }

  setFill(fill: ParcelFill): void {
    if (fill.color) {
      this.fill.style.fill = fill.color;
      this.fill.style.display = '';
    } else {
      this.fill.style.display = 'none';
    }
    const pattern = fill.texture === 'simulated' ? this.dotsId : fill.texture === 'pending' ? this.hatchId : null;
    if (pattern) {
      this.texture.setAttribute('fill', `url(#${pattern})`);
      this.texture.style.display = '';
    } else {
      this.texture.style.display = 'none';
    }
    this.group.dataset.texture = fill.texture;
  }

  /** One-off emphasis when the camera arrives: the outline flares, then settles. */
  flash(): void {
    this.group.classList.remove('is-arriving');
    // Reading a layout property restarts the CSS animation when the class is put back.
    void this.group.getBoundingClientRect();
    this.group.classList.add('is-arriving');
  }

  /** Re-projects the ring. Call once per frame in which the camera or the terrain changed. */
  update(width: number, height: number, force = false): void {
    if (this.ring.length < 3 || !this.centroid) return;
    const { map } = this;
    const screen = (this.screen = projectRing(map, this.ring, this.screen));
    const facing = facesCamera(map, this.centroid, height);
    const w = screen.maxX - screen.minX;
    const h = screen.maxY - screen.minY;
    const onScreen = screen.finite && screen.maxX > 0 && screen.minX < width && screen.maxY > 0 && screen.minY < height;
    const visible = facing && onScreen;

    this.raster.position(visible && Math.max(w, h) >= RETICLE_BELOW_PX);
    if (!visible) {
      this.hide();
    } else {
      const small = Math.max(w, h) < RETICLE_BELOW_PX;
      this.reticle.style.display = small ? '' : 'none';
      this.group.style.display = small ? 'none' : '';
      this.shown = true;
      if (small) {
        this.reticle.setAttribute('transform', `translate(${((screen.minX + screen.maxX) / 2).toFixed(1)} ${((screen.minY + screen.maxY) / 2).toFixed(1)})`);
      } else {
        const d = ringPath(screen, true);
        if (d !== this.lastPath) {
          this.lastPath = d;
          for (const el of [this.fill, this.texture, this.casing, this.line]) el.setAttribute('d', d);
        }
      }
    }

    if (!force && this.anchorEveryMs > 0) {
      const now = performance.now();
      if (now - this.lastEmitAt < this.anchorEveryMs) return;
      this.lastEmitAt = now;
    }
    this.emit({
      x: round(screen.finite ? (screen.minX + screen.maxX) / 2 : width / 2),
      y: round(screen.finite ? (screen.minY + screen.maxY) / 2 : height / 2),
      w: round(screen.finite ? w : 0),
      h: round(screen.finite ? h : 0),
      visible,
    });
  }

  destroy(): void {
    this.raster.destroy();
    this.group.remove();
    this.reticle.remove();
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.group.style.display = 'none';
    this.reticle.style.display = 'none';
  }

  /** Publishes only real changes: the HUD re-lays out on every anchor it receives. */
  private emit(anchor: ScreenAnchor | null): void {
    const prev = this.last;
    if (anchor === prev) return;
    if (anchor && prev && anchor.x === prev.x && anchor.y === prev.y && anchor.w === prev.w && anchor.h === prev.h && anchor.visible === prev.visible) return;
    this.last = anchor;
    this.publish(anchor);
  }
}

/** Half-pixel steps: finer changes are invisible and would only churn the store. */
const round = (v: number): number => Math.round(v * 2) / 2;
