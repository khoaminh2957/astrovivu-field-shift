/**
 * Field boundary from multi-spectral Sentinel-2 stacks (NDVI + optional NDMI and visible
 * brightness): edge + 1-pixel ridge detection, drift-bounded region growing, neck-cutting
 * morphological opening, contour smoothing, simplification and centre-pivot circle fitting.
 * Works in a local metric frame (x east, y south, metres from the window's north-west corner);
 * no network here.
 */
import type { LngLat, PolygonGeometry } from '@/contracts';
import { pointInPolygon } from '../harmonize/zonal';

export interface NdviStack {
  width: number;
  height: number;
  /** One NDVI array per date, NaN where no data. */
  dates: Float32Array[];
  /** Optional aligned NDMI arrays ((B08-B11)/(B08+B11)) per date. */
  ndmi?: Float32Array[];
  /** Optional aligned visible brightness arrays (scaled ~0..1) per date. */
  vis?: Float32Array[];
}

export interface RegionResult {
  mask: Uint8Array;
  cells: number;
  touchesBorder: boolean;
  /** Mean boundary gradient just outside the region minus inside the region. */
  edgeContrast: number;
}

/**
 * Step gradient (Sobel) + narrow 1-2 pixel ridge prominence (roads, bunds, canals, tree lines).
 * When `ridgeOnly` is true (used for visible brightness), smooth soil-colour gradients across a
 * bare field are ignored (`step = 0`) and only narrow local extrema (roads/dikes/ditches) fire.
 */
function bandEdge(
  d: Float32Array,
  w: number,
  h: number,
  ridgeWeight: number,
  out: Float32Array,
  stepScale = 1,
  ridgeScale = stepScale,
): void {
  const axes: [number, number][] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      const center = d[i];
      if (!Number.isFinite(center)) continue;
      const v = (dr: number, dc: number) => d[(r + dr) * w + (c + dc)];
      const gx = v(-1, 1) + 2 * v(0, 1) + v(1, 1) - v(-1, -1) - 2 * v(0, -1) - v(1, -1);
      const gy = v(1, -1) + 2 * v(1, 0) + v(1, 1) - v(-1, -1) - 2 * v(-1, 0) - v(-1, 1);
      const step = Math.hypot(gx, gy) / 8;
      if (!Number.isFinite(step)) continue;
      // Sobel cancels out at the centre of a 1-pixel road, bund, hedgerow or ditch between similar
      // fields (`a1 * b1 > 0`), while smooth soil catenas have opposite signs (`<= 0`). Span-2 only
      // fires on 2-pixel flat-topped barriers (where at least one immediate neighbour is near-level,
      // `min(|a1|, |b1|) < 0.025`, and NDVI is a trough `a2 < 0` rather than a narrow 30 m crop strip).
      let ridge = 0;
      for (const [dr, dc] of axes) {
        const a1 = center - v(-dr, -dc);
        const b1 = center - v(dr, dc);
        if (Number.isFinite(a1) && Number.isFinite(b1) && a1 * b1 > 0) {
          const prom = Math.min(Math.abs(a1), Math.abs(b1));
          if (prom > ridge) ridge = prom;
        }
        if (r >= 2 && r < h - 2 && c >= 2 && c < w - 2 && Number.isFinite(a1) && Number.isFinite(b1) && Math.min(Math.abs(a1), Math.abs(b1)) < 0.025) {
          const a2 = center - v(-2 * dr, -2 * dc);
          const b2 = center - v(2 * dr, 2 * dc);
          if (Number.isFinite(a2) && Number.isFinite(b2) && a2 * b2 > 0 && (stepScale < 0.6 ? a2 > 0 : a2 < 0)) {
            const prom2 = Math.min(Math.abs(a2), Math.abs(b2)) * 0.85;
            if (prom2 > ridge) ridge = prom2;
          }
        }
      }
      const val = Math.max(step * stepScale, ridge * ridgeWeight * ridgeScale);
      if (!Number.isFinite(out[i]) || val > out[i]) out[i] = val;
    }
  }
}

/**
 * Combined multi-date, multi-band boundary strength per cell. NDVI and NDMI contribute both step
 * edges (crop/residue splits) and narrow ridges; visible brightness uses gentle step weight (faint
 * farm lanes) and full ridge weight (gravel roads, bunds, canals) without splitting bare soil swirls.
 * Masked cloud pixels (`NaN`) on a single date are skipped rather than treated as false walls.
 */
