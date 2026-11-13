import type { BBox, LngLat, Parcel, ParcelSource, PlaceInfo, PolygonGeometry } from '@/contracts';

const EARTH_R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres per degree at a latitude (equirectangular; accurate enough for parcels up to tens of km). */
export function metresPerDegree(lat: number): { lng: number; lat: number } {
  const perDeg = (Math.PI * EARTH_R) / 180;
  return { lat: perDeg, lng: perDeg * Math.cos(rad(lat)) };
}

export function offsetMetres(origin: LngLat, eastM: number, northM: number): LngLat {
  const m = metresPerDegree(origin[1]);
  return [origin[0] + eastM / m.lng, origin[1] + northM / m.lat];
}

/** Rectangle centred on `center`; `bearingDeg` rotates it clockwise from north. */
export function rectPolygon(center: LngLat, widthM: number, heightM: number, bearingDeg = 0): PolygonGeometry {
  const b = rad(bearingDeg);
  const c = Math.cos(b);
  const s = Math.sin(b);
  const corners: [number, number][] = [
    [-widthM / 2, -heightM / 2],
    [widthM / 2, -heightM / 2],
    [widthM / 2, heightM / 2],
    [-widthM / 2, heightM / 2],
  ];
  const ring = corners.map(([x, y]) => offsetMetres(center, x * c + y * s, -x * s + y * c));
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

export function circlePolygon(center: LngLat, radiusM: number, steps = 48): PolygonGeometry {
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push(offsetMetres(center, radiusM * Math.cos(a), radiusM * Math.sin(a)));
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Square of a given area: the "coordinates / GPS + area" way of defining a parcel. */
export function squareForArea(center: LngLat, areaHa: number): PolygonGeometry {
  const side = Math.sqrt(Math.max(areaHa, 0.01) * 10_000);
  return rectPolygon(center, side, side);
}

export function closeRing(vertices: LngLat[]): LngLat[] {
  if (vertices.length === 0) return [];
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? vertices : [...vertices, first];
}

function ringMoments(ring: LngLat[]): { areaM2: number; centroid: LngLat } {
  if (ring.length < 4) return { areaM2: 0, centroid: ring[0] ?? [0, 0] };
  const o = ring[0];
  const m = metresPerDegree(o[1]);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = (ring[i][0] - o[0]) * m.lng;
    const y1 = (ring[i][1] - o[1]) * m.lat;
    const x2 = (ring[i + 1][0] - o[0]) * m.lng;
    const y2 = (ring[i + 1][1] - o[1]) * m.lat;
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) return { areaM2: 0, centroid: o };
  const centroid: LngLat = [o[0] + cx / (3 * a) / m.lng, o[1] + cy / (3 * a) / m.lat];
  return { areaM2: Math.abs(a) / 2, centroid };
}

export const polygonAreaHa = (p: PolygonGeometry): number => ringMoments(p.coordinates[0]).areaM2 / 10_000;
export const centroidOf = (p: PolygonGeometry): LngLat => ringMoments(p.coordinates[0]).centroid;

export function bboxOf(p: PolygonGeometry): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of p.coordinates[0]) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

/** Coarse test for the conterminous United States, where SSURGO / CDL / Crop-CASMA apply. */
export function isInUS([lng, lat]: LngLat): boolean {
  return lat >= 24.4 && lat <= 49.4 && lng >= -125 && lng <= -66.9;
}

export function makeParcel(args: {
  id: string;
  name: string;
  polygon: PolygonGeometry;
  source: ParcelSource;
  place?: PlaceInfo;
}): Parcel {
  const centroid = centroidOf(args.polygon);
  return {
    id: args.id,
    name: args.name,
    polygon: args.polygon,
    centroid,
    bbox: bboxOf(args.polygon),
    areaHa: Math.round(polygonAreaHa(args.polygon) * 100) / 100,
    source: args.source,
    place: args.place,
    isUS: isInUS(centroid),
  };
}
