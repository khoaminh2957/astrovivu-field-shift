/**
 * Detect the field (and nested management candidates) under a point from multi-spectral Sentinel-2
 * stacks (Planetary Computer, 10 m): NDVI, NDMI (moisture/residue) and visible brightness (roads,
 * bunds, farmsteads) across up to four seasonally diverse dates, drift-bounded region growing,
 * neck-cutting opening, contour fairing, Douglas-Peucker + collinearity pruning, or fitted circle
 * for centre pivots. Null / empty when no clean field is found.
 */
import type { ISODate, LngLat, PolygonGeometry } from '@/contracts';
import { addDays, diffDays, todayISO } from '@/lib/time';
import { circlePolygon, closeRing } from '@/lib/geo';
import { isAbort, mapLimit } from '../http';
import { fetchScene, searchScenes } from '../rasters/pc';
import { band, normDiff, s2Offset, s2Reflectance, sclValid, type RasterGrid } from '../rasters/pure';

type SceneHit = Awaited<ReturnType<typeof searchScenes>>[number];
import {
  compactness,
  gradient,
  growRegion,
  type GrowOptions,
  polygonIoU,
  type PromptSeeds,
  regularizeRing,
  ringArea,
  ringPerimeter,
  roundness,
  scaleToArea,
  segmentPrompts,
  simplifyRing,
  smoothContour,
  solidity,
  traceContour,
  type NdviStack,
  type XY,
} from './pure';

export interface FieldBoundary {
  polygon: PolygonGeometry;
  areaHa: number;
  confidence: number;
  date: ISODate;
}

export interface FieldPromptPoint {
  at: LngLat;
  kind: 'positive' | 'negative';
}

export interface FieldPromptSession {
  date: ISODate;
  candidates: FieldBoundary[];
  /** True when `at` lies well within the cached Sentinel-2 window and can refine without network calls. */
  contains: (at: LngLat) => boolean;
  /** Recompute the boundary in-memory (20-70 ms in Node) from positive/negative clicks + optional regularisation steps. */
  solve: (prompts: FieldPromptPoint[], opts?: { rungDelta?: number; regularizeSteps?: number }) => FieldBoundary | null;
}

const CELL = 10;
const SIDE = 161; // 1.6 km window at 10 m, seed at the centre cell
const WIDE_CELL = 20;
const WIDE_SIDE = 181; // 3.6 km fallback window when a large (>65 ha) field reaches the 1.6 km border
const M_PER_DEG = 111_320;
const MAX_GRANULE_CLOUD = 45; // 110 km tile cloud %; local SCL checks verify the 1.6 km window itself is clear

function windowGrid(at: LngLat, cellM = CELL, side = SIDE): RasterGrid {
  const coslat = Math.cos((at[1] * Math.PI) / 180);
  const hw = (side * cellM) / 2;
  const dLng = hw / (M_PER_DEG * coslat);
  const dLat = hw / M_PER_DEG;
  const [w, s, e, n] = [at[0] - dLng, at[1] - dLat, at[0] + dLng, at[1] + dLat];
  return { bbox: [w, s, e, n], width: side, height: side, cellM, corners: [[w, n], [e, n], [e, s], [w, s]], inside: new Uint8Array(0), insideCount: 0 };
}

interface DateLayer {
  t: ISODate;
  ndvi: Float32Array;
  ndmi: Float32Array;
  vis: Float32Array;
  valid: number;
  seedValid: number;
  meanNdvi: number;
  sdNdvi: number;
  sdNdmi: number;
  sdVis: number;
  contrast: number;
}

function stats(arr: Float32Array): { mean: number; sd: number } {
  let k = 0;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) continue;
    k++;
    sum += v;
    sq += v * v;
  }
  if (!k) return { mean: 0, sd: 0 };
  const mean = sum / k;
  return { mean, sd: Math.sqrt(Math.max(0, sq / k - mean * mean)) };
}