export function gradient(s: NdviStack): Float32Array {
  const { width: w, height: h, dates, ndmi, vis } = s;
  const n = w * h;
  if (!dates.length) return new Float32Array(n);
  const perDate = dates.map((_, t) => {
    const e = new Float32Array(n).fill(NaN);
    bandEdge(dates[t], w, h, 0.95, e, 1, 1);
    if (ndmi?.[t]) bandEdge(ndmi[t], w, h, 0.9, e, 0.78, 0.85);
    if (vis?.[t]) bandEdge(vis[t], w, h, 1.05, e, 0.45, 1.15);
    return e;
  });
  const minValid = Math.max(1, Math.ceil(dates.length * 0.65));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let validDates = 0;
    for (let t = 0; t < dates.length; t++) if (Number.isFinite(dates[t][i])) validDates++;
    if (validDates < minValid) {
      out[i] = 1;
      continue;
    }
    let count = 0;
    let m1 = 0;
    let m2 = 0;
    for (let t = 0; t < perDate.length; t++) {
      const v = perDate[t][i];
      if (!Number.isFinite(v)) continue;
      count++;
      if (v >= m1) {
        m2 = m1;
        m1 = v;
      } else if (v > m2) {
        m2 = v;
      }
    }
    if (count === 0) out[i] = 0;
    else if (count === 1) out[i] = m1;
    else if (count === 2) out[i] = 0.65 * m1 + 0.35 * m2;
    else out[i] = 0.4 * m1 + 0.6 * m2;
  }
  return out;
}

export interface GrowOptions {
  /** Max NDVI/NDMI distance from the running region mean, per date. */
  tol?: number;
  /** Cells with a boundary gradient above this are edges and never join. */
  edge?: number;
  /** Whether to cut 2-cell necks between large lobes (default true). */
  cutNecks?: boolean;
  /** Optional precomputed `gradient(s)` to avoid recomputing across interactive clicks. */
  preGrad?: Float32Array;
}

function median3x3(arr: Float32Array, w: number, h: number, c: number, r: number): number {
  const vs: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= h) continue;
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc;
      if (cc < 0 || cc >= w) continue;
      const v = arr[rr * w + cc];
      if (Number.isFinite(v)) vs.push(v);
    }
  }
  if (!vs.length) return NaN;
  vs.sort((a, b) => a - b);
  return vs[Math.floor(vs.length / 2)];
}

