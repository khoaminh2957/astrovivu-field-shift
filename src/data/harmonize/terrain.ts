/**
 * Terrain derivatives from a small DEM grid. Pure.
 *
 * Slope: Horn (1981) 3×3 finite differences, averaged over cells inside the parcel.
 * Aspect: direction of the parcel's mean downslope gradient (degrees clockwise from north), which
 *   is more stable on gentle fields than averaging per-cell angles.
 * Flow direction: D8 (O'Callaghan & Mark 1984) per cell; the parcel reports the most common
 *   direction among its cells.
 */

export interface DemGrid {
  width: number;
  height: number;
  /** Row-major, row 0 is the northern edge. NaN = no data. */
  data: Float32Array | number[];
  /** Cell size in metres east-west and north-south. */
  cellX: number;
  cellY: number;
  /** Which cells belong to the parcel (zonal statistics). */
  inside: (col: number, row: number) => boolean;
}

export interface TerrainStats {
  cells: number;
  elevationMean: number;
  elevationMin: number;
  elevationMax: number;
  reliefM: number;
  slopeMeanDeg: number;
  aspectDeg: number | null;
  aspectLabel: string;
  flowDirLabel: string;
}

export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function compass8(deg: number): (typeof COMPASS8)[number] {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS8[i];
}

/** Gentler than this (degrees) the field is called flat: aspect and flow direction are noise. */
export const FLAT_DEG = 0.3;

export function analyseDem(g: DemGrid): TerrainStats | null {
  const { width: w, height: h, data, cellX, cellY } = g;
  const z = (c: number, r: number): number => {
    const cc = Math.min(w - 1, Math.max(0, c));
    const rr = Math.min(h - 1, Math.max(0, r));
    return data[rr * w + cc];
  };
  let n = 0;
  let sumZ = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumSlope = 0;
  let sumDx = 0;
  let sumDy = 0;
  const d8 = new Array<number>(9).fill(0);
  // Neighbour offsets in compass order N, NE, E, SE, S, SW, W, NW.
  const offs: [number, number][] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!g.inside(c, r)) continue;
      const e = z(c, r);
      if (!Number.isFinite(e)) continue;
      const a = z(c - 1, r - 1);
      const b = z(c, r - 1);
      const cc = z(c + 1, r - 1);
      const d = z(c - 1, r);
      const f = z(c + 1, r);
      const gg = z(c - 1, r + 1);
      const hh = z(c, r + 1);
      const i = z(c + 1, r + 1);
      const nb = [a, b, cc, d, f, gg, hh, i];
      if (nb.some((v) => !Number.isFinite(v))) continue;
      const dzdx = (cc + 2 * f + i - (a + 2 * d + gg)) / (8 * cellX);
      const dzdy = (a + 2 * b + cc - (gg + 2 * hh + i)) / (8 * cellY);
      n++;
      sumZ += e;
      minZ = Math.min(minZ, e);
      maxZ = Math.max(maxZ, e);
      sumSlope += (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      sumDx += dzdx;
      sumDy += dzdy;
      let best = 8;
      let bestDrop = 0;
      offs.forEach(([dc, dr], k) => {
        const dist = Math.hypot(dc * cellX, dr * cellY);
        const drop = (e - z(c + dc, r + dr)) / dist;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = k;
        }
      });
      d8[best]++;
    }
  }
  if (n === 0) return null;
  const mdx = sumDx / n;
  const mdy = sumDy / n;
  const meanGradDeg = (Math.atan(Math.hypot(mdx, mdy)) * 180) / Math.PI;
  const flat = meanGradDeg < FLAT_DEG;
  const aspectDeg = flat ? null : (((Math.atan2(-mdx, -mdy) * 180) / Math.PI) % 360 + 360) % 360;
  let mode = 8;
  for (let k = 0; k < 8; k++) if (d8[k] > (mode === 8 ? 0 : d8[mode])) mode = k;
  return {
    cells: n,
    elevationMean: sumZ / n,
    elevationMin: minZ,
    elevationMax: maxZ,
    reliefM: maxZ - minZ,
    slopeMeanDeg: sumSlope / n,
    aspectDeg,
    aspectLabel: aspectDeg == null ? 'flat' : compass8(aspectDeg),
    flowDirLabel: flat || mode === 8 ? 'flat' : COMPASS8[mode],
  };
}

/** Terrarium PNG encoding: elevation = R·256 + G + B/256 − 32768. */
export const terrariumElevation = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;
