/**
 * FAOSTAT's country codes, each with the ISO code the crop atlas uses.
 *
 * A FAOSTAT price line names its country by a FAOSTAT area code; the atlas keys countries by
 * ISO 3166-1 alpha-3. The atlas takes the country name from FAOSTAT's production file, and so
 * does this script, so the name joins the two exactly. An area that is not an atlas country
 * keeps an empty `iso3`: its prices are loaded, and no crop-country row refers to it.
 *
 * Run: `npm run market:areas`  ->  data/market/faostat_areas.csv
 * Reads the production file (34 MB, cached a week in .cache/faostat/). Run it again after the
 * atlas is rebuilt on a new FAOSTAT release; a test fails when an atlas country has no area.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { toCsv } from '../crops/atlas/csv';
import { countryCodes, readTable } from './atlas';
import { bareCode, FAOSTAT, faostatRows, faostatZip } from './faostat';

export const AREAS_FILE = 'data/market/faostat_areas.csv';
/** FAOSTAT area 351 "China" is the sum of mainland, Hong Kong, Macao and Taiwan, which are listed too. */
export const CHINA_AGGREGATE = 351;
/** Area codes from 5000 are regions and other aggregates. */
export const FIRST_AGGREGATE_CODE = 5000;

async function main() {
  const iso3 = countryCodes(readTable('crop_country'));
  console.log(`Atlas: ${iso3.size} countries. Reading FAOSTAT ${FAOSTAT.production.code} ...`);
  const areas = new Map<number, { m49: string; name: string }>();
  for await (const r of faostatRows(await faostatZip(FAOSTAT.production))) {
    const code = Number(r['Area Code']);
    if (code >= FIRST_AGGREGATE_CODE || code === CHINA_AGGREGATE || areas.has(code)) continue;
    areas.set(code, { m49: bareCode(r['Area Code (M49)']), name: r.Area });
  }
  const names = new Set([...areas.values()].map((a) => a.name));
  const missing = [...iso3.keys()].filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Atlas countries FAOSTAT does not list under that name: ${missing.join(', ')}. Was the atlas built on another release?`);
  const rows = [...areas].sort((a, b) => a[0] - b[0]).map(([code, a]) => [code, a.m49, a.name, iso3.get(a.name) ?? '']);
  writeFileSync(AREAS_FILE, toCsv(['area_code', 'm49_code', 'name', 'iso3'], rows));
  const without = rows.filter((r) => r[3] === '').map((r) => r[2]);
  console.log(`Wrote ${AREAS_FILE}: ${rows.length} areas, ${rows.length - without.length} with an ISO code. Without: ${without.join(', ')}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