async function fetchDateLayer(s: SceneHit, grid: RasterGrid, signal?: AbortSignal): Promise<DateLayer | null> {
  try {
    const arr = await fetchScene('sentinel-2-l2a', s.id, ['B03', 'B04', 'B08', 'B11', 'SCL'], grid, signal);
    const [green, red, nir, swir, scl, mask] = [0, 1, 2, 3, 4, 5].map((b) => band(arr, b));
    const off = s2Offset(s.props.baseline as string | undefined);
    const total = grid.width * grid.height;
    const ndvi = new Float32Array(total).fill(NaN);
    const ndmi = new Float32Array(total).fill(NaN);
    const vis = new Float32Array(total).fill(NaN);
    const cx = Math.floor(grid.width / 2);
    const cy = Math.floor(grid.height / 2);
    let validCount = 0;
    let seedCount = 0;
    let seedTotal = 0;
    for (let i = 0; i < total; i++) {
      const r = Math.floor(i / grid.width);
      const c = i % grid.width;
      const inSeed = Math.abs(r - cy) <= 10 && Math.abs(c - cx) <= 10;
      if (inSeed) seedTotal++;
      if (!(mask[i] > 0) || !sclValid(scl[i])) continue;
      const gRef = s2Reflectance(green[i], off);
      const rRef = s2Reflectance(red[i], off);
      const nRef = s2Reflectance(nir[i], off);
      const sRef = s2Reflectance(swir[i], off);
      const vNdvi = normDiff(nRef, rRef);
      const vNdmi = normDiff(nRef, sRef);
      if (vNdvi == null || vNdmi == null || gRef == null || rRef == null) continue;
      ndvi[i] = vNdvi;
      ndmi[i] = vNdmi;
      vis[i] = Math.min(1, Math.max(0, (gRef + rRef) * 1.5));
      validCount++;
      if (inSeed) seedCount++;
    }
    const valid = validCount / total;
    const seedValid = seedTotal ? seedCount / seedTotal : 0;
    const stNdvi = stats(ndvi);
    const stNdmi = stats(ndmi);
    const stVis = stats(vis);
    return {
      t: s.t,
      ndvi,
      ndmi,
      vis,
      valid,
      seedValid,
      meanNdvi: stNdvi.mean,
      sdNdvi: stNdvi.sd,
      sdNdmi: stNdmi.sd,
      sdVis: stVis.sd,
      contrast: stNdvi.sd + 0.65 * stNdmi.sd,
    };
  } catch (e) {
    if (isAbort(e)) throw e;
    return null;
  }
}

async function stackDates(at: LngLat, today: ISODate, grid: RasterGrid, signal?: AbortSignal): Promise<DateLayer[]> {
  const scenes = await searchScenes('sentinel-2-l2a', at, addDays(today, -364), today, MAX_GRANULE_CLOUD, signal);
  // Up to two clearest scenes per 60-day bin: if the clearest granule happens to have a local cloud
  // patch over this 1.6 km window, the runner-up in the same season backs it up.
  const bins = new Map<number, SceneHit[]>();
  for (const s of scenes) {
    const k = Math.floor(diffDays(today, s.t) / 60);
    const list = bins.get(k) ?? [];
    list.push(s);
    bins.set(k, list);
  }
  const binCandidates = [...bins.values()].map((list) => list.sort((a, b) => a.cloud - b.cloud).slice(0, 2));
  const out = await mapLimit(binCandidates, 3, async (cands): Promise<DateLayer | null> => {
    for (const cand of cands) {
      const layer = await fetchDateLayer(cand, grid, signal);
      if (layer && layer.valid >= 0.82 && layer.seedValid >= 0.8) return layer;
    }
    return null;
  });
  return out.filter((d): d is DateLayer => d != null);
}

/** Pure part after the imagery is in hand; exported for tests and tuning. */
export function boundaryFromStack(stack: NdviStack, grid: Pick<RasterGrid, 'bbox' | 'cellM'>, centre: LngLat, grow: GrowOptions = {}): Omit<FieldBoundary, 'date'> | null {
  const seed: [number, number] = [Math.floor(stack.width / 2), Math.floor(stack.height / 2)];
  return boundaryFromPrompts(stack, grid, centre, { positives: [seed] }, grow, 0);
}

/**
 * Pure multi-prompt boundary builder (1-click OR LabelMe/SAM-style multi-point positive/negative
 * refinement + iterative edge regularisation).
 */
