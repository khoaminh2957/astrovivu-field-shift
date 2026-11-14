/**
 * Within-field vegetation zones (OneSoil-style "high / medium / low"), from the NDVI field raster.
 *
 * Method:
 *  1. Frames: the dates in `opts.frames`, or else every frame where the field is vegetated
 *     (parcel mean NDVI >= 0.3) and at least 70 % of the parcel is valid. Bare-soil dates would
 *     only map soil colour, so they are left out.
 *  2. Each valid cell of a frame becomes a ratio to that frame's parcel mean, so a spring date
 *     and a summer date weigh the same; the ratios are averaged per cell.
 *  3. Fixed bands around the field mean, not thirds: ratio < 0.93 is low, > 1.07 is high, the rest
 *     medium. Thirds would always invent three equal zones; fixed bands leave a uniform field
 *     almost entirely medium, which is the honest answer.
 *  4. Stability: a cell is stable when its single-date zone (same bands) equals its final zone on
 *     more than half of the frames where it is valid.
 * These are relative vegetation zones from one year of imagery, not a yield map.
 */
import type { FieldRaster, I18nText, ISODate, LngLat, Parcel, PolygonGeometry } from '@/contracts';
import { tx } from '@/contracts';
import { decodeFrame, encodeFrame, NO_DATA } from '@/lib/raster';

export interface FieldZone {
  id: 'high' | 'medium' | 'low';
  areaHa: number;
  sharePct: number;
  deviationPct: number;
}
export interface FieldZones {
  raster: FieldRaster;
  zones: FieldZone[];
  stableSharePct: number | null;
  framesUsed: ISODate[];
  method: I18nText;
}

const LOW = 0.93;
const HIGH = 1.07;
const MIN_VEG_NDVI = 0.3;
const MIN_COVERAGE = 0.7;
const MIN_CELLS = 8;

const classOf = (ratio: number): 0 | 1 | 2 => (ratio < LOW ? 0 : ratio > HIGH ? 2 : 1);

function pointInPolygon([x, y]: LngLat, poly: PolygonGeometry): boolean {
  const ring = poly.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 1 where the cell centre lies inside the parcel (grid is north-up in lng/lat). */
function insideMask(r: FieldRaster, parcel: Parcel): Uint8Array {
  const [nw, ne, , sw] = r.corners;
  const dLng = (ne[0] - nw[0]) / r.width;
  const dLat = (nw[1] - sw[1]) / r.height;
  const m = new Uint8Array(r.width * r.height);
  for (let row = 0; row < r.height; row++)
    for (let c = 0; c < r.width; c++) if (pointInPolygon([nw[0] + (c + 0.5) * dLng, nw[1] - (row + 0.5) * dLat], parcel.polygon)) m[row * r.width + c] = 1;
  return m;
}

export function computeFieldZones(ndvi: FieldRaster, parcel: Parcel, opts: { frames?: ISODate[] } = {}): FieldZones | null {
  const n = ndvi.width * ndvi.height;
  if (!ndvi.frames.length || n === 0) return null;
  const inside = insideMask(ndvi, parcel);
  const val = (b: number) => ndvi.offset + ndvi.scale * b;

  // Per frame: decoded bytes and the parcel mean.
  const usable: { t: ISODate; bytes: Uint8Array; mean: number }[] = [];
  for (const f of ndvi.frames) {
    if (opts.frames && !opts.frames.includes(f.t)) continue;
    const bytes = decodeFrame(f);
    let sum = 0;
    let k = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!inside[i]) continue;
      total++;
      if (bytes[i] !== NO_DATA) {
        sum += val(bytes[i]);
        k++;
      }
    }
    if (!k || !total) continue;
    const mean = sum / k;
    if (mean <= 0) continue;
    if (!opts.frames && (mean < MIN_VEG_NDVI || k / total < MIN_COVERAGE)) continue;
    usable.push({ t: f.t, bytes, mean });
  }
  if (!usable.length) return null;

  const ratioSum = new Float64Array(n);
  const ratioN = new Uint16Array(n);
  for (const u of usable)
    for (let i = 0; i < n; i++)
      if (inside[i] && u.bytes[i] !== NO_DATA) {
        ratioSum[i] += val(u.bytes[i]) / u.mean;
        ratioN[i]++;
      }

  const out = new Uint8Array(n).fill(NO_DATA);
  const count = [0, 0, 0];
  const devSum = [0, 0, 0];
  let valid = 0;
  let stable = 0;
  for (let i = 0; i < n; i++) {
    if (!ratioN[i]) continue;
    const ratio = ratioSum[i] / ratioN[i];
    const z = classOf(ratio);
    out[i] = z;
    count[z]++;
    devSum[z] += ratio;
    valid++;
    let agree = 0;
    for (const u of usable) if (u.bytes[i] !== NO_DATA && classOf(val(u.bytes[i]) / u.mean) === z) agree++;
    if (agree * 2 > ratioN[i]) stable++;
  }
  if (valid < MIN_CELLS) return null;

  const cellHa = (ndvi.cellM * ndvi.cellM) / 10_000;
  const zone = (id: FieldZone['id'], z: number): FieldZone => ({
    id,
    areaHa: Math.round(count[z] * cellHa * 100) / 100,
    sharePct: Math.round((count[z] / valid) * 1000) / 10,
    deviationPct: count[z] ? Math.round((devSum[z] / count[z] - 1) * 1000) / 10 : 0,
  });
  const framesUsed = usable.map((u) => u.t);
  const last = framesUsed[framesUsed.length - 1];
  const raster: FieldRaster = {
    ...ndvi,
    key: 'zones',
    branch: 'vegetation',
    label: tx('Vegetation zones (relative to the field mean)', 'Vùng sinh trưởng (so với trung bình ruộng)'),
    unit: '',
    scale: 1,
    offset: 0,
    range: [0, 2],
    cadence: 'static',
    frames: [{ t: last, data: encodeFrame(out), coverage: Math.round((valid / Math.max(1, inside.reduce((a, b) => a + b, 0))) * 1000) / 1000 }],
  };
  return {
    raster,
    zones: [zone('high', 2), zone('medium', 1), zone('low', 0)],
    stableSharePct: usable.length >= 3 ? Math.round((stable / valid) * 1000) / 10 : null,
    framesUsed,
    method: tx(
      `Relative vegetation zones, not yield: each cell's NDVI as a ratio to the field mean on ${usable.length} vegetated Sentinel-2 date(s) of the past year, averaged; low below 93 % of the mean, high above 107 %, medium between.`,
      `Vùng sinh trưởng tương đối, không phải năng suất: NDVI từng ô so với trung bình ruộng trên ${usable.length} ngày ảnh Sentinel-2 có cây trong năm qua, lấy trung bình; thấp dưới 93 % trung bình, cao trên 107 %, trung bình ở giữa.`,
    ),
  };
}
