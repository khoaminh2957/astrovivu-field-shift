/**
 * Crop mention detection: longest-match n-grams over the query against an alias table built from
 * EcoCrop `common_names`, synonyms, scientific names and the curated EN/VI names.
 *
 * Folding makes "dau nanh" find "đậu nành", but it also makes "lựa chọn" (choose) look like "lúa"
 * (rice) and "điều kiện" (conditions) look like "điều" (cashew). Two guards:
 *  - `exact`: for short Vietnamese names, when the query itself carries diacritics, the original
 *    spelling must match, not only the folded one;
 *  - `EXCLUDE`: common phrases whose first or last syllable is a crop name.
 */
import { fold, hasDiacritics } from './text';

export interface AliasTable {
  /** Folded alias -> crop ids, most likely first. */
  map: Record<string, string[]>;
  /** Folded alias -> accepted spellings with diacritics (lowercase NFC). */
  exact: Record<string, string[]>;
}

const EXCLUDE = [
  'dieu kien', 'dieu chinh', 'dieu tri', 'dieu do', 'dieu hoa', 'dieu tiet', 'tieu thoat', 'tieu chuan', 'tieu hao', 'tieu thu',
  'tieu chi', 'tieu nuoc', 'hanh dong', 'hanh vi', 'tien hanh', 'thuc hanh', 'van hanh', 'cam on', 'cam thay', 'bong ra',
  'lua chon', 'me tay', 'bo re', 'mia mai', 'ke hoach', 'thong ke', 'thiet ke', 'ke tiep', 'ke ca', 'tra loi', 'kiem tra',
  'dieu tra', 'nghe nong', 'nghe nghiep', 'dau tien', 'dau vu', 'bat dau', 'ban dau', 'dau ra', 'dau vao', 'cai thien', 'cai tao',
  'chuoi thoi gian', 'ngo ngang', 'bap be', 'sang som',
  // "đạm" (nitrogen) folds to "dam", which EcoCrop lists as a name of the greater yam.
  'dam',
];

/**
 * Excluded only in a question typed without accents: "tôi" (I, my) is then "toi", the folded form
 * of "tỏi" (garlic). With accents the two are told apart by their spelling (`exact`), and "tỏi
 * cần pH bao nhiêu" must keep its garlic.
 */
const EXCLUDE_UNACCENTED = [
  'cua toi', 'ruong toi', 'vuon toi', 'dat toi', 'ray toi', 'nha toi', 'cho toi', 'giup toi', 'toi co', 'toi nen', 'toi muon', 'toi can',
  'toi dang', 'toi se', 'toi da', 'toi trong', 'toi bon', 'toi tuoi', 'toi hoi', 'toi thay',
];

export interface CropMention {
  cropIds: string[];
  alias: string;
  start: number;
  end: number;
}

/** Tokens of the query in two forms (original lowercase and folded), aligned. */
function tokens(q: string): { orig: string[]; folded: string[] } {
  const orig = (q.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? []).map((t) => t.replace(/'/g, ''));
  return { orig, folded: orig.map(fold) };
}

export function detectCrops(query: string, table: AliasTable, maxN = 4): CropMention[] {
  const { orig, folded } = tokens(query);
  const strict = hasDiacritics(query);
  const blocked = new Array(folded.length).fill(false);
  const joined = folded.join(' ');
  for (const ex of strict ? EXCLUDE : [...EXCLUDE, ...EXCLUDE_UNACCENTED]) {
    let idx = joined.indexOf(ex);
    while (idx >= 0) {
      const before = joined.slice(0, idx).split(' ').filter(Boolean).length;
      const n = ex.split(' ').length;
      const boundary = (idx === 0 || joined[idx - 1] === ' ') && (idx + ex.length === joined.length || joined[idx + ex.length] === ' ');
      if (boundary) for (let i = before; i < before + n; i++) blocked[i] = true;
      idx = joined.indexOf(ex, idx + 1);
    }
  }
  const out: CropMention[] = [];
  let i = 0;
  while (i < folded.length) {
    let matched = false;
    for (let n = Math.min(maxN, folded.length - i); n >= 1; n--) {
      if (blocked.slice(i, i + n).some(Boolean)) continue;
      const key = folded.slice(i, i + n).join(' ');
      const ids = table.map[key];
      if (!ids) continue;
      const spellings = table.exact[key];
      if (strict && spellings && !spellings.includes(orig.slice(i, i + n).join(' '))) continue;
      out.push({ cropIds: ids, alias: orig.slice(i, i + n).join(' '), start: i, end: i + n });
      i += n;
      matched = true;
      break;
    }
    if (!matched) i++;
  }
  return out;
}

/** Merge alias tables; earlier tables win the order of ids (curated core before full EcoCrop). */
export function mergeAliases(a: AliasTable, b: AliasTable): AliasTable {
  const map: Record<string, string[]> = { ...a.map };
  for (const [k, ids] of Object.entries(b.map)) map[k] = map[k] ? [...new Set([...map[k], ...ids])] : ids;
  return { map, exact: { ...b.exact, ...a.exact } };
}

/** Collapse an ambiguous mention to the ids worth using: prefer the curated ones. */
export function resolveMention(m: CropMention, isCurated: (id: string) => boolean, max = 2): string[] {
  const cur = m.cropIds.filter(isCurated);
  return (cur.length ? cur : m.cropIds).slice(0, max);
}
