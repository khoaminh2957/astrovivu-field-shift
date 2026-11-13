/**
 * Text normalisation shared by the index build (Node) and query time (browser). Both sides MUST
 * use these functions, otherwise indexed terms and query terms drift apart.
 *
 * Vietnamese is indexed and queried in folded form (diacritics removed, đ -> d) so a question typed
 * without accents ("dat chua", common on phones) matches text written with them ("đất chua").
 * The cost is a few collisions between syllables that differ only by tone; BM25 over multi-word
 * queries absorbs that well enough (see docs/RAG.md, eval).
 */

/** Lowercase, strip combining marks, map đ/Đ to d. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/** Slug of a scientific name: `Coffea canephora` -> `coffea-canephora`. */
export function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split into word tokens (Unicode letters and digits). Keeps decimals such as 5.6 together. */
export function tokenize(s: string): string[] {
  return s.match(/\d+(?:[.,]\d+)?|[\p{L}\p{N}]+/gu) ?? [];
}

const STOP_EN = new Set(
  (
    'a an the and or of to in on at for by with from as is are was were be been being it its this that these those ' +
    'what which who whom how why when where does do did can could should would will shall may might my our your ' +
    'i me we you they them he she his her their there here than then so if not no yes about into over under ' +
    'very much more most some any all each also just only such per vs'
  ).split(' '),
);

// Folded Vietnamese function words. Content syllables (dat, cay, nuoc, mua...) are kept on purpose.
const STOP_VI = new Set(
  (
    'la cua va voi cho nhung cac mot nay kia do thi ma neu de duoc bi co khong gi nao sao the nhu ' +
    'tai vi vay rat qua hay hoac toi ban minh chung ta o tren duoi trong ngoai den tu ra vao len xuong ' +
    'cung da dang se roi nhe a u ah oi nhi'
  ).split(' '),
);

export function isStopword(foldedTerm: string): boolean {
  return STOP_EN.has(foldedTerm) || STOP_VI.has(foldedTerm);
}

/** MiniSearch `processTerm`: fold, drop stopwords and 1-character noise. */
export function processTerm(term: string): string | null {
  const t = fold(term);
  if (t.length < 2 && !/\d/.test(t)) return null;
  if (isStopword(t)) return null;
  return t;
}

/** Folded tokens without stopwords, in order. */
export function terms(s: string): string[] {
  const out: string[] = [];
  for (const tok of tokenize(s)) {
    const t = processTerm(tok);
    if (t) out.push(t);
  }
  return out;
}

/** Folded tokens including stopwords (used for alias n-gram matching, where "of" matters). */
export function rawFoldedTokens(s: string): string[] {
  return tokenize(s).map(fold);
}

export function wordCount(s: string): number {
  return tokenize(s).length;
}

/** Trim to at most `max` characters on a word boundary, with an ellipsis. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > max * 0.6 ? sp : max).replace(/[,;:.\s]+$/, '')}…`;
}

const ABBREV = /(?:\b(?:e\.g|i\.e|approx|ca|var|ssp|subsp|spp|cv|St|Dr|Mr|vs|etc|incl|resp|fig|no|al)|\b[A-Z])\.$/;

/** Split text into sentences (good enough for quoting): splits after . ! ? followed by space. */
export function sentences(s: string): string[] {
  const parts = s.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out.filter((x) => x.length > 0);
}

/** Upper-case the first letter (sentence start). */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
