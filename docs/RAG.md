# Crop-knowledge assistant (RAG)

The Ask panel answers three kinds of question, in English and Vietnamese, with citations: questions about crops (ideal conditions, comparisons, rotation partners, care), questions about the locked field against a crop ("is my soil too acid for soybean?", "why did the score drop in March?", "what does root-zone moisture mean here?"), and questions about the readings of the field itself ("what is the pH of my soil and where does the number come from?", "which month is the wettest here?", "will there be frost next week?"). What it answers and what it declines is listed under [Scope](#scope). It also explains the scientific terms the challenge names (evapotranspiration, soil-moisture anomaly, NDVI, frost risk, water balance) and how satellite data differs from ground measurements.

It works as a static site with no key: retrieval and a grounded extractive answer run in the browser. A language model is an optional upgrade through the local API server.

## Corpus

The index holds the crops the crop atlas keeps (`data/crops/atlas/crops.csv`, 387; `docs/CROP_DATA.md`) and no other species. Until 15 November 2026 it held all 2,568 species of EcoCrop, of which 2,182 are species no statistical item of FAOSTAT names, or that are named only inside a group item and that EcoCrop does not describe as cultivated (`dropped.csv`). The atlas has no figures for them, which is not a finding that nobody grows them: `dropped.csv` itself records dragon fruit as "grown on small scale" and white clover as "grown on large scale". The assistant answered about them as confidently as about rice.

| Source | Licence | Documents | Chunks | In first load |
|---|---|---|---|---|
| FAO EcoCrop (fact sheets from requirement columns + `notes` narrative) | © FAO, attribution, non-commercial | 386 species | 936 (456 fact sheets: EN for all, VI for the 70 curated crops; 480 from the notes) | the 70 curated crops |
| Crop atlas: where each crop is grown (FAOSTAT QCL) | CC BY 4.0, © FAO | 387 crops | 774 (one sheet in English and one in Vietnamese per crop) and 1 fact sheet for the crop EcoCrop has no record of | no; the same facts are in the first load as data (`CropFacts.prevalence`) |
| Wikipedia EN: 70 crop articles + 24 method articles | CC BY-SA 4.0 | 94 | 813 | yes |
| Wikipedia VI (via language links) | CC BY-SA 4.0 | 79 (69 of the 70 crops: the Vietnamese durian article is too short to give a passage; 10 of the 24 method articles) | 371 | yes |
| Astrovivu glossary EN / VI (28 entries each) | CC BY 4.0 | 28 + 28 | 28 + 28 | yes |
| **Total** | | | **2,951** (median 142 words; p10 44, p90 249) | 1,522 |

Details, revision ids and the sources considered and rejected: `data/rag/ATTRIBUTION.md`; counts: `data/rag/manifest.json`. The curated crop list (staples, pulses, oilseeds, roots, Central Highlands perennials such as coffee, pepper, durian, avocado, cover crops, vegetables, herbs) is `scripts/rag/curated.ts`: 70 crops, every one a crop of the atlas (the build stops if one is not). It is not the list of 73 crops curated for the web catalogue (`crops.csv`, column `curated`); the two share 57.

**Where a crop is grown** (`scripts/rag/atlas.ts`, `whereLines` in `src/rag/facts.ts`). Every crop has a passage `eco:<id>:where` (and `:where-vi`) whose source is FAOSTAT, so that a citation names the right publisher, and the same content as data in `CropFacts.prevalence`. Three cases, by the atlas's `match`:

| `match` | Crops | The sheet says |
|---|---:|---|
| `exact` | 165 | how many countries report production; the harvested area of the world, with the span of years that covers the countries' figures and the statement that each country's figure is the mean of its own latest three years with data; the atlas's commonness class; the five countries with the largest area and, when they are not among the five, Viet Nam and the United States with their place, each with the years its figure is the mean of (said once when the countries listed share them); and the FAOSTAT item the figures are of, always. For 80 of them the item is tied to more than one crop, and the sheet says the figures are the item's, not one crop's; for the other 85 it names the item all the same, because an item can be wider than the crop ("Carrots and turnips" for carrot) |
| `group` | 202 | the name of the FAOSTAT item the crop is counted in and how many other crops share it; that FAOSTAT gives no area for any country |
| `none` | 20 | that the atlas ties no FAOSTAT item to it and so has no FAOSTAT figures by country. Not that FAOSTAT has no such item: bananas have one, and the atlas ties none to *Musa acuminata* |

**National statistics.** Since 15 November 2026 the atlas also holds what the statistics of Viet Nam and of the United States say of 59 crop and country pairs that FAOSTAT counts inside a group, has no item for, or reports nothing of (`match = national` in `crop_country.csv`); 17 of them carry a figure. A sheet of any of the three kinds gives each such figure in a sentence of its own, with the area, the production where there is one, the year and the publication as the atlas names it: "Viet Nam, from its national statistics: 178,800 ha harvested and 1,470,000 t produced in 2024 (…)" for durian. It is not ranked among FAOSTAT's countries, and a national row without a figure is not turned into a statement.

Every number of every sheet is a column of `crops.csv` or `crop_country.csv` (a test checks all 387), the years included (`year_from`, `year_to` of each country's row). In an extractive answer the sheet is given whole, with the sentence that names the item, or not at all: sentences are never picked out of it. Country names are FAOSTAT's, in both languages, except Viet Nam and the United States, which have their Vietnamese name in the Vietnamese sheet.

**Names.** A curated crop is shown under its curated names. Any other crop takes `name_en` and `name_vi` of the atlas where it has them (162 and 16 of the 317), and its scientific name otherwise.

**The crop EcoCrop has no record of.** *Tagetes erecta* is kept by the atlas (it is in the web catalogue) without an EcoCrop row. Its fact sheet says that no thresholds are known and names the atlas, not EcoCrop, as its source.

**Species the atlas dropped.** The lazy bundle carries their names (`RagBundle.dropped`: 10,600 names of 2,178 species; the other four have no name that passes the filter for generic words). A question that names one, and no kept crop, is answered with "not in Astrovivu's crop data" and the atlas's reason, in the two wordings of `dropped.csv`, without a number and without a passage about another species. A name a kept crop answers to stays with the kept crop; a longer name that holds one wins ("Abelmoschus manihot" is aibika although "manihot" alone is cassava; "bush cabbage" is aibika, not cabbage).

Four species were in the assistant's curated list and are in `dropped.csv` ("no FAOSTAT crop item names it"): *Macadamia integrifolia*, *Trifolium repens*, *Stylosanthes guianensis* var. *guianensis* and *Lablab purpureus*. They were taken out of the curated list, following the atlas; the names they were curated under ("macadamia", "đậu ván", "white clover", "cỏ stylo") still lead to the "not in the data" answer. Whether the atlas should keep them is the crop data owner's decision (`docs/CROP_DATA.md`, section 10).

EcoCrop cleaning (docs/DATA_SOURCES.md §5): temperatures beyond ±60 °C and latitudes beyond 90° are dropped as wrong-scale, a growing cycle of 0 is missing, pH outside 0-14 is dropped; 30 of the 386 rows had something cleaned and each fact record lists what in `cleaning`. Crop ids are slugs of the EcoCrop scientific name (`coffea-canephora`, `lycopersicon-esculentum` for tomato, `vicia-villosa-ssp-villosa` for hairy vetch), and equal the atlas's `crop_id` for all 386 (the build stops on a difference).

## Scope

What can be asked, where the answer comes from, and what the assistant says when it has no answer. Code: `src/rag/intent.ts` (routing), `src/rag/fieldFacts.ts` (readings of the field), `src/rag/fieldAnswer.ts` and `src/rag/compose.ts` (answers). Each group has questions in `data/rag/eval.json` (column "Eval group"; see Evaluation).

| Group | Example | Answered from | Status | Eval group |
|---|---|---|---|---|
| What a crop needs; two crops side by side; care; rotation partners | "What conditions does soybean need?" | FAO EcoCrop fact sheets, Wikipedia extracts, glossary | answered | crops and terms |
| A term or a method | "What is NDVI?" | glossary, Wikipedia | answered; with a field locked, the field's own reading is added | crops and terms |
| The field against a crop | "Is my soil too acid for soybean?", "Is it too salty for maize?" | field facts against the crop's EcoCrop window or class (`suitability.ts`) | answered for pH, temperature, rain, texture, drainage, frost, altitude, salinity (the field's electrical conductivity against EcoCrop's classes: low below 4 dS/m, medium 4 to 10, high above 10) and soil depth (the depth to a layer that stops roots against the classes very shallow, shallow, medium, deep). Where the field has no reading, what the crop asks for is still said. Organic matter, CEC and nitrogen are given without a verdict, because EcoCrop knows fertility only as a class; slope and bulk density likewise, because EcoCrop records nothing on them | crops and terms, contrast, regression |
| Why the score moved | "Why did the score drop in March?" | the monthly `score_YYYY-MM` facts | answered | crops and terms |
| **Soil of the field** | "What is the pH of my soil?", "Is my soil salty?", "How much organic matter?" | the soil facts: `ph`, `om_pct` or `soc_gkg`, `cec_cmolkg`, `nitrogen_gkg`, `bulk_density`, `usda_texture`, `texture_class`, `clay_pct`, `sand_pct`, `silt_pct`, `drainage_class`, `depth_cm`, `ec_dsm` | answered: the value, its source, the size of one value of the source, the 5-95 % range, and whether it is the grower's own number. Salinity, drainage class and depth to a layer that stops roots come from the United States soil survey (SSURGO) only: elsewhere the answer is "no value for this field", with that reason and the cheapest way to measure it | soil |
| **Terrain** | "How steep is my field?", "How high is it?" | `slope_deg`, `relief_m`, `aspect_label`, `elevation_m` (SRTM) | answered. Erosion: the slope is given and the answer says the app has no erosion estimate | terrain |
| **Climate of the field by month** | "Which month is the wettest?", "the coldest?", "How much does it rain in March?", "How much rain in the last 30 days?" | `climate_monthly_rain`, `climate_monthly_t` (means of the climate history), `rain_30d`, `rain_90d` | answered: the highest and the lowest month, or the normal of the month that is named, and all twelve values. Needs three years of climate history; without it the answer says so. Where the observed rain series stops short of today, the sum of the last 30 days comes from the reanalysis and the answer says which series it stands in for | climate, regression |
| **Risks ahead** | "Will there be frost next week?", "in the next two weeks?", "Is a heat wave coming?", "What is the weather forecast for my field?" | the `risk_<kind>_<date>` facts (frost, heat, heavy rain, dry spell, wind) and `forecast_tmin`, `forecast_tmax`, `forecast_rain` | answered within the forecast (16 days): the warnings in the days asked about (tomorrow, a number of days or of weeks, a week; the whole forecast when none is named), or "no warning" with the forecast number and the rule the app warns by. A question that reaches beyond the last day of the forecast is answered up to that day, and the answer says that nothing can be said of the days after it. Without a forecast the answer says so and gives the last reading | risk, regression |
| **Source and reliability of a number** | "Which satellite does the NDVI come from?", "How old is it?", "Can I trust it?" | the fact itself: source, size of one value, observed, modelled, derived or forecast, date, age in days, 5-95 % range, comparison with the normal for the day | answered for every reading above and for the daily series (NDVI, EVI, land surface temperature, soil moisture, evapotranspiration, air temperature, humidity, PAR, wind). A pixel larger than the field is said to mix in the surroundings. The two numbers beside the elevation are the lowest and the highest point of the parcel and are said as that. The productivity score is said to be the app's own result, with what it is made of; it has no source to name | source, regression |
| A reading that is not recognised | "Is there much zinc in my field?" | | not answered: the assistant says it did not recognise the reading and lists the readings the field has. It does not answer about another reading. "How is my field?" names no reading and is the comparison with the crop of the field | contrast, regression |
| Low or high? | "Is my organic matter low or high?" | | the value only. No threshold with a source exists yet except through a crop's EcoCrop window; the soil diagnosis is issue C10 | soil |
| What to apply | "My soil is acid, what should I apply for soybean?" | the pH check | what the pH alone says about liming; no amounts and no other fertiliser (C10) | contrast |
| Which crops a country grows, where a crop is grown, prices | "What is grown here?" | the crop atlas and the price database | not yet (C2, C3) | |

Declined, whether or not a crop is named:

| Question | The assistant says |
|---|---|
| Diagnosis of a pest or disease from a photo or a description | it cannot look at photos or diagnose; what it can give instead; take a sample or a photo to the local plant-protection office |
| The price tomorrow, next month, "will it rise" | it does not forecast prices; the prices in the economics panel are published reference values with year and source |
| Land rights, leases and other contracts, disputes | it gives no legal advice; the commune or district office and a lawyer |
| Pesticide, herbicide and fungicide products and doses (also by the name of a substance, such as glyphosate) | it names neither; the local plant-protection office knows the registered options |
| Finance, medicine, politics, sport (only when no crop is named) | it answers about crops, soil, water and the readings of the field |

## Pipeline

```
data/crops/atlas (which crops, where grown, which dropped) + data/ecocrop + data/rag/raw/wikipedia + data/rag/glossary.*.md
   └─ scripts/rag/build.ts ─ chunk by section (150-300 words) ─ aliases ─ MiniSearch
        ├─ public/rag/core.json   the 70 curated crops + Wikipedia + glossary (first load)
        └─ public/rag/full.json   index over ALL chunks + the other 317 crops + where every crop is grown + names of dropped species (lazy)
src/rag (browser and server)
   ask(req) ─ health check ─┬─ generative: POST /api/ask (server retrieves the same way, Claude writes)
                            └─ extractive: analyze → search → compose (templates over facts + quotes)
```

**Chunking.** Wikipedia extracts are split on `== headings ==`; crop articles keep the lead and sections whose heading path matches cultivation, climate, soil, pests, rotation, harvest and similar (history, cuisine, nutrition, production tables are dropped), capped at 3,200 words (EN) / 2,500 (VI) per article. Paragraphs are packed to at most 300 words, long ones split on sentences, short tails merged. EcoCrop notes are split on their own headings (DESCRIPTION, USES, GROWING PERIOD, FURTHER INF.); common names and sources are dropped from the text and kept as aliases.

**Index.** MiniSearch (BM25) over `title` (boost 2), `names` (3: scientific + curated EN/VI names + EcoCrop common names), `tags` (1.5) and `text` (1). Prefix matching for terms of 5+ characters, fuzzy only for 7+, because short Vietnamese syllables are one edit apart from unrelated words. Text is indexed folded (lowercase, no diacritics, đ → d) so "dat chua" finds "đất chua".

**Query analysis** (`src/rag/retrieve.ts`, `intent.ts`, `aliases.ts`):
- Crop linking: longest-match n-grams against 1,611 curated-crop aliases and 3,794 aliases of the other crops of the atlas. Folding creates collisions ("lựa chọn" = choose looks like "lúa" = rice; "điều kiện" = conditions looks like "điều" = cashew; "vối" = robusta looks like "vôi" = lime; "đạm" = nitrogen is "dam", a name EcoCrop lists for the greater yam; "tôi" = I typed without accents is "toi", garlic), so short Vietnamese names must match with their diacritics when the query has any, and a list of common words and phrases is excluded. Generic words that are crop names somewhere in EcoCrop ("date", "lime") are dropped when they occur in 3+ prose chunks.
- Intent routing (rules, both languages): ideal conditions, compare, field suitability (`field`), a reading of the field (`field-fact`: a value, the wettest or hottest month, the forecast), score change, explain a term, rotation, care, general, off-topic (with the reason for declining). "My field" beside a reading asks for its value ("what is my soil pH"); "what does it mean" and "why" ask for an explanation; a crop in the question asks for the comparison with that crop. The focus of a question is one of eighteen readings or requirements; organic matter, CEC, nitrogen, bulk density, slope and soil depth were added for field questions.
- Words that folding makes equal. The rules for readings, weather, prices and photos run on a text in which a Vietnamese syllable keeps its meaning when the question is typed with accents (`guard` in `intent.ts`, `foldGuarded` in `text.ts`): "mưa" is rain and "mua" (to buy) is not, "nắng" and "năng suất", "đạm" and "đám", "chua" and "chưa", "nóng" and "nông dân", "khô" and "khó", "bão" and "dự báo", "giá" (a price, but not in "sương giá", "băng giá", "đánh giá") and "gia tăng", "ảnh" (a photo) and "anh" (a form of address). A question typed without accents gives nothing to tell them apart by, and is read as before.
- Vietnamese→English expansion (e.g. "chua" → acid pH, "luân canh" → rotation) at half weight, so Vietnamese questions also reach English EcoCrop text.
- Boosts: ×3 for chunks about the mentioned crop (×0.35 for other crops), by chunk kind per intent (fact sheets for requirement questions, glossary for term questions), ×1.3 same language; the crop's fact sheet (or the glossary entry) is pinned first; at most 2 chunks per document.

**Extractive answers** (`src/rag/compose.ts`) follow docs/SYSTEM_INSTRUCTIONS.md by template: numbers come only from EcoCrop facts or `FieldContext`, each field number keeps its source, pixel and date, missing facts are named with the cheapest way to get them, quotes are one sentence each with `[S#]`, quotes about another crop are never used, and every answer ends with one next step. Field questions compare field facts with the crop's window deterministically (`src/rag/suitability.ts`): pH 5.6 against soybean's optimal 5.5-6.5 → "inside the optimal range", plus the caveat that a SoilGrids value is a 250 m model estimate. Score-change questions read the monthly `score_YYYY-MM` facts and the limiting factor. Each answer returns 2-3 follow-up questions.

**Answers about the field itself** (`src/rag/fieldFacts.ts`, `src/rag/fieldAnswer.ts`). `parseFieldFact` reads a fact string back into value, unit, source, size of one value, provenance, date, age, 5-95 % range and the estimate a grower's number replaced; `lookupFieldFacts` picks the facts a focus or a glossary term asks for. The answer starts with the number as the fact prints it, then the source, then one sentence on how far to trust it (a model estimate for a 250 m cell; an observation of a pixel larger than the field; a forecast; the grower's own number), then the glossary sentence on that source with its citation. Class names (drainage, texture group, compass direction) and the comparison with the normal are given in the language of the answer; source names stay as published. A month question finds the highest and the lowest of the twelve monthly means. A forecast question lists the `risk_*` events of the days asked about; where there is none it gives the number that shows it (the lowest minimum, the highest maximum, the rain total of the forecast) and the rule the app warns by, which a test keeps in step with `src/data/harmonize/risk.ts`. Nothing is estimated: a reading the field does not have is named as missing, with the reason and the cheapest way to get it, and a reading that was not recognised is not replaced by another one.

**FieldContext** (`buildFieldContext` in `src/rag/fieldContext.ts`, pure): latest value at the cursor of each key series (`sampleAt`, with stale flag and anomaly against the day-of-year baseline), 30/90-day rain sums (from the observed series, or from the reanalysis series where the observed one stops short of the cursor, as CHIRPS does by several weeks; the fact names the series used), what the forecast holds from the cursor on (`forecast_tmin`, `forecast_tmax`, `forecast_rain`), the risk events of the forecast, all static facts with their uncertainty, climate normals (annual and monthly) from `climateHistory`, ground-truth overrides ("measured by the farmer; satellite/model estimate was …"), score at the cursor, every factor, and one score per month. Each fact is a string that starts with the value, e.g. `sm_root: "0.21 m³/m³ (SMAP L4, 9 km pixel, modelled, 2026-11-08; 9% below normal …)"`.

**Generative path** (`server/`, Hono on port 8787, `npm run server`). `GET /api/health` → `{ ok, generative }`; `POST /api/ask` validates the request (zod), retrieves with the same code, and sends Claude the "System prompt" section of docs/SYSTEM_INSTRUCTIONS.md (read at start-up) plus a data-handling rule, and a user turn with `FIELD CONTEXT` and `KNOWLEDGE` blocks (`src/rag/prompt.ts`). Retrieved text is wrapped in `<passage id="S1" …>` tags with `<`/`>` neutralised so a passage cannot close its wrapper, and with double quotes and line breaks neutralised in the tag's attributes (source name, licence) so a value cannot add attributes to the tag; the model is told that text inside the blocks is data. Cited ids are renumbered to first-use order and mapped back to citations. Any failure (no key, refusal, network) returns the extractive answer. The Claude call lives in `server/llm.ts` (`createLlm`, reusable for advisory narratives): `@anthropic-ai/sdk`, model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `output_config.effort` from `ANTHROPIC_EFFORT` (default `low`), cached system prompt, server-side refusal fallback (`fallbacks: "default"`). The key is read from the environment or `.env` only and never logged. **The generative path has not been run against the live API** (no key was configured); request assembly, citation mapping and fallback are unit-tested with a fake model.

## Evaluation

`data/rag/eval.json`: 132 hand-written questions (57 English, 75 Vietnamese, three without diacritics, 72 asked with a field context). `npx tsx scripts/rag/eval.ts` prints the tables below; `scripts/rag/eval.test.ts` guards them. The first 62 are the set the retrieval was built against; 48 were added for the questions about the field itself; 22 are questions that an earlier state of that change answered wrongly and that its review found (group `regression`).

**Retrieval** is scored on the 72 questions that state expected documents or crops (the other 60 are answered from the field's own readings or declined, where nothing is retrieved). A retrieved chunk counts as relevant when its document or one of its crops is expected. The test fails if the full pipeline drops below recall@5 0.95 or MRR 0.90.

| Variant | recall@5 (all / en / vi) | MRR (all / en / vi) |
|---|---|---|
| BM25 only (field boosts, no query analysis) | 0.90 / 0.97 / 0.84 | 0.81 / 0.95 / 0.69 |
| + Vietnamese→English expansion | 0.90 / 1.00 / 0.82 | 0.81 / 0.93 / 0.70 |
| + crop linking (alias boost, fact sheet pinned) | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| Full pipeline (+ intent kind boost, language boost) | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |

Plain BM25 misses "Is my soil too acid for soybean?" (it ranks pH articles above soybean), "Mè cần loại đất gì?", three questions about garlic and one about rice (one-syllable crop names: "mè", "tỏi", "lúa"), and one question whose crop is the crop of the field and is not named; expansion alone trades one Vietnamese miss for another; crop linking fixes all of them. The first two rows are lower than on the first 62 questions (0.97 and 0.86) because five of the ten questions added with a crop are of those kinds. The numbers are those of the corpus cut down to the crops of the atlas; on the corpus of all 2,568 EcoCrop species the MRR of the first two rows was 0.80. Before 15 November 2026 the last two rows had an MRR of 0.98 (Vietnamese 0.97): "Cây che phủ nào giúp cố định đạm?" and "Cây nào giúp cố định đạm cho đất?" were linked to the greater yam through "đạm" and found their document second. With "đạm" excluded from crop linking both find it first.

**Routing** is scored on the 126 questions that state an expected intent; the questions about the field also state the kind of question (value, month, forecast), the focus, a focus that must not be found ("năng suất" is not "nắng") and, for a declined question, the reason. The test requires every question of the field groups and of the regression group to be routed as stated, and at least four questions per field group in both languages.

| Group (row of the scope table) | Questions (en / vi) | Routed as expected |
|---|---|---|
| crops and terms | 56 (28 / 28) | 56 |
| soil | 12 (5 / 7) | 12 |
| terrain | 6 (3 / 3) | 6 |
| climate | 7 (3 / 4) | 7 |
| risk | 7 (3 / 4) | 7 |
| source | 6 (3 / 3) | 6 |
| contrast (a value against a definition, a crop, an unknown reading) | 4 (1 / 3) | 4 |
| declined | 6 (3 / 3) | 6 |
| regression (found by the review of the change) | 22 (5 / 17) | 22 |

**Content** is scored on the 29 questions about a value of the field that state what the answer is made of: the readings (keys of the fixture's facts) it must give and no others, and the readings it must name as missing. Routing alone does not show an answer that brings the pH along with the soil moisture; this does. All 29 are made of the stated readings.

The answers themselves are checked in `src/rag/fieldAnswer.test.ts`: on the fixture field and on the four demo fields (`scripts/rag/sample-context.ts` builds the context the app gives the assistant from the cached telemetry), every number in an answer about a reading has to be a number of that field's facts, or one the test names (the day a question's horizon ends, the count of warnings, the thresholds of the warning rules, the numbers of the months).

**Embeddings: not added.** The lexical pipeline leaves no measurable headroom on this set (recall@5 1.00, MRR 1.00), while a multilingual embedding model in the browser would add tens of megabytes (a small multilingual sentence encoder is roughly 30 MB quantised, plus about 2-9 MB of vectors for 6,108 chunks) to a first load of about 1 MB. Embeddings were therefore not installed or measured. Caveat: the eval was written by the same agent that built the retrieval and uses a lenient relevance rule; paraphrased questions that share no words with any crop name or glossary alias ("which plant fixes nitrogen and tolerates shade?") are where an embedding pass would help, and an optional lazy hybrid stage could be added behind the same `search` interface if real user questions show that gap.

## Sizes

| Artifact | Raw | gzip | Loaded |
|---|---|---|---|
| `public/rag/core.json` (1,522 chunks, 70 crops, index over core) | 4,069 kB | 1,000 kB | on the first question (or `warmUp()`) |
| `public/rag/full.json` (index over all 2,951 chunks + 1,429 extra chunks, 317 crops, names of 2,178 dropped species) | 6,027 kB | 1,160 kB | in the background after core; awaited when a question matches nothing in core, or asks what a crop needs and names no curated crop |

Before the corpus was cut down to the atlas (13 November 2026): 4,130 kB (1,015 kB gzip) and 16,266 kB (2,962 kB gzip), 6,108 chunks. The first load is 2 % smaller, the lazy file 63 % smaller.

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
npx tsx scripts/rag/demo.ts "Tuần tới có sương giá không?" vi iowa-corn-soy   # the same on a demo field's cached telemetry
npx vitest run src/rag scripts/rag server
```

## Limits

- Extractive answers are templates: they quote, they do not reason. Questions outside the routed intents get the best sentences from the top passages, which can be off target.
- In answers that compare the field with a crop, and in the line a term answer adds about the field, field facts are written in English inside Vietnamese answers (source names, "below normal"). Answers about a reading of the field word the value, the class names and the comparison with the normal in Vietnamese; source names stay as published. English EcoCrop narrative is quoted in Vietnamese answers with a "(nguồn tiếng Anh)" note. Only the 70 curated crops have Vietnamese fact sheets; 16 more crops have a Vietnamese name from the atlas (Vietnamese names for the rest: issue C6).
- A reading of the field is given without saying whether it is low or high: the only thresholds with a source are the crop windows of EcoCrop (pH, temperature, rain, texture, drainage). Erosion is not estimated. What to apply is answered from the pH alone, without amounts.
- A forecast question about "next week" lists the warnings of those days, but the supporting number (lowest minimum, highest maximum, rain total) is that of the whole forecast, because the context carries one summary of it; the answer says "in the whole forecast" and its last day.
- A question typed without accents is routed on folded syllables, so "mua phan bon" (to buy fertiliser) is still read as rain and "nang suat" as sun. Only the accents can tell those apart. Flood, pest and disease warnings are read if the data layer raises them; today it raises frost, heat, heavy rain, dry spell and wind.
- The Vietnamese wording of a risk is rebuilt from the numbers of the English text in the fact, by the five templates the data layer uses; a warning worded otherwise is quoted in English.
- Routing is by rules: a question about a reading that names it in a way the rules do not know gets the list of readings the field has, not an answer.
- EcoCrop rainfall is an annual figure and its temperature a growing-season mean; comparing them with annual climate normals is a coarse first check, not a season model (the scorer in `src/core` does that).
- Rotation partners are rule-based (different family, legume after cereal and the reverse, low covers for perennials) and filtered by EcoCrop tolerances; they ignore markets, pests and water.
- 14 of the 24 method articles have no Vietnamese Wikipedia page; the Vietnamese glossary covers those terms.
- "Not in the crop data" follows the atlas, and the atlas follows FAOSTAT: a species that is grown but that no FAOSTAT item names (macadamia, white clover) gets that answer. The wording says what the atlas found, not that the species is not grown.
- The names of dropped species arrive with the lazy bundle. Until it has loaded, a question that names one together with a glossary term ("is aibika frost tolerant?") is answered from the glossary; a question about what a crop needs waits for the bundle.
- The sheet on where a crop is grown is not yet what a question such as "which countries grow rice?" is answered from: routing for that question is issue C3. Until then the sheet is reached by search and through `CropFacts.prevalence`.
- Country names in the Vietnamese sheets are FAOSTAT's English names, except Viet Nam and the United States.
- The eval is small and self-written (see above).
- Generative mode is untested against the live API.
