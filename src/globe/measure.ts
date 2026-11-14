/**
 * Measure tool: click points on the map, read a length in metres or an area in hectares.
 * Drawn in the same SVG overlay as the parcel and re-projected in the render event, so it sits
 * on the ground at any pitch.
 */
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { LngLat, PolygonGeometry } from '@/contracts';
import { closeRing, polygonAreaHa } from '@/lib/geo';
import { svgEl } from './svg';
import { useMeasureStore, type MeasureKind } from './toolState';

const R_EARTH = 6_371_008.8;
const RAD = Math.PI / 180;
/** A click this close to the first point (CSS px) closes an area. */
const CLOSE_PX = 12;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function measureValue(kind: MeasureKind, points: LngLat[]): number | null {
  if (kind === 'distance') {
    if (points.length < 2) return null;
    let m = 0;
    for (let i = 1; i < points.length; i++) m += haversineM(points[i - 1], points[i]);
    return m;
  }
  if (points.length < 3) return null;
  const polygon: PolygonGeometry = { type: 'Polygon', coordinates: [closeRing(points)] };
  return polygonAreaHa(polygon);
}

export function formatMeasure(kind: MeasureKind, value: number): string {
  if (kind === 'area') return value >= 100 ? `${value.toFixed(0)} ha` : value >= 10 ? `${value.toFixed(1)} ha` : `${value.toFixed(2)} ha`;
  return value >= 10_000 ? `${(value / 1000).toFixed(1)} km` : value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(0)} m`;
}

export class MeasureTool {
  private readonly group: SVGGElement;
  private readonly shape: SVGPathElement;
  private readonly dots: SVGGElement;
  private readonly label: SVGTextElement;
  private kind: MeasureKind | null = null;
  private points: LngLat[] = [];
  private closed = false;
  private hadDoubleClickZoom = true;

  constructor(
    private readonly map: MapLibreMap,
    svg: SVGSVGElement,
  ) {
    this.group = svgEl('g', { class: 'globe-measure' }, svg);
    this.shape = svgEl('path', { class: 'globe-measure__shape' }, this.group);
    this.dots = svgEl('g', {}, this.group);
    this.label = svgEl('text', { class: 'globe-measure__label' }, this.group);
    this.group.style.display = 'none';
  }

  get active(): boolean {
    return this.kind !== null;
  }

  start(kind: MeasureKind): void {
    if (!this.kind) {
      this.hadDoubleClickZoom = this.map.doubleClickZoom.isEnabled();
      this.map.on('click', this.onClick);
    }
    // A double click would zoom between two points; the measure owns clicks while it runs.
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.kind = kind;
    this.points = [];
    this.closed = false;
    this.group.style.display = '';
    this.publish();
    this.render();
  }

  stop(): void {
    if (!this.kind) return;
    this.map.off('click', this.onClick);
    if (this.hadDoubleClickZoom) this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = '';
    this.kind = null;
    this.points = [];
    this.group.style.display = 'none';
    this.publish();
  }

  destroy(): void {
    this.stop();
    this.group.remove();
  }

  render(): void {
    if (!this.kind) return;
    const pts = this.points.map((p) => this.map.project(p));
    let d = '';
    pts.forEach((p, i) => {
      d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    });
    if (this.kind === 'area' && pts.length > 2) d += 'Z';
    this.shape.setAttribute('d', d);
    this.shape.dataset.kind = this.kind;
    while (this.dots.childNodes.length > pts.length) this.dots.lastChild?.remove();
    while (this.dots.childNodes.length < pts.length) svgEl('circle', { r: 4, class: 'globe-measure__dot' }, this.dots);
    pts.forEach((p, i) => {
      const c = this.dots.childNodes[i] as SVGCircleElement;
      c.setAttribute('cx', p.x.toFixed(1));
      c.setAttribute('cy', p.y.toFixed(1));
    });
    const value = measureValue(this.kind, this.points);
    const at = pts[pts.length - 1];
    if (value == null || !at) {
      this.label.style.display = 'none';
      return;
    }
    this.label.style.display = '';
    this.label.textContent = formatMeasure(this.kind, value);
    this.label.setAttribute('x', (at.x + 10).toFixed(1));
    this.label.setAttribute('y', (at.y - 10).toFixed(1));
  }

  private onClick = (e: MapMouseEvent): void => {
    if (!this.kind) return;
    if (this.closed) {
      // A finished area: the next click starts a new one.
      this.points = [];
      this.closed = false;
    }
    if (this.kind === 'area' && this.points.length >= 3) {
      const first = this.map.project(this.points[0]);
      if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < CLOSE_PX) {
        this.closed = true;
        this.publish();
        this.render();
        return;
      }
    }
    this.points = [...this.points, [e.lngLat.lng, e.lngLat.lat]];
    this.publish();
    this.render();
  };

  private publish(): void {
    const kind = this.kind;
    useMeasureStore.setState({ kind, points: this.points, value: kind ? measureValue(kind, this.points) : null });
  }
}