export function boundaryFromPrompts(
  stack: NdviStack,
  grid: Pick<RasterGrid, 'bbox' | 'cellM'>,
  centre: LngLat,
  seeds: PromptSeeds,
  grow: GrowOptions = {},
  regularizeSteps = 0,
  allowBorderTouch = false,
): Omit<FieldBoundary, 'date'> | null {
  const interactive = seeds.positives.length > 1 || (seeds.negatives?.length ?? 0) > 0;
  const reg = segmentPrompts(stack, seeds, grow);
  if (!reg || (!allowBorderTouch && reg.touchesBorder)) return null;
  const areaM2 = reg.cells * grid.cellM * grid.cellM;
  if (areaM2 < (interactive ? 1_200 : 2_500)) return null;
  const rawContour = traceContour(reg.mask, stack.width, stack.height, grid.cellM);
  if (rawContour.length < 4) return null;
  const approxMinorM = (2 * areaM2) / Math.max(grid.cellM * 4, ringPerimeter(rawContour));
  const contour = approxMinorM < grid.cellM * 4 ? smoothContour(rawContour, 1) : smoothContour(rawContour, 2);
  const comp = compactness(scaleToArea(contour, areaM2));
  const round = roundness(contour);
  const hasNeg = (seeds.negatives?.length ?? 0) > 0;
  let ring: XY[];
  let circle: { cx: number; cy: number; r: number } | null = null;
  if (!hasNeg && regularizeSteps === 0 && round.cv < 0.07 && comp > 0.8) {
    circle = { cx: round.cx, cy: round.cy, r: Math.sqrt(areaM2 / Math.PI) };
  } else {
    const baseTol = Math.max(grid.cellM * 1.1, Math.min(grid.cellM * 2.6, ringPerimeter(contour) * 0.007));
    const simpTol = Math.max(grid.cellM * 0.45, Math.min(baseTol, approxMinorM * 0.28));
    let simplified = simplifyRing(contour, simpTol, 16);
    for (let step = 1; step <= regularizeSteps; step++) {
      const snapDeg = Math.min(36, 15 + step * 8);
      const minEdge = grid.cellM * (1.1 + step * 0.55);
      simplified = regularizeRing(simplified, snapDeg, minEdge);
      if (step >= 2 && simplified.length > 4) {
        simplified = simplifyRing(simplified, simpTol * (1 + 0.35 * step), Math.max(4, 14 - step * 2));
        simplified = regularizeRing(simplified, snapDeg, minEdge);
      }
    }
    ring = scaleToArea(simplified, areaM2);
  }
  const simple = circle ? null : ring!;
  const shapeComp = circle ? 1 : compactness(simple!);
  const sol = circle ? 1 : solidity(simple!);
  // Elongated strip paddies (5:1..7:1) have low Polsby-Popper compactness (~0.30) yet high solidity (>0.85),
  // whereas leaky cross-road blobs have low solidity (<0.62). Interactive multi-point shapes allow L-parcels.
  if (shapeComp < (interactive ? 0.1 : 0.2) || sol < (interactive ? 0.32 : 0.66)) return null;
  const [w, , , n] = grid.bbox;
  const coslat = Math.cos((centre[1] * Math.PI) / 180);
  const toLngLat = ([x, y]: XY): LngLat => [w + x / (M_PER_DEG * coslat), n - y / M_PER_DEG];
  const polygon: PolygonGeometry = circle
    ? circlePolygon(toLngLat([circle.cx, circle.cy]), circle.r)
    : { type: 'Polygon', coordinates: [closeRing(simple!.map(toLngLat))] };
  const contrastScore = Math.max(0, Math.min(1, reg.edgeContrast / 0.085));
  const solidityScore = Math.max(0, Math.min(1, (sol - 0.65) / 0.3));
  const compScore = Math.max(0, Math.min(1, (shapeComp - 0.25) / 0.5));
  return {
    polygon,
    areaHa: Math.round((circle ? areaM2 : ringArea(simple!)) / 100) / 100,
    confidence: Math.round((0.55 * contrastScore + 0.3 * solidityScore + 0.15 * compScore) * 100) / 100,
  };
}

