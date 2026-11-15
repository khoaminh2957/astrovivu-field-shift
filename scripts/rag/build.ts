/**
 * `npm run rag:build` — builds the crop-knowledge index from local snapshots:
 *   FAO EcoCrop (data/ecocrop) for the crops the crop atlas keeps (data/crops/atlas/crops.csv),
 *   where each is grown (the atlas, from FAOSTAT), Wikipedia snapshots (data/rag/raw/wikipedia),
 *   the bilingual glossary (data/rag/glossary.*.md).
 * Writes public/rag/core.json (first load) and public/rag/full.json (lazy: the other crops of the
 * atlas, and the names of the species the atlas dropped), plus data/rag/manifest.json with
 * per-source counts and sizes.
 *
 * Flags: --fetch (download missing Wikipedia snapshots first), --refresh (re-download all).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import MiniSearch from 'minisearch';
import type { KnowledgeChunk } from '../../src/contracts';
import type { AliasTable } from '../../src/rag/aliases';
import { INDEX_OPTIONS } from '../../src/rag/searchConfig';
import { fold, slugify, terms, wordCount } from '../../src/rag/text';
import type { CropFacts, DroppedTable, IndexDoc, RagBundle } from '../../src/rag/types';
import { chunkKind } from '../../src/rag/types';
import { mergeShortSections, packParagraphs, parseWikiSections, type Section } from './chunk';
import { type DroppedSpecies, FAOSTAT_SOURCE, readAtlasCrops, readDropped } from './atlas';
import { CONCEPT_ARTICLES, CURATED, type CuratedCrop, FORMERLY_CURATED } from './curated';
import { aliasesOf, ecoChunks, factsFromAtlas, readEcoCrop, toFacts } from './ecocrop';
import { fetchAll, SNAP_DIR, type WikiSnapshot } from './fetch-wikipedia';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'public/rag');
const DATA = path.join(ROOT, 'data/rag');
const WIKI_LICENSE = 'CC BY-SA 4.0';
const GLOSSARY_LICENSE = 'CC BY 4.0 (Astrovivu team)';

// ------------------------------------------------------------------------------------------------
// Wikipedia
// ------------------------------------------------------------------------------------------------

const EN_KEEP =
  /cultivat|agronom|climat|soil|grow|pest|disease|rotation|harvest|irrigat|water|fertili[sz]|propagat|plant(ing)?\b|sowing|requirement|ecolog|environment|cover crop|weed|description|botany|uses?\b|nitrogen|varieties|cultivars|husbandry|management|intercrop|agricultur|farming|yield|storage|processing|biology|morphology|physiology|types|method|principle|application|measurement|definition|calculation|effect|benefit|limitation|overview|mechanism|factors?|sensor|instrument|data|product|mission|design|cause|prevention|protection|impact/i;
const EN_DROP =
  /history|etymology|culture|cuisine|culinary|nutrition|health|toxicity|economics|trade|see also|references|external links|further reading|notes|gallery|popular culture|symbol|religion|literature|production by|world production|genetics|genome|taxonomy|names?\b|chemistry|research|phytochemi|medicin|folklore|in art|legal|safety|allerg|food|dish|beverage|cooking|recipes?|consumption|marketing|market|price|statistic|countries|by country|launch|spacecraft|bibliography|sources|citations/i;
const VI_DROP = /tham khảo|liên kết ngoài|chú thích|xem thêm|hình ảnh|ghi chú|đọc thêm|thư viện ảnh|lịch sử|từ nguyên|văn hóa|văn hoá|ẩm thực|dinh dưỡng|món ăn|nguồn|thư mục|liên kết/i;

function selectSections(snap: WikiSnapshot, concept: boolean): Section[] {
  const secs = parseWikiSections(snap.extract).filter((s) => {
    if (s.path.length === 0) return true;
    if (snap.lang === 'vi') return !s.path.some((p) => VI_DROP.test(p));
    if (s.path.some((p) => EN_DROP.test(p))) return false;
    return concept || s.path.some((p) => EN_KEEP.test(p));
  });
  const cap = snap.lang === 'en' ? (concept ? 2200 : 3200) : concept ? 1500 : 2500;
  const out: Section[] = [];
  let total = 0;
  for (const s of mergeShortSections(secs)) {
    const w = wordCount(s.text);
    if (w < 25) continue;
    if (total + w > cap && out.length) break;
    out.push(s);
    total += w;
  }
  return out;
}

function readSnapshots(lang: 'en' | 'vi'): Map<string, WikiSnapshot> {
  const dir = path.join(SNAP_DIR, lang);
  const m = new Map<string, WikiSnapshot>();
  if (!fs.existsSync(dir)) return m;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) m.set(f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as WikiSnapshot);
  return m;
}

function wikiChunks(snap: WikiSnapshot, slug: string, opts: { cropIds?: string[]; tags: string[]; concept: boolean; label?: string }): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  const url = `https://${snap.lang}.wikipedia.org/w/index.php?title=${encodeURIComponent(snap.title.replace(/ /g, '_'))}&oldid=${snap.revid}`;
  let n = 0;
  for (const s of selectSections(snap, opts.concept)) {
    const where = s.path.length ? s.path.join(' / ') : snap.lang === 'vi' ? 'Tổng quan' : 'Overview';
    for (const piece of packParagraphs(s.text)) {
      out.push({
        id: `wiki-${snap.lang}:${slug}:${String(n++).padStart(2, '0')}`,
        docId: `wiki-${snap.lang}:${slug}`,
        title: `${snap.title}: ${where}`,
        text: piece.replace(/\n+/g, ' '),
        lang: snap.lang,
        source: { name: `Wikipedia (${snap.lang}): ${snap.title}`, url, license: WIKI_LICENSE },
        cropIds: opts.cropIds,
        tags: [`kind:${opts.concept ? 'concept' : 'wiki'}`, 'wikipedia', ...opts.tags, ...s.path.slice(0, 2).map((p) => `sec:${slugify(p)}`)],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Glossary
// ------------------------------------------------------------------------------------------------

interface GlossaryEntry {
  id: string;
  title: string;
  aliases: string[];
  tags: string[];
  text: string;
}

export function parseGlossary(md: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const block of md.split(/^## /m).slice(1)) {
    const lines = block.split('\n');
    const id = lines[0].trim();
    const meta: Record<string, string> = {};
    let i = 1;
    for (; i < lines.length; i++) {
      const m = lines[i].match(/^(title|aliases|tags):\s*(.*)$/);
      if (!m) break;
      meta[m[1]] = m[2];
    }
    const text = lines.slice(i).join('\n').trim();
    out.push({
      id,
      title: meta.title ?? id,
      aliases: (meta.aliases ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      tags: (meta.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      text,
    });
  }
  return out;
}

function glossaryChunks(lang: 'en' | 'vi'): { chunks: KnowledgeChunk[]; names: Map<string, string> } {
  const file = path.join(DATA, `glossary.${lang}.md`);
  const entries = parseGlossary(fs.readFileSync(file, 'utf8'));
  const chunks: KnowledgeChunk[] = [];
  const names = new Map<string, string>();
  for (const e of entries) {
    const pieces = packParagraphs(e.text, 120, 320);
    pieces.forEach((p, k) => {
      const id = `gloss-${lang}:${e.id}${pieces.length > 1 ? `:${k}` : ''}`;
      chunks.push({
        id,
        docId: `gloss:${e.id}`,
        title: e.title,
        text: p.replace(/\n+/g, ' '),
        lang,
        source: { name: lang === 'vi' ? 'Thuật ngữ Astrovivu' : 'Astrovivu glossary', url: `data/rag/glossary.${lang}.md#${e.id}`, license: GLOSSARY_LICENSE },
        tags: ['kind:glossary', `term:${e.id}`, ...e.tags],
      });
      names.set(id, [e.title, ...e.aliases].join(' ; '));
    });
  }
  return { chunks, names };
}

// ------------------------------------------------------------------------------------------------
// Aliases
// ------------------------------------------------------------------------------------------------

// Words that are crop names somewhere in EcoCrop but ordinary words in a farming question.
const GENERIC = new Set(
  (
    'okay date lime rape cane gram oil palm grass tree herb weed vine bean beans pea peas nut nuts root roots seed seeds leaf ' +
    'water rain soil cover field garden wild common sweet bitter black white red yellow green blue hot cold rush reed quick ' +
    'rocket fat hog dog cat bush plant crop crops fruit berry apple pear plum moss fern cress star sun moon ice snow fire ' +
    // "dam": a name EcoCrop lists for the greater yam, and the folded form of "đạm" (nitrogen).
    'mai tao cay hoa rau la qua hat cu re than bo de me ca an ga dam'
  ).split(' '),
);

/** The folded form of a name that the alias tables are keyed by; null for names not worth matching. */
function aliasKey(alias: string): string | null {
  const key = fold(alias).replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Single letters ("L.", "G.") are abbreviations, never names worth matching.
  return key.length < 2 || key.split(' ').some((w) => w.length < 2) ? null : key;
}

