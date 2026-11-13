import fs from 'node:fs/promises';
import path from 'node:path';
import type { BundleLoader } from '../src/rag/store';
import type { RagBundle } from '../src/rag/types';

/** Node loader for the bundles written by `npm run rag:build`. */
export function fileLoader(dir: string): BundleLoader {
  return async (kind) => JSON.parse(await fs.readFile(path.join(dir, `${kind}.json`), 'utf8')) as RagBundle;
}
