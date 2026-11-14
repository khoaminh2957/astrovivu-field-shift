/**
 * Live smoke test of the field rasters: the four demo fields (live path, not the cache) and one
 * arbitrary point. Prints frames, date range, grid, mean coverage and newest mean per raster.
 *
 *   npx tsx scripts/data/smoke-rasters.ts [--frames 12] [--only nevada-alfalfa] [lat,lng]
 */
import type { LngLat, Parcel } from '../../src/contracts';
import { SAMPLE_PARCELS } from '../../src/data';
import { loadLiveRasters } from '../../src/data/rasters';
import { makeParcel, squareForArea } from '../../src/lib/geo';
import { rasterMean } from '../../src/lib/raster';

const args = process.argv.slice(2);
const fi = args.indexOf('--frames');
const maxFrames = fi >= 0 ? Number(args[fi + 1]) : 12;
const oi = args.indexOf('--only');
const only = oi >= 0 ? args[oi + 1] : null;
const pt = args.find((a) => /^-?\d+(\.\d+)?,-?\d/.test(a));
const today = '2026-11-14';

const parcels: Parcel[] = SAMPLE_PARCELS.filter((p) => !only || p.id === only).map((p) => ({ ...p, source: 'quad' as const }));
if (!only || pt) {
  const [lat, lng] = (pt ?? '43.75,4.85').split(',').map(Number);
  const at: LngLat = [lng, lat];
  parcels.push(makeParcel({ id: `pt-${lat},${lng}`, name: `Point ${lat},${lng}`, polygon: squareForArea(at, 4), source: 'quad' }));
}

const rows = [['parcel', 'raster', 'frames', 'first', 'last', 'grid', 'cellM', 'meanCov', 'newestMean', 'range', 's']];
for (const p of parcels) {
  const t0 = Date.now();
  const rs = await loadLiveRasters(p, { today, maxFrames });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  if (!rs.length) rows.push([p.id, '(none)', '0', '', '', '', '', '', '', '', s]);
  for (const r of rs) {
    const cov = r.frames.reduce((a, f) => a + f.coverage, 0) / (r.frames.length || 1);
    const last = r.frames[r.frames.length - 1];
    const m = last ? rasterMean(r, last.t) : null;
    rows.push([p.id, r.key, String(r.frames.length), r.frames[0]?.t ?? '', last?.t ?? '', `${r.width}x${r.height}`, String(r.cellM), cov.toFixed(2), m == null ? '' : m.toFixed(3), r.range.join('..'), s]);
  }
}
const w = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (const r of rows) console.log(r.map((v, c) => v.padEnd(w[c])).join('  '));
