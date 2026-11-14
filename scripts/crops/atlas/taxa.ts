/**
 * Scientific-name handling for the item-to-species crosswalk. Pure: no I/O.
 *
 * An item definition (FAO commodity definitions, CPC explanatory notes) names its plants in
 * italics: `Zea mays`, `Triticum spp.`, `(T. aestivum)`, `Brassica oleracea var. botrytis`.
 * `extractMentions` turns such a fragment into taxa; `matchMention` compares one of them with an
 * EcoCrop species (accepted name and synonyms). Nothing here knows any plant: the functions only
 * compare strings found in the two sources.
 */

export interface Taxon {
  /** Lower case. */
  genus: string;
  /** Lower case; absent for a genus-level name (`Dioscorea spp.`, `Citrus sp.`). */
  species?: string;
  /** Infraspecific epithet (var., subsp.), lower case. */
  infra?: string;
}

export interface Mention extends Taxon {
  /** The text the taxon was read from, for the audit trail. */
  raw: string;
  /** The vernacular name the definition gives just before the scientific one: `durian (Durio zibethinus)`. */
  label?: string;
}

const INFRA = /(?:\bvar|\bssp|\bsubsp|\bconvar)\b\.?\)?\s+([a-z][a-z-]{2,})/;
const NOT_EPITHET = new Set(['spp', 'sp', 'var', 'ssp', 'subsp', 'all', 'and', 'etc', 'the', 'for', 'syn', 'mainly', 'except']);
/** Family, order and class names are not genera. */
const HIGHER_RANK = /(aceae|idae|ales|opsida|ineae)$/;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** `Coffea canephora`, `Vigna unguiculata ssp. sesquipedalis`, `Fragaria x ananassa`, `Citrus sp.`. */
export function parseScientificName(name: string): Taxon | null {
  const s = name.replace(/\s+/g, ' ').trim();
  const m = /^([A-Z][a-z]+)(?:\s+(?:x|×)\s+|\s+)?(.*)$/.exec(s);
  if (!m) return null;
  const genus = fold(m[1]);
  const rest = m[2].trim();
  const sp = /^([a-z][a-z-]{2,})\b\.?/.exec(rest);
  if (!sp || NOT_EPITHET.has(sp[1]) || /^(sp|spp)\.?$/.test(rest.split(' ')[0])) return { genus };
  const infra = INFRA.exec(rest);
  return infra && !NOT_EPITHET.has(infra[1]) ? { genus, species: sp[1], infra: infra[1] } : { genus, species: sp[1] };
}

/** EcoCrop `synonyms`: entries separated by commas or semicolons, each a name followed by its authority. */
export function synonymTaxa(synonyms: string): Taxon[] {
  const out: Taxon[] = [];
  for (const part of synonyms.split(/[,;]/)) {
    const t = parseScientificName(part.trim());
    if (t?.species) out.push(t);
  }
  return out;
}

export const taxonKey = (t: Taxon) => [t.genus, t.species ?? '*', t.infra ?? ''].join(' ').trim();

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Taxa named in an HTML fragment. Two passes:
 *   1. italic runs (`<i>...</i>`): every binomial, abbreviation and genus is taken;
 *   2. the whole text: the source pages often leave a name outside italics or break the tags, so a
 *      binomial is also taken from plain text, but only when its genus is one EcoCrop knows
 *      (`knownGenera`), because plain text also holds English phrases shaped like a binomial
 *      ("Indian corn", "Irish potato"). `Genus spp.` is unambiguous and is always read.
 */