/** Grow a 4-connected region from the seed, sever thin leaks, fill interior holes and recover the half-cell edge. */
export function growRegion(s: NdviStack, seed: [col: number, row: number], opts: GrowOptions = {}): RegionResult | null {
  const { width: w, height: h, dates, ndmi, vis } = s;
  if (!dates.length) return null;
  const tol = opts.tol ?? 0.1;
  const edgeThr = opts.edge ?? 0.05;
  const g = opts.preGrad ?? gradient(s);
  const minValid = Math.max(1, Math.ceil(dates.length * 0.65));

  const validDatesAt = (i: number): number => {
    let k = 0;
    for (let t = 0; t < dates.length; t++) if (Number.isFinite(dates[t][i])) k++;
    return k;
  };
  const cellOddness = (c: number, r: number): number => {
    const i = r * w + c;
    let odd = 0;
    for (const d of dates) {
      const v = d[i];
      if (!Number.isFinite(v)) continue;
      const nb = [d[i - 1], d[i + 1], d[i - w], d[i + w]].filter(Number.isFinite);
      if (nb.length >= 3) odd = Math.max(odd, Math.abs(v - nb.reduce((a, b) => a + b, 0) / nb.length));
    }
    return odd;
  };

  // Keep the clicked cell when it already sits inside a smooth parcel (essential for 30 m wide
  // smallholder plots); only search up to 3 cells (30 m) when the click landed on a bund, road or tower.
  const [sc0, sr0] = [Math.min(w - 2, Math.max(1, seed[0])), Math.min(h - 2, Math.max(1, seed[1]))];
  const i0 = sr0 * w + sc0;
  const seedOnObstacle = validDatesAt(i0) < minValid || g[i0] > edgeThr * 0.85 || cellOddness(sc0, sr0) > tol * 0.8;
  const searchRadius = seedOnObstacle ? 4 : 1;
  let bestScore = Infinity;
  let moved: [number, number] = [sc0, sr0];
  for (let dr = -searchRadius; dr <= searchRadius; dr++) {
    for (let dc = -searchRadius; dc <= searchRadius; dc++) {
      const c = sc0 + dc;
      const r = sr0 + dr;
      if (c < 1 || r < 1 || c >= w - 1 || r >= h - 1) continue;
      const i = r * w + c;
      if (validDatesAt(i) < minValid) continue;
      const score = g[i] + cellOddness(c, r) + 0.006 * Math.hypot(dr, dc);
      if (Number.isFinite(score) && score < bestScore) {
        bestScore = score;
        moved = [c, r];
      }
    }
  }
  seed = moved;

  const anchorNdvi = dates.map((d) => median3x3(d, w, h, seed[0], seed[1]));
  if (anchorNdvi.filter(Number.isFinite).length < minValid) return null;
  const anchorNdmi = ndmi?.map((d) => median3x3(d, w, h, seed[0], seed[1]));

  const accNdvi = anchorNdvi.map((v) => (Number.isFinite(v) ? v : 0));
  const cntNdvi = anchorNdvi.map((v) => (Number.isFinite(v) ? 1 : 0));
  const accNdmi = anchorNdmi?.map((v) => (Number.isFinite(v) ? v : 0));
  const cntNdmi = anchorNdmi?.map((v) => (Number.isFinite(v) ? 1 : 0));

  const mask = new Uint8Array(w * h);
  const start = seed[1] * w + seed[0];
  mask[start] = 1;
  const queue = [start];
  const driftCap = tol * 1.55;
  const ndmiTol = Math.max(0.115, tol * 1.35);
  const ndmiDrift = Math.max(0.165, driftCap * 1.3);

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
      if (mask[j] || g[j] > edgeThr) continue;

      let shared = 0;
      let misses = 0;
      let hardFail = false;
      for (let t = 0; t < dates.length; t++) {
        const v = dates[t][j];
        if (!Number.isFinite(v) || !cntNdvi[t]) continue;
        shared++;
        const meanV = accNdvi[t] / cntNdvi[t];
        const dMean = Math.abs(v - meanV);
        const dSeed = Math.abs(v - anchorNdvi[t]);
        let bad = dMean > tol || dSeed > driftCap;
        if (dMean > tol * 1.85 || dSeed > driftCap * 1.55) hardFail = true;

        if (!bad && ndmi?.[t] && accNdmi && cntNdmi?.[t] && anchorNdmi && Number.isFinite(ndmi[t][j])) {
          const mv = ndmi[t][j];
          const dM = Math.abs(mv - accNdmi[t] / cntNdmi[t]);
          const dS = Math.abs(mv - anchorNdmi[t]);
          if (dM > ndmiTol || dS > ndmiDrift) bad = true;
          if (dM > ndmiTol * 1.75 || dS > ndmiDrift * 1.5) hardFail = true;
        }
        if (bad) misses++;
      }
      const allowedMisses = shared >= 3 ? 1 : 0;
      if (shared < minValid || hardFail || misses > allowedMisses) continue;

      mask[j] = 1;
      for (let t = 0; t < dates.length; t++) {
        const v = dates[t][j];
        if (Number.isFinite(v)) {
          accNdvi[t] += v;
          cntNdvi[t]++;
        }
        if (ndmi?.[t] && accNdmi && cntNdmi && Number.isFinite(ndmi[t][j])) {
          accNdmi[t] += ndmi[t][j];
          cntNdmi[t]++;
        }
      }
      queue.push(j);
    }
  }

  let m: Uint8Array = mask;
  const rawCells = queue.length;
  // 1) Morphological opening BEFORE dilation so 1-2 cell bridges across roads/dikes are severed, not thickened.
  if (rawCells >= 70) {
    const er1 = erode(m, w, h);
    const seed1 = pickSeedIn(er1, w, h, start);
    if (seed1 >= 0) {
      const comp1 = component(er1, w, h, seed1);
      m = and(dilate(comp1, w, h), m);
      if (opts.cutNecks !== false && rawCells >= 450) {
        const er2 = erode(comp1, w, h);
        const seed2 = pickSeedIn(er2, w, h, start);
        if (seed2 >= 0) {
          const comp2 = component(er2, w, h, seed2);
          m = and(dilate(dilate(comp2, w, h), w, h), m);
        }
      }
    }
  }

  // 2) Fill small interior holes (pivot towers, tree clumps, cloud specks) without swallowing huge external blocks.
  m = fillInteriorHoles(m, w, h, Math.max(36, Math.round(rawCells * 0.12)));

  // 3) Sobel's 3x3 stencil lights up both the outer neighbour pixel AND the true last inside pixel
  // of the field. Recover that 1-cell inside margin ONLY where the pixel itself spectrally matches
  // the interior mean and is not a barrier ridge (road/bund/ditch).
  const matchesInterior = (idx: number): boolean => {
    if (vis) {
      for (let t = 0; t < dates.length; t++) {
        const bv = vis[t]?.[idx];
        if (!Number.isFinite(bv)) continue;
        // Reject stepping onto a bright gravel road or dark canal pixel at the border.
        const r = Math.floor(idx / w);
        const c = idx % w;
        if (r >= 1 && r < h - 1 && c >= 1 && c < w - 1) {
          const d = vis[t];
          const h1 = bv - d[idx - 1];
          const h2 = bv - d[idx + 1];
          const v1 = bv - d[idx - w];
          const v2 = bv - d[idx + w];
          if ((h1 * h2 > 0 && Math.min(Math.abs(h1), Math.abs(h2)) > edgeThr) || (v1 * v2 > 0 && Math.min(Math.abs(v1), Math.abs(v2)) > edgeThr)) {
            return false;
          }
        }
      }
    }
    let shared = 0;
    let misses = 0;
    for (let t = 0; t < dates.length; t++) {
      const v = dates[t][idx];
      if (!Number.isFinite(v) || !cntNdvi[t]) continue;
      shared++;
      let bad = Math.abs(v - accNdvi[t] / cntNdvi[t]) > tol || Math.abs(v - anchorNdvi[t]) > driftCap;
      if (!bad && ndmi?.[t] && accNdmi && cntNdmi?.[t] && anchorNdmi && Number.isFinite(ndmi[t][idx])) {
        if (Math.abs(ndmi[t][idx] - accNdmi[t] / cntNdmi[t]) > ndmiTol || Math.abs(ndmi[t][idx] - anchorNdmi[t]) > ndmiDrift) {
          bad = true;
        }
      }
      if (bad) misses++;
    }
    return shared >= minValid && misses <= (shared >= 3 ? 1 : 0);
  };
  m = recoverSpectralMargin(m, matchesInterior, w, h);

  let cells = 0;
  let touches = false;
  let inG = 0;
  let inN = 0;
  let borderG = 0;
  let borderN = 0;
  const inner = erode(m, w, h);
  const outerRing = and(dilate(m, w, h), not(m));
  for (let i = 0; i < m.length; i++) {
    if (m[i]) {
      cells++;
      const r = Math.floor(i / w);
      const c = i % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) touches = true;
      if (inner[i]) {
        inG += g[i];
        inN++;
      } else {
        borderG += g[i];
        borderN++;
      }
    } else if (outerRing[i]) {
      borderG += g[i];
      borderN++;
    }
  }
  return {
    mask: m,
    cells,
    touchesBorder: touches,
    edgeContrast: Math.max(0, (borderN ? borderG / borderN : 0) - (inN ? inG / inN : 0)),
  };
}

