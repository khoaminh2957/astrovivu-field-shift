import type { KnowledgeChunk } from '@/contracts';
import type { AliasTable } from './aliases';

/** EcoCrop-style window with possibly missing ends: [absMin, optMin, optMax, absMax]. */
export type Range4 = [absMin: number | null, optMin: number | null, optMax: number | null, absMax: number | null];

/** Structured requirements of one species, cleaned from FAO EcoCrop (see scripts/rag/ecocrop.ts). */
export interface CropFacts {
  id: string;
  sci: string;
  ecocropId: number;
  family?: string;
  /** Curated English / Vietnamese display names (curated crops only). */
  en?: string;
  vi?: string;
  /** A few common names as published by EcoCrop, for display. */
  names: string[];
  category?: string;
  lifeForm?: string;
  lifeSpan?: string;
  /** Mean temperature during the growing period, °C. */
  temp?: Range4;
  /** Annual rainfall, mm. */
  rain?: Range4;
  ph?: Range4;
  texture?: { opt?: string; abs?: string };
  drainage?: { opt?: string; abs?: string };
  depth?: { opt?: string; abs?: string };
  fertility?: { opt?: string; abs?: string };
  salinity?: { opt?: string; abs?: string };
  light?: { opt?: string; abs?: string };
  killTempEarly?: number | null;
  killTempRest?: number | null;
  /** Days from sowing to harvest. */
  cycle?: [number, number] | null;
  latAbs?: [number, number] | null;
  altAbsMax?: number | null;
  climate?: string;
  photoperiod?: string;
  uses?: string;
  usesMain?: string;
  companions?: string;
  curated: boolean;
  /** What the build changed while cleaning this row (wrong-scale values dropped, zero cycles). */
  cleaning?: string[];
}

/** Serialised MiniSearch index (`MiniSearch.toJSON()`), kept opaque here. */
export type SerializedIndex = Record<string, unknown>;

/**
 * One shipped artifact. `core` is fetched first (curated crops + glossary + concept articles);
 * `full` is fetched lazily and carries an index over ALL chunks (core included, so BM25 statistics
 * stay consistent when the search switches to it) plus only the chunks/crops/aliases not in core.
 */
export interface RagBundle {
  version: 1;
  kind: 'core' | 'full';
  builtAt: string;
  chunks: KnowledgeChunk[];
  crops: CropFacts[];
  aliases: AliasTable;
  index: SerializedIndex;
}

/** Stored fields kept inside the MiniSearch index (used for boosting and filtering). */
export interface StoredFields {
  lang: string;
  kind: ChunkKind;
  cropIds: string;
  tags: string;
}

export type ChunkKind = 'facts' | 'narrative' | 'wiki' | 'glossary' | 'concept';

/** Indexed document shape. */
export interface IndexDoc {
  id: string;
  title: string;
  names: string;
  tags: string;
  text: string;
  lang: string;
  kind: ChunkKind;
  cropIds: string;
}

export function chunkKind(c: KnowledgeChunk): ChunkKind {
  const k = c.tags?.find((t) => t.startsWith('kind:'));
  return (k?.slice(5) as ChunkKind | undefined) ?? 'narrative';
}
