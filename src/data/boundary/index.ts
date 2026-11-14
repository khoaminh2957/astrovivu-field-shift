/**
 * Detect the field under a point from Sentinel-2 NDVI (Planetary Computer, 10 m): the clearest
 * near-peak date plus a contrasting second date, region growing from the seed, outer contour,
 * simplified polygon or a fitted circle for centre pivots. Null when no clean field is found.
 */
import type { ISODate, LngLat, PolygonGeometry } from '@/contracts';
import { addDays, diffDays, todayISO } from '@/lib/time';
import { circlePolygon, closeRing } from '@/lib/geo';
import { isAbort, mapLimit } from '../http';
import { fetchScene, searchScenes } from '../rasters/pc';
import { band, normDiff, s2Offset, s2Reflectance, sclValid, type RasterGrid } from '../rasters/pure';
import { compactness, growRegion, type GrowOptions, ringArea, roundness, scaleToArea, simplifyRing, traceContour, type NdviStack, type XY } from './pure';

export interface FieldBoundary {
  polygon: PolygonGeometry;
  areaHa: number;
  confidence: number;
  date: ISODate;
}

const CELL = 10;
const SIDE = 161; // 1.6 km window, seed at the centre cell
const M_PER_DEG = 111_320;

function windowGrid(at: LngLat): RasterGrid {
  const coslat = Math.cos((at[1] * Math.PI) / 180);
  const hw = (SIDE * CELL) / 2;
  const dLng = hw / (M_PER_DEG * coslat);
  const dLat = hw / M_PER_DEG;
  const [w, s, e, n] = [at[0] - dLng, at[1] - dLat, at[0] + dLng, at[1] + dLat];
  return { bbox: [w, s, e, n], width: SIDE, height: SIDE, cellM: CELL, corners: [[w, n], [e, n], [e, s], [w, s]], inside: new Uint8Array(0), insideCount: 0 };
}

interface DateNdvi {
  t: ISODate;
  ndvi: Float32Array;
  valid: number;
  mean: number;
  sd: number;
}

async function ndviDates(at: LngLat, today: ISODate, grid: RasterGrid, signal?: AbortSignal): Promise<DateNdvi[]> {
  const scenes = await searchScenes('sentinel-2-l2a', at, addDays(today, -364), today, 15, signal);
  // One clearest scene per 60-day bin, so the pick can see the season.
  const bins = new Map<number, (typeof scenes)[number]>();
  for (const s of scenes) {
    const k = Math.floor(diffDays(today, s.t) / 60);
    const cur = bins.get(k);
    if (!cur || s.cloud < cur.cloud) bins.set(k, s);
  }
  const picks = [...bins.values()];
  const out = await mapLimit(picks, 3, async (s): Promise<DateNdvi | null> => {
    try {
      const arr = await fetchScene('sentinel-2-l2a', s.id, ['B04', 'B08', 'SCL'], grid, signal);
      const [red, nir, scl, mask] = [0, 1, 2, 3].map((b) => band(arr, b));
      const off = s2Offset(s.props.baseline as string | undefined);
      const ndvi = new Float32Array(SIDE * SIDE).fill(NaN);
      let k = 0;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < ndvi.length; i++) {
        if (!(mask[i] > 0) || !sclValid(scl[i])) continue;
        const v = normDiff(s2Reflectance(nir[i], off), s2Reflectance(red[i], off));
        if (v == null) continue;
        ndvi[i] = v;
        k++;
        sum += v;
        sq += v * v;
      }
      const mean = k ? sum / k : 0;
      return { t: s.t, ndvi, valid: k / ndvi.length, mean, sd: k ? Math.sqrt(sq / k - mean * mean) : 0 };
    } catch (e) {
      if (isAbort(e)) throw e;
      return null;
    }
  });
  return out.filter((d): d is DateNdvi => d != null && d.valid > 0.95);
}

