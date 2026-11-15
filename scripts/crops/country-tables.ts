/**
 * The crop table of every country of the crop atlas, as the small files the app loads when a field
 * is opened: `public/data/crops/country/<ISO3>.json` and `index.json` (two-letter code -> country).
 *
 *   npx tsx scripts/crops/country-tables.ts
 *
 * Input: data/crops/atlas/crop_country.csv (the same rows as the "crop_country" sheet of the
 * Google Sheet, docs/CROP_DATA.md) and the GeoNames country list the atlas build downloaded
 * (.cache/atlas/raw/geonames_countryInfo.txt, CC BY 4.0) for the two-letter codes. Nothing is
 * computed here: each record is the atlas row, in the form of `src/data/countryTable.ts`.
 * The output has no date in it, so a second run writes the same bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CropPrevalence, PrevalenceLevel, PrevalenceMatch } from '@/contracts';
import type { CountryIndexFile, CountryTableFile } from '@/data/countryTable';
import { parseCsvObjects } from './atlas/csv';

const ATLAS = 'data/crops/atlas';
const GEONAMES = '.cache/atlas/raw/geonames_countryInfo.txt';
const OUT = 'public/data/crops/country';
const GROWN: PrevalenceLevel[] = ['major', 'common', 'minor', 'present'];

const num = (v: string): number | undefined => (v === '' ? undefined : Number(v));

/** ISO 3166-1 alpha-3 -> alpha-2, from the GeoNames country list (columns: ISO, ISO3, ...). */
export function iso2ByIso3(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (/^[A-Z]{2}$/.test(c[0]) && /^[A-Z]{3}$/.test(c[1])) out.set(c[1], c[0]);
  }
  return out;
}

/** The rows of one country in the form the app loads. Throws on a row the compact form cannot hold. */
export function countryTable(iso3: string, rows: Record<string, string>[]): CountryTableFile {
  const source = rows.find((r) => r.match !== 'national')?.source ?? rows[0].source;
  const file: CountryTableFile = { iso3, country: rows[0].country, source, prevalence: {}, absent: [], group: { reported: [], unreported: [] } };
  for (const r of rows) {
    const level = r.level as PrevalenceLevel;
    const match = r.match as PrevalenceMatch;
    const reported = r.item_reported === 'yes';
    if (GROWN.includes(level) || match === 'national' || r.source !== source) {
      const from = num(r.year_from);
      const to = num(r.year_to);
      const record: CropPrevalence = {
        level,
        match,
        sharePct: num(r.share_of_country_harvested_area_pct),
        rankInCountry: num(r.rank_in_country),
        areaHa: num(r.area_ha),
        productionT: num(r.production_t),
        years: from != null && to != null ? [from, to] : undefined,
        itemReported: reported,
        source: r.source,
      };
      file.prevalence[r.crop_id] = record;
    } else if (level === 'absent' && match === 'exact' && !reported && r.source === source) file.absent.push(r.crop_id);
    else if (level === 'unknown' && match === 'group' && r.source === source) (reported ? file.group.reported : file.group.unreported).push(r.crop_id);
    else throw new Error(`${iso3} ${r.crop_id}: a row with level ${level}, match ${match}, item_reported ${r.item_reported} does not fit the country file`);
  }
  file.absent.sort();
  file.group.reported.sort();
  file.group.unreported.sort();
  return file;
}

/**
 * Every country of the atlas and the index. `iso2` maps three-letter to two-letter codes; left out,
 * it is read from the GeoNames list in the atlas cache (git-ignored, so a test passes its own).
 */
export function buildCountryTables(atlasDir = ATLAS, iso2: Map<string, string> = iso2ByIso3(readFileSync(GEONAMES, 'utf8'))): { files: Map<string, CountryTableFile>; index: CountryIndexFile; withoutIso2: string[] } {
  const byCountry = new Map<string, Record<string, string>[]>();
  for (const r of parseCsvObjects(readFileSync(`${atlasDir}/crop_country.csv`, 'utf8'))) {
    const list = byCountry.get(r.iso3);
    if (list) list.push(r);
    else byCountry.set(r.iso3, [r]);
  }
  const files = new Map<string, CountryTableFile>();
  const countries: CountryIndexFile['countries'] = {};
  const withoutIso2: string[] = [];
  let from = Infinity;
  let to = -Infinity;
  for (const iso3 of [...byCountry.keys()].sort()) {
    const rows = byCountry.get(iso3)!;
    const file = countryTable(iso3, rows);
    files.set(iso3, file);
    for (const p of Object.values(file.prevalence)) {
      if (!p.years) continue;
      from = Math.min(from, p.years[0]);
      to = Math.max(to, p.years[1]);
    }
    const code = iso2.get(iso3);
    if (!code) {
      withoutIso2.push(iso3);
      continue;
    }
    countries[code] = { iso3, name: file.country, hash: createHash('sha1').update(serialise(file)).digest('hex').slice(0, 8), grown: Object.keys(file.prevalence).length };
  }
  return { files, index: { source: files.values().next().value!.source, years: [from, to], countries }, withoutIso2 };
}

const serialise = (v: unknown): string => `${JSON.stringify(v)}\n`;

function main(): void {
  if (!existsSync(GEONAMES)) throw new Error(`${GEONAMES} is missing: run the atlas build once (npx tsx scripts/crops/atlas/build.ts), it downloads the file`);
  const { files, index, withoutIso2 } = buildCountryTables();
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith('.json')) rmSync(path.join(OUT, f));
  let bytes = 0;
  for (const [iso3, file] of files) {
    const text = serialise(file);
    writeFileSync(path.join(OUT, `${iso3}.json`), text);
    bytes += text.length;
  }
  writeFileSync(path.join(OUT, 'index.json'), serialise(index));
  console.log(`${files.size} countries, ${Object.keys(index.countries).length} with a two-letter code, ${bytes} bytes; period ${index.years.join('-')}; source ${index.source}`);
  if (withoutIso2.length) console.log(`no two-letter code in GeoNames, left out of the index: ${withoutIso2.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/crops/country-tables.ts')) main();
