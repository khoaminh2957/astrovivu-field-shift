/** Citation collection and sentence selection shared by the extractive composers. */
import type { Citation, KnowledgeChunk, Lang } from '@/contracts';
import { clip, fold, sentences, terms } from './text';

export class Citer {
  readonly list: Citation[] = [];
  private readonly ids = new Map<string, number>();

  /** Returns the `[S#]` marker for a chunk, registering it on first use. */
  cite(chunk: KnowledgeChunk, snippet?: string, score = 0): string {
    let n = this.ids.get(chunk.id);
    if (n == null) {
      n = this.list.length + 1;
      this.ids.set(chunk.id, n);
      this.list.push({
        chunkId: chunk.id,
        title: chunk.title,
        source: chunk.source.name,
        url: chunk.source.url,
        license: chunk.source.license,
        snippet: clip(snippet ?? chunk.text, 280),
        score: Number(score.toFixed(3)),
      });
    }
    return `[S${n}]`;
  }
}

/**
 * Sentences of a passage ranked by overlap with the query terms (folded), preferring 8-45 words.
 * Returns at most `n`, in their original order.
 */
export function bestSentences(chunk: KnowledgeChunk, queryTerms: string[], n = 2, extra: string[] = []): string[] {
  const q = new Set([...queryTerms, ...extra.flatMap((e) => terms(e))]);
  const ss = sentences(chunk.text);
  const scored = ss.map((s, i) => {
    const ts = terms(s);
    const hit = new Set(ts.filter((t) => q.has(t) || [...q].some((x) => x.length >= 5 && t.startsWith(x.slice(0, 5))))).size;
    const len = ts.length;
    const lenPenalty = len < 6 ? 0.4 : len > 55 ? 0.6 : 1;
    // Headings glued to text by the EcoCrop notes ("Uses: ...") should not dominate.
    return { s, i, score: (hit + (i === 0 ? 0.2 : 0)) * lenPenalty };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => clip(x.s, 360));
}

export function quote(s: string, chunk: KnowledgeChunk, lang: Lang): string {
  const foreign = chunk.lang !== lang ? (lang === 'vi' ? ' (nguồn tiếng Anh)' : ' (Vietnamese source)') : '';
  return `“${s.replace(/^[A-Z][a-z]+(?: [a-z]+)?: /, '')}”${foreign}`;
}

/** Does the folded text mention any of these folded keywords? */
export const mentions = (text: string, words: string[]) => {
  const t = fold(text);
  return words.some((w) => t.includes(w));
};
