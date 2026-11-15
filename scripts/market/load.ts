/**
 * Loads the market data into Supabase: three tables of the crop atlas (crops, items,
 * crop_country), the crop-to-item link, and FAOSTAT producer prices of the atlas items.
 *
 *   npx tsx scripts/market/load.ts --dry-run     read and count everything, write nothing
 *   npx tsx scripts/market/load.ts               annual prices
 *   npx tsx scripts/market/load.ts --monthly     annual and monthly prices
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in `.env` or the environment). The service
 * role key bypasses row level security: it belongs on a developer machine or in a CI secret, never
 * in browser code. Rows are upserted on their primary key, and crops and items that the atlas no
 * longer holds are deleted (their links, country rows and prices go with them), so after a run the
 * database holds the atlas of the repository and a second run changes nothing.
 * Schema and policies: supabase/migrations/. Description: docs/DATABASE.md.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { errText } from '@/data/build';
import { getJson, getText, mapLimit } from '@/data/http';
import { parseCsvObjects } from '../crops/atlas/csv';
import { AREAS_FILE, CHINA_AGGREGATE, FIRST_AGGREGATE_CODE } from './areas';
import { ATLAS_DIR, countryCodes, readAtlas, type Atlas, type CropItem, type Row } from './atlas';
import { bareCode, FAOSTAT, FAOSTAT_BULK, faostatRows, faostatZip } from './faostat';

const ANNUAL = 7021;
const BATCH = 2000;
const FAOSTAT_LICENCE = 'CC BY 4.0 (FAO Statistical Database Terms of Use, https://www.fao.org/contact-us/terms/db-terms-of-use/en/)';

/** FAOSTAT element code -> the value column and the flag column of `producer_prices`. */
const MEASURES: Record<string, [value: keyof PriceRow, flag: keyof PriceRow]> = {
  '5530': ['lcu_per_tonne', 'lcu_flag'],
  '5531': ['slc_per_tonne', 'slc_flag'],
  '5532': ['usd_per_tonne', 'usd_flag'],
  '5539': ['price_index', 'index_flag'],
};

export interface PriceRow {
  area_code: number;
  faostat_item_code: number;
  year: number;
  /** 0 = annual value, 1-12 = month. */
  month: number;
  lcu_per_tonne: number | null;
  slc_per_tonne: number | null;
  usd_per_tonne: number | null;
  price_index: number | null;
  lcu_flag: string | null;
  slc_flag: string | null;
  usd_flag: string | null;
  index_flag: string | null;
}

export interface AreaRow {
  area_code: number;
  m49_code: string;
  name: string;
  /** Null for an area that is not an atlas country (a former state, for example). */
  iso3: string | null;
}

/** FAOSTAT month codes: 7021 is the annual value, 7001-7012 are January to December. */
export const monthOf = (code: number): number | null => (code === ANNUAL ? 0 : code >= 7001 && code <= 7012 ? code - 7000 : null);

export function readAreas(file = AREAS_FILE): AreaRow[] {
  return parseCsvObjects(readFileSync(file, 'utf8')).map((a) => ({ area_code: Number(a.area_code), m49_code: a.m49_code, name: a.name, iso3: a.iso3 || null }));
}

export interface MarketData {
  areas: AreaRow[];
  items: Row[];
  crops: Row[];
  cropItems: CropItem[];
  cropCountry: Row[];
  prices: PriceRow[];
  skipped: { aggregateAreas: number; otherItems: number; monthly: number; noValue: number };
}

/** Everything the database holds, assembled from the atlas, the area list and one pass over the FAOSTAT price file. */
export async function assemble(priceRows: AsyncIterable<Record<string, string>>, opts: { monthly: boolean }, atlas: Atlas = readAtlas()): Promise<MarketData> {
  const areas = new Map(readAreas().map((a) => [a.area_code, a]));
  const itemCodes = new Set(atlas.items.map((i) => Number(i.faostat_item_code)));

  // The foreign keys of the database, checked here so that a mismatch names its cause.
  for (const link of atlas.cropItems) if (!itemCodes.has(link.faostat_item_code)) throw new Error(`${link.crop_id}: item ${link.faostat_item_code} is not in ${ATLAS_DIR}/items.csv`);
  const known = new Set([...areas.values()].map((a) => a.iso3));
  const unknown = [...countryCodes(atlas.cropCountry)].filter(([, iso3]) => !known.has(iso3)).map(([name]) => name);
  if (unknown.length) throw new Error(`Atlas countries without a FAOSTAT area in ${AREAS_FILE}: ${unknown.join(', ')}. Run npm run market:areas`);

  const prices = new Map<string, PriceRow>();
  const skipped = { aggregateAreas: 0, otherItems: 0, monthly: 0, noValue: 0 };
  for await (const r of priceRows) {
    const area = Number(r['Area Code']);
    if (area >= FIRST_AGGREGATE_CODE || area === CHINA_AGGREGATE) {
      skipped.aggregateAreas++;
      continue;
    }
    const item = Number(r['Item Code']);
    if (!itemCodes.has(item)) {
      skipped.otherItems++;
      continue;
    }
    const month = monthOf(Number(r['Months Code']));
    if (month == null || (month > 0 && !opts.monthly)) {
      skipped.monthly++;
      continue;
    }
    const measure = MEASURES[r['Element Code']];
    const value = r.Value === '' ? NaN : Number(r.Value);
    if (!measure || !Number.isFinite(value)) {
      skipped.noValue++;
      continue;
    }
    // A country that reports prices but no production is not in the area list: it has no atlas country either.
    if (!areas.has(area)) areas.set(area, { area_code: area, m49_code: bareCode(r['Area Code (M49)']), name: r.Area, iso3: null });
    const year = Number(r.Year);
    const key = `${area}:${item}:${year}:${month}`;
    let row = prices.get(key);
    if (!row) {
      row = { area_code: area, faostat_item_code: item, year, month, lcu_per_tonne: null, slc_per_tonne: null, usd_per_tonne: null, price_index: null, lcu_flag: null, slc_flag: null, usd_flag: null, index_flag: null };
      prices.set(key, row);
    }
    (row[measure[0]] as number) = value;
    (row[measure[1]] as string | null) = r.Flag || null;
  }

  return {
    areas: [...areas.values()].sort((a, b) => a.area_code - b.area_code),
    items: atlas.items,
    crops: atlas.crops,
    cropItems: atlas.cropItems,
    cropCountry: atlas.cropCountry,
    prices: [...prices.values()],
    skipped,
  };
}

