/**
 * Loads the market data into Supabase: the crop atlas, its link to FAOSTAT items, the producing
 * countries, and FAOSTAT producer prices of the linked items.
 *
 *   npx tsx scripts/market/load.ts --dry-run     read and count everything, write nothing
 *   npx tsx scripts/market/load.ts               annual prices
 *   npx tsx scripts/market/load.ts --monthly     annual and monthly prices
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in `.env` or the environment). The service
 * role key bypasses row level security: it belongs on a developer machine or in a CI secret, never
 * in browser code. Rows are upserted on their primary key, so a second run changes nothing.
 * Schema and policies: supabase/migrations/. Description: docs/DATABASE.md.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';
import { errText } from '@/data/build';
import { getJson, getText, mapLimit } from '@/data/http';
import { readAtlas, type CropRow } from './atlas';
import { bareCode, FAOSTAT, FAOSTAT_BULK, faostatRows, faostatZip } from './faostat';
import { AREAS_FILE, isResidualItem, MAPPING_FILE } from './match-faostat';

const CHINA_AGGREGATE = 351;
const FIRST_AGGREGATE_CODE = 5000;
const ANNUAL = 7021;
const BATCH = 2000;

/** FAOSTAT element code -> the value column and the flag column of `producer_prices`. */
const MEASURES: Record<string, [value: keyof PriceRow, flag: keyof PriceRow]> = {
  '5530': ['lcu_per_tonne', 'lcu_flag'],
  '5531': ['slc_per_tonne', 'slc_flag'],
  '5532': ['usd_per_tonne', 'usd_flag'],
  '5539': ['price_index', 'index_flag'],
};

export interface PriceRow {
  area_code: number;
  item_code: number;
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

interface Mapping {
  crop_id: string;
  item_code: number;
  cpc_code: string;
  faostat_item: string;
  match_method: string;
  tie_note: string;
}

const csv = <T>(file: string): T[] => Papa.parse<T>(readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true }).data;

export function readMapping(file = MAPPING_FILE): Mapping[] {
  return csv<Record<string, string>>(file).map((r) => ({ crop_id: r.crop_id, item_code: Number(r.item_code), cpc_code: r.cpc_code, faostat_item: r.faostat_item, match_method: r.match_method, tie_note: r.tie_note }));
}

/** FAOSTAT month codes: 7021 is the annual value, 7001-7012 are January to December. */
export const monthOf = (code: number): number | null => (code === ANNUAL ? 0 : code >= 7001 && code <= 7012 ? code - 7000 : null);

export interface MarketData {
  areas: { area_code: number; m49_code: string; name: string }[];
  items: { item_code: number; cpc_code: string | null; name: string; is_residual: boolean }[];
  crops: CropRow[];
  links: { crop_id: string; item_code: number; match_method: string; tie_note: string | null }[];
  cropCountries: { crop_id: string; area_code: number }[];
  prices: PriceRow[];
  skipped: { aggregateAreas: number; otherItems: number; monthly: number; noValue: number };
}

