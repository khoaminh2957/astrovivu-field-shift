/**
 * MiniSearch configuration shared by the build and the runtime. A serialised index can only be
 * loaded with the same `fields`, `tokenize` and `processTerm`, so this is the single definition.
 */
import type { Options } from 'minisearch';
import { processTerm, tokenize } from './text';
import type { IndexDoc } from './types';

export const INDEX_OPTIONS: Options<IndexDoc> = {
  idField: 'id',
  fields: ['title', 'names', 'tags', 'text'],
  storeFields: ['lang', 'kind', 'cropIds'],
  tokenize: (s) => tokenize(s),
  processTerm: (t) => processTerm(t) ?? null,
  searchOptions: {
    boost: { names: 3, title: 2, tags: 1.5, text: 1 },
    // Prefix matching helps English stems ("irrigat"); fuzzy only on long terms, because short
    // Vietnamese syllables are one edit apart from unrelated words.
    prefix: (term) => term.length >= 5,
    fuzzy: (term) => (term.length >= 7 ? 0.15 : false),
    weights: { prefix: 0.4, fuzzy: 0.3 },
  },
};
