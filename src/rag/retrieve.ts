/**
 * Query analysis + retrieval. Lexical BM25 (MiniSearch) with:
 *  - crop entity linking through the alias table, and a document boost for chunks about the
 *    mentioned crops (their fact sheet is always pinned first for crop-centred intents);
 *  - Vietnamese -> English expansion so a Vietnamese question also reaches English EcoCrop text
 *    (expanded terms count half);
 *  - intent-dependent boosts by chunk kind and a mild same-language boost;
 *  - at most `perDoc` chunks per document so one long article cannot fill the top-k.
 */
import type { KnowledgeChunk, Lang } from '@/contracts';
import { detectCrops, resolveMention } from './aliases';
import { detectTerms, type Intent, routeIntent, type Routed } from './intent';
import type { KnowledgeStore } from './store';
import { fold, terms } from './text';
import type { ChunkKind } from './types';

export interface Analysis extends Routed {
  query: string;
  lang: Lang;
  cropIds: string[];
  termIds: string[];
  expansion: string[];
}

export interface Hit {
  chunk: KnowledgeChunk;
  score: number;
}

// Folded Vietnamese phrase -> English search terms.
const VI_EN: [RegExp, string][] = [
  [/\bdat\b/, 'soil'],
  [/\bchua\b|do chua/, 'acid ph'],
  [/\bph\b/, 'ph'],
  [/\bmua\b/, 'rain rainfall'],
  [/nhiet do/, 'temperature'],
  [/kho han|\bhan\b/, 'drought dry'],
  [/\btuoi\b/, 'irrigation water'],
  [/luan canh/, 'rotation crop'],
  [/xen canh/, 'intercropping'],
  [/che phu/, 'cover crop'],
  [/phan xanh/, 'green manure'],
  [/sau benh|sau hai/, 'pests diseases'],
  [/\bbenh\b/, 'disease'],
  [/thu hoach/, 'harvest'],
  [/\bgieo\b|gieo trong/, 'sowing planting'],
  [/thoat nuoc/, 'drainage'],
  [/ngap|\bung\b/, 'waterlogging flooding'],
  [/phan bon|bon phan/, 'fertilizer'],
  [/suong gia|suong muoi/, 'frost'],
  [/do am/, 'moisture'],
  [/khi hau/, 'climate'],
  [/dieu kien/, 'conditions requirements'],
  [/ly tuong|toi uu/, 'optimal'],
  [/thoi gian sinh truong|bao lau|bao nhieu ngay/, 'growing period days'],
  [/dat set/, 'clay heavy'],
  [/dat cat/, 'sandy light'],
  [/nhiem man|do man|\bman\b/, 'salinity'],
  [/do cao/, 'altitude elevation'],
  [/anh sang|bong ram/, 'light shade'],
  [/ve tinh/, 'satellite'],
  [/cong dung/, 'uses'],
  [/nang suat/, 'yield'],
  [/ho dau/, 'legume nitrogen'],
  [/co dinh dam|\bdam\b/, 'nitrogen'],
  [/\bvoi\b/, 'lime liming'],
  [/nhiet/, 'heat'],
  [/\blanh\b|\bret\b/, 'cold'],
  [/trong/, 'grow cultivation'],
];

const KIND_BOOST: Record<Intent, Partial<Record<ChunkKind, number>>> = {
  ideal: { facts: 1.8, narrative: 1.2, wiki: 1.0, glossary: 0.6, concept: 0.6 },
  compare: { facts: 2.0, narrative: 1.1, glossary: 0.5, concept: 0.5 },
  field: { facts: 1.6, glossary: 1.2, narrative: 1.0, concept: 0.9 },
  // A reading of the parcel is explained by the glossary entry on the reading and on its source.
  'field-fact': { glossary: 2.0, concept: 1.3, facts: 0.5, narrative: 0.6 },
  'score-change': { glossary: 2.0, concept: 1.2, facts: 0.8 },
  term: { glossary: 2.2, concept: 1.5, facts: 0.4, narrative: 0.5, wiki: 0.7 },
  rotation: { concept: 1.5, glossary: 1.5, wiki: 1.3, facts: 0.9 },
  care: { wiki: 1.4, narrative: 1.3, facts: 1.0, glossary: 0.7 },
  general: {},
  'off-topic': {},
};