// ------------------------------------------------------------------------------------------------
// Where the rows come from
// ------------------------------------------------------------------------------------------------

export interface SourceRow {
  code: string;
  name: string;
  publisher: string;
  url: string;
  licence: string | null;
  accessed_on: string | null;
  sha256: string | null;
  released_on: string | null;
  row_count: number | null;
  notes: string | null;
}

/** The sources of the atlas, as its build recorded them (data/crops/atlas/sources.csv). */
export function atlasSources(dir = ATLAS_DIR): SourceRow[] {
  return parseCsvObjects(readFileSync(`${dir}/sources.csv`, 'utf8')).map((s) => ({
    code: s.source,
    name: s.title,
    publisher: s.publisher,
    url: s.url,
    licence: s.licence || null,
    accessed_on: s.accessed || null,
    sha256: s.sha256 || null,
    released_on: null,
    row_count: null,
    notes: s.rows_used ? `Used by the crop atlas: ${s.rows_used}` : 'Used by the crop atlas.',
  }));
}

/** Checksum and modification time of a file, read through one handle so that both describe the same bytes. */
async function fileFacts(file: string): Promise<{ sha256: string; modified: Date }> {
  const handle = await open(file, 'r');
  try {
    const modified = (await handle.stat()).mtime;
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    return { sha256: hash.digest('hex'), modified };
  } finally {
    await handle.close();
  }
}

/** Calendar date of a moment in local time (toISOString would give the UTC date, a day early in the small hours of UTC+7). */
const localDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Release dates as FAOSTAT publishes them in its bulk catalogue; empty when the catalogue cannot be read. */
async function releaseDates(): Promise<Record<string, string | null>> {
  try {
    const j = await getJson<{ Datasets: { Dataset: { DatasetCode: string; DateUpdate: string }[] } }>(`${FAOSTAT_BULK}/datasets_E.json`, { timeoutMs: 60_000, retries: 2 });
    return Object.fromEntries(j.Datasets.Dataset.map((d) => [d.DatasetCode, d.DateUpdate?.slice(0, 10) ?? null]));
  } catch (e) {
    console.warn(`FAOSTAT catalogue not readable (${errText(e)}): release dates stay empty.`);
    return {};
  }
}

// ------------------------------------------------------------------------------------------------
// Writing through the Data API (PostgREST)
// ------------------------------------------------------------------------------------------------

function loadDotEnv(): void {
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env: the variables must come from the environment
  }
}

interface Api {
  base: string;
  key: string;
}
const headers = (api: Api): Record<string, string> => ({ apikey: api.key, Authorization: `Bearer ${api.key}` });

