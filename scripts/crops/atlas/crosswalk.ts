/**
 * The joins of the atlas, as rules over the parsed sources. Pure: no I/O.
 *
 *   FAOSTAT item  <->  EcoCrop species   by scientific name (definitions), then by common name
 *   SPAM crop     <->  FAOSTAT item      by the mapspamc table, then by name for the six newer crops
 *
 * Nothing here is a list of plants: every pairing comes out of comparing strings of two sources.
 */
import { MATCH_SCORE, bestMatch, commodityTerms, commonNameMatches, singular, type MatchKind, type Mention, type Taxon } from './taxa';

export interface CropItem {
  code: number;
  cpc: string;
  name: string;
  /** Name in the FAO commodity definitions; empty when the definitions have no row for this code. */
  faodefName: string;
  definition: string;
  definitionSources: string[];
  mentions: Mention[];
  openList: boolean;
  worldAreaHa: number;
  worldProductionT: number;
  countries: number;
}

export interface SpeciesIn {
  id: number;
  taxon: Taxon | null;
  synonyms: readonly Taxon[];
  commonNames: readonly string[];
  /** EcoCrop describes the plant as grown on a large or a small scale. */
  cultivated: boolean;
}

export type ItemClass = 'single' | 'group';

export interface ItemClassification {
  class: ItemClass;
  reason: string;
  /** Genera of the EcoCrop species the definition resolves to. */
  genera: string[];
}

export interface Candidate {
  item: number;
  kind: MatchKind;
  /** Vernacular name the definition gives for the matched scientific name. */
  label: string;
}

export type Match = 'exact' | 'group' | 'none';

export interface SpeciesMatch {
  match: Match;
  /** variety | species | synonym | species-variety | genus | name, or empty. */
  method: string;
  /** Items the species is attached to: all best-scoring single items (exact) or the one group item. */
  items: number[];
  primary: number | null;
  /** For `name` matches: the EcoCrop common name that equalled the item's commodity term. */
  matchedName: string;
  /** Vernacular name the FAO definition gives for this species in its item, if any. */
  label: string;
}

export const isNecName = (name: string) => /\bn\.e\.c\b|\bnes\b/i.test(name) || /^other\b/i.test(name.trim());

export interface CrosswalkResult {
  itemClass: Map<number, ItemClassification>;
  species: Map<number, SpeciesMatch>;
}

const byArea = (items: Map<number, CropItem>) => (a: number, b: number) => {
  const x = items.get(a)!;
  const y = items.get(b)!;
  return y.worldAreaHa - x.worldAreaHa || y.worldProductionT - x.worldProductionT || a - b;
};

