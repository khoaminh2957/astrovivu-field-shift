/**
 * Item definitions that name the plants behind a FAOSTAT item. Two sources, both parsed by rule:
 *
 *   1. FAO, "Definition and classification of commodities" (the FAOSTAT commodity list, FCL): one
 *      HTML table row per commodity, keyed by the FCL code, which is the FAOSTAT `Item Code`.
 *   2. CPC Ver. 2.1 explanatory notes, keyed by the CPC code FAOSTAT prints as `Item Code (CPC)`.
 *
 * Pure parsing: the caller reads the files.
 */
import { extractMentions, type Mention } from './taxa';
import { parseCsvObjects } from './csv';

export interface FaodefItem {
  /** FCL code = FAOSTAT item code. */
  code: number;
  name: string;
  /** Description with tags removed (second table cell without the commodity name). */
  text: string;
  /** "Including inter alia: ...": the list is open-ended, so the item is a group by definition. */
  openList: boolean;
  mentions: Mention[];
}

const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function parseFaodefPage(html: string, knownGenera?: ReadonlySet<string>): FaodefItem[] {
  const out: FaodefItem[] = [];
  for (const tr of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = tr.split(/<td\b[^>]*>/i).slice(1);
    if (cells.length < 2) continue;
    const code = clean(cells[0]);
    if (!/^\d{4}$/.test(code)) continue;
    const cell = cells[1].replace(/<\/t[dr]>[\s\S]*$/i, '');
    const bold = /<b\b[^>]*>([\s\S]*?)<\/b>/i.exec(cell);
    const body = bold ? cell.replace(bold[0], ' ') : cell;
    const text = clean(body).replace(/^>\s*/, '');
    out.push({
      code: Number(code),
      name: clean(bold?.[1] ?? '').replace(/^\[|\]$/g, ''),
      text,
      openList: /^includ(e|es|ing)\b/i.test(text),
      mentions: extractMentions(body, knownGenera),
    });
  }
  return out;
}

export interface CpcClass {
  code: string;
  label: string;
  parent: string;
  /** Text of "This subclass includes" up to "This subclass does not include". */
  includes: string;
  mentions: Mention[];
}

export function parseCpc(csvText: string, knownGenera?: ReadonlySet<string>): Map<string, CpcClass> {
  const out = new Map<string, CpcClass>();
  for (const r of parseCsvObjects(csvText)) {
    const code = r.code;
    if (!code) continue;
    const note = r.note ?? '';
    const start = note.search(/This (sub)?class includes:/i);
    const stop = note.search(/This (sub)?class does not include:/i);
    const includes = start < 0 ? '' : note.slice(start, stop > start ? stop : undefined);
    const prev = out.get(code);
    const html = `${r.label_en} ${includes}`;
    const mentions = extractMentions(html, knownGenera);
    if (prev) {
      // The file repeats a class when it carries both a revision remark and explanatory notes.
      const seen = new Set(prev.mentions.map((m) => `${m.genus} ${m.species ?? ''} ${m.infra ?? ''}`));
      for (const m of mentions) if (!seen.has(`${m.genus} ${m.species ?? ''} ${m.infra ?? ''}`)) prev.mentions.push(m);
      if (includes && !prev.includes) prev.includes = clean(includes);
    } else {
      out.set(code, { code, label: clean(r.label_en), parent: r.broader ?? '', includes: clean(includes), mentions });
    }
  }
  return out;
}

/** UN M49 overview page: `<td>Viet Nam</td><td>704</td><td>VN</td><td>VNM</td>` -> 704 -> VNM. */
export function parseM49(html: string): Map<string, { iso3: string; name: string }> {
  const out = new Map<string, { iso3: string; name: string }>();
  for (const tr of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = tr
      .split(/<td\b[^>]*>/i)
      .slice(1)
      .map((c) => clean(c.replace(/<\/td>[\s\S]*$/i, '')));
    for (let k = 1; k + 2 < cells.length; k++) {
      if (/^\d{3}$/.test(cells[k]) && /^[A-Z]{2}$/.test(cells[k + 1]) && /^[A-Z]{3}$/.test(cells[k + 2])) {
        if (!out.has(cells[k])) out.set(cells[k], { iso3: cells[k + 2], name: cells[k - 1] });
        break;
      }
    }
  }
  return out;
}

export interface GeoNamesCountry {
  iso3: string;
  numeric: string;
  fips: string;
  name: string;
}

/** GeoNames countryInfo.txt: tab-separated, `#` comments; columns ISO, ISO3, ISO-Numeric, fips, Country. */
export function parseGeoNames(text: string): GeoNamesCountry[] {
  const out: GeoNamesCountry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length < 5 || !/^[A-Z]{3}$/.test(c[1])) continue;
    out.push({ iso3: c[1], numeric: c[2].padStart(3, '0'), fips: c[3], name: c[4] });
  }
  return out;
}

/** SPAM readme crop table: `1<TAB>whea<TAB>Wheat`. */
export function parseSpamReadme(text: string): { id: number; code: string; name: string }[] {
  const out: { id: number; code: string; name: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d{1,2})\s+([a-z]{4})\s+(\S.*)$/.exec(line.trim());
    if (m) out.push({ id: Number(m[1]), code: m[2], name: m[3].trim() });
  }
  return out;
}