/** Orthogonalise / straighten an arbitrary LngLat polygon ring (e.g. after corner drags), preserving area. */
export function regularizePolygonRing(vertices: LngLat[], step = 1): LngLat[] {
  const open = vertices.length > 1 && vertices[0][0] === vertices[vertices.length - 1][0] && vertices[0][1] === vertices[vertices.length - 1][1]
    ? vertices.slice(0, -1)
    : vertices.slice();
  if (open.length < 4) return vertices;
  const o = open[0];
  const coslat = Math.cos((o[1] * Math.PI) / 180);
  const xy: XY[] = open.map(([lng, lat]) => [(lng - o[0]) * M_PER_DEG * coslat, (o[1] - lat) * M_PER_DEG]);
  const s = Math.max(1, step);
  const reg = regularizeRing(xy, Math.min(36, 15 + s * 8), 10 + s * 5);
  return reg.map(([x, y]) => [o[0] + x / (M_PER_DEG * coslat), o[1] - y / M_PER_DEG] as LngLat);
}

interface ScaleCandidate extends FieldBoundary {
  rankScore: number;
  stack: NdviStack;
  preGrad: Float32Array;
  ladderIdx: number;
  grid: RasterGrid;
  ladder: { grow: GrowOptions; bonus: number; strict?: boolean }[];
}

const FINE_LADDER: { grow: GrowOptions; bonus: number; strict?: boolean }[] = [
  { grow: { tol: 0.068, edge: 0.036, cutNecks: true }, bonus: 0.05, strict: true },
  { grow: { tol: 0.098, edge: 0.05, cutNecks: true }, bonus: 0.07, strict: true },
  { grow: { tol: 0.13, edge: 0.066, cutNecks: true }, bonus: 0.02 },
  { grow: { tol: 0.162, edge: 0.082, cutNecks: false }, bonus: -0.08 },
];

// At 20 m resolution a 10 m gravel road or canal dike spans half a pixel, so edge thresholds are
// scaled tighter and neck-cutting stays on to prevent merging adjacent quarter-sections.
const WIDE_LADDER: { grow: GrowOptions; bonus: number; strict?: boolean }[] = [
  { grow: { tol: 0.068, edge: 0.025, cutNecks: true }, bonus: 0.04, strict: true },
  { grow: { tol: 0.092, edge: 0.034, cutNecks: true }, bonus: 0.05, strict: true },
  { grow: { tol: 0.118, edge: 0.045, cutNecks: true }, bonus: 0.01 },
];

interface ScaleRun {
  candidates: ScaleCandidate[];
  strictTouchedBorder: boolean;
  anyTouchedBorder: boolean;
  stack: NdviStack | null;
  grid: RasterGrid;
  date: ISODate | null;
  ladder: { grow: GrowOptions; bonus: number; strict?: boolean }[];
}

async function candidatesAtScale(
  point: LngLat,
  today: ISODate,
  cellM: number,
  side: number,
  ladder: { grow: GrowOptions; bonus: number; strict?: boolean }[],
  signal?: AbortSignal,
): Promise<ScaleRun> {
  const grid = windowGrid(point, cellM, side);
  const dates = await stackDates(point, today, grid, signal);
  if (!dates.length) {
    return { candidates: [], strictTouchedBorder: false, anyTouchedBorder: false, stack: null, grid, date: null, ladder };
  }
  const ordered = orderDates(dates);
  const seed: [number, number] = [Math.floor(side / 2), Math.floor(side / 2)];
  const raw: ScaleCandidate[] = [];
  let strictTouchedBorder = false;
  let anyTouchedBorder = false;
  const fullStack: NdviStack = {
    width: side,
    height: side,
    dates: ordered.map((d) => d.ndvi),
    ndmi: ordered.map((d) => d.ndmi),
    vis: ordered.map((d) => d.vis),
  };
  const counts = [...new Set([2, Math.min(3, ordered.length), ordered.length].filter((n) => n <= ordered.length && n >= 1))];
  for (const k of counts) {
    const slice = ordered.slice(0, k);
    const stack: NdviStack = {
      width: side,
      height: side,
      dates: slice.map((d) => d.ndvi),
      ndmi: slice.map((d) => d.ndmi),
      vis: slice.map((d) => d.vis),
    };
    const preGrad = gradient(stack);
    const multiDateBonus = k >= 3 ? 0.02 : 0;
    for (let ladderIdx = 0; ladderIdx < ladder.length; ladderIdx++) {
      const { grow, bonus, strict } = ladder[ladderIdx];
      const growWithGrad = { ...grow, preGrad };
      const r = boundaryFromStack(stack, grid, point, growWithGrad);
      if (r) {
        const sizePenalty = r.areaHa > 135 ? -0.1 : 0;
        raw.push({
          ...r,
          date: ordered[0].t,
          rankScore: r.confidence + bonus + multiDateBonus + sizePenalty,
          stack,
          preGrad,
          ladderIdx,
          grid,
          ladder,
        });
      } else if (growRegion(stack, seed, growWithGrad)?.touchesBorder) {
        anyTouchedBorder = true;
        if (strict) strictTouchedBorder = true;
      }
    }
  }
  return {
    candidates: dedupeCandidates(raw),
    strictTouchedBorder,
    anyTouchedBorder,
    stack: fullStack,
    grid,
    date: ordered[0].t,
    ladder,
  };
}