export function expandQuery(query: string, lang: Lang): string[] {
  if (lang !== 'vi' && !/[̀-ͯđĐ]/.test(query.normalize('NFD'))) return [];
  const q = fold(query);
  const out: string[] = [];
  for (const [re, en] of VI_EN) if (re.test(q)) out.push(...en.split(' '));
  return [...new Set(out)];
}

export function analyze(store: KnowledgeStore, query: string, lang: Lang, hasContext: boolean, contextCropId?: string | null): Analysis {
  const mentions = detectCrops(query, store.aliases);
  const cropIds: string[] = [];
  for (const m of mentions) for (const id of resolveMention(m, (id) => store.isCurated(id))) if (!cropIds.includes(id)) cropIds.push(id);
  const termIds = detectTerms(query);
  const routed = routeIntent(query, { cropCount: cropIds.length, hasContext, termHit: termIds.length > 0 });
  // A field question that names no crop is about the crop on the field.
  if ((routed.intent === 'field' || routed.intent === 'rotation' || routed.intent === 'care') && cropIds.length === 0 && contextCropId) cropIds.push(contextCropId);
  return { ...routed, query, lang, cropIds, termIds, expansion: expandQuery(query, lang) };
}

/** Switches used by the eval to measure each retrieval component; all on in production. */
export interface SearchOptions {
  cropBoost?: boolean;
  pin?: boolean;
  kindBoost?: boolean;
  langBoost?: boolean;
  expansion?: boolean;
}

export function search(store: KnowledgeStore, a: Analysis, topK = 6, perDoc = 2, opts: SearchOptions = {}): Hit[] {
  const o = { cropBoost: true, pin: true, kindBoost: true, langBoost: true, expansion: true, ...opts };
  if (!store.index) return [];
  const nOrig = terms(a.query).length;
  const crops = new Set(o.cropBoost ? a.cropIds : []);
  const kindBoost = KIND_BOOST[a.intent];
  const qText = o.expansion ? [a.query, ...a.expansion, ...a.termIds.map((t) => t.replace(/-/g, ' '))].join(' ') : a.query;
  const raw = store.index.search(qText, {
    boostTerm: (_t, i) => (i < nOrig ? 1 : 0.5),
    boostDocument: (_id, _term, stored) => {
      const s = stored as { lang?: string; kind?: ChunkKind; cropIds?: string } | undefined;
      let b = 1;
      if (crops.size) {
        const ids = s?.cropIds ? s.cropIds.split(' ') : [];
        if (ids.some((id) => crops.has(id))) b *= 3;
        else if (ids.length) b *= 0.35;
      }
      if (o.kindBoost && s?.kind) b *= kindBoost[s.kind] ?? 1;
      if (o.langBoost && s?.lang === a.lang) b *= 1.3;
      return b;
    },
  });
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const perDocCount = new Map<string, number>();
  const push = (chunk: KnowledgeChunk | undefined, score: number) => {
    if (!chunk || seen.has(chunk.id)) return;
    const n = perDocCount.get(chunk.docId) ?? 0;
    if (n >= perDoc) return;
    perDocCount.set(chunk.docId, n + 1);
    seen.add(chunk.id);
    hits.push({ chunk, score });
  };
  const top = raw[0]?.score ?? 1;
  // Entity linking: pin each mentioned crop's fact sheet (query language first) for crop intents.
  if (o.pin && ['ideal', 'compare', 'field', 'rotation', 'care'].includes(a.intent)) {
    for (const id of a.cropIds.slice(0, 3)) {
      const local = store.chunks.get(`eco:${id}:facts${a.lang === 'vi' ? '-vi' : ''}`) ?? store.chunks.get(`eco:${id}:facts`);
      push(local, top * 1.01);
    }
  }
  // Term intents: pin the glossary entry in the query language.
  if (o.pin && (a.intent === 'term' || a.intent === 'score-change' || a.intent === 'field-fact')) {
    const ids = a.intent === 'score-change' ? ['productivity-score', ...a.termIds] : a.termIds;
    for (const t of ids.slice(0, 2)) push(store.chunks.get(`gloss-${a.lang}:${t}`) ?? store.chunks.get(`gloss-${a.lang}:${t}:0`), top * 1.01);
  }
  for (const r of raw) {
    if (hits.length >= topK) break;
    push(store.chunks.get(String(r.id)), r.score);
  }
  return hits.slice(0, topK);
}
