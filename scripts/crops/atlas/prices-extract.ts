/**
 * Rebuilds data/crops/review/prices-from-faostat.csv: for every price in economics.csv whose source
 * cites FAOSTAT Producer Prices, the FAOSTAT row it was copied from (country, item, year, element
 * 5532 "Producer Price (USD/tonne)", annual value). The extract lets economics.test.ts check those
 * prices in CI without the 11 MB bulk file, and lets a reviewer see each figure next to its source
 * row. The market database view `crop_latest_prices` reads the same bulk file, but its hosted copy
 * is empty, so the extract is taken from the file itself.
 *
 *   npx tsx scripts/crops/atlas/prices-extract.ts
 *
 * Reads `.cache/faostat/Prices_E_All_Data_(Normalized).zip` (downloaded by scripts/market/faostat.ts
 * when missing or older than a week). Stops with an error if a cited price has no FAOSTAT row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bareCode, FAOSTAT, FAOSTAT_BULK, faostatRows, faostatZip } from '../../market/faostat';
import { parseCsvObjects, toCsv } from './csv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ECON_FILE = 'data/crops/atlas/economics.csv';
export const CROPS_FILE = 'data/crops/atlas/crops.csv';
export const EXTRACT_FILE = 'data/crops/review/prices-from-faostat.csv';
export const EXTRACT_COLUMNS = ['crop_id', 'iso3', 'item_code', 'item', 'year', 'element_code', 'unit', 'value', 'flag', 'source_file', 'accessed'] as const;

export const PRICE_ELEMENT = '5532';
const ANNUAL = '7021';
/** M49 codes as FAOSTAT writes them in `Area Code (M49)`, without the leading apostrophe. */
const M49: Record<string, string> = { VNM: '704', USA: '840' };
/** The URL as economics.csv writes it in its `url` column. */
export const SOURCE_FILE = `${FAOSTAT_BULK}/${FAOSTAT.prices.file}`;

/**
 * crops.csv links no FAOSTAT item to musa-acuminata (match = none: items.csv gives item 486
 * "Bananas" to musa-sapientum), yet its reference price in scripts/crops/economics.ts is the
 * Viet Nam 2024 price of item 486 (304.2 USD/t, the only Viet Nam 2024 producer price of that value).
 */
const ITEM_OF_UNLINKED_CROP: Record<string, string> = { 'musa-acuminata': '486' };

export interface FaostatPriceCell {
  cropId: string;
  iso3: string;
  itemCode: string;
  /** Year of the price as the source text states it; economics.csv's `year` column is the row's year, which can differ. */
  year: string;
  price: string;
}

/** The `price: ...` part of a `yield | price | cost` source text. */
export const priceSource = (source: string): string => source.split(' | ').find((p) => p.startsWith('price:')) ?? '';

/** Both wordings in economics.csv: the new rows ("FAOSTAT Producer Prices via crop_latest_prices") and the 49 reference rows ("FAOSTAT, Producer prices in USD/tonne"). */
export const citesFaostatPrices = (priceText: string): boolean => /FAOSTAT,? Producer prices/i.test(priceText);

function priceYear(priceText: string): string | null {
  return (priceText.match(/\((\d{4}), flag /) ?? priceText.match(/Producer prices in USD\/tonne, [A-Za-z ]+ (\d{4})/))?.[1] ?? null;
}

/** Every filled price cell of economics.csv whose source cites FAOSTAT producer prices, with the item and year it names. */
export function faostatPriceCells(econRows: readonly Record<string, string>[], cropRows: readonly Record<string, string>[]): FaostatPriceCell[] {
  const itemOf = new Map(cropRows.map((c) => [c.crop_id, c.faostat_item_code]));
  const cells: FaostatPriceCell[] = [];
  for (const r of econRows) {
    const text = priceSource(r.source);
    if (r.price_usd_t === '' || !citesFaostatPrices(text)) continue;
    const label = `${r.crop_id} ${r.iso3}${r.region ? ` ${r.region}` : ''}`;
    const itemCode = text.match(/item (\d+) "/)?.[1] || itemOf.get(r.crop_id) || ITEM_OF_UNLINKED_CROP[r.crop_id];
    if (!itemCode) throw new Error(`${label}: no FAOSTAT item code in the source text or in crops.csv`);
    const year = priceYear(text);
    if (!year) throw new Error(`${label}: the price source names no year`);
    cells.push({ cropId: r.crop_id, iso3: r.iso3, itemCode, year, price: r.price_usd_t });
  }
  return cells;
}

/** Local calendar date of the cached file, so the extract does not change when rebuilt from the same download. */
function fileDate(file: string): string {
  const d = fs.statSync(file).mtime;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const read = (rel: string) => parseCsvObjects(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const cells = faostatPriceCells(read(ECON_FILE), read(CROPS_FILE));
  const wanted = new Map(cells.map((c) => [`${M49[c.iso3]}:${c.itemCode}:${c.year}`, c]));

  const zip = await faostatZip(FAOSTAT.prices);
  const accessed = fileDate(zip);
  const found = new Map<string, Record<string, string>>();
  for await (const row of faostatRows(zip)) {
    if (row['Element Code'] !== PRICE_ELEMENT || row['Months Code'] !== ANNUAL) continue;
    const key = `${bareCode(row['Area Code (M49)'])}:${row['Item Code']}:${row.Year}`;
    if (wanted.has(key)) found.set(key, row);
  }

  const missing = [...wanted].filter(([k]) => !found.has(k)).map(([, c]) => `${c.cropId} ${c.iso3} item ${c.itemCode} ${c.year}`);
  if (missing.length) throw new Error(`no FAOSTAT producer price (element ${PRICE_ELEMENT}, annual) for: ${missing.join('; ')}`);

  const out = cells
    .map((c) => {
      const f = found.get(`${M49[c.iso3]}:${c.itemCode}:${c.year}`)!; // checked above
      return [c.cropId, c.iso3, f['Item Code'], f.Item, f.Year, f['Element Code'], f.Unit, f.Value, f.Flag, SOURCE_FILE, accessed];
    })
    .sort((a, b) => (a[1] + a[0]).localeCompare(b[1] + b[0]));
  const target = path.join(ROOT, EXTRACT_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, toCsv(EXTRACT_COLUMNS, out));
  const mismatched = cells.filter((c) => Number(found.get(`${M49[c.iso3]}:${c.itemCode}:${c.year}`)!.Value) !== Number(c.price));
  console.log(`${EXTRACT_FILE}: ${out.length} rows from ${path.relative(ROOT, zip)} (${accessed})`);
  for (const c of mismatched) console.log(`  differs from economics.csv: ${c.cropId} ${c.iso3} ${c.year} csv ${c.price}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