function pickSeedIn(m: Uint8Array, w: number, h: number, start: number): number {
  if (m[start]) return start;
  for (const j of N4(w, h, start)) if (m[j]) return j;
  return -1;
}

function recoverSpectralMargin(
  m: Uint8Array,
  matchesInterior: (idx: number) => boolean,
  w: number,
  h: number,
): Uint8Array {
  const cardinal = new Uint8Array(m);
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      if (m[i]) continue;
      if ((m[i - 1] || m[i + 1] || m[i - w] || m[i + w]) && matchesInterior(i)) cardinal[i] = 1;
    }
  }
  // Also snap 90-degree parcel corners that touch two recovered cardinal edges and match the field.
  const out = new Uint8Array(cardinal);
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      if (cardinal[i]) continue;
      const nb = (cardinal[i - 1] ? 1 : 0) + (cardinal[i + 1] ? 1 : 0) + (cardinal[i - w] ? 1 : 0) + (cardinal[i + w] ? 1 : 0);
      if (nb >= 2 && matchesInterior(i)) out[i] = 1;
    }
  }
  return out;
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
  for (let r = 0; r < h; r++) {
    const row = r * w;
    for (let c = 0; c < w; c++) {
      const i = row + c;
      if (
        m[i] ||
        (r > 0 && m[i - w]) ||
        (r + 1 < h && m[i + w]) ||
        (c > 0 && m[i - 1]) ||
        (c + 1 < w && m[i + 1])
      ) {
        o[i] = 1;
      }
    }
  }
  return o;
}
function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let r = 1; r < h - 1; r++) {
    const row = r * w;
    for (let c = 1; c < w - 1; c++) {
      const i = row + c;
      if (m[i] && m[i - w] && m[i + w] && m[i - 1] && m[i + 1]) o[i] = 1;
    }
  }
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

function fillInteriorHoles(m: Uint8Array, w: number, h: number, maxHoleCells: number): Uint8Array {
  const allFilled = fillHoles(m, w, h);
  const out = new Uint8Array(m);
  const seen = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (m[i] || !allFilled[i] || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      for (const j of N4(w, h, comp[k])) {
        if (!m[j] && allFilled[j] && !seen[j]) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    if (comp.length <= maxHoleCells) for (const j of comp) out[j] = 1;
  }
  return out;
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

/** Fair pixel-staircase jaggies along a dense contour while keeping true corners sharp. */
export function smoothContour(p: XY[], passes = 2): XY[] {
  if (p.length < 8) return p;
  let cur = p;
  for (let pass = 0; pass < passes; pass++) {
    const n = cur.length;
    const next: XY[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = cur[(i - 1 + n) % n];
      const pt = cur[i];
      const nxt = cur[(i + 1) % n];
      next[i] = [0.25 * prev[0] + 0.5 * pt[0] + 0.25 * nxt[0], 0.25 * prev[1] + 0.5 * pt[1] + 0.25 * nxt[1]];
    }
    cur = next;
  }
  return cur;
}

export const ringArea = (p: XY[]): number => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
};
export const ringPerimeter = (p: XY[]): number => p.reduce((s, q, i) => s + Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]), 0);
/** Polsby-Popper compactness: 1 for a circle, about 0.785 for a square. */
export const compactness = (p: XY[]): number => (p.length < 3 ? 0 : (4 * Math.PI * ringArea(p)) / ringPerimeter(p) ** 2);