export function extractMentions(html: string, knownGenera?: ReadonlySet<string>): Mention[] {
  const out = new Map<string, Mention>();
  const genera: string[] = [];
  let label = '';
  const add = (t: Taxon, raw: string) => {
    if (!genera.includes(t.genus)) genera.push(t.genus);
    const k = taxonKey(t);
    if (!out.has(k)) out.set(k, label && t.species ? { ...t, raw: raw.trim(), label } : { ...t, raw: raw.trim() });
  };
  // `ragi, finger or African millet (Eleusine coracana);` -> the clause in front of the bracket.
  const labelBefore = (before: string, run: string): string => {
    if (!/^\s*\(/.test(run) && !/\(\s*$/.test(before)) return '';
    const clause = (before.replace(/\(\s*$/, '').split(/[;:.]|\binter alia\b/).pop() ?? '').replace(/\s+/g, ' ').trim();
    return /^[A-Za-z][A-Za-z ,'-]{1,58}$/.test(clause) ? clause : '';
  };
  const plain = (text: string) => {
    for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\s+(?:and\s+([A-Z][a-z]{2,})\s+)?spp\b/g)) {
      add({ genus: fold(m[1]) }, m[0]);
      if (m[2]) add({ genus: fold(m[2]) }, m[0]);
    }
  };
  const italic = (text: string) => {
    for (const piece of text.split(/[;,()[\]:/]|\band\b|\bor\b|\bsyn\b\.?|\bmainly\b|\bparticularly\b|\betc\b\.?/)) {
      const f = piece.replace(/\s+/g, ' ').trim();
      if (!f) continue;
      let m: RegExpExecArray | null;
      if ((m = /^([A-Z][a-z]{2,})\s+spp?\b\.?/.exec(f))) {
        add({ genus: fold(m[1]) }, f);
      } else if ((m = /^([A-Z][a-z]{2,})\s+([a-z][a-z-]{2,})\b/.exec(f)) && !NOT_EPITHET.has(m[2])) {
        const infra = INFRA.exec(f);
        add(infra && !NOT_EPITHET.has(infra[1]) ? { genus: fold(m[1]), species: m[2], infra: infra[1] } : { genus: fold(m[1]), species: m[2] }, f);
      } else if ((m = /^([A-Z][a-z]{0,2})\.\s*([a-z][a-z-]{2,})\b/.exec(f)) && !NOT_EPITHET.has(m[2])) {
        // `T. aestivum`, `Ph. vulgaris`: the genus is the latest one named in this definition with that initial.
        const abbr = fold(m[1]);
        const genus = [...genera].reverse().find((g) => g.startsWith(abbr));
        if (!genus) continue;
        const infra = INFRA.exec(f);
        add(infra && !NOT_EPITHET.has(infra[1]) ? { genus, species: m[2], infra: infra[1] } : { genus, species: m[2] }, f);
      } else if ((m = /^([a-z]{3,})\s+([a-z][a-z-]{2,})$/.exec(f)) && genera.includes(m[1]) && !NOT_EPITHET.has(m[2])) {
        // `oryza sativa`: a genus typed in lower case, accepted only when the genus was already named.
        add({ genus: m[1], species: m[2] }, f);
      } else if ((m = /^([A-Z][a-z]{3,})\.?$/.exec(f)) && !HIGHER_RANK.test(m[1])) {
        add({ genus: fold(m[1]) }, f);
      }
    }
  };
  const re = /<i\b[^>]*>([\s\S]*?)<\/i>/gi;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const before = stripTags(html.slice(last, m.index));
    plain(before);
    label = labelBefore(before, stripTags(m[1]));
    italic(stripTags(m[1]));
    label = '';
    last = re.lastIndex;
  }
  plain(stripTags(html.slice(last)));

  if (knownGenera) {
    const text = stripTags(html);
    const local: string[] = [];
    const scan = /\b([A-Z][a-z]{2,})\s+([a-z][a-z-]{2,})\b|\b([A-Z][a-z]{0,2})\.\s*([a-z][a-z-]{2,})\b/g;
    for (let m = scan.exec(text); m; m = scan.exec(text)) {
      const infra = /^\s+(?:var|ssp|subsp)\b\.?\s+([a-z][a-z-]{2,})/.exec(text.slice(scan.lastIndex, scan.lastIndex + 40));
      const taxon = (genus: string, sp: string): Taxon => (infra && !NOT_EPITHET.has(infra[1]) ? { genus, species: sp, infra: infra[1] } : { genus, species: sp });
      if (m[1]) {
        const genus = fold(m[1]);
        if (!knownGenera.has(genus)) continue;
        local.push(genus);
        if (m[2] === 'spp' || m[2] === 'sp') add({ genus }, m[0]);
        else if (!NOT_EPITHET.has(m[2])) add(taxon(genus, m[2]), m[0]);
      } else if (!NOT_EPITHET.has(m[4])) {
        const abbr = fold(m[3]);
        const genus = [...local].reverse().find((g) => g.startsWith(abbr)) ?? [...genera].reverse().find((g) => g.startsWith(abbr) && knownGenera.has(g));
        if (genus) add(taxon(genus, m[4]), m[0]);
      }
    }
  }
  return [...out.values()];
}

/**
 * How a definition's taxon relates to an EcoCrop species:
 *   variety          same species and same infraspecific epithet
 *   species          same binomial as the accepted name
 *   synonym          same binomial as one of the EcoCrop synonyms
 *   species-variety  the definition names one variety of the species, the EcoCrop row is the whole species
 *   genus            the definition names the genus (`spp.`) and the species belongs to it
 */
export type MatchKind = 'variety' | 'species' | 'synonym' | 'species-variety' | 'genus';

export const MATCH_SCORE: Record<MatchKind, number> = { variety: 5, species: 4, synonym: 4, 'species-variety': 2, genus: 1 };

export interface SpeciesNames {
  name: Taxon;
  synonyms: readonly Taxon[];
}

export function matchMention(m: Taxon, crop: SpeciesNames): MatchKind | null {
  if (!m.species) return crop.name.genus === m.genus ? 'genus' : null;
  if (crop.name.species && crop.name.genus === m.genus && crop.name.species === m.species) {
    if (m.infra && crop.name.infra) return m.infra === crop.name.infra ? 'variety' : null;
    return m.infra ? 'species-variety' : 'species';
  }
  for (const s of crop.synonyms) {
    if (s.genus !== m.genus || s.species !== m.species) continue;
    // A synonym given as a variety (`Citrus aurantium var. sinensis`) stands for that variety only.
    if (s.infra) {
      if (m.infra === s.infra) return 'synonym';
      continue;
    }
    return m.infra ? 'species-variety' : 'synonym';
  }
  return null;
}

/** Best relation between any of the mentions and the species (with the mention that gave it), or null. */
export function bestMatch<T extends Taxon>(mentions: readonly T[], crop: SpeciesNames): { kind: MatchKind; mention: T } | null {
  let best: { kind: MatchKind; mention: T } | null = null;
  for (const m of mentions) {
    const k = matchMention(m, crop);
    if (k && (!best || MATCH_SCORE[k] > MATCH_SCORE[best.kind])) best = { kind: k, mention: m };
  }
  return best;
}

/**
 * Commodity terms of an item name, singular, for the common-name fallback:
 * `Mangoes, guavas and mangosteens` -> mango, guava, mangosteen; `Chick peas, dry` -> chick pea.
 * Qualifiers after the head noun (dry, green, in shell, raw, n.e.c.) are not commodity terms.
 */
const QUALIFIER = /^(dry|dried|green|fresh|raw|in shell|shelled|unginned|ginned|other|n\.e\.c\.?|nes|excluding .*|including .*|for .*|in primary forms.*|unmanufactured|primary|total|.* n\.e\.c\.?)$/;

export function singular(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y');
  if (/(oes|ches|shes|sses|xes)$/.test(word)) return word.replace(/es$/, '');
  if (/s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.replace(/s$/, '');
  return word;
}

export function commodityTerms(itemName: string): string[] {
  const base = fold(itemName).replace(/\([^)]*\)/g, ' ');
  const out = new Set<string>();
  for (const part of base.split(/[,;]|\band\b|\bor\b/)) {
    const p = part.replace(/\s+/g, ' ').trim();
    if (!p || QUALIFIER.test(p)) continue;
    const words = p.split(' ');
    words[words.length - 1] = singular(words[words.length - 1]);
    out.add(words.join(' '));
  }
  return [...out];
}

/** Comparison key for vernacular names: `cow pea` = `cowpea` = `cow-pea`. */
export const nameKey = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');

/** True when one of the EcoCrop common names is exactly one of the item's commodity terms (singular or plural). */
export function commonNameMatches(commonNames: readonly string[], terms: readonly string[]): string | null {
  const keys = new Set(terms.map(nameKey));
  for (const n of commonNames) {
    const words = fold(n).trim().split(/\s+/);
    if (!words[0]) continue;
    const plain = nameKey(words.join(' '));
    words[words.length - 1] = singular(words[words.length - 1]);
    const single = nameKey(words.join(' '));
    if (keys.has(plain) || keys.has(single)) return n.trim();
  }
  return null;
}
