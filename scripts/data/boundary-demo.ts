/**
 * Run the field-boundary detector at the demo centres (and optional lat,lng points) and print
 * area, confidence, vertices and IoU with the traced polygon.
 *   npx tsx scripts/data/boundary-demo.ts [lat,lng ...]
 */
import { SAMPLE_PARCELS } from '../../src/data/samples';
import { detectFieldBoundary } from '../../src/data/boundary';
import { polygonIoU } from '../../src/data/boundary/pure';
import type { LngLat } from '../../src/contracts';

const pts = process.argv.slice(2).filter((a) => /^-?\d/.test(a));
const today = '2026-11-14';
if (pts.length) {
  for (const a of pts) {
    const [lat, lng] = a.split(',').map(Number);
    const b = await detectFieldBoundary([lng, lat] as LngLat, { today });
    console.log(a, b ? `${b.areaHa} ha conf ${b.confidence} verts ${b.polygon.coordinates[0].length - 1} ${b.date}` : 'null');
  }
} else {
  for (const p of SAMPLE_PARCELS) {
    const b = await detectFieldBoundary(p.centroid, { today });
    console.log(p.id, `traced ${p.areaHa.toFixed(2)} ha`, b ? `detected ${b.areaHa} ha conf ${b.confidence} verts ${b.polygon.coordinates[0].length - 1} IoU ${polygonIoU(p.polygon, b.polygon).toFixed(2)} ${b.date}` : 'null');
  }
}