/** Monotone-chain convex hull of 2D points, for measuring solidity (area / hullArea). */
export function convexHull(pts: readonly XY[]): XY[] {
  if (pts.length <= 3) return [...pts];
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Ratio of polygon area to its convex-hull area: ~1 for any rectangle (even 6:1 strips), low for leaky shapes. */
export const solidity = (p: XY[]): number => {
  if (p.length < 3) return 0;
  const ha = ringArea(convexHull(p));
  return ha > 0 ? Math.min(1, ringArea(p) / ha) : 0;
};

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

/** Drop nearly-collinear vertices along straight parcel edges so rectangular fields keep clean corners. */
function pruneCollinear(ring: XY[], tol: number): XY[] {
  let cur = [...ring];
  let changed = true;
  while (changed && cur.length > 4) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[i];
      const c = cur[(i + 1) % cur.length];
      const base = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (base < 1e-6) {
        cur.splice(i, 1);
        changed = true;
        break;
      }
      const dist = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / base;
      if (dist <= tol * 0.75) {
        cur.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return cur;
}

/** Douglas-Peucker on a closed ring, tolerance raised until at most `maxVertices` remain without collapsing below 3 corners. */
export function simplifyRing(p: XY[], tol: number, maxVertices = 18): XY[] {
  if (p.length <= 4) return p;
  let far = 0;
  let fd = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > fd) (fd = d), (far = i);
  }
  let t = tol;
  let lastValid = p;
  for (let k = 0; k < 20; k++) {
    const raw = [...dpOpen(p.slice(0, far + 1), t).slice(0, -1), ...dpOpen([...p.slice(far), p[0]], t).slice(0, -1)];
    if (raw.length < 3) {
      t *= 0.6;
      continue;
    }
    const s = pruneCollinear(raw, t);
    if (s.length >= 3) lastValid = s;
    if (s.length >= 3 && (s.length <= maxVertices || s.length <= 4)) return s;
    t *= 1.35;
  }
  return lastValid;
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

// ---------------------------------------------------------------- interactive multi-point prompts & regularisation

export interface PromptSeeds {
  positives: [col: number, row: number][];
  negatives?: [col: number, row: number][];
}

/**
 * LabelMe / SAM-style interactive segmentation on a multi-spectral Sentinel-2 stack:
 * - Grows foreground from every positive point (each anchored to its own local canopy/moisture
 *   signature) and welds 1-2 pixel internal waterways/bunds between co-selected strips.
 * - Cuts away over-segmented spills using simultaneous binary-heap Dijkstra geodesic competition
 *   from all positive vs negative points over the multi-date boundary gradient + spectral step graph,
 *   so cuts snap cleanly onto faint bunds, ditches, tillage lines and roads.
 */
export function segmentPrompts(s: NdviStack, seeds: PromptSeeds, opts: GrowOptions = {}): RegionResult | null {
  const { width: w, height: h, dates, ndmi } = s;
  const posRaw = seeds.positives;
  const negRaw = seeds.negatives ?? [];
  if (!dates.length || !posRaw.length) return null;
  if (posRaw.length === 1 && negRaw.length === 0) return growRegion(s, posRaw[0], opts);

  const clampSeed = ([c, r]: [number, number]): [number, number] => [
    Math.min(w - 2, Math.max(1, Math.round(c))),
    Math.min(h - 2, Math.max(1, Math.round(r))),
  ];
  const pos = posRaw.map(clampSeed);
  const neg = negRaw.map(clampSeed);
  const g = opts.preGrad ?? gradient(s);
  const n = w * h;

  // 1) Foreground union from all positive seeds (each keeping neck-cutting enabled so individual
  // positive clicks never leak across 2-pixel road bridges into neighbouring sections).
  const baseTol = opts.tol ?? 0.098;
  const baseEdge = opts.edge ?? 0.05;
  const union = new Uint8Array(n);
  for (const p of pos) {
    const r1 = growRegion(s, p, { tol: baseTol, edge: baseEdge, cutNecks: opts.cutNecks, preGrad: g });
    if (r1) {
      for (let i = 0; i < n; i++) if (r1.mask[i]) union[i] = 1;
    } else {
      // Fallback looser local grow if user explicitly clicked a tricky corner/strip.
      const r2 = growRegion(s, p, { tol: baseTol * 1.3, edge: baseEdge * 1.3, cutNecks: opts.cutNecks, preGrad: g });
      if (r2) for (let i = 0; i < n; i++) if (r2.mask[i]) union[i] = 1;
    }
    union[p[1] * w + p[0]] = 1;
  }

  // Weld 1-6 cell internal ditches, grass headlands or farm tracks between multiple positive-selected
  // strips, never stepping onto negative seeds.
  let m: Uint8Array = union;
  if (pos.length >= 2) {
    const negBlock = new Uint8Array(n);
    for (const [nc, nr] of neg) {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = nr + dr;
          const cc = nc + dc;
          if (rr >= 0 && rr < h && cc >= 0 && cc < w) negBlock[rr * w + cc] = 1;
        }
      }
    }
    const clampNeg = (arr: Uint8Array) => {
      for (let i = 0; i < n; i++) if (negBlock[i]) arr[i] = 0;
      return arr;
    };
    const d1 = clampNeg(dilate(m, w, h));
    const d2 = clampNeg(dilate(d1, w, h));
    const d3 = clampNeg(dilate(d2, w, h));
    m = erode(erode(erode(d3, w, h), w, h), w, h);
    for (let i = 0; i < n; i++) if (union[i]) m[i] = 1;
  }

  // 2) Geodesic shortest-path competition (Image Foresting Transform) restricted strictly to `m`
  // so wavefronts must meet across internal bunds/ditches instead of sneaking around outside.
  if (neg.length > 0) {
    const domain = new Uint8Array(m);
    for (const [nc, nr] of neg) domain[nr * w + nc] = 1;
    for (const [pc, pr] of pos) domain[pr * w + pc] = 1;
    const owner = geodesicCompetition(s, g, domain, pos, neg);
    for (let i = 0; i < n; i++) if (owner[i] === 2) m[i] = 0;
    // Keep only connected components that still contain at least one positive seed.
    const kept = new Uint8Array(n);
    for (const [pc, pr] of pos) {
      const idx = pr * w + pc;
      if (!m[idx] || kept[idx]) continue;
      const comp = component(m, w, h, idx);
      for (let i = 0; i < n; i++) if (comp[i]) kept[i] = 1;
    }
    // Smooth 1-pixel staircase teeth along the newly carved cut without losing narrow strips.
    const countKept = kept.reduce((acc, v) => acc + v, 0);
    if (countKept >= 80) {
      const er = erode(kept, w, h);
      const reseeded = new Uint8Array(n);
      for (const [pc, pr] of pos) {
        const sIdx = pickSeedIn(er, w, h, pr * w + pc);
        if (sIdx >= 0) {
          const c = component(er, w, h, sIdx);
          for (let i = 0; i < n; i++) if (c[i]) reseeded[i] = 1;
        }
      }
      if (reseeded.some((v) => v === 1)) {
        m = and(dilate(reseeded, w, h), kept);
      } else {
        m = kept;
      }
    } else {
      m = kept;
    }
  }

  // 3) Fill small interior holes that do NOT contain any negative prompt, then keep a single
  // connected component so PolygonGeometry's exterior contour matches `cells` 1-to-1.
  const negIdx = new Set(neg.map(([nc, nr]) => nr * w + nc));
  m = fillInteriorHolesExcluding(m, w, h, Math.max(36, Math.round(n * 0.04)), negIdx);
  m = largestPositiveComponent(m, w, h, pos);

  // Measure cells, border touch and edge contrast.
  let cells = 0;
  let touches = false;
  let inG = 0;
  let inN = 0;
  let borderG = 0;
  let borderN = 0;
  const inner = erode(m, w, h);
  const outerRing = and(dilate(m, w, h), not(m));
  for (let i = 0; i < n; i++) {
    if (m[i]) {
      cells++;
      const r = Math.floor(i / w);
      const c = i % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) touches = true;
      if (inner[i]) {
        inG += g[i];
        inN++;
      } else {
        borderG += g[i];
        borderN++;
      }
    } else if (outerRing[i]) {
      borderG += g[i];
      borderN++;
    }
  }
  if (!cells) return null;
  // Unused reference guard when ndmi is absent:
  void ndmi;
  return {
    mask: m,
    cells,
    touchesBorder: touches,
    edgeContrast: Math.max(0, (borderN ? borderG / borderN : 0) - (inN ? inG / inN : 0)),
  };
}