/** A one-word name of a species that is not curated: too short, an ordinary word, or frequent in prose. */
const tooGeneric = (key: string, genericDf: (folded: string) => number): boolean => !key.includes(' ') && (key.length < 4 || GENERIC.has(key) || genericDf(key) >= 3);

function buildAliases(
  entries: { facts: CropFacts; aliases: string[]; curated?: CuratedCrop }[],
  genericDf: (folded: string) => number,
): AliasTable {
  const map: Record<string, string[]> = {};
  const exact: Record<string, string[]> = {};
  const add = (alias: string, id: string, curated: boolean, first: boolean) => {
    const key = aliasKey(alias);
    if (!key) return;
    const single = !key.includes(' ');
    if (!curated) {
      if (tooGeneric(key, genericDf)) return;
    } else if (single && GENERIC.has(key) && !first) return;
    const list = (map[key] ??= []);
    if (!list.includes(id)) {
      if (first) list.unshift(id);
      else list.push(id);
    }
    const orig = alias.normalize('NFC').toLowerCase().trim();
    if (orig !== key && curated && key.split(' ').length <= 2) {
      const ex = (exact[key] ??= []);
      if (!ex.includes(orig)) ex.push(orig);
    }
  };
  for (const { facts, aliases, curated } of entries) {
    const primary = curated ? [curated.en, ...(curated.enAliases ?? []), ...curated.vi, facts.sci] : [facts.sci];
    for (const a of primary) add(a, facts.id, Boolean(curated), true);
    for (const a of aliases) add(a, facts.id, Boolean(curated), false);
  }
  // An exact-spelling guard only makes sense when every id behind the key came with a spelling.
  for (const k of Object.keys(exact)) if (!map[k]) delete exact[k];
  return { map, exact };
}

