/**
 * Static terrain rasters (elevation, slope) from the AWS Terrarium tiles already used for the
 * terrain branch. One frame each, dated today: the DEM is a fixed surface, not an observation.
 */
import type { FieldRaster, ISODate, LngLat, Parcel } from '@/contracts';
import { tx } from '@/contracts';
import { encodeFrame } from '@/lib/raster';
import { terrariumDem } from '../adapters/terrarium';
import { quantise, type RasterGrid } from './pure';

export async function terrainRasters(parcel: Parcel, today: ISODate, signal?: AbortSignal): Promise<FieldRaster[]> {
  const { grid: dem, pixelM, corners: full } = await terrariumDem(parcel, signal);
  // Block-average to at most 96 cells on the long side.
  const k = Math.max(1, Math.ceil(Math.max(dem.width, dem.height) / 96));
  const w = Math.floor(dem.width / k);
  const h = Math.floor(dem.height / k);
  const elev = new Array<number | null>(w * h).fill(null);
  const inside = new Uint8Array(w * h);
  let insideCount = 0;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let s = 0;
      let n = 0;
      let inn = false;
      for (let dr = 0; dr < k; dr++)
        for (let dc = 0; dc < k; dc++) {
          const v = dem.data[(r * k + dr) * dem.width + c * k + dc];
          if (Number.isFinite(v)) {
            s += v;
            n++;
          }
          if (dem.inside(c * k + dc, r * k + dr)) inn = true;
        }
      elev[r * w + c] = n ? s / n : null;
      if (inn) {
        inside[r * w + c] = 1;
        insideCount++;
      }
    }
  const cellM = pixelM * k;
  const [nw, ne, , sw] = full;
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  const east = lerp(nw[0], ne[0], (w * k) / dem.width);
  const south = lerp(nw[1], sw[1], (h * k) / dem.height);
  const corners: [LngLat, LngLat, LngLat, LngLat] = [nw, [east, nw[1]], [east, south], [nw[0], south]];
  const grid: RasterGrid = { bbox: [nw[0], south, east, nw[1]], width: w, height: h, cellM, corners, inside, insideCount: Math.max(1, insideCount) };

  const slope = new Array<number | null>(w * h).fill(null);
  const at = (c: number, r: number) => elev[Math.max(0, Math.min(h - 1, r)) * w + Math.max(0, Math.min(w - 1, c))];
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const [l, rt, u, d] = [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)];
      if (l == null || rt == null || u == null || d == null) continue;
      const dx = (rt - l) / (2 * cellM);
      const dy = (d - u) / (2 * cellM);
      slope[r * w + c] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }

  const vals = elev.filter((v): v is number => v != null);
  if (!vals.length) return [];
  const lo = Math.floor(Math.min(...vals));
  const hi = Math.ceil(Math.max(...vals));
  const eEnc = { offset: lo, scale: Math.max(0.1, (hi - lo) / 254) };
  const sVals = slope.filter((v): v is number => v != null);
  const sMax = Math.max(1, ...sVals);
  const sEnc = { offset: 0, scale: Math.max(0.02, sMax / 254) };
  const base = {
    branch: 'terrain' as const,
    sourceId: 'srtm-terrarium',
    cellM: Math.round(cellM * 10) / 10,
    width: w,
    height: h,
    corners,
    cadence: 'static' as const,
  };
  const e = quantise(elev, grid, eEnc);
  const s = quantise(slope, grid, sEnc);
  return [
    {
      ...base,
      key: 'elevation',
      label: tx('Elevation (Terrarium DEM)', 'Độ cao (DEM Terrarium)'),
      unit: 'm',
      ramp: 'terrain',
      ...eEnc,
      range: [lo, Math.max(hi, lo + 1)],
      frames: [{ t: today, data: encodeFrame(e.bytes), coverage: e.coverage }],
    },
    {
      ...base,
      key: 'slope',
      label: tx('Slope (Terrarium DEM)', 'Độ dốc (DEM Terrarium)'),
      unit: '°',
      ramp: 'terrain',
      ...sEnc,
      range: [0, Math.max(2, Math.ceil(sMax))],
      frames: [{ t: today, data: encodeFrame(s.bytes), coverage: s.coverage }],
    },
  ];
}
