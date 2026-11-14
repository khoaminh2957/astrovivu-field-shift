/**
 * Field boundary from NDVI: region growing from a seed cell, hole filling, outer contour,
 * simplification and a circle fit for centre pivots. Works in a local metric frame (x east,
 * y south, metres from the window's north-west corner); no network here.
 */
import type { LngLat, PolygonGeometry } from '@/contracts';
import { pointInPolygon } from '../harmonize/zonal';

export interface NdviStack {
  width: number;
  height: number;
  /** One array per date, NaN where no data. */
  dates: Float32Array[];
}

export interface RegionResult {
  mask: Uint8Array;
  cells: number;
  touchesBorder: boolean;
  /** Mean NDVI gradient just outside the boundary minus inside the region. */
  edgeContrast: number;
}

/** Sobel gradient magnitude (NDVI per cell), the maximum over dates. */
export function gradient(s: NdviStack): Float32Array {
  const { width: w, height: h } = s;
  const g = new Float32Array(w * h);
  for (const d of s.dates)
    for (let r = 1; r < h - 1; r++)
      for (let c = 1; c < w - 1; c++) {
        const v = (dr: number, dc: number) => d[(r + dr) * w + c + dc];
        const gx = v(-1, 1) + 2 * v(0, 1) + v(1, 1) - v(-1, -1) - 2 * v(0, -1) - v(1, -1);
        const gy = v(1, -1) + 2 * v(1, 0) + v(1, 1) - v(-1, -1) - 2 * v(-1, 0) - v(-1, 1);
        const m = Math.hypot(gx, gy) / 8;
        const i = r * w + c;
        if (Number.isFinite(m)) g[i] = Math.max(g[i], m);
        else g[i] = Math.max(g[i], 1);
      }
  return g;
}

export interface GrowOptions {
  /** Max NDVI distance from the running region mean, per date. */
  tol?: number;
  /** Cells with a gradient above this are edges and never join. */
  edge?: number;
}

/** Grow a 4-connected region from the seed, fill holes, and open it once to cut thin leaks. */
export function growRegion(s: NdviStack, seed: [col: number, row: number], opts: GrowOptions = {}): RegionResult | null {
  const { width: w, height: h, dates } = s;
  const tol = opts.tol ?? 0.1;
  const edgeThr = opts.edge ?? 0.06;
  const g = gradient(s);
  const valid = (i: number) => dates.every((d) => Number.isFinite(d[i]));
  // A clicked point often sits on a pivot tower, track or ditch: move the seed to the smoothest
  // valid cell within 5 cells (50 m).
  let bestG = Infinity;
  let moved = seed;
  for (let dr = -5; dr <= 5; dr++)
    for (let dc = -5; dc <= 5; dc++) {
      const c = seed[0] + dc;
      const r = seed[1] + dr;
      if (c < 1 || r < 1 || c >= w - 1 || r >= h - 1) continue;
      const i = r * w + c;
      // Sobel ignores the centre cell, so also penalise a cell unlike its neighbours (the tower itself).
      let odd = 0;
      for (const d of dates) odd = Math.max(odd, Math.abs(d[i] - (d[i - 1] + d[i + 1] + d[i - w] + d[i + w]) / 4));
      const score = g[i] + odd + 0.002 * Math.hypot(dr, dc);
      if (valid(i) && Number.isFinite(score) && score < bestG) (bestG = score), (moved = [c, r]);
    }
  seed = moved;
  // Seed value: median of the 3x3 neighbourhood per date, robust to one odd cell.
  const sum = dates.map((d) => {
    const vs: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) vs.push(d[(seed[1] + dr) * w + seed[0] + dc]);
    const f = vs.filter(Number.isFinite).sort((a, b) => a - b);
    return f.length ? f[Math.floor(f.length / 2)] : NaN;
  });
  if (sum.some((v) => !Number.isFinite(v))) return null;
  const acc = [...sum];
  let n = 1;
  const mask = new Uint8Array(w * h);
  const start = seed[1] * w + seed[0];
  mask[start] = 1;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const r = Math.floor(i / w);
    const c = i % w;
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]) {
      if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
      const j = nr * w + nc;
      if (mask[j] || !valid(j) || g[j] > edgeThr) continue;
      if (dates.some((d, k) => Math.abs(d[j] - acc[k] / n) > tol)) continue;
      mask[j] = 1;
      n++;
      dates.forEach((d, k) => (acc[k] += d[j]));
      queue.push(j);
    }
  }
  // The region stops one cell short of the edge line (edge cells are excluded): dilate once, then
  // open (erode + dilate) to cut one-cell bridges into neighbouring fields.
  let m = dilate(mask, w, h);
  const er = erode(m, w, h);
  if (er[start]) m = and(dilate(component(er, w, h, start), w, h), m);
  m = fillHoles(m, w, h);
  let cells = 0;
  let touches = false;
  let inG = 0;
  let outG = 0;
  let outN = 0;
  const ring = and(dilate(m, w, h), not(m));
  for (let i = 0; i < m.length; i++) {
    if (m[i]) {
      cells++;
      inG += g[i];
      const r = Math.floor(i / w);
      const c = i % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) touches = true;
    } else if (ring[i]) {
      outG += g[i];
      outN++;
    }
  }
  return { mask: m, cells, touchesBorder: touches, edgeContrast: (outN ? outG / outN : 0) - (cells ? inG / cells : 0) };
}

