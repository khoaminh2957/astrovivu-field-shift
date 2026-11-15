# Crop-knowledge assistant (RAG)

The Ask panel answers two kinds of question, in English and Vietnamese, with citations: questions about crops (ideal conditions, comparisons, rotation partners, care) and questions about the locked field ("is my soil too acid for soybean?", "why did the score drop in March?", "what does root-zone moisture mean here?"). It also explains the scientific terms the challenge names (evapotranspiration, soil-moisture anomaly, NDVI, frost risk, water balance) and how satellite data differs from ground measurements.

It works as a static site with no key: retrieval and a grounded extractive answer run in the browser. A language model is an optional upgrade through the local API server.

## Corpus

| Source | Licence | Documents | Chunks | In first load |
|---|---|---|---|---|
| FAO EcoCrop (fact sheets from requirement columns + `notes` narrative) | © FAO, attribution, non-commercial | 2,568 species | 4,845 (2,642 fact sheets: EN for all, VI for the 74 curated crops) | curated 74 only |
| Wikipedia EN: 74 crop articles + 24 method articles | CC BY-SA 4.0 | 98 | 830 | yes |
| Wikipedia VI (via language links) | CC BY-SA 4.0 | 82 (all 74 crops, 8 of 24 method articles exist in Vietnamese) | 377 | yes |
| Astrovivu glossary EN / VI (28 entries each) | CC BY 4.0 | 28 + 28 | 28 + 28 | yes |
| **Total** | | | **6,108** (median 155 words; p10 50, p90 231) | 1,559 |

Details, revision ids and the sources considered and rejected: `data/rag/ATTRIBUTION.md`; counts: `data/rag/manifest.json`. The curated crop list (staples, pulses, oilseeds, roots, Central Highlands perennials such as coffee, pepper, durian, avocado, macadamia, cover crops, vegetables, herbs) is `scripts/rag/curated.ts`.

EcoCrop cleaning (docs/DATA_SOURCES.md §5): temperatures beyond ±60 °C and latitudes beyond 90° are dropped as wrong-scale, a growing cycle of 0 is missing, pH outside 0-14 is dropped; 693 rows had something cleaned and each fact record lists what in `cleaning`. Crop ids are slugs of the EcoCrop scientific name (`coffea-canephora`, `lycopersicon-esculentum` for tomato, `vicia-villosa-ssp-villosa` for hairy vetch).

## Pipeline

```
data/ecocrop + data/rag/raw/wikipedia + data/rag/glossary.*.md
   └─ scripts/rag/build.ts ─ chunk by section (150-300 words) ─ aliases ─ MiniSearch
        ├─ public/rag/core.json   curated crops + Wikipedia + glossary (first load)
        └─ public/rag/full.json   index over ALL chunks + the other 2,494 species (lazy)
src/rag (browser and server)
   ask(req) ─ health check ─┬─ generative: POST /api/ask (server retrieves the same way, Claude writes)
                            └─ extractive: analyze → search → compose (templates over facts + quotes)
```

**Chunking.** Wikipedia extracts are split on `== headings ==`; crop articles keep the lead and sections whose heading path matches cultivation, climate, soil, pests, rotation, harvest and similar (history, cuisine, nutrition, production tables are dropped), capped at 3,200 words (EN) / 2,500 (VI) per article. Paragraphs are packed to at most 300 words, long ones split on sentences, short tails merged. EcoCrop notes are split on their own headings (DESCRIPTION, USES, GROWING PERIOD, FURTHER INF.); common names and sources are dropped from the text and kept as aliases.

**Index.** MiniSearch (BM25) over `title` (boost 2), `names` (3: scientific + curated EN/VI names + EcoCrop common names), `tags` (1.5) and `text` (1). Prefix matching for terms of 5+ characters, fuzzy only for 7+, because short Vietnamese syllables are one edit apart from unrelated words. Text is indexed folded (lowercase, no diacritics, đ → d) so "dat chua" finds "đất chua".

