/**
 * Run the field-boundary detector at the demo centres (and optional lat,lng points) and print
 * primary boundary, alternative candidates, confidence, vertices and IoU with traced polygons.
 *   npx tsx scripts/data/boundary-demo.ts [lat,lng ...]
 */
import { SAMPLE_PARCELS } from '../../src/data/samples';
import { detectFieldCandidates } from '../../src/data/boundary';
import { polygonIoU } from '../../src/data/boundary/pure';
import type { LngLat } from '../../src/contracts';

const pts = process.argv.slice(2).filter((a) => /^-?\d/.test(a));
const today = '2026-11-14';
if (pts.length) {
  for (const a of pts) {
    const [lat, lng] = a.split(',').map(Number);
    const cands = await detectFieldCandidates([lng, lat] as LngLat, { today });
    const b = cands[0];
    const alts = cands.slice(1).map((c) => `${c.areaHa}ha(${c.confidence})`).join(', ');
    console.log(
      a,
      b
        ? `${b.areaHa} ha conf ${b.confidence} verts ${b.polygon.coordinates[0].length - 1} ${b.date}${alts ? ` | alts: [${alts}]` : ''}`
        : 'null',
    );
  }
} else {
  for (const p of SAMPLE_PARCELS) {
    const cands = await detectFieldCandidates(p.centroid, { today });
    const b = cands[0];
    const alts = cands
      .slice(1)
      .map((c) => `${c.areaHa}ha(IoU ${polygonIoU(p.polygon, c.polygon).toFixed(2)})`)
      .join(', ');
    console.log(
      p.id,
      `traced ${p.areaHa.toFixed(2)} ha`,
      b
        ? `detected ${b.areaHa} ha conf ${b.confidence} verts ${b.polygon.coordinates[0].length - 1} IoU ${polygonIoU(p.polygon, b.polygon).toFixed(2)} ${b.date}${alts ? ` | alts: [${alts}]` : ''}`
        : 'null',
    );
  }
}