export function buildCrosswalk(itemList: readonly CropItem[], speciesList: readonly SpeciesIn[]): CrosswalkResult {
  const items = new Map(itemList.map((i) => [i.code, i]));
  const candidates = new Map<number, Candidate[]>();
  const generaOf = new Map<number, Set<string>>(itemList.map((i) => [i.code, new Set<string>()]));
  /** Genera of which the definition singles out at least one species (not just `Genus spp.`). */
  const namedGenera = new Map<number, Set<string>>(itemList.map((i) => [i.code, new Set<string>()]));
  const genusOf = new Map<number, string>();

  // Pass 1: scientific names.
  for (const s of speciesList) {
    if (!s.taxon) continue;
    const names = { name: s.taxon, synonyms: s.synonyms };
    for (const it of itemList) {
      if (!it.mentions.length) continue;
      const hit = bestMatch(it.mentions, names);
      if (!hit) continue;
      const kind = hit.kind;
      // `Dioscorea spp.` covers every yam that is farmed, not the wild species of the genus: a
      // genus-level name reaches only the species EcoCrop itself describes as grown.
      if (kind === 'genus' && !s.cultivated) continue;
      // The definition's vernacular name belongs to the taxon it stands next to: it is passed on to the
      // species itself, not to a variety of it ("celery" is not the name of celeriac).
      const sameRank = kind === 'variety' || ((kind === 'species' || kind === 'synonym') && !s.taxon.infra);
      candidates.set(s.id, [...(candidates.get(s.id) ?? []), { item: it.code, kind, label: sameRank ? (hit.mention.label ?? '') : '' }]);
      generaOf.get(it.code)!.add(s.taxon.genus);
      genusOf.set(s.id, s.taxon.genus);
      if (kind !== 'genus') namedGenera.get(it.code)!.add(s.taxon.genus);
    }
  }

  // An item is a group when it is a residual class, an open list, or names EcoCrop species of several genera.
  const itemClass = new Map<number, ItemClassification>();
  for (const it of itemList) {
    const genera = [...generaOf.get(it.code)!].sort();
    let cls: ItemClass = 'single';
    let reason = genera.length === 1 ? `one genus (${genera[0]})` : 'no EcoCrop species named in the definition';
    if (isNecName(it.name)) {
      cls = 'group';
      reason = 'residual item (n.e.c. / other)';
    } else if (it.openList) {
      cls = 'group';
      reason = 'open list in the FAO definition ("including inter alia")';
    } else if (genera.length > 1) {
      cls = 'group';
      reason = `definition names EcoCrop species of ${genera.length} genera (${genera.join(', ')})`;
    }
    itemClass.set(it.code, { class: cls, reason, genera });
  }

  const sortItems = byArea(items);
  const species = new Map<number, SpeciesMatch>();
  const termsOf = new Map(itemList.map((i) => [i.code, commodityTerms(i.name)]));

  for (const s of speciesList) {
    const cand = candidates.get(s.id) ?? [];
    // "Oryza spp., mainly Oryza sativa": the item is rice, and it is Oryza sativa. Another species of
    // the genus is in the item but not singled out, so for that species the item acts as a group.
    const sidelined = (c: Candidate) => c.kind === 'genus' && namedGenera.get(c.item)!.has(genusOf.get(s.id) ?? '');
    const pick = (cls: ItemClass): SpeciesMatch | null => {
      const pool = cand.filter((c) => (itemClass.get(c.item)!.class === 'single' && !sidelined(c) ? 'single' : 'group') === cls);
      if (!pool.length) return null;
      const top = Math.max(...pool.map((c) => MATCH_SCORE[c.kind]));
      const best = pool.filter((c) => MATCH_SCORE[c.kind] === top);
      const codes = best.map((c) => c.item).sort(sortItems);
      const primary = codes[0];
      const chosen = best.find((c) => c.item === primary)!;
      const label = chosen.kind === 'genus' ? '' : chosen.label;
      return cls === 'single'
        ? { match: 'exact', method: chosen.kind, items: codes, primary, matchedName: '', label }
        : { match: 'group', method: chosen.kind, items: [primary], primary, matchedName: '', label };
    };
    let m = pick('single') ?? pick('group');
    if (!m) {
      // Pass 2: common names, only for species no definition names, and only into items whose own
      // scientific names resolved to no EcoCrop species (the definition uses a name EcoCrop lacks).
      // Where the definition already found its species, a second plant with the same vernacular
      // name is a homonym ("groundnut" is also Apios americana), not the commodity.
      const hits: { item: number; name: string }[] = [];
      for (const it of itemList) {
        if (generaOf.get(it.code)!.size > 0) continue;
        const name = commonNameMatches(s.commonNames, termsOf.get(it.code)!);
        if (name) hits.push({ item: it.code, name });
      }
      const single = hits.filter((h) => itemClass.get(h.item)!.class === 'single');
      const pool = single.length ? single : hits;
      if (pool.length) {
        const codes = pool.map((h) => h.item).sort(sortItems);
        m = {
          match: single.length ? 'exact' : 'group',
          method: 'name',
          items: single.length ? codes : [codes[0]],
          primary: codes[0],
          matchedName: pool.find((h) => h.item === codes[0])!.name,
          label: '',
        };
      }
    }
    species.set(s.id, m ?? { match: 'none', method: '', items: [], primary: null, matchedName: '', label: '' });
  }
  return { itemClass, species };
}