**Query analysis** (`src/rag/retrieve.ts`, `intent.ts`, `aliases.ts`):
- Crop linking: longest-match n-grams against 1,660 curated-crop aliases and 15,318 aliases of the other EcoCrop species. Folding creates collisions ("lựa chọn" = choose looks like "lúa" = rice; "điều kiện" = conditions looks like "điều" = cashew; "vối" = robusta looks like "vôi" = lime), so short Vietnamese names must match with their diacritics when the query has any, and a list of common phrases is excluded. Generic words that are crop names somewhere in EcoCrop ("date", "lime") are dropped when they occur in 3+ prose chunks.
- Intent routing (rules, both languages): ideal conditions, compare, field suitability, score change, explain a term, rotation, care, general, off-topic.
- Vietnamese→English expansion (e.g. "chua" → acid pH, "luân canh" → rotation) at half weight, so Vietnamese questions also reach English EcoCrop text.
- Boosts: ×3 for chunks about the mentioned crop (×0.35 for other crops), by chunk kind per intent (fact sheets for requirement questions, glossary for term questions), ×1.3 same language; the crop's fact sheet (or the glossary entry) is pinned first; at most 2 chunks per document.

**Extractive answers** (`src/rag/compose.ts`) follow docs/SYSTEM_INSTRUCTIONS.md by template: numbers come only from EcoCrop facts or `FieldContext`, each field number keeps its source, pixel and date, missing facts are named with the cheapest way to get them, quotes are one sentence each with `[S#]`, quotes about another crop are never used, and every answer ends with one next step. Field questions compare field facts with the crop's window deterministically (`src/rag/suitability.ts`): pH 5.6 against soybean's optimal 5.5-6.5 → "inside the optimal range", plus the caveat that a SoilGrids value is a 250 m model estimate. Score-change questions read the monthly `score_YYYY-MM` facts and the limiting factor. Each answer returns 2-3 follow-up questions.

**FieldContext** (`buildFieldContext` in `src/rag/fieldContext.ts`, pure): latest value at the cursor of each key series (`sampleAt`, with stale flag and anomaly against the day-of-year baseline), 30/90-day rain sums, all static facts with their uncertainty, climate normals (annual and monthly) from `climateHistory`, ground-truth overrides ("measured by the farmer; satellite/model estimate was …"), score at the cursor, every factor, and one score per month. Each fact is a string that starts with the value, e.g. `sm_root: "0.21 m³/m³ (SMAP L4, 9 km pixel, modelled, 2026-11-08; 9% below normal …)"`.

**Generative path** (`server/`, Hono on port 8787, `npm run server`). `GET /api/health` → `{ ok, generative }`; `POST /api/ask` validates the request (zod), retrieves with the same code, and sends Claude the "System prompt" section of docs/SYSTEM_INSTRUCTIONS.md (read at start-up) plus a data-handling rule, and a user turn with `FIELD CONTEXT` and `KNOWLEDGE` blocks (`src/rag/prompt.ts`). Retrieved text is wrapped in `<passage id="S1" …>` tags with `<`/`>` neutralised so a passage cannot close its wrapper, and with double quotes and line breaks neutralised in the tag's attributes (source name, licence) so a value cannot add attributes to the tag; the model is told that text inside the blocks is data. Cited ids are renumbered to first-use order and mapped back to citations. Any failure (no key, refusal, network) returns the extractive answer. The Claude call lives in `server/llm.ts` (`createLlm`, reusable for advisory narratives): `@anthropic-ai/sdk`, model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `output_config.effort` from `ANTHROPIC_EFFORT` (default `low`), cached system prompt, server-side refusal fallback (`fallbacks: "default"`). The key is read from the environment or `.env` only and never logged. **The generative path has not been run against the live API** (no key was configured); request assembly, citation mapping and fallback are unit-tested with a fake model.

## Evaluation

`data/rag/eval.json`: 56 hand-written questions (28 English, 28 Vietnamese, two without diacritics, 7 asked with a field context), each with the expected documents or crops. A retrieved chunk counts as relevant when its document or one of its crops is expected. `npx tsx scripts/rag/eval.ts` prints the table; `scripts/rag/eval.test.ts` fails if the full pipeline drops below recall@5 0.95 or MRR 0.90.