function geodesicCompetition(
  s: NdviStack,
  g: Float32Array,
  domain: Uint8Array,
  pos: [number, number][],
  neg: [number, number][],
): Uint8Array {
  const { width: w, height: h, dates, ndmi } = s;
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const owner = new Uint8Array(n); // 1 = positive, 2 = negative

  const posAnchors = pos.map(([c, r]) => ({
    ndvi: dates.map((d) => median3x3(d, w, h, c, r)),
    ndmi: ndmi?.map((d) => median3x3(d, w, h, c, r)),
  }));
  const negAnchors = neg.map(([c, r]) => ({
    ndvi: dates.map((d) => median3x3(d, w, h, c, r)),
    ndmi: ndmi?.map((d) => median3x3(d, w, h, c, r)),
  }));

  const anchorDist = (idx: number, anchors: typeof posAnchors): number => {
    let best = Infinity;
    for (const a of anchors) {
      let sum = 0;
      let k = 0;
      for (let t = 0; t < dates.length; t++) {
        const v = dates[t][idx];
        const av = a.ndvi[t];
        if (!Number.isFinite(v) || !Number.isFinite(av)) continue;
        let diff = Math.abs(v - av);
        if (ndmi?.[t] && a.ndmi && Number.isFinite(ndmi[t][idx]) && Number.isFinite(a.ndmi[t])) {
          diff += 0.65 * Math.abs(ndmi[t][idx] - a.ndmi[t]);
        }
        sum += diff;
        k++;
      }
      const mean = k ? sum / k : 0.25;
      if (mean < best) best = mean;
    }
    return Number.isFinite(best) ? best : 0.25;
  };

  // Compact binary min-heap on pixel indices + distances.
  const heapIdx: number[] = [];
  const heapCost: number[] = [];
  const push = (idx: number, cost: number) => {
    let i = heapIdx.length;
    heapIdx.push(idx);
    heapCost.push(cost);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapCost[p] <= cost) break;
      heapIdx[i] = heapIdx[p];
      heapCost[i] = heapCost[p];
      i = p;
    }
    heapIdx[i] = idx;
    heapCost[i] = cost;
  };
  const pop = (): [number, number] => {
    const topIdx = heapIdx[0];
    const topCost = heapCost[0];
    const lastIdx = heapIdx.pop()!;
    const lastCost = heapCost.pop()!;
    if (heapIdx.length > 0) {
      let i = 0;
      const len = heapIdx.length;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let sm = i;
        if (l < len && heapCost[l] < lastCost) sm = l;
        if (r < len && heapCost[r] < (sm === i ? lastCost : heapCost[l])) sm = r;
        if (sm === i) break;
        heapIdx[i] = heapIdx[sm];
        heapCost[i] = heapCost[sm];
        i = sm;
      }
      heapIdx[i] = lastIdx;
      heapCost[i] = lastCost;
    }
    return [topIdx, topCost];
  };

  for (const [c, r] of pos) {
    const idx = r * w + c;
    dist[idx] = 0;
    owner[idx] = 1;
    push(idx, 0);
  }
  for (const [c, r] of neg) {
    const idx = r * w + c;
    dist[idx] = 0;
    owner[idx] = 2;
    push(idx, 0);
  }

  const stepBarrier = (u: number, v: number): number => {
    const du = v - u; // +-1 or +-w
    const beyond = v + du;
    const inBounds = beyond >= 0 && beyond < n && (Math.abs(du) === w || Math.floor(beyond / w) === Math.floor(v / w));
    let sum = 0;
    let k = 0;
    for (let t = 0; t < dates.length; t++) {
      const a = dates[t][u];
      const b = dates[t][v];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      let d = Math.abs(b - a);
      // Directional ridge across u -> v -> beyond catches 1-pixel bunds/ditches right up to the perimeter!
      if (inBounds && domain[beyond] && Number.isFinite(dates[t][beyond])) {
        const c = dates[t][beyond];
        if ((b - a) * (b - c) > 0) d += 1.5 * Math.min(Math.abs(b - a), Math.abs(b - c));
      }
      if (ndmi?.[t] && Number.isFinite(ndmi[t][u]) && Number.isFinite(ndmi[t][v])) {
        d += 0.7 * Math.abs(ndmi[t][v] - ndmi[t][u]);
      }
      if (s.vis?.[t] && Number.isFinite(s.vis[t][u]) && Number.isFinite(s.vis[t][v])) {
        const va = s.vis[t][u];
        const vb = s.vis[t][v];
        if (inBounds && domain[beyond] && Number.isFinite(s.vis[t][beyond])) {
          const vc = s.vis[t][beyond];
          if ((vb - va) * (vb - vc) > 0) d += 1.4 * Math.min(Math.abs(vb - va), Math.abs(vb - vc));
        }
      }
      sum += d;
      k++;
    }
    return k ? sum / k : 0.1;
  };

  while (heapIdx.length > 0) {
    const [u, dU] = pop();
    if (dU > dist[u]) continue;
    const lab = owner[u];
    for (const v of N4(w, h, u)) {
      if (!domain[v]) continue;
      const aff =
        lab === 1
          ? Math.max(0, anchorDist(v, posAnchors) - anchorDist(v, negAnchors))
          : Math.max(0, anchorDist(v, negAnchors) - anchorDist(v, posAnchors));
      const bar = stepBarrier(u, v);
      // Quadratic boost on barriers so even a faint 0.04 bund outweighs 30+ flat interior steps.
      const wStep = 0.002 + 3.2 * bar + 28 * bar * bar + 0.3 * aff;
      const next = dU + wStep;
      if (next < dist[v]) {
        dist[v] = next;
        owner[v] = lab;
        push(v, next);
      }
    }
  }
  void g;
  return owner;
}