/**
 * Names of the species the atlas dropped, so that a question about one gets "not in the data, and
 * why". A name a kept crop already answers to is left to the kept crop.
 */
export function buildDropped(dropped: DroppedSpecies[], kept: (key: string) => boolean, genericDf: (folded: string) => number): DroppedTable {
  const aliases: Record<string, string[]> = {};
  const species: DroppedTable['species'] = {};
  const former = new Map(FORMERLY_CURATED.map((f) => [f.eco, f.names]));
  for (const d of dropped) {
    let named = false;
    // The names a species was curated under are taken as given; the others pass the filter for generic words.
    const given = new Set((former.get(d.sci) ?? []).map((n) => aliasKey(n)));
    for (const name of [d.sci, ...(former.get(d.sci) ?? []), ...d.commonNames]) {
      const key = aliasKey(name.replace(/['‚’]+$/, ''));
      if (!key || kept(key) || (!given.has(key) && tooGeneric(key, genericDf))) continue;
      const list = (aliases[key] ??= []);
      if (!list.includes(d.id)) list.push(d.id);
      named = true;
    }
    if (named) species[d.id] = [d.sci, d.reason === 'no-item' ? 'n' : 'g'];
  }
  return { aliases, species };
}

// ------------------------------------------------------------------------------------------------
// Index
// ------------------------------------------------------------------------------------------------

function toDoc(c: KnowledgeChunk, names: string): IndexDoc {
  return {
    id: c.id,
    title: c.title,
    names,
    tags: (c.tags ?? []).filter((t) => !t.startsWith('kind:')).map((t) => t.replace(/^[a-z]+:/, '').replace(/-/g, ' ')).join(' '),
    text: c.text,
    lang: c.lang,
    kind: chunkKind(c),
    cropIds: (c.cropIds ?? []).join(' '),
  };
}

function writeJson(file: string, data: unknown): { bytes: number; gzip: number } {
  const s = JSON.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s);
  return { bytes: Buffer.byteLength(s), gzip: zlib.gzipSync(s, { level: 9 }).length };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--fetch') || args.has('--refresh') || !fs.existsSync(path.join(SNAP_DIR, 'en'))) {
    console.log('Fetching Wikipedia snapshots...');
    const r = await fetchAll(args.has('--refresh'));
    console.log(`  ${r.ok} pages; missing: ${r.missing.length}`);
  }
  const builtAt = new Date().toISOString();

  // The crops of the atlas: EcoCrop rows for those that have one, the atlas row alone for the rest.
  const atlas = readAtlasCrops();
  const atlasByEco = new Map(atlas.filter((a) => a.ecocropId != null).map((a) => [a.ecocropId!, a]));
  const rows = readEcoCrop().filter((r) => atlasByEco.has(Number(r.ecocrop_id)));
  const curatedBySci = new Map(CURATED.map((c) => [c.eco, c]));
  const notKept = CURATED.filter((c) => !atlas.some((a) => a.sci === c.eco)).map((c) => c.eco);
  if (notKept.length) throw new Error(`Curated species the crop atlas does not keep: ${notKept.join(', ')}`);
  type Species = { row: Record<string, string> | null; facts: CropFacts; curated: CuratedCrop | undefined; aliases: string[] };
  const species: Species[] = rows.map((row) => {
    const crop = atlasByEco.get(Number(row.ecocrop_id))!;
    const curated = curatedBySci.get(row.name.trim());
    const facts = toFacts(row, curated, crop);
    if (facts.id !== crop.cropId) throw new Error(`Crop id of the atlas (${crop.cropId}) and of the index (${facts.id}) differ for EcoCrop ${row.ecocrop_id}`);
    return { row, facts, curated, aliases: aliasesOf(row, curated, crop) };
  });
  for (const crop of atlas.filter((a) => a.ecocropId == null)) {
    const curated = curatedBySci.get(crop.sci);
    species.push({ row: null, facts: factsFromAtlas(crop, curated), curated, aliases: [crop.sci, crop.nameEn, crop.nameVi, ...(curated ? [curated.en, ...(curated.enAliases ?? []), ...curated.vi] : [])].filter((n): n is string => Boolean(n)) });
  }
  const ids = new Set<string>();
  for (const s of species) {
    if (ids.has(s.facts.id)) throw new Error(`Duplicate crop id ${s.facts.id}`);
    ids.add(s.facts.id);
  }
  const sheetless = atlas.filter((a) => !ids.has(a.cropId)).map((a) => a.cropId);
  if (sheetless.length) throw new Error(`Crops of the atlas without a fact sheet: ${sheetless.join(', ')}`);
  const cropNames = new Map<string, string>();
  for (const s of species) {
    const names = s.curated ? [s.facts.sci, s.curated.en, ...(s.curated.enAliases ?? []), ...s.curated.vi, ...s.facts.names.slice(0, 4)] : [s.facts.sci, ...[s.facts.en, s.facts.vi].filter((n): n is string => Boolean(n)), ...s.facts.names.slice(0, 6)];
    cropNames.set(s.facts.id, names.join(' ; '));
  }

  // Wikipedia
  const enSnaps = readSnapshots('en');
  const viSnaps = readSnapshots('vi');
  const wiki: KnowledgeChunk[] = [];
  const wikiDocs: { source: string; lang: string; title: string; revid: number; url: string; chunks: number }[] = [];
  const pushWiki = (snap: WikiSnapshot | undefined, slug: string, opts: Parameters<typeof wikiChunks>[2]) => {
    if (!snap) return;
    const cs = wikiChunks(snap, slug, opts);
    wiki.push(...cs);
    wikiDocs.push({ source: `wikipedia-${snap.lang}`, lang: snap.lang, title: snap.title, revid: snap.revid, url: snap.url, chunks: cs.length });
  };
  for (const c of CURATED) {
    const slug = slugify(c.wiki);
    const id = slugify(c.eco);
    pushWiki(enSnaps.get(slug), slug, { cropIds: [id], tags: [`group:${c.group}`], concept: false });
    pushWiki(viSnaps.get(slug), slug, { cropIds: [id], tags: [`group:${c.group}`], concept: false });
  }
  for (const a of CONCEPT_ARTICLES) {
    const slug = slugify(a.wiki);
    pushWiki(enSnaps.get(slug), slug, { tags: a.tags, concept: true });
    pushWiki(viSnaps.get(slug), slug, { tags: a.tags, concept: true });
  }

  // Glossary
  const gEn = glossaryChunks('en');
  const gVi = glossaryChunks('vi');
  const glossary = [...gEn.chunks, ...gVi.chunks];
  const glossaryNames = new Map([...gEn.names, ...gVi.names]);

  // EcoCrop chunks
  const ecoCore: KnowledgeChunk[] = [];
  const ecoFull: KnowledgeChunk[] = [];
  // The passages on where a crop is grown go into the lazy bundle for every crop, the curated ones
  // included: the first-load bundle carries the same facts as data (`CropFacts.prevalence`) and
  // does not grow by 140 passages that only a question about countries reads.
  for (const s of species) {
    for (const c of ecoChunks(s.row, s.facts, s.curated)) (s.curated && chunkKind(c) !== 'where' ? ecoCore : ecoFull).push(c);
  }

  const core = [...ecoCore, ...wiki, ...glossary];
  const all = [...core, ...ecoFull];

  // Document frequency of single words in prose (wiki + glossary) flags generic aliases.
  const df = new Map<string, number>();
  for (const c of [...wiki, ...glossary]) for (const t of new Set(terms(c.text))) df.set(t, (df.get(t) ?? 0) + 1);
  const curatedSpecies = species.filter((s) => s.curated);
  const otherSpecies = species.filter((s) => !s.curated);
  const aliasCore = buildAliases(curatedSpecies, (k) => df.get(k) ?? 0);
  const aliasFull = buildAliases(otherSpecies, (k) => df.get(k) ?? 0);
  // Keys already owned by a curated crop stay with it (core wins at merge time).

  const namesOf = (c: KnowledgeChunk) =>
    glossaryNames.get(c.id) ?? (c.cropIds ?? []).map((id) => cropNames.get(id) ?? '').join(' ; ');

  const coreIndex = new MiniSearch<IndexDoc>(INDEX_OPTIONS);
  coreIndex.addAll(core.map((c) => toDoc(c, namesOf(c))));
  const fullIndex = new MiniSearch<IndexDoc>(INDEX_OPTIONS);
  fullIndex.addAll(all.map((c) => toDoc(c, namesOf(c))));

  // Species the atlas dropped: a name is theirs only when no kept crop answers to it.
  const droppedSpecies = readDropped();
  const dropped = buildDropped(droppedSpecies, (key) => key in aliasCore.map || key in aliasFull.map, (k) => df.get(k) ?? 0);

  const coreBundle: RagBundle = { version: 1, kind: 'core', builtAt, chunks: core, crops: curatedSpecies.map((s) => s.facts), aliases: aliasCore, index: coreIndex.toJSON() as unknown as Record<string, unknown> };
  const fullBundle: RagBundle = { version: 1, kind: 'full', builtAt, chunks: ecoFull, crops: otherSpecies.map((s) => s.facts), aliases: aliasFull, index: fullIndex.toJSON() as unknown as Record<string, unknown>, dropped };
  const coreSize = writeJson(path.join(OUT, 'core.json'), coreBundle);
  const fullSize = writeJson(path.join(OUT, 'full.json'), fullBundle);

  const count = (pred: (c: KnowledgeChunk) => boolean) => all.filter(pred).length;
  const docCount = (pred: (c: KnowledgeChunk) => boolean) => new Set(all.filter(pred).map((c) => c.docId)).size;
  const words = all.map((c) => wordCount(c.text)).sort((a, b) => a - b);
  const manifest = {
    builtAt,
    sources: {
      ecocrop: { license: 'FAO EcoCrop (attribution, non-commercial)', documents: species.filter((s) => s.row).length, chunks: count((c) => c.id.startsWith('eco:') && chunkKind(c) !== 'where' && c.source.name === 'FAO EcoCrop'), factSheets: count((c) => chunkKind(c) === 'facts' && c.source.name === 'FAO EcoCrop'), cleanedRows: species.filter((s) => s.facts.cleaning).length },
      'crop-atlas': { license: FAOSTAT_SOURCE.license, documents: atlas.length, chunks: count((c) => chunkKind(c) === 'where'), sheetsWithoutEcoCrop: species.filter((s) => !s.row).map((s) => s.facts.id), byMatch: { exact: atlas.filter((a) => a.match === 'exact').length, group: atlas.filter((a) => a.match === 'group').length, none: atlas.filter((a) => a.match === 'none').length } },
      'wikipedia-en': { license: WIKI_LICENSE, documents: docCount((c) => c.id.startsWith('wiki-en:')), chunks: count((c) => c.id.startsWith('wiki-en:')) },
      'wikipedia-vi': { license: WIKI_LICENSE, documents: docCount((c) => c.id.startsWith('wiki-vi:')), chunks: count((c) => c.id.startsWith('wiki-vi:')) },
      'glossary-en': { license: GLOSSARY_LICENSE, documents: docCount((c) => c.id.startsWith('gloss-en:')), chunks: count((c) => c.id.startsWith('gloss-en:')) },
      'glossary-vi': { license: GLOSSARY_LICENSE, documents: docCount((c) => c.id.startsWith('gloss-vi:')), chunks: count((c) => c.id.startsWith('gloss-vi:')) },
    },
    chunks: { core: core.length, total: all.length, wordsMedian: words[Math.floor(words.length / 2)], wordsP10: words[Math.floor(words.length * 0.1)], wordsP90: words[Math.floor(words.length * 0.9)] },
    aliases: { core: Object.keys(aliasCore.map).length, full: Object.keys(aliasFull.map).length },
    dropped: { inAtlas: droppedSpecies.length, named: Object.keys(dropped.species).length, names: Object.keys(dropped.aliases).length },
    crops: { core: curatedSpecies.length, full: otherSpecies.length },
    artifacts: { 'public/rag/core.json': coreSize, 'public/rag/full.json': fullSize },
    wikipedia: wikiDocs,
    missingVietnamese: CURATED.filter((c) => !viSnaps.has(slugify(c.wiki))).map((c) => c.wiki),
  };
  fs.writeFileSync(path.join(DATA, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
  console.log(`core: ${core.length} chunks, ${kb(coreSize.bytes)} (${kb(coreSize.gzip)} gzip)`);
  console.log(`full: ${all.length} chunks indexed, ${kb(fullSize.bytes)} (${kb(fullSize.gzip)} gzip)`);
  console.log(JSON.stringify(manifest.sources), JSON.stringify(manifest.chunks));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