async function upsert(api: Api, table: string, conflict: string, rows: object[]): Promise<void> {
  const batches: object[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  let done = 0;
  await mapLimit(batches, 4, async (batch) => {
    await getText(`${api.base}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      timeoutMs: 120_000,
      retries: 3,
      headers: { ...headers(api), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    done += batch.length;
    if (batches.length > 10 && done % (BATCH * 25) < BATCH) console.log(`  ${table}: ${done.toLocaleString('en')} of ${rows.length.toLocaleString('en')}`);
  });
  console.log(`  ${table}: ${rows.length.toLocaleString('en')} rows`);
}

/** Deletes the rows of a table whose key the atlas no longer holds. The tables that refer to them follow (on delete cascade). */
async function prune(api: Api, table: string, column: string, keep: Set<string>): Promise<void> {
  const stale: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await getJson<Record<string, string | number>[]>(`${api.base}/rest/v1/${table}?select=${column}&order=${column}&limit=${PAGE}&offset=${offset}`, { timeoutMs: 60_000, retries: 3, headers: headers(api) });
    for (const row of page) if (!keep.has(String(row[column]))) stale.push(String(row[column]));
    if (page.length < PAGE) break;
  }
  for (let i = 0; i < stale.length; i += 50) {
    const list = stale.slice(i, i + 50).map((v) => `"${v.replaceAll('"', '\\"')}"`).join(',');
    await getText(`${api.base}/rest/v1/${table}?${column}=in.(${encodeURIComponent(list)})`, { method: 'DELETE', timeoutMs: 60_000, retries: 3, headers: { ...headers(api), Prefer: 'return=minimal' } });
  }
  if (stale.length) console.log(`  ${table}: ${stale.length} rows no longer in the atlas deleted`);
}

/** The same for the crop-to-item links of crops that are still there but changed items. */
async function pruneLinks(api: Api, keep: CropItem[]): Promise<void> {
  const wanted = new Set(keep.map((l) => `${l.crop_id}:${l.faostat_item_code}`));
  const existing = await getJson<CropItem[]>(`${api.base}/rest/v1/crop_items?select=crop_id,faostat_item_code&order=crop_id,faostat_item_code&limit=1000`, { timeoutMs: 60_000, retries: 3, headers: headers(api) });
  const stale = existing.filter((l) => !wanted.has(`${l.crop_id}:${l.faostat_item_code}`));
  for (const l of stale) {
    await getText(`${api.base}/rest/v1/crop_items?crop_id=eq.${encodeURIComponent(l.crop_id)}&faostat_item_code=eq.${l.faostat_item_code}`, { method: 'DELETE', timeoutMs: 60_000, retries: 3, headers: { ...headers(api), Prefer: 'return=minimal' } });
  }
  if (stale.length) console.log(`  crop_items: ${stale.length} links no longer in the atlas deleted`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const monthly = process.argv.includes('--monthly');
  loadDotEnv();
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!base || !key)) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run).');
    process.exit(1);
  }

  console.log(`Reading the crop atlas and FAOSTAT ${FAOSTAT.prices.code} (${monthly ? 'annual and monthly' : 'annual'} prices) ...`);
  const zip = await faostatZip(FAOSTAT.prices);
  const data = await assemble(faostatRows(zip), { monthly });
  const priced = new Set(data.prices.map((p) => p.faostat_item_code));
  const linked = new Set(data.cropItems.map((l) => l.crop_id));
  console.log(
    `${data.crops.length} crops (${data.crops.length - linked.size} without a FAOSTAT item), ${data.items.length} items (${data.items.filter((i) => !priced.has(Number(i.faostat_item_code))).length} without a price), ` +
      `${data.cropItems.length} crop-item links, ${data.cropCountry.length.toLocaleString('en')} crop-country rows, ${data.areas.length} areas, ${data.prices.length.toLocaleString('en')} price rows.`,
  );
  console.log(`Not loaded: ${data.skipped.aggregateAreas.toLocaleString('en')} values of regional aggregates, ${data.skipped.otherItems.toLocaleString('en')} of items that are not atlas items, ${data.skipped.monthly.toLocaleString('en')} monthly, ${data.skipped.noValue} without a number.`);
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  const released = await releaseDates();
  const priceFile = await fileFacts(zip);
  const loaded_at = new Date().toISOString();
  const sources = [
    ...atlasSources(),
    {
      code: 'faostat-pp',
      name: `FAOSTAT, ${FAOSTAT.prices.name}, bulk download, normalized`,
      publisher: 'FAO',
      url: `${FAOSTAT_BULK}/${FAOSTAT.prices.file}`,
      licence: FAOSTAT_LICENCE,
      accessed_on: localDate(priceFile.modified),
      sha256: priceFile.sha256,
      released_on: released[FAOSTAT.prices.code] ?? null,
      row_count: data.prices.length,
      notes: monthly ? 'Annual and monthly producer prices of the atlas items.' : 'Annual producer prices of the atlas items.',
    },
  ].map((s) => ({ ...s, loaded_at }));

  const api: Api = { base: base!, key: key! };
  console.log(`Writing to ${new URL(api.base).host} ...`);
  // Parents before children: the foreign keys are checked on every batch.
  await upsert(api, 'data_sources', 'code', sources);
  await upsert(api, 'areas', 'area_code', data.areas);
  await upsert(api, 'items', 'faostat_item_code', data.items);
  await upsert(api, 'crops', 'crop_id', data.crops);
  await prune(api, 'crops', 'crop_id', new Set(data.crops.map((c) => String(c.crop_id))));
  await prune(api, 'items', 'faostat_item_code', new Set(data.items.map((i) => String(i.faostat_item_code))));
  await upsert(api, 'crop_items', 'crop_id,faostat_item_code', data.cropItems);
  await pruneLinks(api, data.cropItems);
  await upsert(api, 'crop_country', 'crop_id,iso3', data.cropCountry);
  await upsert(api, 'producer_prices', 'area_code,faostat_item_code,year,month', data.prices);
  console.log('Done.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
