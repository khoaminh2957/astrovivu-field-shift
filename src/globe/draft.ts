/**
 * Geometry of a boundary being drawn. Pure functions: the map and the dock both call them, and
 * the rules ("a draft is lockable when its area is a number") are unit-tested here.
 */
import type { DrawMode, LngLat, Parcel, ParcelDraft, PlaceInfo, PolygonGeometry } from '@/contracts';
import { closeRing, makeParcel, metresPerDegree, polygonAreaHa, squareForArea } from '@/lib/geo';

export const MIN_VERTICES = 3;
/** Corners tapped in `quad` mode before the ring closes itself. */
export const QUAD_CORNERS = 4;

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

/** Distinct corners: a closed GeoJSON ring passed in by mistake loses its repeated last vertex. */
export function openRing(vertices: LngLat[]): LngLat[] {
  const v = vertices.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return v.length > 1 && same(v[0], v[v.length - 1]) ? v.slice(0, -1) : v;
}

/** Local east/north metres around the first vertex; flat-earth is exact enough for one field. */
function toMetres(vertices: LngLat[]): [number, number][] {
  if (vertices.length === 0) return [];
  const o = vertices[0];
  const m = metresPerDegree(o[1]);
  return vertices.map((p) => [(p[0] - o[0]) * m.lng, (p[1] - o[1]) * m.lat]);
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when two non-adjacent edges of the closed ring cross (a bow-tie has no meaningful area). */
export function selfIntersects(vertices: LngLat[]): boolean {
  const p = toMetres(vertices);
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Orders tapped corners counter-clockwise around their mean so that four taps in any order give
 * a simple quadrilateral instead of a bow-tie.
 */
export function orderRing(vertices: LngLat[]): LngLat[] {
  const p = toMetres(vertices);
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  return vertices
    .map((v, i) => ({ v, a: Math.atan2(p[i][1] - cy, p[i][0] - cx) }))
    .sort((a, b) => a.a - b.a)
    .map((x) => x.v);
}

export const ringPolygon = (vertices: LngLat[]): PolygonGeometry => ({ type: 'Polygon', coordinates: [closeRing(vertices)] });

/** Area in hectares, or null while the ring is open, degenerate or crosses itself. */
export function draftAreaHa(vertices: LngLat[], closed: boolean): number | null {
  if (!closed || vertices.length < MIN_VERTICES || selfIntersects(vertices)) return null;
  const ha = polygonAreaHa(ringPolygon(vertices));
  return ha > 0 ? Math.round(ha * 100) / 100 : null;
}

/** The single way a draft is written to the store, so `areaHa` can never disagree with the vertices. */
export function makeDraft(mode: DrawMode, vertices: LngLat[], closed: boolean): ParcelDraft {
  const v = openRing(vertices);
  const isClosed = closed && v.length >= MIN_VERTICES;
  return { mode, vertices: v, closed: isClosed, areaHa: draftAreaHa(v, isClosed) };
}

/** "Coordinates / GPS + area": a north-up square of the given area around a point. */
export function squareDraft(mode: DrawMode, center: LngLat, areaHa: number): ParcelDraft {
  return makeDraft(mode, squareForArea(center, areaHa).coordinates[0], true);
}

export const isLockable = (draft: ParcelDraft | null): draft is ParcelDraft => !!draft && draft.closed && draft.areaHa != null;

/** Deterministic id from the geometry, so re-locking the same boundary hits the same telemetry cache. */
function parcelId(mode: DrawMode, vertices: LngLat[]): string {
  let h = 2166136261;
  for (const [lng, lat] of vertices) {
    for (const n of [Math.round(lng * 1e6), Math.round(lat * 1e6)]) {
      h ^= n & 0xffff;
      h = Math.imul(h, 16777619);
      h ^= (n >>> 16) & 0xffff;
      h = Math.imul(h, 16777619);
    }
  }
  return `${mode}-${(h >>> 0).toString(36)}`;
}

/**
 * Turns a finished draft into the `Parcel` the store locks. Returns null while the draft is not
 * lockable (open ring, fewer than three corners, crossing edges).
 */
export function draftToParcel(draft: ParcelDraft | null, name: string, place?: PlaceInfo): Parcel | null {
  if (!isLockable(draft)) return null;
  const vertices = openRing(draft.vertices);
  return makeParcel({ id: parcelId(draft.mode, vertices), name, polygon: ringPolygon(vertices), source: draft.mode, place });
}

export const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function meanPoint(vertices: LngLat[]): LngLat {
  const n = vertices.length || 1;
  return [vertices.reduce((s, p) => s + p[0], 0) / n, vertices.reduce((s, p) => s + p[1], 0) / n];
}

/**
 * Inserts points along every edge so a boundary projected to the screen follows relief instead
 * of cutting straight across it. Edges longer than `maxSegmentM` are split evenly.
 */
export function densifyRing(vertices: LngLat[], maxSegmentM: number, closed = true): LngLat[] {
  const n = vertices.length;
  if (n < 2) return vertices.slice();
  const out: LngLat[] = [];
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const m = metresPerDegree((a[1] + b[1]) / 2);
    const length = Math.hypot((b[0] - a[0]) * m.lng, (b[1] - a[1]) * m.lat);
    const parts = Math.max(1, Math.min(24, Math.ceil(length / maxSegmentM)));
    for (let k = 0; k < parts; k++) out.push([a[0] + ((b[0] - a[0]) * k) / parts, a[1] + ((b[1] - a[1]) * k) / parts]);
  }
  if (!closed) out.push(vertices[n - 1]);
  return out;
}

/**
 * Compass bearing (degrees, -90..90) that puts the boundary's long axis across the screen, from
 * the principal axis of its corners. Round or square shapes return `fallback`.
 */
export function framingBearing(vertices: LngLat[], fallback = 0): number {
  const p = toMetres(vertices);
  if (p.length < 3) return fallback;
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of p) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  const trace = sxx + syy;
  const spread = Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2);
  // Nearly isotropic: no long axis worth turning the camera for.
  if (trace === 0 || spread / trace < 0.18) return fallback;
  // Angle of the major axis from east, counter-clockwise; the camera bearing that lays it
  // horizontally is the same angle measured clockwise from north, i.e. its negative.
  const axis = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
  let bearing = -axis;
  while (bearing > 90) bearing -= 180;
  while (bearing < -90) bearing += 180;
  return bearing;
}