function largestPositiveComponent(m: Uint8Array, w: number, h: number, pos: [number, number][]): Uint8Array {
  const seen = new Uint8Array(m.length);
  let best: Uint8Array | null = null;
  let bestCount = 0;
  for (let pIdx = pos.length - 1; pIdx >= 0; pIdx--) {
    const [pc, pr] = pos[pIdx];
    const start = pickSeedIn(m, w, h, pr * w + pc);
    if (start < 0 || seen[start]) continue;
    const comp = component(m, w, h, start);
    let cnt = 0;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i]) {
        seen[i] = 1;
        cnt++;
      }
    }
    if (cnt > bestCount) {
      bestCount = cnt;
      best = comp;
    }
  }
  return best ?? m;
}

function fillInteriorHolesExcluding(m: Uint8Array, w: number, h: number, maxHoleCells: number, forbidden: Set<number>): Uint8Array {
  const allFilled = fillHoles(m, w, h);
  const out = new Uint8Array(m);
  const seen = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (m[i] || !allFilled[i] || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    let hasForbidden = forbidden.has(i);
    for (let k = 0; k < comp.length; k++) {
      for (const j of N4(w, h, comp[k])) {
        if (!m[j] && allFilled[j] && !seen[j]) {
          seen[j] = 1;
          if (forbidden.has(j)) hasForbidden = true;
          comp.push(j);
        }
      }
    }
    if (!hasForbidden && comp.length <= maxHoleCells) for (const j of comp) out[j] = 1;
  }
  return out;
}

