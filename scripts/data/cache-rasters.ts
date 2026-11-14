/**
 * Write the demo field rasters to `public/data/samples/<id>.rasters.json` (up to 24 frames per
 * dated raster), so demo parcels draw instantly. Responses are cached under `.cache/`.
 *
 *   npx tsx scripts/data/cache-rasters.ts [--frames 24] [--today 2026-11-14] [id ...]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { SAMPLE_PARCELS } from '../../src/data';
import { loadLiveRasters } from '../../src/data/rasters';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const maxFrames = Number(opt('--frames') ?? 24);
const today = opt('--today') ?? '2026-11-14';
const ids = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

await mkdir('public/data/samples', { recursive: true });
for (const p of SAMPLE_PARCELS.filter((s) => !ids.length || ids.includes(s.id))) {
  const t0 = Date.now();
  const rasters = await loadLiveRasters({ ...p, source: 'quad' }, { today, maxFrames });
  const json = JSON.stringify(rasters);
  await writeFile(`public/data/samples/${p.id}.rasters.json`, json);
  console.log(
    p.id.padEnd(16),
    rasters.map((r) => `${r.key}:${r.frames.length}`).join(' ').padEnd(48),
    `${(json.length / 1024).toFixed(0)} kB`,
    `${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}
