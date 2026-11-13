/**
 * Opt-in live smoke test: loads telemetry for arbitrary non-demo points through the live
 * adapters and prints one row per branch.
 *
 *   npx tsx scripts/data/smoke.ts                 # Kenya highlands + southern France
 *   npx tsx scripts/data/smoke.ts 12.5,107.9      # any lat,lng
 *   add --no-cache to bypass .cache/
 */
import type { FieldTelemetry, LngLat } from '../../src/contracts';
import { BRANCHES, pick } from '../../src/contracts';
import { loadTelemetry } from '../../src/data';
import { setCacheEnabled } from '../../src/data/cache';
import { latestDate } from '../../src/data/build';
import { makeParcel, squareForArea } from '../../src/lib/geo';
import { todayISO } from '../../src/lib/time';

const args = process.argv.slice(2);
if (args.includes('--no-cache')) setCacheEnabled(false);
const pts: { name: string; at: LngLat }[] = args
  .filter((a) => /^-?\d/.test(a))
  .map((a) => {
    const [lat, lng] = a.split(',').map(Number);
    return { name: a, at: [lng, lat] as LngLat };
  });
if (pts.length === 0) {
  pts.push({ name: 'Kenya highlands (Nyeri)', at: [36.95, -0.42] }, { name: 'Southern France (Provence)', at: [4.85, 43.75] });
}

function table(t: FieldTelemetry, firstAt: Record<string, number>): string {
  const rows = [['branch', 'status', 'sources', 'series', 'samples', 'latest', 'facts', 'conf', 'first(s)']];
  for (const b of BRANCHES) {
    const br = t.branches[b];
    const samples = br.series.reduce((a, s) => a + s.samples.filter((x) => x.v != null).length, 0);
    const latest = br.series.map((s) => latestDate(s.samples)).filter(Boolean).sort().pop() ?? '-';
    rows.push([
      b,
      br.status,
      br.sources.join('+') || '-',
      String(br.series.length),
      String(samples),
      latest,
      String(br.facts.filter((f) => f.value != null).length),
      `${br.confidence.level} ${br.confidence.score}`,
      firstAt[b] != null ? firstAt[b].toFixed(1) : '-',
    ]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => '| ' + r.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |').join('\n');
}

for (const p of pts) {
  const parcel = makeParcel({ id: `smoke-${p.at.join('_')}`, name: p.name, polygon: squareForArea(p.at, 2), source: 'coords' });
  const t0 = Date.now();
  const firstAt: Record<string, number> = {};
  const t = await loadTelemetry(parcel, {
    mode: 'live',
    today: todayISO(),
    onProgress: (_partial, branch) => {
      firstAt[branch] ??= (Date.now() - t0) / 1000;
    },
  });
  console.log(`\n## ${p.name} (${p.at[1]}, ${p.at[0]}) - ${((Date.now() - t0) / 1000).toFixed(1)} s, mode ${t.mode}, elevation ${parcel.elevationM ?? '?'} m`);
  console.log(table(t, firstAt));
  console.log(`climateHistory: ${t.climateHistory?.length ?? 0} years (${t.climateSourceId ?? '-'})`);
  for (const b of BRANCHES) for (const n of t.branches[b].notes ?? []) console.log(`  [${b}] ${pick(n, 'en')}`);
  const ok = BRANCHES.filter((b) => t.branches[b].status !== 'unavailable' && !t.branches[b].sources.includes('sim')).length;
  console.log(`branches ok/partial with real sources: ${ok}/8`);
}
