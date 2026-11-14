/**
 * Links every atlas crop to its FAOSTAT item, so that FAOSTAT producer prices can be read per crop.
 *
 * The atlas carries no item code. It does carry, per crop, the list of producing countries, and
 * that list was taken from one FAOSTAT item. The rule that produced the lists was recovered from
 * the data: countries with a production above zero in at least one year of 2019-2024, the
 * aggregate row "China" left out. Under that rule each of the 146 distinct lists of the atlas is
 * the country set of exactly one item, country for country. Three lists fit two or three items of
 * the same plant (seed cotton / cotton seed / lint): `TIES` names the one farmers sell.
 *
 * Run: `npx tsx scripts/market/match-faostat.ts`
 *   -> data/market/crop_faostat_items.csv   crop -> item
 *   -> data/market/faostat_areas.csv        FAOSTAT area codes of countries
 * The run stops if a list fits no item: after a new FAOSTAT release, re-check `YEARS`.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readAtlas } from './atlas';
import { csvLine } from './csv';
import { bareCode, FAOSTAT, faostatRows, faostatZip } from './faostat';

export const MAPPING_FILE = 'data/market/crop_faostat_items.csv';
export const AREAS_FILE = 'data/market/faostat_areas.csv';
const YEARS: [number, number] = [2019, 2024];
/** FAOSTAT area 351 "China" is the sum of mainland, Hong Kong, Macao and Taiwan, which are listed too. */
const CHINA_AGGREGATE = 351;
/** Area codes from 5000 are regions and other aggregates. */
const FIRST_AGGREGATE_CODE = 5000;

/** Items with identical country sets: the key is the sorted item codes, the value the item to use. */
const TIES: Record<string, { item: number; note: string }> = {
  '310,311,778': { item: 310, note: 'Kapok fruit, Kapokseed in shell and Kapok fibre have the same producing countries; the fruit is the raw product' },
  '328,329,767': { item: 328, note: 'Seed cotton, Cotton seed and Cotton lint have the same producing countries; seed cotton is the raw product' },
  '254,256': { item: 254, note: 'Oil palm fruit and Palm kernels have the same producing countries; the fruit is the raw product' },
};

/** "n.e.c." and "Other ..." classes pool many species: a price there is not the price of one crop. */
export const isResidualItem = (name: string): boolean => /n\.e\.c\.|^Other /.test(name);

const setKey = (names: Iterable<string>): string => [...names].sort().join('|');

async function main() {
  const atlas = readAtlas();
  console.log(`Atlas: ${atlas.length} crops. Reading FAOSTAT ${FAOSTAT.production.code} ...`);
  const zip = await faostatZip(FAOSTAT.production);
  const producers = new Map<number, Set<string>>();
  const items = new Map<number, { name: string; cpc: string }>();
  const areas = new Map<number, { m49: string; name: string }>();
  for await (const r of faostatRows(zip)) {
    const area = Number(r['Area Code']);
    if (area >= FIRST_AGGREGATE_CODE) continue;
    if (!areas.has(area)) areas.set(area, { m49: bareCode(r['Area Code (M49)']), name: r.Area });
    const item = Number(r['Item Code']);
    if (!items.has(item)) items.set(item, { name: r.Item, cpc: bareCode(r['Item Code (CPC)']) });
    if (area === CHINA_AGGREGATE || r.Element !== 'Production') continue;
    const year = Number(r.Year);
    if (year < YEARS[0] || year > YEARS[1] || !(Number(r.Value) > 0)) continue;
    let s = producers.get(item);
    if (!s) producers.set(item, (s = new Set()));
    s.add(r.Area);
  }
  const bySet = new Map<string, number[]>();
  for (const [item, s] of producers) {
    const k = setKey(s);
    bySet.set(k, [...(bySet.get(k) ?? []), item]);
  }

  const lines = [csvLine(['crop_id', 'name', 'scientific_name', 'item_code', 'cpc_code', 'faostat_item', 'item_is_residual', 'match_method', 'tie_note'])];
  const used = new Set<number>();
  let tied = 0;
  for (const c of atlas) {
    const candidates = (bySet.get(setKey(c.producingCountries)) ?? []).sort((a, b) => a - b);
    if (candidates.length === 0) throw new Error(`${c.row.name}: no FAOSTAT item has exactly this list of producing countries. Has FAOSTAT published a new release?`);
    let item = candidates[0];
    let note = '';
    if (candidates.length > 1) {
      const tie = TIES[candidates.join(',')];
      if (!tie) throw new Error(`${c.row.name}: items ${candidates.join(', ')} share its country list and TIES has no rule for them`);
      item = tie.item;
      note = tie.note;
      tied++;
    }
    used.add(item);
    const it = items.get(item)!;
    lines.push(csvLine([c.row.id, c.row.name, c.row.scientific_name, item, it.cpc, it.name, isResidualItem(it.name), 'producing-countries', note]));
  }
  writeFileSync(MAPPING_FILE, lines.join('\n') + '\n');

  const unknown = new Set<string>();
  const codeOf = new Map([...areas].map(([code, a]) => [a.name, code]));
  for (const c of atlas) for (const name of c.producingCountries) if (!codeOf.has(name)) unknown.add(name);
  if (unknown.size) throw new Error(`Atlas countries without a FAOSTAT area code: ${[...unknown].join(', ')}`);
  const areaLines = [csvLine(['area_code', 'm49_code', 'name'])];
  for (const [code, a] of [...areas].sort((x, y) => x[0] - y[0])) if (code !== CHINA_AGGREGATE) areaLines.push(csvLine([code, a.m49, a.name]));
  writeFileSync(AREAS_FILE, areaLines.join('\n') + '\n');

  console.log(`${atlas.length} crops -> ${used.size} FAOSTAT items (${tied} crops through a tie rule). Wrote ${MAPPING_FILE} and ${AREAS_FILE} (${areaLines.length - 1} areas).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
