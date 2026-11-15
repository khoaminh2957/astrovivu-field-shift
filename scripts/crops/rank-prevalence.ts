/**
 * The crop ranking with what the country grows (docs/SCORING.md, section 12; tasks K3 and K4).
 *
 * Same four demo fields as the baseline (scripts/crops/rank-baseline.ts), but the model now gets
 * the crop table of the field's country. Prints, per field, the first 15 crops of the main list
 * with their place in the baseline, and the list of crops without reported production.
 *
 *   npx tsx scripts/crops/rank-prevalence.ts   -> data/crops/rank-prevalence.json, and the tables
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getCrop } from '@/core/crops';
import { rankCropLists, type CropRanking } from '@/core/scoring';
import { countryCropsFromAtlas } from './country-crops';
import { BASELINE_FILE, FIELDS, inputFor, ISO3, TOP, type FieldBaseline } from './rank-baseline';

export const PREVALENCE_FILE = 'data/crops/rank-prevalence.json';

export interface RankedRow {
  rank: number;
  cropId: string;
  nameEn: string;
  compatibility: number;
  reliability: number | null;
  rankScore: number;
  status: string;
  level: string;
  sharePct: number | null;
  /** Place among the first 15 of the baseline; null when the crop was not among them. */
  baselineRank: number | null;
}

export interface FieldRanking {
  field: string;
  name: string;
  iso3: string;
  grownCropId: string | null;
  /** Place of the field's own crop in the main list, and in the baseline. */
  grownCropRank: number | null;
  grownCropBaselineRank: number | null;
  mainCount: number;
  main: RankedRow[];
  trial: RankedRow[];
}

const pct = (v: number): number => Math.round(v * 1000) / 10;

export function rows(ranking: CropRanking[], baseline: FieldBaseline, top: number): RankedRow[] {
  return ranking.slice(0, top).map((r, i) => ({
    rank: i + 1,
    cropId: r.cropId,
    nameEn: getCrop(r.cropId)?.names.en ?? r.cropId,
    compatibility: pct(r.compatibility),
    reliability: r.reliability == null ? null : pct(r.reliability),
    rankScore: pct(r.rankScore),
    status: r.prevalence?.status ?? 'unknown',
    level: r.prevalence?.level ?? 'unknown',
    sharePct: r.prevalence?.sharePct ?? null,
    baselineRank: baseline.top.find((b) => b.cropId === r.cropId)?.rank ?? null,
  }));
}

const share = (v: number | null): string => (v == null ? '' : `${v < 0.1 ? v.toFixed(3) : v.toFixed(1)} %`);

export function markdown(fields: FieldRanking[], baseline: FieldBaseline[]): string {
  const lines = ['| Field | Field\'s own crop: baseline place | now | Without reported production among the first 15: baseline | now | Crops in the second list |', '|---|---:|---:|---:|---:|---:|'];
  fields.forEach((f, i) => {
    const own = f.grownCropId ? (getCrop(f.grownCropId)?.names.en ?? f.grownCropId) : '';
    lines.push(`| ${f.name} (${own}) | ${f.grownCropBaselineRank ?? ''} | ${f.grownCropRank ?? 'not in the main list'} | ${baseline[i].counts.absent} | ${f.main.filter((r) => r.status === 'absent').length} | ${f.trial.length} |`);
  });
  for (const f of fields) {
    lines.push('', `**${f.name}** (\`${f.field}\`, ${f.iso3}): main list, ${f.mainCount} crops`, '', '| # | Crop | Compatibility | Reliability | Rank score | In the country | Share of harvested area | Baseline place |', '|---:|---|---:|---:|---:|---|---:|---:|');
    for (const r of f.main) lines.push(`| ${r.rank} | ${r.nameEn} (\`${r.cropId}\`) | ${r.compatibility} | ${r.reliability ?? ''} | ${r.rankScore} | ${r.level} | ${share(r.sharePct)} | ${r.baselineRank ?? ''} |`);
    if (f.trial.length) {
      lines.push('', `Without reported production in the country, compatibility from 60 (${f.trial.length}): ${f.trial.map((r) => `${r.nameEn} ${r.compatibility}`).join(', ')}.`);
    } else lines.push('', 'Without reported production in the country, compatibility from 60: none.');
  }
  return lines.join('\n');
}

function main() {
  const baseline = (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { fields: FieldBaseline[] }).fields;
  const fields = FIELDS.map((id, i): FieldRanking => {
    const input = inputFor(id);
    const iso3 = ISO3[input.parcel.place?.countryCode ?? (input.parcel.isUS ? 'US' : '')];
    const lists = rankCropLists({ ...input, country: countryCropsFromAtlas(iso3) });
    const at = lists.main.findIndex((r) => r.cropId === input.cropId);
    return {
      field: id,
      name: input.parcel.name,
      iso3,
      grownCropId: input.cropId,
      grownCropRank: at < 0 ? null : at + 1,
      grownCropBaselineRank: baseline[i].grownCropRank,
      mainCount: lists.main.length,
      main: rows(lists.main, baseline[i], TOP),
      trial: rows(lists.trial, baseline[i], lists.trial.length),
    };
  });
  writeFileSync(PREVALENCE_FILE, JSON.stringify({ generatedBy: 'scripts/crops/rank-prevalence.ts', comparedWith: BASELINE_FILE, fields }, null, 1) + '\n');
  console.log(markdown(fields, baseline));
  console.error(`\nWrote ${PREVALENCE_FILE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
