/**
 * Holds the loaded knowledge: the small `core` bundle first, then (lazily) the `full` bundle whose
 * index covers every chunk. Swapping to the full index keeps BM25 statistics consistent, because
 * that index was built over core + full chunks together.
 */
import MiniSearch from 'minisearch';
import type { KnowledgeChunk } from '@/contracts';
import { type AliasTable, detectCrops, mergeAliases } from './aliases';
import { INDEX_OPTIONS } from './searchConfig';
import type { CropFacts, DroppedTable, IndexDoc, RagBundle } from './types';

/** An EcoCrop species the crop atlas does not keep, as a question named it. */
export interface DroppedMention {
  id: string;
  sci: string;
  /** `no-item`: no FAOSTAT crop item names it. `group-only`: named only in a group item and not described as cultivated. */
  reason: 'no-item' | 'group-only';
  /** The words of the question that named it. */
  alias: string;
  /** Where those words are in the question, as token positions (as `detectCrops` counts them). */
  start: number;
  end: number;
}

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
  /** Names of the species the atlas dropped; arrives with the full bundle. */
  dropped: DroppedTable | null = null;
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
    if (b.dropped) this.dropped = b.dropped;
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

  /**
   * Species the atlas dropped that the question names. Empty until the full bundle has loaded.
   * A name a kept crop answers to is not in this table, but a longer name can hold one
   * ("Abelmoschus manihot" holds "manihot", cassava): `analyze` gives the longer name the word.
   */
  findDropped(query: string): DroppedMention[] {
    if (!this.dropped) return [];
    const out: DroppedMention[] = [];
    for (const m of detectCrops(query, { map: this.dropped.aliases, exact: {} })) {
      for (const id of m.cropIds) {
        const s = this.dropped.species[id];
        if (s && !out.some((x) => x.id === id)) out.push({ id, sci: s[0], reason: s[1] === 'g' ? 'group-only' : 'no-item', alias: m.alias, start: m.start, end: m.end });
      }
    }
    return out;
  }
}
