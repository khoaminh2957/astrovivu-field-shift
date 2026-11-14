import { describe, expect, it } from 'vitest';
import { boundaryFromStack } from './index';
import { compactness, fillHoles, growRegion, polygonIoU, simplifyRing, traceContour, type NdviStack, type XY } from './pure';

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
});