function dedupeCandidates(raw: ScaleCandidate[]): ScaleCandidate[] {
  const sorted = [...raw].sort((a, b) => b.rankScore - a.rankScore || b.confidence - a.confidence);
  const kept: ScaleCandidate[] = [];
  for (const cand of sorted) {
    const dup = kept.some((k) => {
      const areaRatio = Math.min(k.areaHa, cand.areaHa) / Math.max(k.areaHa, cand.areaHa);
      return areaRatio > 0.78 && polygonIoU(k.polygon, cand.polygon, 90) > 0.72;
    });
    if (!dup) kept.push(cand);
    if (kept.length >= 3) break;
  }
  return kept;
}

/**
 * Open an interactive LabelMe / SAM-style segmentation session around `point`: performs 1-click
 * boundary detection and retains the multi-spectral Sentinel-2 stack in memory so subsequent
 * `+` (include) / `−` (exclude) clicks and regularisation steps run in tens of milliseconds with zero network I/O.
 */
export async function openFieldSession(
  point: LngLat,
  opts: { signal?: AbortSignal; today?: ISODate } = {},
): Promise<FieldPromptSession | null> {
  const today = opts.today ?? todayISO();
  const fine = await candidatesAtScale(point, today, CELL, SIDE, FINE_LADDER, opts.signal);
  let merged = fine.candidates;
  let activeRun = fine;
  const hasSolidFine = merged.some((c) => c.areaHa >= 2 && c.confidence >= 0.7);
  const needWide = (!merged.length && fine.anyTouchedBorder) || (fine.strictTouchedBorder && !hasSolidFine);
  if (needWide) {
    const wide = await candidatesAtScale(point, today, WIDE_CELL, WIDE_SIDE, WIDE_LADDER, opts.signal);
    merged = dedupeCandidates([...merged, ...wide.candidates]);
    if (wide.stack && !activeRun.stack) {
      activeRun = wide;
    }
  }
  const win = merged[0];
  const stack = win?.stack ?? activeRun.stack;
  const date = win?.date ?? activeRun.date;
  if (!stack || !date) return null;
  const preGrad = win?.preGrad ?? gradient(stack);
  const grid = win?.grid ?? activeRun.grid;
  const ladder = win?.ladder ?? activeRun.ladder;
  const winLadderIdx = win?.ladderIdx ?? 1;
  const coslat = Math.cos((point[1] * Math.PI) / 180);
  const [w, s, e, n] = grid.bbox;
  const marginLng = (grid.cellM * 4) / (M_PER_DEG * coslat);
  const marginLat = (grid.cellM * 4) / M_PER_DEG;

  const toColRow = ([lng, lat]: LngLat): [number, number] => [
    Math.min(stack.width - 2, Math.max(1, Math.round(((lng - w) * M_PER_DEG * coslat) / grid.cellM - 0.5))),
    Math.min(stack.height - 2, Math.max(1, Math.round(((n - lat) * M_PER_DEG) / grid.cellM - 0.5))),
  ];

  const candidates: FieldBoundary[] = merged.map(({ polygon, areaHa, confidence, date: d }) => ({
    polygon,
    areaHa,
    confidence,
    date: d,
  }));

  return {
    date,
    candidates,
    contains: ([lng, lat]: LngLat) =>
      lng >= w + marginLng && lng <= e - marginLng && lat >= s + marginLat && lat <= n - marginLat,
    solve: (prompts, solveOpts = {}) => {
      const positives = prompts.filter((p) => p.kind === 'positive').map((p) => toColRow(p.at));
      const negatives = prompts.filter((p) => p.kind === 'negative').map((p) => toColRow(p.at));
      if (!positives.length) return null;
      const baseIdx = Math.min(ladder.length - 1, Math.max(0, winLadderIdx + (solveOpts.rungDelta ?? 0)));
      const regSteps = solveOpts.regularizeSteps ?? 0;
      const tryIndices = [baseIdx, ...ladder.map((_, idx) => idx).filter((idx) => idx !== baseIdx)];
      for (const allowBorder of [false, true]) {
        for (const idx of tryIndices) {
          const res = boundaryFromPrompts(
            stack,
            grid,
            point,
            { positives, negatives },
            { ...ladder[idx].grow, preGrad },
            regSteps,
            allowBorder,
          );
          if (res) return { ...res, date };
        }
      }
      return null;
    },
  };
}

