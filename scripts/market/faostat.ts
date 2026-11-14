/**
 * FAOSTAT bulk downloads (https://bulks-faostat.fao.org/production/, public, no key). A bulk file
 * is a ZIP holding one large CSV in "normalized" form: one value per line.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { getBytes } from '@/data/http';
import { parseCsvLine } from './csv';
import { openZipEntry, zipEntries } from './zip';

export const FAOSTAT_BULK = 'https://bulks-faostat.fao.org/production';
export const FAOSTAT = {
  /** Production: Crops and livestock products. */
  production: { code: 'QCL', name: 'Production: Crops and livestock products', file: 'Production_Crops_Livestock_E_All_Data_(Normalized).zip' },
  /** Prices: Producer Prices. */
  prices: { code: 'PP', name: 'Prices: Producer Prices', file: 'Prices_E_All_Data_(Normalized).zip' },
} as const;
export type FaostatDataset = (typeof FAOSTAT)[keyof typeof FAOSTAT];

const CACHE = path.join(process.cwd(), '.cache', 'faostat');
const WEEK_MS = 7 * 86_400_000;

/** The ZIP of a dataset, from `.cache/faostat/` when it is less than a week old. */
export async function faostatZip(ds: FaostatDataset, opts: { refresh?: boolean } = {}): Promise<Buffer> {
  const file = path.join(CACHE, ds.file);
  if (!opts.refresh) {
    try {
      if (Date.now() - (await stat(file)).mtimeMs < WEEK_MS) return await readFile(file);
    } catch {
      // not cached yet
    }
  }
  const url = `${FAOSTAT_BULK}/${encodeURIComponent(ds.file).replaceAll('(', '%28').replaceAll(')', '%29')}`;
  const bytes = Buffer.from(await getBytes(url, { timeoutMs: 300_000, retries: 3 }));
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

/** Rows of the dataset's main table, keyed by the column names of its header line. */
export async function* faostatRows(zip: Buffer): AsyncGenerator<Record<string, string>> {
  const entry = zipEntries(zip).find((e) => e.name.includes('All_Data'));
  if (!entry) throw new Error('FAOSTAT archive without an All_Data table');
  const lines = createInterface({ input: openZipEntry(zip, entry), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const line of lines) {
    if (!line) continue;
    if (!header) {
      // A byte-order mark before the first quote would make the parser read the cell as unquoted.
      header = parseCsvLine(line.replace(/^\uFEFF/, '')).map((h) => h.trim());
      continue;
    }
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    yield row;
  }
}

/** FAOSTAT writes M49 and CPC codes with a leading apostrophe so that spreadsheets keep the zeros. */
export const bareCode = (v: string): string => v.replace(/^'/, '');