/** Everything the database holds, assembled from the atlas, the mapping and one pass over the FAOSTAT price file. */
export async function assemble(priceRows: AsyncIterable<Record<string, string>>, opts: { monthly: boolean }): Promise<MarketData> {
  const atlas = readAtlas();
  const mapping = readMapping();
  const linked = new Map(mapping.map((m) => [m.crop_id, m]));
  for (const c of atlas) if (!linked.has(c.row.id)) throw new Error(`${c.row.name} has no row in ${MAPPING_FILE}: run scripts/market/match-faostat.ts`);

  const areas = new Map(csv<Record<string, string>>(AREAS_FILE).map((a) => [Number(a.area_code), { area_code: Number(a.area_code), m49_code: a.m49_code, name: a.name }]));
  const areaCode = new Map([...areas.values()].map((a) => [a.name, a.area_code]));
  const items = new Map(mapping.map((m) => [m.item_code, { item_code: m.item_code, cpc_code: m.cpc_code || null, name: m.faostat_item, is_residual: isResidualItem(m.faostat_item) }]));

  const cropCountries: MarketData['cropCountries'] = [];
  for (const c of atlas)
    for (const name of new Set(c.producingCountries)) {
      const code = areaCode.get(name);
      if (code == null) throw new Error(`${c.row.name}: producing country "${name}" is not in ${AREAS_FILE}`);
      cropCountries.push({ crop_id: c.row.id, area_code: code });
    }

  const prices = new Map<string, PriceRow>();
  const skipped = { aggregateAreas: 0, otherItems: 0, monthly: 0, noValue: 0 };
  for await (const r of priceRows) {
    const area = Number(r['Area Code']);
    if (area >= FIRST_AGGREGATE_CODE || area === CHINA_AGGREGATE) {
      skipped.aggregateAreas++;
      continue;
    }
    const item = Number(r['Item Code']);
    if (!items.has(item)) {
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
    // A country that has prices but no production record is not in the areas file yet.
    if (!areas.has(area)) areas.set(area, { area_code: area, m49_code: bareCode(r['Area Code (M49)']), name: r.Area });
    const year = Number(r.Year);
    const key = `${area}:${item}:${year}:${month}`;
    let row = prices.get(key);
    if (!row) {
      row = { area_code: area, item_code: item, year, month, lcu_per_tonne: null, slc_per_tonne: null, usd_per_tonne: null, price_index: null, lcu_flag: null, slc_flag: null, usd_flag: null, index_flag: null };
      prices.set(key, row);
    }
    (row[measure[0]] as number) = value;
    (row[measure[1]] as string | null) = r.Flag || null;
  }

  return {
    areas: [...areas.values()].sort((a, b) => a.area_code - b.area_code),
    items: [...items.values()].sort((a, b) => a.item_code - b.item_code),
    crops: atlas.map((c) => c.row),
    links: mapping.map((m) => ({ crop_id: m.crop_id, item_code: m.item_code, match_method: m.match_method, tie_note: m.tie_note || null })),
    cropCountries,
    prices: [...prices.values()],
    skipped,
  };
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

async function upsert(base: string, key: string, table: string, conflict: string, rows: object[]): Promise<void> {
  const batches: object[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  let done = 0;
  await mapLimit(batches, 4, async (batch) => {
    await getText(`${base}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      timeoutMs: 120_000,
      retries: 3,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    done += batch.length;
    if (batches.length > 10 && done % (BATCH * 25) < BATCH) console.log(`  ${table}: ${done.toLocaleString('en')} of ${rows.length.toLocaleString('en')}`);
  });
  console.log(`  ${table}: ${rows.length.toLocaleString('en')} rows`);
}

/** Release dates as FAOSTAT publishes them in its bulk catalogue; null when the catalogue cannot be read. */
async function releaseDates(): Promise<Record<string, string | null>> {
  try {
    const j = await getJson<{ Datasets: { Dataset: { DatasetCode: string; DateUpdate: string }[] } }>(`${FAOSTAT_BULK}/datasets_E.json`, { timeoutMs: 60_000, retries: 2 });
    return Object.fromEntries(j.Datasets.Dataset.map((d) => [d.DatasetCode, d.DateUpdate?.slice(0, 10) ?? null]));
  } catch (e) {
    console.warn(`FAOSTAT catalogue not readable (${errText(e)}): release dates stay empty.`);
    return {};
  }
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

  console.log(`Reading FAOSTAT ${FAOSTAT.prices.code} (${monthly ? 'annual and monthly' : 'annual'} prices) ...`);
  const data = await assemble(faostatRows(await faostatZip(FAOSTAT.prices)), { monthly });
  const withPrice = new Set(data.prices.map((p) => p.item_code));
  console.log(
    `${data.crops.length} crops, ${data.items.length} FAOSTAT items (${data.items.filter((i) => !withPrice.has(i.item_code)).length} without a price), ` +
      `${data.areas.length} areas, ${data.cropCountries.length.toLocaleString('en')} crop-country pairs, ${data.prices.length.toLocaleString('en')} price rows.`,
  );
  console.log(`Not loaded: ${data.skipped.aggregateAreas.toLocaleString('en')} values of regional aggregates, ${data.skipped.otherItems.toLocaleString('en')} of items no crop is linked to, ${data.skipped.monthly.toLocaleString('en')} monthly, ${data.skipped.noValue} without a number.`);
  const noted = data.crops.filter((c) => c.quality_notes.length);
  console.log(`${noted.length} crops carry a quality note (see crops.quality_notes).`);
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  const released = await releaseDates();
  const sources = [
    { code: 'atlas', name: 'Crop atlas (EcoCrop requirements selected by the team)', publisher: 'Astrovivu, from FAO EcoCrop', url: 'data/market/atlas.csv', released_on: null, row_count: data.crops.length, notes: 'Producing countries: FAOSTAT production above zero in 2019-2024.' },
    { code: 'faostat-qcl', name: FAOSTAT.production.name, publisher: 'FAO', url: `${FAOSTAT_BULK}/${FAOSTAT.production.file}`, released_on: released[FAOSTAT.production.code] ?? null, row_count: data.links.length, notes: 'Basis of the crop-to-item link (scripts/market/match-faostat.ts).' },
    { code: 'faostat-pp', name: FAOSTAT.prices.name, publisher: 'FAO', url: `${FAOSTAT_BULK}/${FAOSTAT.prices.file}`, released_on: released[FAOSTAT.prices.code] ?? null, row_count: data.prices.length, notes: monthly ? 'Annual and monthly values of the linked items.' : 'Annual values of the linked items.' },
  ].map((s) => ({ ...s, loaded_at: new Date().toISOString() }));

  console.log(`Writing to ${new URL(base!).host} ...`);
  // Parents before children: the foreign keys are checked on every batch.
  await upsert(base!, key!, 'data_sources', 'code', sources);
  await upsert(base!, key!, 'areas', 'area_code', data.areas);
  await upsert(base!, key!, 'faostat_items', 'item_code', data.items);
  await upsert(base!, key!, 'crops', 'id', data.crops);
  await upsert(base!, key!, 'crop_faostat_items', 'crop_id', data.links);
  await upsert(base!, key!, 'crop_countries', 'crop_id,area_code', data.cropCountries);
  await upsert(base!, key!, 'producer_prices', 'area_code,item_code,year,month', data.prices);
  console.log('Done.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
