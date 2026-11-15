/**
 * FAOSTAT bulk downloads (https://bulks-faostat.fao.org/production/, public, no key). A bulk file
 * is a ZIP holding one large CSV in "normalized" form: one value per line. The ZIP and CSV formats
 * are read with the helpers of the crop atlas (scripts/crops/atlas/), which reads FAOSTAT too.
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { getBytes } from '@/data/http';
import { parseCsvLine } from '../crops/atlas/csv';
import { listZip, openZipEntry } from '../crops/atlas/zip';

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

/** Path of a dataset's ZIP in `.cache/faostat/`, downloaded when the copy there is missing or older than a week. */
export async function faostatZip(ds: FaostatDataset, opts: { refresh?: boolean } = {}): Promise<string> {
  const file = path.join(CACHE, ds.file);
  if (!opts.refresh) {
    const cached = await open(file, 'r').catch(() => null); // null: not cached yet
    if (cached) {
      try {
        if (Date.now() - (await cached.stat()).mtimeMs < WEEK_MS) return file;
      } finally {
        await cached.close();
      }
    }
  }
  const url = `${FAOSTAT_BULK}/${encodeURIComponent(ds.file).replaceAll('(', '%28').replaceAll(')', '%29')}`;
  const bytes = await getBytes(url, { timeoutMs: 300_000, retries: 3 });
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, bytes);
  return file;
}

/** Rows of the dataset's main table, keyed by the column names of its header line. */
export async function* faostatRows(zipFile: string): AsyncGenerator<Record<string, string>> {
  const entry = listZip(zipFile).find((e) => e.name.includes('All_Data'));
  if (!entry) throw new Error(`${zipFile}: FAOSTAT archive without an All_Data table`);
  const lines = createInterface({ input: openZipEntry(zipFile, entry), crlfDelay: Infinity });
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
