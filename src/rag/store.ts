/**
 * Holds the loaded knowledge: the small `core` bundle first, then (lazily) the `full` bundle whose
 * index covers every chunk. Swapping to the full index keeps BM25 statistics consistent, because
 * that index was built over core + full chunks together.
 */
import MiniSearch from 'minisearch';
import type { KnowledgeChunk } from '@/contracts';
import { type AliasTable, mergeAliases } from './aliases';
import { INDEX_OPTIONS } from './searchConfig';
import type { CropFacts, IndexDoc, RagBundle } from './types';

export type BundleKind = 'core' | 'full';
export type BundleLoader = (kind: BundleKind) => Promise<RagBundle>;

/** Browser default: fetch from `<base>/rag/<kind>.json`. */
export const fetchLoader: BundleLoader = async (kind) => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}rag/${kind}.json`);
  if (!res.ok) throw new Error(`rag/${kind}.json: HTTP ${res.status}`);
  return (await res.json()) as RagBundle;
};

export class KnowledgeStore {
  index: MiniSearch<IndexDoc> | null = null;
  readonly chunks = new Map<string, KnowledgeChunk>();
  readonly crops = new Map<string, CropFacts>();
  aliases: AliasTable = { map: {}, exact: {} };
  hasFull = false;
  private corePromise: Promise<void> | null = null;
  private fullPromise: Promise<void> | null = null;

  constructor(private readonly loader: BundleLoader) {}

  private absorb(b: RagBundle): void {
    for (const c of b.chunks) this.chunks.set(c.id, c);
    for (const f of b.crops) this.crops.set(f.id, f);
    // `as never`: MiniSearch's AsPlainObject type is not exported; the bundle holds exactly toJSON() output.
    this.index = MiniSearch.loadJS<IndexDoc>(b.index as never, INDEX_OPTIONS);
    this.aliases = b.kind === 'core' ? mergeAliases(b.aliases, this.aliases) : mergeAliases(this.aliases, b.aliases);
  }

  ensureCore(): Promise<void> {
    this.corePromise ??= this.loader('core').then((b) => {
      // If full finished first (unlikely), keep its index.
      const idx = this.index;
      this.absorb(b);
      if (this.hasFull && idx) this.index = idx;
    });
    return this.corePromise;
  }

  ensureFull(): Promise<void> {
    this.fullPromise ??= this.ensureCore()
      .then(() => this.loader('full'))
      .then((b) => {
        this.absorb(b);
        this.hasFull = true;
      });
    return this.fullPromise;
  }

  /** Start loading the full bundle without waiting; errors are swallowed (core still works). */
  prefetchFull(): void {
    this.ensureFull().catch(() => {
      this.fullPromise = null;
    });
  }

  isCurated(id: string): boolean {
    return this.crops.get(id)?.curated ?? false;
  }
}
