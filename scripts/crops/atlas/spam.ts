/**
 * MapSPAM 2020 harvested area (all technologies), summed from the 5-arc-minute cells to country
 * and first-level administrative unit. The cell table is 416 MB of CSV inside the zip: streamed.
 */
import readline from 'node:readline';
import { parseCsvLine } from './csv';
import { listZip, openZipEntry } from './zip';

export interface SpamRegion {
  fips0: string;
  country: string;
  /** SPAM's FIPS1 code; empty on a country total. */
  admin1Code: string;
  admin1: string;
  /** Harvested area per crop column, in the order of `SpamData.crops`. */
  area: Float64Array;
  cells: number;
}

export interface SpamData {
  crops: string[];
  countries: Map<string, SpamRegion>;
  regions: Map<string, SpamRegion>;
  cells: number;
  entryName: string;
}

const ID_COLUMNS = new Set(['grid_code', 'x', 'y', 'FIPS0', 'FIPS1', 'FIPS2', 'ADM0_NAME', 'ADM1_NAME', 'ADM2_NAME', 'rec_type', 'tech_type', 'unit', 'year_data']);

export async function readSpamHarvestedArea(zipFile: string): Promise<SpamData> {
  // `_H_TA`: variable H (harvested area), technology A (all technologies together), per the SPAM readme.
  const entry = listZip(zipFile).find((e) => /_H_TA\.csv$/i.test(e.name));
  if (!entry) throw new Error(`${zipFile}: no *_H_TA.csv (harvested area, all technologies) in the archive`);
  const rl = readline.createInterface({ input: openZipEntry(zipFile, entry).setEncoding('utf8'), crlfDelay: Infinity });
  const out: SpamData = { crops: [], countries: new Map(), regions: new Map(), cells: 0, entryName: entry.name };
  let cropIdx: number[] = [];
  let iF0 = -1;
  let iF1 = -1;
  let iA0 = -1;
  let iA1 = -1;
  for await (const line of rl) {
    if (!line) continue;
    const f = parseCsvLine(line);
    if (iF0 < 0) {
      const head = f.map((h) => h.replace(/^﻿/, '').trim());
      iF0 = head.indexOf('FIPS0');
      iF1 = head.indexOf('FIPS1');
      iA0 = head.indexOf('ADM0_NAME');
      iA1 = head.indexOf('ADM1_NAME');
      if (iF0 < 0 || iF1 < 0 || iA0 < 0 || iA1 < 0) throw new Error('SPAM: FIPS0/FIPS1/ADM0_NAME/ADM1_NAME columns missing; the file layout changed');
      head.forEach((h, i) => {
        if (!ID_COLUMNS.has(h)) {
          out.crops.push(h.toLowerCase());
          cropIdx.push(i);
        }
      });
      continue;
    }
    out.cells++;
    const fips0 = f[iF0];
    const get = (map: Map<string, SpamRegion>, key: string, admin1Code: string, admin1: string) => {
      let r = map.get(key);
      if (!r) {
        r = { fips0, country: f[iA0], admin1Code, admin1, area: new Float64Array(cropIdx.length), cells: 0 };
        map.set(key, r);
      }
      return r;
    };
    const c = get(out.countries, fips0, '', '');
    const r = get(out.regions, `${fips0}|${f[iF1]}`, f[iF1], f[iA1]);
    c.cells++;
    r.cells++;
    for (let k = 0; k < cropIdx.length; k++) {
      const v = Number(f[cropIdx[k]]);
      if (v > 0) {
        c.area[k] += v;
        r.area[k] += v;
      }
    }
  }
  cropIdx = [];
  return out;
}
