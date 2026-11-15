import fs from 'node:fs/promises';
import path from 'node:path';
import type { BundleLoader } from '../src/rag/store';
import type { TableReader } from '../src/rag/tables';
import type { RagBundle } from '../src/rag/types';

/** Node loader for the bundles written by `npm run rag:build`. */
export function fileLoader(dir: string): BundleLoader {
  return async (kind) => JSON.parse(await fs.readFile(path.join(dir, `${kind}.json`), 'utf8')) as RagBundle;
}

/**
 * Node reader for the lookup tables (`tableSource` in src/rag/tables.ts): reads a file under the
 * `public` folder, null when it is not there. A path that would leave the folder is not read.
 */
export function fileReader(publicDir: string): TableReader {
  const root = path.resolve(publicDir);
  return async (rel) => {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return null;
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  };
}
