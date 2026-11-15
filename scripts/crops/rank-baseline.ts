/**
 * Baseline of the crop ranking, taken before country prevalence enters it (docs/PLAN.md, K1).
 *
 * For each of the four demo fields: the 15 crops `rankCrops` puts first, with score and limiting
 * factor, and beside each how much of it the field's country grows according to the crop atlas
 * (data/crops/atlas/crop_country.csv). The ranking does not read the atlas; this script only puts
 * the two side by side, so that later changes to the ranking (K3, K4, K5) have something to be
 * measured against.
 *
 *   npx tsx scripts/crops/rank-baseline.ts            prints the tables of docs/SCORING.md, section 11
 *   npx tsx scripts/crops/rank-baseline.ts --write    also overwrites data/crops/rank-baseline.json
 *
 * The committed file is the ranking as it was on commit c11874c, before prevalence and the new
 * tie-break (section 12): it is what later work is compared with, so it is overwritten on request
 * only. `scripts/crops/rank-prevalence.ts` prints the ranking as it is now.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getCrop } from '@/core/crops';
import { rankCrops, type CropRanking } from '@/core/scoring';
import { getSampleParcel } from '@/data/samples';
import { parseCsvObjects } from './atlas/csv';

export const BASELINE_FILE = 'data/crops/rank-baseline.json';
export const FIELDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
export const TOP = 15;
/** The telemetry window of the demo caches ends on this day (AGENTS.md). */
const TODAY = '2026-11-14';
/** The demo fields lie in two countries. The app's general conversion of country codes is decided in K2. */
export const ISO3: Record<string, string> = { VN: 'VNM', US: 'USA' };

/** How much of a crop a country grows: a level of the atlas, or why the atlas has none. */
export type Prevalence = 'major' | 'common' | 'minor' | 'present' | 'absent' | 'unknown' | 'no-item' | 'not-in-atlas';

export interface Atlas {
  /** crop_id -> match (exact, group, none). */
  match: Map<string, string>;
  /** `${crop_id}|${iso3}` -> level and share of the country's harvested area. */
  country: Map<string, { level: string; sharePct: number | null }>;
}

export function readAtlas(dir = 'data/crops/atlas'): Atlas {
  const match = new Map(parseCsvObjects(readFileSync(`${dir}/crops.csv`, 'utf8')).map((c) => [c.crop_id, c.match]));
  const country = new Map(
    parseCsvObjects(readFileSync(`${dir}/crop_country.csv`, 'utf8')).map((r) => [
      `${r.crop_id}|${r.iso3}`,
      { level: r.level, sharePct: r.share_of_country_harvested_area_pct === '' ? null : Number(r.share_of_country_harvested_area_pct) },
    ]),
  );
  return { match, country };
}

/**
 * The atlas level of a crop in a country. Two cases have no level: the atlas attaches the crop to
 * no FAOSTAT item (`no-item`: forage and cover crops, leafy vegetables), or does not keep it.
 */
export function prevalence(atlas: Atlas, cropId: string, iso3: string): { prevalence: Prevalence; sharePct: number | null } {
  const match = atlas.match.get(cropId);
  if (match == null) return { prevalence: 'not-in-atlas', sharePct: null };
  if (match === 'none') return { prevalence: 'no-item', sharePct: null };
  const row = atlas.country.get(`${cropId}|${iso3}`);
  return row ? { prevalence: row.level as Prevalence, sharePct: row.sharePct } : { prevalence: 'not-in-atlas', sharePct: null };
}

export interface BaselineRow {
  rank: number;
  cropId: string;
  nameEn: string;
  nameVi: string;
  /** 0-100. */
  compatibility: number;
  /** Share of analysed years that met the crop's needs, 0-100; null without a climate history. */
  reliability: number | null;
  /** compatibility x (0.5 + 0.5 reliability), 0-100: what the list is sorted by. */
  rankScore: number;
  bestSowingMonth: number;
  limiting: string | null;
  match: string | null;
  prevalence: Prevalence;
  sharePct: number | null;
}

export interface FieldBaseline {
  field: string;
  name: string;
  iso3: string;
  /** The crop the field grows now, and where the ranking puts it (1 = first). */
  grownCropId: string | null;
  grownCropRank: number | null;
  ranked: number;
  /** Crops with a compatibility of 100, in the whole ranking. */
  compatibility100: number;
  /** Crops that share the highest rank score: among them the order is alphabetical. */
  tiedForFirst: number;
  top: BaselineRow[];
  /** Of the top rows: how many the country does not grow, how many the atlas cannot tell. */
  counts: Record<Prevalence, number>;
}

const pct = (v: number): number => Math.round(v * 1000) / 10;