/**
 * Return up to 3 distinct boundary candidates ordered with the highest-confidence parcel first
 * (e.g. single management strip vs full road-bounded block), using one set of cached scenes.
 */
export async function detectFieldCandidates(point: LngLat, opts: { signal?: AbortSignal; today?: ISODate } = {}): Promise<FieldBoundary[]> {
  const session = await openFieldSession(point, opts);
  return session?.candidates ?? [];
}

export async function detectFieldBoundary(point: LngLat, opts: { signal?: AbortSignal; today?: ISODate } = {}): Promise<FieldBoundary | null> {
  const cands = await detectFieldCandidates(point, opts);
  return cands[0] ?? null;
}

/**
 * Up to 4 seasonally diverse dates: peak canopy first, mid-season crop-phenology split second,
 * bare-soil / residue / flooded contrast third, and next best seasonal contrast fourth.
 */
function orderDates(dates: DateLayer[]): DateLayer[] {
  if (dates.length <= 1) return [...dates];
  const peak = [...dates].sort((a, b) => b.meanNdvi - a.meanNdvi)[0];
  const chosen: DateLayer[] = [peak];
  const away = (minDays: number) => dates.filter((d) => !chosen.includes(d) && chosen.every((c) => Math.abs(diffDays(d.t, c.t)) >= minDays));

  const pool2 = away(25).length ? away(25) : dates.filter((d) => !chosen.includes(d));
  if (pool2.length) {
    const midCanopy = pool2.filter((d) => d.meanNdvi >= 0.3);
    const src2 = midCanopy.length ? midCanopy : pool2;
    chosen.push([...src2].sort((a, b) => b.contrast - a.contrast)[0]);
  }

  const pool3 = away(20).length ? away(20) : dates.filter((d) => !chosen.includes(d));
  if (pool3.length) {
    chosen.push([...pool3].sort((a, b) => b.contrast + 0.2 * (peak.meanNdvi - b.meanNdvi) - (a.contrast + 0.2 * (peak.meanNdvi - a.meanNdvi)))[0]);
  }

  const pool4 = away(20).length ? away(20) : dates.filter((d) => !chosen.includes(d));
  if (pool4.length) chosen.push([...pool4].sort((a, b) => b.contrast - a.contrast)[0]);

  return chosen;
}

/** Tuning hook for scripts: the multi-spectral stack the detector would use (peak date first). */
export async function _debugStack(point: LngLat, today: ISODate): Promise<{ stack: NdviStack; dates: string[] }> {
  const grid = windowGrid(point);
  const dates = await stackDates(point, today, grid);
  const set = orderDates(dates);
  return {
    stack: {
      width: SIDE,
      height: SIDE,
      dates: set.map((d) => d.ndvi),
      ndmi: set.map((d) => d.ndmi),
      vis: set.map((d) => d.vis),
    },
    dates: set.map((d) => `${d.t} ndvi=${d.meanNdvi.toFixed(2)} c=${d.contrast.toFixed(2)} v=${d.valid.toFixed(2)}`),
  };
}
