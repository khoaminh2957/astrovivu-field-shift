/**
 * Section-aware chunking. Target 150-300 words: paragraphs are packed until the next one would
 * pass 300 words; a paragraph longer than that is split on sentence boundaries. Small trailing
 * pieces (< 60 words) are merged into the previous chunk of the same section.
 */
import { sentences, wordCount } from '../../src/rag/text';

export interface Section {
  /** Heading path, e.g. ["Cultivation", "Soil"]; [] for the lead. */
  path: string[];
  text: string;
}

/** Parse a MediaWiki plain-text extract with `== Heading ==` markers into sections. */
export function parseWikiSections(extract: string): Section[] {
  const out: Section[] = [];
  const stack: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ path: [...stack], text });
    buf = [];
  };
  for (const line of extract.split('\n')) {
    const m = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (m) {
      flush();
      const level = m[1].length - 2;
      stack.length = Math.min(stack.length, level);
      stack[level] = m[2];
      stack.length = level + 1;
    } else buf.push(line);
  }
  flush();
  return out;
}

/** Split long text into pieces of about `target` words on sentence boundaries. */
export function splitWords(text: string, target: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const s of sentences(text)) {
    const w = wordCount(s);
    if (n + w > target && n > 0) {
      out.push(cur.join(' '));
      cur = [];
      n = 0;
    }
    cur.push(s);
    n += w;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

export function packParagraphs(text: string, min = 150, max = 300): string[] {
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .flatMap((p) => (wordCount(p) > max ? splitWords(p, Math.round((min + max) / 2)) : [p]));
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const p of paras) {
    const w = wordCount(p);
    if (n > 0 && n + w > max) {
      out.push(cur.join('\n'));
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += w;
  }
  if (cur.length) {
    if (out.length && n < 60) out[out.length - 1] += `\n${cur.join('\n')}`;
    else out.push(cur.join('\n'));
  }
  return out;
}

/**
 * Merge consecutive short sections under the same top-level heading so a 40-word "Soil" section
 * does not become its own weak chunk.
 */
export function mergeShortSections(secs: Section[], min = 80): Section[] {
  const out: Section[] = [];
  for (const s of secs) {
    const prev = out[out.length - 1];
    if (prev && prev.path[0] === s.path[0] && s.path.length > 0 && wordCount(prev.text) < min) {
      const label = s.path.slice(1).join(' / ');
      prev.text += `\n${label ? `${label}: ` : ''}${s.text}`;
      continue;
    }
    out.push({ path: [...s.path], text: s.text });
  }
  return out;
}