/** Pure part after the imagery is in hand; exported for tests and tuning. */
export function boundaryFromStack(stack: NdviStack, grid: Pick<RasterGrid, 'bbox' | 'cellM'>, centre: LngLat, grow: GrowOptions = {}): Omit<FieldBoundary, 'date'> | null {
  const seed: [number, number] = [Math.floor(stack.width / 2), Math.floor(stack.height / 2)];
  const reg = growRegion(stack, seed, grow);
  if (!reg || reg.touchesBorder) return null;
  const areaM2 = reg.cells * grid.cellM * grid.cellM;
  if (areaM2 < 3_000) return null;
  const contour = traceContour(reg.mask, stack.width, stack.height, grid.cellM);
  if (contour.length < 4) return null;
  const comp = compactness(scaleToArea(contour, areaM2));
  const round = roundness(contour);
  let ring: XY[];
  let circle: { cx: number; cy: number; r: number } | null = null;
  if (round.cv < 0.07 && comp > 0.8) circle = { cx: round.cx, cy: round.cy, r: Math.sqrt(areaM2 / Math.PI) };
  else ring = scaleToArea(simplifyRing(contour, grid.cellM, 24), areaM2);
  const simple = circle ? null : ring!;
  const shapeComp = circle ? 1 : compactness(simple!);
  if (shapeComp < 0.45) return null;
  const [w, , , n] = grid.bbox;
  const coslat = Math.cos((centre[1] * Math.PI) / 180);
  const toLngLat = ([x, y]: XY): LngLat => [w + x / (M_PER_DEG * coslat), n - y / M_PER_DEG];
  const polygon: PolygonGeometry = circle
    ? circlePolygon(toLngLat([circle.cx, circle.cy]), circle.r)
    : { type: 'Polygon', coordinates: [closeRing(simple!.map(toLngLat))] };
  const contrast = Math.max(0, Math.min(1, reg.edgeContrast / 0.08));
  const compScore = Math.max(0, Math.min(1, (shapeComp - 0.45) / 0.4));
  return {
    polygon,
    areaHa: Math.round((circle ? areaM2 : ringArea(simple!)) / 100) / 100,
    confidence: Math.round((0.6 * contrast + 0.4 * compScore) * 100) / 100,
  };
}

export async function detectFieldBoundary(point: LngLat, opts: { signal?: AbortSignal; today?: ISODate } = {}): Promise<FieldBoundary | null> {
  const today = opts.today ?? todayISO();
  const grid = windowGrid(point);
  const dates = await ndviDates(point, today, grid, opts.signal);
  if (!dates.length) return null;
  const ordered = orderDates(dates);
  // Fields differ in how sharply they stand out: try loose to strict growth on two dates, three,
  // then all, and keep the cleanest result (highest confidence).
  let best: Omit<FieldBoundary, 'date'> | null = null;
  for (const k of [2, 3, ordered.length])
    for (const grow of LADDER) {
      const r = boundaryFromStack({ width: SIDE, height: SIDE, dates: ordered.slice(0, k).map((d) => d.ndvi) }, grid, point, grow);
      if (r && (!best || r.confidence > best.confidence)) best = r;
    }
  return best ? { ...best, date: ordered[0].t } : null;
}

const LADDER: GrowOptions[] = [
  { tol: 0.15, edge: 0.06 },
  { tol: 0.1, edge: 0.04 },
  { tol: 0.06, edge: 0.02 },
];

/** Peak (greenest) date first, then the most contrasted date at least a month away, then the rest. */
function orderDates(dates: DateNdvi[]): DateNdvi[] {
  const peak = [...dates].sort((a, b) => b.mean - a.mean)[0];
  const second = dates.filter((d) => Math.abs(diffDays(d.t, peak.t)) >= 30).sort((a, b) => b.sd - a.sd)[0];
  return [peak, ...(second ? [second] : []), ...dates.filter((d) => d !== peak && d !== second).sort((a, b) => b.sd - a.sd)];
}

/** Tuning hook for scripts: the NDVI stack the detector would use (peak date first). */
export async function _debugStack(point: LngLat, today: ISODate): Promise<{ stack: NdviStack; dates: string[] }> {
  const grid = windowGrid(point);
  const dates = await ndviDates(point, today, grid);
  const set = orderDates(dates);
  return { stack: { width: SIDE, height: SIDE, dates: set.map((d) => d.ndvi) }, dates: dates.map((d) => `${d.t} m${d.mean.toFixed(2)} sd${d.sd.toFixed(2)}`) };
}
