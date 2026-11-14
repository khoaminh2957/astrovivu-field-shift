/**
 * FAOSTAT "Crops and livestock products" (QCL), normalized bulk file, read as a stream straight
 * from the zip. Keeps three elements of the crop items: area harvested (ha), production (t) and
 * yield (kg/ha), for the years that can enter the latest-three-years mean.
 */
import readline from 'node:readline';
import { parseCsvLine } from './csv';
import { listZip, openZipEntry } from './zip';

export interface ItemInfo {
  code: number;
  cpc: string;
  name: string;
}

export interface AreaInfo {
  code: number;
  m49: string;
  name: string;
}

export type ElementKey = 'area' | 'production' | 'yield';

/** FAOSTAT element code -> our key and the unit the build expects; another unit stops the build. */
const ELEMENTS: Record<string, { key: ElementKey; unit: string }> = {
  '5312': { key: 'area', unit: 'ha' },
  '5510': { key: 'production', unit: 't' },
  '5412': { key: 'yield', unit: 'kg/ha' },
};

export interface Series {
  area: Map<number, number>;
  production: Map<number, number>;
  yield: Map<number, number>;
}

export interface QclData {
  items: Map<number, ItemInfo>;
  areas: Map<number, AreaInfo>;
  /** `${areaCode}|${itemCode}` -> yearly values. */
  series: Map<string, Series>;
  maxYear: number;
  rowsRead: number;
  rowsKept: number;
}

const unquote = (s: string) => s.replace(/^'/, '');

/**
 * @param keepFromYear years before this are skipped while reading (the window is cut exactly later,
 *                     once the latest year of the file is known).
 */
export async function readQcl(zipFile: string, keepFromYear: number): Promise<QclData> {
  const entry = listZip(zipFile).find((e) => /All_Data_\(Normalized\)\.csv$/i.test(e.name));
  if (!entry) throw new Error(`${zipFile}: normalized data file not found in the archive`);
  const rl = readline.createInterface({ input: openZipEntry(zipFile, entry).setEncoding('utf8'), crlfDelay: Infinity });
  const data: QclData = { items: new Map(), areas: new Map(), series: new Map(), maxYear: 0, rowsRead: 0, rowsKept: 0 };
  let header: string[] | null = null;
  let col: Record<string, number> = {};
  for await (const line of rl) {
    if (!line) continue;
    const f = parseCsvLine(line);
    if (!header) {
      header = f.map((h) => h.replace(/^﻿/, '').trim());
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      for (const need of ['Area Code', 'Area Code (M49)', 'Area', 'Item Code', 'Item Code (CPC)', 'Item', 'Element Code', 'Year', 'Unit', 'Value', 'Flag']) {
        if (!(need in col)) throw new Error(`FAOSTAT QCL: column "${need}" missing; the file layout changed`);
      }
      continue;
    }
    data.rowsRead++;
    const el = ELEMENTS[f[col['Element Code']]];
    if (!el) continue;
    if (f[col.Unit] !== el.unit) throw new Error(`FAOSTAT QCL: element ${f[col['Element Code']]} has unit "${f[col.Unit]}", expected "${el.unit}"`);
    const cpc = unquote(f[col['Item Code (CPC)']]);
    // Codes such as F1717 are FAOSTAT's own aggregates (Cereals, primary; Vegetables Primary): not CPC classes, not crops.
    if (cpc.startsWith('F')) continue;
    const year = Number(f[col.Year]);
    if (year > data.maxYear) data.maxYear = year;
    if (year < keepFromYear) continue;
    const raw = f[col.Value];
    // Flag M: "Missing value; data cannot exist". An empty value is no observation either.
    if (raw === '' || f[col.Flag] === 'M') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const areaCode = Number(f[col['Area Code']]);
    const itemCode = Number(f[col['Item Code']]);
    if (!data.areas.has(areaCode)) data.areas.set(areaCode, { code: areaCode, m49: unquote(f[col['Area Code (M49)']]), name: f[col.Area] });
    if (!data.items.has(itemCode)) data.items.set(itemCode, { code: itemCode, cpc, name: f[col.Item] });
    const key = `${areaCode}|${itemCode}`;
    let s = data.series.get(key);
    if (!s) {
      s = { area: new Map(), production: new Map(), yield: new Map() };
      data.series.set(key, s);
    }
    s[el.key].set(year, value);
    data.rowsKept++;
  }
  return data;
}