// ------------------------------------------------------------------------------------------------
// SPAM crops <-> FAOSTAT items
// ------------------------------------------------------------------------------------------------

export interface SpamCropIn {
  id: number;
  code: string;
  name: string;
}

export interface SpamCrop extends SpamCropIn {
  items: number[];
  /** `mapspamc` (crosswalk table) or `name` (crop name matched to item names; SPAM 2020 crops the table lacks). */
  method: 'mapspamc' | 'name' | '';
  /** `residual`: a class that pools many items (other vegetables, rest of crops); not evidence for one species. */
  class: 'individual' | 'residual';
}

const lower = (s: string) => s.toLowerCase();
const wordsOf = (s: string) =>
  lower(s)
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);

/**
 * @param table       mapspamc rows: SPAM crop code -> FAOSTAT item code (the 40-crop scheme of SPAM 2010).
 * @param itemNames   FAOSTAT crop items present in the data (code -> name).
 * @param groupLabel  label of each item's CPC parent class (e.g. "Citrus fruits"), for crops named after a class.
 */
export function buildSpamCrosswalk(
  crops: readonly SpamCropIn[],
  table: readonly { crop: string; item: number }[],
  itemNames: ReadonlyMap<number, string>,
  groupLabel: ReadonlyMap<number, string>,
): SpamCrop[] {
  const fromTable = new Map<string, number[]>();
  for (const r of table) fromTable.set(r.crop, [...(fromTable.get(r.crop) ?? []), r.item]);
  const out: SpamCrop[] = crops.map((c) => ({ ...c, items: [...(fromTable.get(c.code) ?? [])], method: fromTable.has(c.code) ? 'mapspamc' : '', class: 'individual' }));
  const isResidualName = (n: string) => /^(other|rest)\b/i.test(n);

  // SPAM 2020 crops the table does not know: the head noun of the crop name is looked up in the
  // FAOSTAT item names and in the label of each item's CPC parent class.
  const named = out.filter((c) => !c.method);
  for (const c of named) {
    const head = wordsOf(c.name).pop();
    if (!head) continue;
    for (const [code, name] of itemNames) {
      if (wordsOf(name).includes(head) || wordsOf(groupLabel.get(code) ?? '').includes(head)) c.items.push(code);
    }
    if (c.items.length) c.method = 'name';
  }
  // An item that now has its own SPAM crop leaves the residual class the older table put it in.
  for (const c of named) {
    for (const other of out) {
      if (other === c || !isResidualName(other.name)) continue;
      other.items = other.items.filter((i) => !c.items.includes(i));
    }
  }
  for (const c of out) {
    c.items = [...new Set(c.items)].sort((a, b) => a - b);
    c.class = isResidualName(c.name) || c.items.length > 3 ? 'residual' : 'individual';
  }
  return out;
}

/**
 * The SPAM crop of a species, given the SPAM crops its FAOSTAT item maps to. When two SPAM crops
 * share one item (small and pearl millet; arabica and robusta coffee), the species goes to the crop
 * whose name its EcoCrop common names carry ("pearl millet", "robusta coffee" for SPAM's "Robust
 * Coffee": each word of the SPAM name is a prefix of the word in the common name); a species no
 * name claims stays with the crop the crosswalk table gives the item.
 */
export function spamCropFor(candidates: readonly SpamCrop[], commonNames: readonly string[]): SpamCrop | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const names = commonNames.map((n) => lower(n).trim().split(/\s+/));
  const claims = candidates.filter((c) => {
    const w = lower(c.name).split(/\s+/);
    return names.some((n) => n.length === w.length && w.every((x, i) => n[i].startsWith(x)));
  });
  if (claims.length === 1) return claims[0];
  return candidates.find((c) => c.method === 'mapspamc') ?? candidates[0];
}
