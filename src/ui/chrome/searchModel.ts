/**
 * The single search, without React: what the rows are, in which order, and which part of a row is
 * shown in bold. Matching ignores case and Vietnamese diacritics, so "cai lay" finds "Cai Lậy".
 */
import type { LngLat, PlaceHit } from '@/contracts';

export type SuggestionKind = 'own' | 'demo' | 'coords' | 'place';

export interface Suggestion {
  kind: SuggestionKind;
  /** Stable within one list: the option's DOM id and React key. */
  id: string;
  /** First line: the field's name, or the first part of the place's label. */
  title: string;
  /** Second line, after the kind's own label: region and country. */
  detail?: string;
  location: LngLat;
}

/** The little of a field the search needs; a `Parcel` fits. */
export interface FieldEntry {
  id: string;
  name: string;
  centroid: LngLat;
  place?: { label: string };
}

export const MAX_SUGGESTIONS = 6;

/** "12.68, 108.05" or "12.68 108.05": latitude first, the way people copy it from a map. */
export function parseLatLon(q: string): LngLat | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

const MARKS = /[̀-ͯ]/g;

/** Lower case, without diacritics; "đ" has no decomposition, so it is mapped by hand. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);

const tokens = (query: string): string[] => fold(query).split(/[^\p{L}\p{N}.-]+/u).filter(Boolean);

/** `text` folded one character at a time, with the index in `text` each folded character came from. */
function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const c of fold(text[i])) {
      folded += c;
      at.push(i);
    }
  }
  return { folded, at };
}

/** Start of the first word in `folded` that begins with `token`, or -1. */
function wordStart(folded: string, token: string): number {
  for (let i = folded.indexOf(token); i >= 0; i = folded.indexOf(token, i + 1)) {
    if (!isWordChar(folded[i - 1])) return i;
  }
  return -1;
}

/** True when every word of the query begins a word of the text. An empty query matches nothing. */
export function matchesQuery(text: string, query: string): boolean {
  const words = tokens(query);
  if (words.length === 0) return false;
  const folded = fold(text);
  return words.every((w) => wordStart(folded, w) >= 0);
}

export interface TextPart {
  text: string;
  bold: boolean;
}

/** `text` cut into parts, bold where a word of the query begins a word of it. */
export function highlight(text: string, query: string): TextPart[] {
  const { folded, at } = foldWithMap(text);
  const bold = new Array<boolean>(text.length).fill(false);
  for (const w of tokens(query)) {
    const i = wordStart(folded, w);
    if (i < 0) continue;
    for (let k = i; k < i + w.length; k++) bold[at[k]] = true;
  }
  // A combining mark belongs to the letter before it.
  for (let i = 1; i < text.length; i++) if (fold(text[i]) === '' && bold[i - 1]) bold[i] = true;
  const parts: TextPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.bold === bold[i]) last.text += text[i];
    else parts.push({ text: text[i], bold: bold[i] });
  }
  return parts;
}

/** "89316", "CB2 1TA": digits, or capitals and digits together. A name with lower-case letters ("Quận 1") is not one. */
const POSTCODE = /^(?=.*\d)[A-Z\d][A-Z\d\s-]*$/;

/** "Cai Lậy, Tiền Giang, Việt Nam" as a title and what is left of it. */
export function splitPlaceLabel(label: string): { title: string; detail?: string } {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { title: label.trim() };
  // Geocoders repeat a name ("Cai Lậy, Cai Lậy, …") and put a postcode before the country: neither helps to tell two rows apart.
  const rest = parts.slice(1).filter((p, i, a) => p !== parts[0] && a.indexOf(p) === i && !POSTCODE.test(p));
  return { title: parts[0], detail: rest.length ? rest.slice(-2).join(', ') : undefined };
}

export const formatLatLon = ([lon, lat]: LngLat): string => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

export interface MergeInput {
  query: string;
  /** The visitor's own field, if they made one in this session. */
  own?: FieldEntry | null;
  demo?: FieldEntry | null;
  /** Words that also find a field: the localised "Your field" and "Demo field". */
  ownWords?: string;
  demoWords?: string;
  places?: readonly PlaceHit[] | null;
  max?: number;
}

/**
 * The rows of the dropdown, in order: the visitor's own field, the demo field, the typed
 * coordinates, then places. A field is listed only when the query matches its name or its place,
 * so that Enter on a place name never opens a field by surprise.
 */
export function mergeSuggestions({ query, own, demo, ownWords = '', demoWords = '', places, max = MAX_SUGGESTIONS }: MergeInput): Suggestion[] {
  const q = query.trim();
  if (!q) return [];
  const out: Suggestion[] = [];
  const field = (kind: 'own' | 'demo', f: FieldEntry | null | undefined, words: string) => {
    if (!f || !matchesQuery(`${f.name} ${f.place?.label ?? ''} ${words}`, q)) return;
    out.push({ kind, id: `${kind}-${f.id}`, title: f.name, detail: f.place?.label, location: f.centroid });
  };
  field('own', own, ownWords);
  if (demo && demo.id !== own?.id) field('demo', demo, demoWords);
  const at = parseLatLon(q);
  if (at) out.push({ kind: 'coords', id: 'coords', title: formatLatLon(at), location: at });
  const seen = new Set<string>();
  for (const p of places ?? []) {
    if (out.length >= max) break;
    const key = `${p.location[0].toFixed(4)},${p.location[1].toFixed(4)}`;
    // With coordinates typed, the geocoder's answer is the same point again.
    if (at || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'place', id: `place-${key}`, ...splitPlaceLabel(p.label), location: p.location });
  }
  return out.slice(0, max);
}

/** Up / Down in the list: wraps at both ends; -1 (nothing highlighted) when the list is empty. */
export function moveIndex(index: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  return (((index + delta) % count) + count) % count;
}
