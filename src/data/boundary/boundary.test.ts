import { describe, expect, it } from 'vitest';
import { boundaryFromPrompts, boundaryFromStack } from './index';
import { compactness, fillHoles, growRegion, polygonIoU, regularizeRing, ringArea, simplifyRing, traceContour, type NdviStack, type XY } from './pure';

const S = 61;
function stack(inField: (c: number, r: number) => boolean, field = 0.8, around = 0.3): NdviStack {
  const d = new Float32Array(S * S);
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) d[r * S + c] = inField(c, r) ? field : around + ((c * 7 + r * 3) % 5) * 0.005;
  return { width: S, height: S, dates: [d] };
}
const grid = { bbox: [0, -S * 10 / 111_320, S * 10 / 111_320, 0] as [number, number, number, number], cellM: 10 };

describe('field boundary (pure)', () => {
  it('finds a rectangular field: area, few vertices, compact', () => {
    const s = stack((c, r) => c >= 20 && c < 40 && r >= 25 && r < 35); // 200 m x 100 m = 2 ha
    const b = boundaryFromStack(s, grid, [0, 0])!;
    expect(b.areaHa).toBeGreaterThan(1.8);
    expect(b.areaHa).toBeLessThan(2.2);
    expect(b.polygon.coordinates[0].length - 1).toBeLessThanOrEqual(8);
    expect(b.confidence).toBeGreaterThan(0.6);
  });
  it('fits a circle to a centre pivot', () => {
    const s = stack((c, r) => Math.hypot(c - 30, r - 30) < 20);
    const b = boundaryFromStack(s, grid, [0, 0])!;
    expect(b.polygon.coordinates[0].length).toBeGreaterThan(30);
    // Within 6 %: the edge ring of cells is partly lost to the gradient threshold.
    expect(Math.abs(b.areaHa / ((Math.PI * 200 * 200) / 10_000) - 1)).toBeLessThan(0.06);
  });
  it('returns null when the region reaches the window border or is tiny', () => {
    expect(boundaryFromStack(stack((c) => c > 10), grid, [0, 0])).toBeNull();
    expect(boundaryFromStack(stack((c, r) => Math.abs(c - 30) < 2 && Math.abs(r - 30) < 2), grid, [0, 0])).toBeNull();
  });
  it('moves a seed off a tower to the smooth field around it', () => {
    const s = stack((c, r) => Math.hypot(c - 30, r - 30) < 15);
    s.dates[0][30 * S + 30] = 0.1;
    const reg = growRegion(s, [30, 30])!;
    expect(reg.cells).toBeGreaterThan(600);
  });
  it('fills holes and traces a closed contour', () => {
    const m = new Uint8Array(25).fill(0);
    for (let r = 1; r < 4; r++) for (let c = 1; c < 4; c++) m[r * 5 + c] = 1;
    m[12] = 0;
    expect(fillHoles(m, 5, 5)[12]).toBe(1);
    expect(traceContour(fillHoles(m, 5, 5), 5, 5, 10)).toHaveLength(8);
  });
  it('simplifies a dense square to four corners and measures compactness', () => {
    const sq: XY[] = [];
    for (let i = 0; i < 10; i++) sq.push([i, 0]);
    for (let i = 0; i < 10; i++) sq.push([10, i]);
    for (let i = 10; i > 0; i--) sq.push([i, 10]);
    for (let i = 10; i > 0; i--) sq.push([0, i]);
    expect(simplifyRing(sq, 0.5)).toHaveLength(4);
    expect(compactness(simplifyRing(sq, 0.5))).toBeCloseTo(Math.PI / 4, 2);
  });
  it('computes intersection over union', () => {
    const a = { type: 'Polygon' as const, coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] as [number, number][][] };
    const b = { type: 'Polygon' as const, coordinates: [[[1, 0], [3, 0], [3, 1], [1, 1], [1, 0]]] as [number, number][][] };
    expect(polygonIoU(a, b)).toBeCloseTo(1 / 3, 1);
  });
  it('measures large (>100 ha) parcels accurately on a 20 m fallback grid', () => {
    const W = 121;
    const d = new Float32Array(W * W);
    // 60 x 50 cells at 20 m = 1,200 m x 1,000 m = 120 ha
    for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) d[r * W + c] = c >= 30 && c < 90 && r >= 35 && r < 85 ? 0.82 : 0.25 + ((c * 7 + r * 3) % 5) * 0.005;
    const wideGrid = { bbox: [0, -(W * 20) / 111_320, (W * 20) / 111_320, 0] as [number, number, number, number], cellM: 20 };
    const b = boundaryFromStack({ width: W, height: W, dates: [d] }, wideGrid, [0, 0])!;
    expect(b.areaHa).toBeGreaterThan(114);
    expect(b.areaHa).toBeLessThan(126);
    expect(b.confidence).toBeGreaterThan(0.6);
  });
  it('stops at a 1-pixel gravel road or bund between two identical-NDVI fields', () => {
    const ndvi = new Float32Array(S * S);
    const vis = new Float32Array(S * S);
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        const i = r * S + c;
        const leftField = c >= 20 && c < 40 && r >= 22 && r < 38; // 20x16 = 3.2 ha (contains centre [30,30])
        const rightField = c >= 41 && c < 56 && r >= 22 && r < 38; // twin field across 1-pixel road at c=40
        const road = c === 40 && r >= 20 && r < 40;
        ndvi[i] = leftField || rightField ? 0.82 : road ? 0.68 : 0.28;
        vis[i] = road ? 0.34 : 0.12;
      }
    }
    const b = boundaryFromStack({ width: S, height: S, dates: [ndvi], vis: [vis] }, grid, [0, 0])!;
    expect(b).not.toBeNull();
    expect(b.areaHa).toBeGreaterThan(2.9);
    expect(b.areaHa).toBeLessThan(3.5);
    expect(b.polygon.coordinates[0].length - 1).toBeLessThanOrEqual(8);
  });
  it('separates adjacent harvested fields with identical NDVI using NDMI residue contrast', () => {
    const ndviPeak = new Float32Array(S * S);
    const ndviHarvest = new Float32Array(S * S);
    const ndmiPeak = new Float32Array(S * S);
    const ndmiHarvest = new Float32Array(S * S);
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        const i = r * S + c;
        const ours = c >= 18 && c < 38 && r >= 24 && r < 36; // 20x12 = 2.4 ha
        const neighbour = c >= 38 && c < 54 && r >= 24 && r < 36;
        ndviPeak[i] = ours || neighbour ? 0.84 : 0.25;
        ndmiPeak[i] = ours || neighbour ? 0.42 : -0.1;
        ndviHarvest[i] = ours || neighbour ? 0.2 : 0.22;
        ndmiHarvest[i] = ours ? -0.26 : neighbour ? -0.48 : -0.12;
      }
    }
    const b = boundaryFromStack(
      { width: S, height: S, dates: [ndviPeak, ndviHarvest], ndmi: [ndmiPeak, ndmiHarvest] },
      grid,
      [0, 0],
    )!;
    expect(b).not.toBeNull();
    expect(b.areaHa).toBeGreaterThan(2.1);
    expect(b.areaHa).toBeLessThan(2.7);
  });
  it('accepts elongated 6:1 strip paddies via convex solidity with clean corners', () => {
    // 18 x 3 cells at 10 m = 180 m x 30 m = 0.54 ha (Polsby-Popper ~0.38 < 0.45, solidity ~1)
    const s = stack((c, r) => c >= 21 && c < 39 && r >= 29 && r < 32, 0.78, 0.24);
    const b = boundaryFromStack(s, grid, [0, 0])!;
    expect(b).not.toBeNull();
    expect(b.areaHa).toBeGreaterThan(0.45);
    expect(b.areaHa).toBeLessThan(0.65);
    expect(b.polygon.coordinates[0].length - 1).toBeLessThanOrEqual(6);
  });
  it('tolerates a local cloud mask gap on one of four dates', () => {
    const base = stack((c, r) => c >= 20 && c < 40 && r >= 25 && r < 35, 0.8, 0.3).dates[0];
    const cloudy = new Float32Array(base);
    for (let r = 26; r < 32; r++) for (let c = 24; c < 30; c++) cloudy[r * S + c] = NaN;
    const b = boundaryFromStack(
      { width: S, height: S, dates: [base, new Float32Array(base), cloudy, new Float32Array(base)] },
      grid,
      [0, 0],
    )!;
    expect(b).not.toBeNull();
    expect(b.areaHa).toBeGreaterThan(1.8);
    expect(b.areaHa).toBeLessThan(2.2);
  });
  it('merges two strips of a field when a second positive (+) prompt is clicked', () => {
    const d = new Float32Array(S * S);
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        const left = c >= 20 && c < 30 && r >= 20 && r < 40; // 2.0 ha
        const ditch = c === 30 && r >= 20 && r < 40; // 1-cell internal waterway
        const right = c >= 31 && c < 41 && r >= 20 && r < 40; // 2.0 ha
        d[r * S + c] = left || right ? 0.82 : ditch ? 0.62 : 0.25;
      }
    }
    const single = boundaryFromPrompts({ width: S, height: S, dates: [d] }, grid, [0, 0], { positives: [[25, 30]] })!;
    expect(single.areaHa).toBeGreaterThan(1.7);
    expect(single.areaHa).toBeLessThan(2.3);

    const fused = boundaryFromPrompts({ width: S, height: S, dates: [d] }, grid, [0, 0], {
      positives: [
        [25, 30],
        [35, 30],
      ],
    })!;
    expect(fused.areaHa).toBeGreaterThan(3.8);
    expect(fused.areaHa).toBeLessThan(4.5);
  });
  it('cuts an over-segmented neighbour spill along a faint bund when a negative (−) prompt is clicked', () => {
    const d = new Float32Array(S * S);
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        const block = c >= 20 && c < 40 && r >= 20 && r < 40; // 4.0 ha combined
        const faintBund = c === 32 && r >= 20 && r < 40; // subtle bund inside tol
        d[r * S + c] = faintBund ? 0.77 : block ? 0.81 : 0.25;
      }
    }
    const over = boundaryFromPrompts(
      { width: S, height: S, dates: [d] },
      grid,
      [0, 0],
      { positives: [[25, 30]] },
      { tol: 0.1, edge: 0.06 },
    )!;
    expect(over.areaHa).toBeGreaterThan(3.7);

    const cut = boundaryFromPrompts(
      { width: S, height: S, dates: [d] },
      grid,
      [0, 0],
      { positives: [[25, 30]], negatives: [[36, 30]] },
      { tol: 0.1, edge: 0.06 },
    )!;
    // Left sub-plot is 12 x 20 cells = 2.4 ha (right 8 x 20 = 1.6 ha excluded at c=32 bund)
    expect(cut.areaHa).toBeGreaterThan(2.1);
    expect(cut.areaHa).toBeLessThan(2.75);
  });
  it('regularises a wobbly rotated rectangle to four orthogonal corners while preserving area', () => {
    const ang = (22 * Math.PI) / 180;
    const rot = ([x, y]: XY): XY => [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)];
    const wobbly: XY[] = [
      rot([0, 0]),
      rot([95, 4]),
      rot([200, 0]),
      rot([197, 52]),
      rot([200, 100]),
      rot([102, 97]),
      rot([0, 100]),
      rot([3, 48]),
    ];
    const origA = ringArea(wobbly);
    const clean = regularizeRing(wobbly, 18, 12);
    expect(clean.length).toBe(4);
    expect(Math.abs(ringArea(clean) - origA) / origA).toBeLessThan(0.01);
  });
});