/**
 * Regularise a parcel ring along its dominant agricultural orientation (4-fold axial estimate):
 * edges within `snapDeg` of the principal axes snap to clean parallel/perpendicular lines and
 * micro-jogs shorter than `minEdgeM` are pruned, preserving the original ring area.
 */
export function regularizeRing(ring: XY[], snapDeg = 18, minEdgeM = 12): XY[] {
  if (ring.length < 4) return ring;
  const origArea = ringArea(ring);
  if (origArea <= 0) return ring;

  // 1) Prune tiny edges & near-collinear kinks first.
  let pts = pruneCollinear(ring, minEdgeM * 0.45);
  if (pts.length < 4) return ring;

  // 2) Dominant orthogonal orientation via 4*theta circular mean weighted by edge length.
  let c4 = 0;
  let s4 = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const ang = Math.atan2(dy, dx);
    c4 += len * Math.cos(4 * ang);
    s4 += len * Math.sin(4 * ang);
  }
  const theta0 = 0.25 * Math.atan2(s4, c4);
  const snapRad = (snapDeg * Math.PI) / 180;

  // 3) Snap each edge direction if close to theta0 + k*(pi/2), keeping edge midpoint fixed.
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const mx = 0.5 * (a[0] + b[0]);
    const my = 0.5 * (a[1] + b[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const k = Math.round((ang - theta0) / (Math.PI / 2));
    const target = theta0 + k * (Math.PI / 2);
    const diff = Math.atan2(Math.sin(ang - target), Math.cos(ang - target));
    const finalAng = Math.abs(diff) <= snapRad ? target : ang;
    return { mx, my, ux: Math.cos(finalAng), uy: Math.sin(finalAng), snapped: Math.abs(diff) <= snapRad, len };
  });

  // 4) Merge consecutive parallel lines and intersect consecutive non-parallel lines.
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const origCorner = pts[i];
    const det = l1.ux * l2.uy - l1.uy * l2.ux;
    if (Math.abs(det) < 0.18) {
      // Nearly parallel consecutive edges: drop the redundant intermediate vertex if collinear.
      continue;
    }
    const dx = l2.mx - l1.mx;
    const dy = l2.my - l1.my;
    const t = (dx * l2.uy - dy * l2.ux) / det;
    const ix = l1.mx + t * l1.ux;
    const iy = l1.my + t * l1.uy;
    const maxShift = Math.max(minEdgeM * 2.2, 0.35 * Math.min(l1.len, l2.len));
    if (Math.hypot(ix - origCorner[0], iy - origCorner[1]) <= maxShift) {
      out.push([ix, iy]);
    } else {
      out.push(origCorner);
    }
  }
  const cleaned = pruneCollinear(out, minEdgeM * 0.35);
  if (cleaned.length < 3) return ring;
  return scaleToArea(cleaned, origArea);
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
