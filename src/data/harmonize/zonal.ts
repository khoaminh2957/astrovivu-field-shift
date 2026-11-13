/** Spatial helpers for rule S1/S2 (sample to the parcel, publish the footprint ratio). Pure. */
import type { LngLat, Parcel, PolygonGeometry } from '@/contracts';

export function pointInPolygon([x, y]: LngLat, poly: PolygonGeometry): boolean {
  const ring = poly.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** S2: fit = min(1, sqrt(parcel area) / native resolution); 1 when the source is not gridded. */
export function footprintFit(areaHa: number, resolutionM: number | null): number {
  if (resolutionM == null || resolutionM <= 0) return 1;
  return Math.min(1, Math.sqrt(areaHa * 10_000) / resolutionM);
}

/** MODIS sinusoidal projection (the grid ORNL subsets are delivered in). */
export const MODIS_R = 6_371_007.181;
export function toSinusoidal([lng, lat]: LngLat): [x: number, y: number] {
  const phi = (lat * Math.PI) / 180;
  return [MODIS_R * ((lng * Math.PI) / 180) * Math.cos(phi), MODIS_R * phi];
}
export function fromSinusoidal(x: number, y: number): LngLat {
  const phi = y / MODIS_R;
  return [((x / (MODIS_R * Math.cos(phi))) * 180) / Math.PI, (phi * 180) / Math.PI];
}

/**
 * Indices (row-major, row 0 north) of subset pixels whose centre falls inside the parcel. When none
 * does (parcel smaller than a pixel), the pixel containing the centroid is returned.
 */
export function pixelsInParcel(
  grid: { xll: number; yll: number; cell: number; nrows: number; ncols: number },
  parcel: Pick<Parcel, 'polygon' | 'centroid'>,
): number[] {
  const out: number[] = [];
  for (let r = 0; r < grid.nrows; r++) {
    for (let c = 0; c < grid.ncols; c++) {
      const x = grid.xll + (c + 0.5) * grid.cell;
      const y = grid.yll + (grid.nrows - r - 0.5) * grid.cell;
      if (pointInPolygon(fromSinusoidal(x, y), parcel.polygon)) out.push(r * grid.ncols + c);
    }
  }
  if (out.length > 0) return out;
  const [cx, cy] = toSinusoidal(parcel.centroid);
  const c = Math.min(grid.ncols - 1, Math.max(0, Math.floor((cx - grid.xll) / grid.cell)));
  const r = Math.min(grid.nrows - 1, Math.max(0, grid.nrows - 1 - Math.floor((cy - grid.yll) / grid.cell)));
  return [r * grid.ncols + c];
}

/** Square GeoJSON ring of half-size `halfDeg` around a point (ClimateSERV needs a polygon). */
export function boxAround([lng, lat]: LngLat, halfDeg: number): PolygonGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - halfDeg, lat - halfDeg],
        [lng + halfDeg, lat - halfDeg],
        [lng + halfDeg, lat + halfDeg],
        [lng - halfDeg, lat + halfDeg],
        [lng - halfDeg, lat - halfDeg],
      ],
    ],
  };
}