const N4 = (w: number, h: number, i: number) => {
  const r = Math.floor(i / w);
  const c = i % w;
  const out: number[] = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
};
function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) if (m[i] || N4(w, h, i).some((j) => m[j])) o[i] = 1;
  return o;
}
function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) if (m[i] && N4(w, h, i).length === 4 && N4(w, h, i).every((j) => m[j])) o[i] = 1;
  return o;
}
const and = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => (v && b[i] ? 1 : 0));
const not = (a: Uint8Array) => a.map((v) => (v ? 0 : 1));
function component(m: Uint8Array, w: number, h: number, start: number): Uint8Array {
  const o = new Uint8Array(m.length);
  o[start] = 1;
  const q = [start];
  for (let k = 0; k < q.length; k++) for (const j of N4(w, h, q[k])) if (m[j] && !o[j]) (o[j] = 1), q.push(j);
  return o;
}
/** Everything not reachable from the border through non-region cells is a hole. */
export function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(m.length);
  const q: number[] = [];
  for (let i = 0; i < m.length; i++) {
    const r = Math.floor(i / w);
    const c = i % w;
    if ((r === 0 || c === 0 || r === h - 1 || c === w - 1) && !m[i]) (outside[i] = 1), q.push(i);
  }
  for (let k = 0; k < q.length; k++) for (const j of N4(w, h, q[k])) if (!m[j] && !outside[j]) (outside[j] = 1), q.push(j);
  return outside.map((v) => (v ? 0 : 1));
}

// ---------------------------------------------------------------- contour and shape

export type XY = [x: number, y: number];

/** Moore-neighbour trace of the outer boundary, as cell centres in metres (x east, y south). */
export function traceContour(m: Uint8Array, w: number, h: number, cellM: number): XY[] {
  const start = m.findIndex((v) => v === 1);
  if (start < 0) return [];
  // Clockwise ring (y down): W, NW, N, NE, E, SE, S, SW.
  const D: [number, number][] = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  const at = (c: number, r: number) => c >= 0 && r >= 0 && c < w && r < h && m[r * w + c] === 1;
  let c = start % w;
  let r = Math.floor(start / w);
  const sc = c;
  const sr = r;
  let from = 0; // we entered the start cell from the west (outside)
  const out: XY[] = [];
  for (let guard = 0; guard < 4 * w * h; guard++) {
    out.push([(c + 0.5) * cellM, (r + 0.5) * cellM]);
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (from + k) % 8;
      if (at(c + D[d][0], r + D[d][1])) {
        found = d;
        break;
      }
    }
    if (found < 0) break; // single cell
    c += D[found][0];
    r += D[found][1];
    // Backtrack: the last empty cell examined, seen from the new cell.
    from = (found + (found % 2 ? 5 : 6)) % 8;
    if (c === sc && r === sr) break;
  }
  return out;
}

export const ringArea = (p: XY[]): number => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
};
export const ringPerimeter = (p: XY[]): number => p.reduce((s, q, i) => s + Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]), 0);
/** Polsby-Popper compactness: 1 for a circle, about 0.785 for a square. */
export const compactness = (p: XY[]): number => (p.length < 3 ? 0 : (4 * Math.PI * ringArea(p)) / ringPerimeter(p) ** 2);

function dpOpen(p: XY[], tol: number): XY[] {
  if (p.length < 3) return p;
  const [a, b] = [p[0], p[p.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let best = -1;
  let idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[i][1]) - (a[0] - p[i][0]) * (b[1] - a[1])) / L;
    if (d > best) (best = d), (idx = i);
  }
  if (best <= tol) return [a, b];
  return [...dpOpen(p.slice(0, idx + 1), tol).slice(0, -1), ...dpOpen(p.slice(idx), tol)];
}

/** Douglas-Peucker on a closed ring, tolerance raised until at most `maxVertices` remain. */
export function simplifyRing(p: XY[], tol: number, maxVertices = 24): XY[] {
  if (p.length <= 4) return p;
  let far = 0;
  let fd = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > fd) (fd = d), (far = i);
  }
  let t = tol;
  for (let k = 0; k < 20; k++) {
    const s = [...dpOpen(p.slice(0, far + 1), t).slice(0, -1), ...dpOpen([...p.slice(far), p[0]], t).slice(0, -1)];
    if (s.length <= maxVertices || s.length <= 4) return s;
    t *= 1.4;
  }
  return p;
}

/** Radial spread of the contour around its centroid, relative to the mean radius. */
export function roundness(p: XY[]): { cx: number; cy: number; cv: number } {
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  const rs = p.map((q) => Math.hypot(q[0] - cx, q[1] - cy));
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  return { cx, cy, cv: sd / (mean || 1) };
}

/** Scale a ring about its centroid to a target area (the contour runs through cell centres, half a cell inside the true edge). */
export function scaleToArea(p: XY[], areaM2: number): XY[] {
  const a = ringArea(p);
  if (!a) return p;
  const f = Math.sqrt(areaM2 / a);
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  return p.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
}

/** Intersection over union of two polygons, by sampling a grid over their joint bounding box. */
export function polygonIoU(a: PolygonGeometry, b: PolygonGeometry, n = 200): number {
  const pts = [...a.coordinates[0], ...b.coordinates[0]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p: LngLat = [x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)];
      const ia = pointInPolygon(p, a);
      const ib = pointInPolygon(p, b);
      if (ia && ib) inter++;
      if (ia || ib) uni++;
    }
  return uni ? inter / uni : 0;
}