| Variant | recall@5 (all / en / vi) | MRR (all / en / vi) |
|---|---|---|
| BM25 only (field boosts, no query analysis) | 0.97 / 0.97 / 0.97 | 0.86 / 0.94 / 0.78 |
| + Vietnamese→English expansion | 0.97 / 1.00 / 0.94 | 0.86 / 0.93 / 0.80 |
| + crop linking (alias boost, fact sheet pinned) | 1.00 / 1.00 / 1.00 | 0.98 / 1.00 / 0.97 |
| Full pipeline (+ intent kind boost, language boost) | 1.00 / 1.00 / 1.00 | 0.98 / 1.00 / 0.97 |

Intent routing: 56/56 on the questions that state an expected intent. Plain BM25 misses "Is my soil too acid for soybean?" (it ranks pH articles above soybean) and "Mè cần loại đất gì?" (one-syllable crop name); expansion alone trades one Vietnamese miss for another; crop linking fixes all of them.

**Embeddings: not added.** The lexical pipeline leaves no measurable headroom on this set (recall@5 1.00, MRR 0.98), while a multilingual embedding model in the browser would add tens of megabytes (a small multilingual sentence encoder is roughly 30 MB quantised, plus about 2-9 MB of vectors for 6,108 chunks) to a first load of about 1 MB. Embeddings were therefore not installed or measured. Caveat: the eval was written by the same agent that built the retrieval and uses a lenient relevance rule; paraphrased questions that share no words with any crop name or glossary alias ("which plant fixes nitrogen and tolerates shade?") are where an embedding pass would help, and an optional lazy hybrid stage could be added behind the same `search` interface if real user questions show that gap.

## Sizes

| Artifact | Raw | gzip | Loaded |
|---|---|---|---|
| `public/rag/core.json` (1,559 chunks, 74 crops, index over core) | 4,130 kB | 1,015 kB | on the first question (or `warmUp()`) |
| `public/rag/full.json` (index over all 6,108 chunks + 4,549 extra chunks, 2,494 species) | 16,266 kB | 2,962 kB | in the background after core; awaited only when a question matches nothing in core |

The serialised MiniSearch index is about two thirds of each file.

## Using it from the UI

```ts
import { ask, buildFieldContext, suggestQuestions, warmUp } from '@/rag';
const context = buildFieldContext({ parcel, telemetry, score, cursor: timeline.cursor, cropId, groundTruth });
const result = await ask({ query, lang, context });   // AskResult: answer with [S#], citations, followUps, confidence, mode
const starters = suggestQuestions(context, lang);
```

`result.answer` uses `\n\n` between paragraphs and `- ` list lines; `[S#]` refers to `result.citations[#-1]`.

## Rebuild

```
npm run rag:build              # from local snapshots (offline)
npm run rag:build -- --fetch   # also download missing Wikipedia snapshots
npm run rag:build -- --refresh # re-download all Wikipedia snapshots
npx tsx scripts/rag/eval.ts    # eval table
npx tsx scripts/rag/demo.ts "Is my soil too acid for soybean?" en field   # print an answer (fixture field)
npx vitest run src/rag scripts/rag server
```

## Limits

- Extractive answers are templates: they quote, they do not reason. Questions outside the routed intents get the best sentences from the top passages, which can be off target.
- Field facts are written in English inside Vietnamese answers (source names, "below normal"), and English EcoCrop narrative is quoted in Vietnamese answers with a "(nguồn tiếng Anh)" note. Only the 74 curated crops have Vietnamese fact sheets and names.
- EcoCrop rainfall is an annual figure and its temperature a growing-season mean; comparing them with annual climate normals is a coarse first check, not a season model (the scorer in `src/core` does that).
- Rotation partners are rule-based (different family, legume after cereal and the reverse, low covers for perennials) and filtered by EcoCrop tolerances; they ignore markets, pests and water.
- 16 of the 24 method articles have no Vietnamese Wikipedia page; the Vietnamese glossary covers those terms.
- The eval is small and self-written (see above).
- Generative mode is untested against the live API.