export function fieldBaseline(field: string, name: string, iso3: string, grownCropId: string | null, ranking: CropRanking[], atlas: Atlas, top = TOP): FieldBaseline {
  const rows = ranking.slice(0, top).map((r, i): BaselineRow => {
    const crop = getCrop(r.cropId);
    return {
      rank: i + 1,
      cropId: r.cropId,
      nameEn: crop?.names.en ?? r.cropId,
      nameVi: crop?.names.vi ?? r.cropId,
      compatibility: pct(r.compatibility),
      reliability: r.reliability == null ? null : pct(r.reliability),
      rankScore: pct(r.rankScore),
      bestSowingMonth: r.bestSowingMonth,
      limiting: r.limiting,
      match: atlas.match.get(r.cropId) ?? null,
      ...prevalence(atlas, r.cropId, iso3),
    };
  });
  const counts: Record<Prevalence, number> = { major: 0, common: 0, minor: 0, present: 0, absent: 0, unknown: 0, 'no-item': 0, 'not-in-atlas': 0 };
  for (const row of rows) counts[row.prevalence]++;
  const grownAt = grownCropId ? ranking.findIndex((r) => r.cropId === grownCropId) : -1;
  return {
    field,
    name,
    iso3,
    grownCropId,
    grownCropRank: grownAt < 0 ? null : grownAt + 1,
    ranked: ranking.length,
    compatibility100: ranking.filter((r) => r.compatibility >= 1).length,
    tiedForFirst: ranking.length ? ranking.filter((r) => r.rankScore === ranking[0].rankScore).length : 0,
    top: rows,
    counts,
  };
}

/** The demo field as the app scores it: its cached telemetry and the practice it is opened with. */
export function inputFor(id: string): ModelInput {
  const parcel = getSampleParcel(id);
  if (!parcel) throw new Error(`No demo field ${id}`);
  const defaults = (parcel as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth ?? {};
  const telemetry = JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;
  return { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: { ...defaults }, priorities: ['profit', 'water', 'soil'], today: TODAY };
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function markdown(fields: FieldBaseline[]): string {
  const lines: string[] = [];
  lines.push('| Field | Country | Ranked | At compatibility 100 | Tied for first | Field\'s own crop | Top 15: grown | absent | unknown (group) | no FAOSTAT item |', '|---|---|---:|---:|---:|---|---:|---:|---:|---:|');
  for (const f of fields) {
    const grown = f.counts.major + f.counts.common + f.counts.minor + f.counts.present;
    const own = f.grownCropId ? `${getCrop(f.grownCropId)?.names.en ?? f.grownCropId}: rank ${f.grownCropRank ?? 'not ranked'}` : '';
    lines.push(`| ${f.name} | ${f.iso3} | ${f.ranked} | ${f.compatibility100} | ${f.tiedForFirst} | ${own} | ${grown} | ${f.counts.absent} | ${f.counts.unknown} | ${f.counts['no-item']} |`);
  }
  for (const f of fields) {
    lines.push('', `**${f.name}** (\`${f.field}\`, ${f.iso3})`, '', '| # | Crop | Compatibility | Reliability | Rank score | Best sowing | Limiting factor | Atlas match | In the country | Share of harvested area |', '|---:|---|---:|---:|---:|---|---|---|---|---:|');
    for (const r of f.top) {
      const share = r.sharePct == null ? '' : `${r.sharePct < 0.1 ? r.sharePct.toFixed(3) : r.sharePct.toFixed(1)} %`;
      lines.push(`| ${r.rank} | ${r.nameEn} (\`${r.cropId}\`) | ${r.compatibility} | ${r.reliability ?? ''} | ${r.rankScore} | ${MONTH[r.bestSowingMonth - 1] ?? ''} | ${r.limiting ?? 'none'} | ${r.match ?? ''} | ${r.prevalence} | ${share} |`);
    }
  }
  return lines.join('\n');
}

function commit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null; // not a git checkout
  }
}

function main() {
  const atlas = readAtlas();
  const fields = FIELDS.map((id) => {
    const input = inputFor(id);
    const code = input.parcel.place?.countryCode ?? (input.parcel.isUS ? 'US' : '');
    const iso3 = ISO3[code];
    if (!iso3) throw new Error(`${id}: no ISO 3166-1 alpha-3 code for country "${code}"`);
    return fieldBaseline(id, input.parcel.name, iso3, input.cropId, rankCrops(input), atlas);
  });
  const out = {
    generatedBy: 'scripts/crops/rank-baseline.ts',
    today: TODAY,
    commit: commit(),
    note: 'Ranking of the curated crops by rankCrops (climate and soil at the field only), next to the atlas level of each crop in the field\'s country. Taken before prevalence enters the ranking.',
    fields,
  };
  console.log(markdown(fields));
  if (process.argv.includes('--write')) {
    writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 1) + '\n');
    console.error(`\nWrote ${BASELINE_FILE} (commit ${out.commit ?? 'unknown'}).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
