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
| `group` | 202 | the name of the FAOSTAT item the crop is counted in and how many other crops share it; no area of any country |
| `none` | 20 | that the atlas ties no FAOSTAT item to it and so has no figures by country. Not that FAOSTAT has no such item: bananas have one, and the atlas ties none to *Musa acuminata* |

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

## Looking numbers up

Code: `src/rag/lookups.ts` (the lookups), `src/rag/tables.ts` (loading), `scripts/rag/tables.ts` (the files); the server reads the same files through `fileReader` in `server/loader.ts`. Tests: `src/rag/lookups.test.ts`, `scripts/rag/tables.test.ts`; every expected number is read from `data/crops/atlas/*.csv` in the test.

A question about a number is better answered from a table than from a passage that happens to hold the number. The lookups are pure functions over tables that are already loaded; they return rows, the source of the rows (name, licence, years, day of access) and the cautions a reader needs, in both languages, or a reason why there are no rows. The language model calls them as functions (`server/tools.ts`, see "Generative mode"); the extractive answers (issue C3) are to call the same ones.

| Lookup | Answers | From | No rows when |
|---|---|---|---|
| `cropsInPlace(iso3)` | the crops a country grows, largest harvested area first, with level, share and rank | the country's table (FAOSTAT QCL) | `unknown-place`: the atlas has no such country |
| `cropsInPlace(iso3, admin1)` | the crops of a province or state | MapSPAM 2020, a model estimate, said as such | `no-data`: MapSPAM has no such region (Nevada is not among its 44 for the United States) |
| `whereGrown(cropId, iso3?)` | the five countries with the largest area, how many report it, and the level and place of the country asked about | the crop's table (FAOSTAT QCL) | `group-item`: the crop is counted inside a group item; `no-data`: no item at all; `dropped-crop`, `unknown-crop` |
| `cropFigures(cropId)` | what the crop needs and how widely it is grown, as lines in both languages | FAO EcoCrop, FAOSTAT QCL | `no-data`: the crop has neither |
| `compareCrops(a, b, iso3?)` | the two crops line against line, and how much of each the country grows | the same | as above |
| `fieldSuitability(input, cropId)` | the model's assessment of the crop on the locked field: `assessCrop`, unchanged | the suitability score | `no-field` |
| `rotationOptions(input)` | the rotations the app builds: `buildRotations`, unchanged | the rotation planner | `no-field` |
| `soilPlan(input)` | the pH plan, with the caution that it is the pH part only: the soil module (issue S2) is not built | the advisory report | `no-field`, `no-data` |
| `priceAndMargin(input, cropId)` | the reference yield, price and cost of the field's region and the season built on them, with the quality of each source | the reference economics | `no-data`: no record, or only a record of another country |

Four rules hold in every lookup, each with a test:

- **A shared item is one row.** FAOSTAT's "Rice" is the item of three rice crops of the atlas; the atlas has the same 7,089,041 ha for Viet Nam on three rows, the lookup has it once with the three crops.
- **A group crop never gets the group's numbers.** Durian is counted in "Other tropical fruits, n.e.c."; African rice in "Rice". Neither has a figure, in any country, and the lookup says which item it is counted in.
- **"Cannot tell" is not "not grown".** A crop a country reports none of is given as `absent` with the caution that a country that does not itemise a crop reads the same way.
- **No figure of another country.** Common bean has no Vietnamese price; the reference table would fall back to the record of the United States, and the lookup returns `no-data` instead.

**The tables** (`public/rag/tables/`, written by `npm run rag:build`; nothing is computed, every value is a cell of the atlas; no date in the files, so a second build writes the same bytes):

| File | Holds | Files | Size | Largest |
|---|---|---:|---:|---|
| `crops.json` | the 387 crops (names, match, FAOSTAT item) and each item with its crops | 1 | 49 kB | |
| `countries.json` | the 198 countries, ISO3 to name | 1 | 4 kB | |
| `spam.json` | the 46 SPAM crops and classes, with the crops of ours tied to each | 1 | 4 kB | |
| `sources.json` | title, publisher, licence, landing page and day of access of the three sources cited | 1 | 1 kB | |
| `crop/<crop_id>.json` | the countries that report the crop; only for the 165 crops with an item of their own | 165 | 961 kB | 14.7 kB |
| `region/<ISO3>.json` | MapSPAM harvested area by first-level region | 179 | 1,000 kB | 32.1 kB (Viet Nam; 10.4 kB gzip) |
| **All** | | **348** | **2,018 kB** (551 kB gzip) | 49 kB |

The crops of one country are not written a second time: the lookups read `public/data/crops/country/<ISO3>.json`, the files the app loads for the model (`scripts/crops/country-tables.ts`, 198 files). One file is read per question (a country, a crop or the regions of a country), on demand, and kept; `tableSource` does that over a reader, `fetch` in the browser and the disk on the server.

Not done here: routing a question to a lookup and wording the extractive answer (C3), the interface sending the model input with a question (`field`, which the server already takes; the call is in `src/ui/ask/index.tsx`, the project lead's), prices from `economics.csv` (T5) and the soil plan (S2).

## Pipeline

```
data/crops/atlas (which crops, where grown, which dropped) + data/ecocrop + data/rag/raw/wikipedia + data/rag/glossary.*.md
   └─ scripts/rag/build.ts ─ chunk by section (150-300 words) ─ aliases ─ MiniSearch
        ├─ public/rag/core.json   the 70 curated crops + Wikipedia + glossary (first load)
        └─ public/rag/full.json   index over ALL chunks + the other 317 crops + where every crop is grown + names of dropped species (lazy)
src/rag (browser and server)
   ask(req) ─ health check ─┬─ generative: POST /api/ask (server retrieves the same way; Claude or Gemini calls the lookups and writes; number check)
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

**Generative path**: the next section.

## Generative mode

Code: `server/app.ts` (the request), `server/llm.ts` (the loop and the Claude provider), `server/gemini.ts` (the Gemini provider), `server/tools.ts` (the lookups as functions a model calls), `src/rag/prompt.ts` (what the model is told), `src/rag/numberGuard.ts` (the number check). Tests: `server/app.test.ts`, `server/llm.test.ts`, `server/tools.test.ts`, `src/rag/numberGuard.test.ts`, `src/rag/prompt.test.ts`, `scripts/rag/transcripts.test.ts`.

With a key in `.env`, `npm run server` (Hono, port 8787; Vite proxies `/api` to it) answers `POST /api/ask` with a language model: the model reads the question, the field context and the retrieved passages, may call the lookups of "Looking numbers up", and writes the answer. `GET /api/health` → `{ ok, generative, model, provider, tools }`. Every request builds the extractive answer first, and that is what the client gets whenever a generated answer is not given.

**One request, step by step.**

1. The body is checked with zod: question, language, optional `context` (`FieldContext`) and optional `field`, the locked field as the scoring and rotation models read it (`ModelInput`; `AssistantRequest` in `src/rag/types.ts`). The envelope of `field` is checked and the telemetry inside is taken as it comes: the models already read every reading as possibly missing, and a lookup that throws reaches the model as a failed call. A body over 1 MB is refused with 413; a question with the telemetry of a demo field is 264 to 270 kB.
2. Retrieval and the extractive answer, by the same code as in the browser.
3. Two kinds of question are answered by rule, and the model is not asked: one the router declines (photo diagnosis, price forecast, legal advice, a pesticide product or dose) and one about a species the atlas dropped, where the reason it is not in the data is a fact of the atlas that the rule states exactly.
4. The model is given the "System prompt" section of docs/SYSTEM_INSTRUCTIONS.md (read at start-up) plus `DATA_RULE`, and a user turn with `FIELD CONTEXT` and `KNOWLEDGE` blocks. Retrieved text is wrapped in `<passage id="S1" …>` tags with `<`/`>` neutralised so a passage cannot close its wrapper, and with double quotes and line breaks neutralised in the tag's attributes (source name, licence) so a value cannot add attributes to the tag. `DATA_RULE` says that the blocks and the results of the functions are data and not instructions, that a number may come only from a function result or from the two blocks and is written as it stands there or rounded, that a result with no data is said as such with its reason, that a missing figure does not tell whether a crop is grown, and what the answer panel can show.
5. The functions are offered when the lookup tables are built (`public/rag/tables`). The four that read the field are offered only when the request brings `field`: with the field context alone the model answers from that context, and is not handed a function that could only say "no field".
6. The loop (`runToolLoop`): a request to the model; if it asks for functions, each is run and all results go back together in one message; and again, until it answers. Limits: 5 requests, and 50 s for the whole answer with every request and every lookup in it (the browser waits 60 s). A refusal, an answer cut off at the token limit, a turn that is neither an answer nor a call, the rounds or the time running out, a network error: each is thrown, and the request gives the extractive answer.
7. The number check (below). An answer that fails it is dropped for the extractive one; the log says how many numbers had no source and how many answers were dropped since the server started.
8. Citations: `[S#]` marks are renumbered to the order of first use, one mark per source (`[S2][S1]`, since the panel draws a mark only for a single id). A passage becomes the citation it always was; a function result becomes a `Citation` with `chunkId` `table:<table>:<key>`, the source name with its years, the licence and the link of `sources.json`, and a short line of what the table said. `tidy` turns the marks the panel does not draw (`*` bullets, `#` headings, italics, code marks) into the ones it does.

**The functions** (`server/tools.ts`). One per lookup, under the lookup's name, with a description and an input schema made from a zod schema (`z.toJSONSchema`); the input the model sends is checked against that schema before anything is looked up, and a wrong input is a failed call the model can read ("Invalid input for whereGrown: crop: …"). A function computes nothing. It turns the words of the model into a crop and a place, calls the lookup, and returns the lookup's rows in the language of the question with their sources and caveats.

| Function | Input | Returns | Cited as |
|---|---|---|---|
| `cropsInPlace` | `country?`, `region?`, `limit?` | the first rows of the table (15 unless asked, 40 at most) and how many there are | `table:country:<ISO3>`, `table:region:<ISO3>:<region>` |
| `whereGrown` | `crop`, `country?`, `top?` | the largest growers and the country asked about | `table:crop-countries:<crop>[:<ISO3>]` |
| `cropFigures` | `crop` | requirement lines and world figures | `table:crop-figures:<crop>` |
| `compareCrops` | `cropA`, `cropB`, `country?` | the two crops line against line | `table:compare:<a>:<b>` |
| `fieldSuitability` | `crop?` | the assessment of the crop on the field, factor by factor, each factor with the source of its reading | `table:field-suitability:<parcel>:<crop>` |
| `rotationOptions` | none | each rotation: seasons, metrics, margin with its range, reasons, gaps, risks (the per-season accounts are left to `priceAndMargin`) | `table:rotations:<parcel>` |
| `soilPlan` | none | the pH plan | `table:soil-plan:<parcel>` |
| `priceAndMargin` | `crop?` | the reference record with its three sources, and the season on the field | `table:economics:<crop>` |

- A crop is given by name, in English, Vietnamese or Latin, and found with the alias table of the retrieval; the longest name wins. A name that only holds a crop name among other words ("moon cabbage") is not taken for that crop: the result says which crop was seen in it, for the model to ask again if that is the one meant.
- A country is given by ISO3 code or by FAOSTAT's English name; Viet Nam and the United States also by their Vietnamese names. Left out, it is the country of the locked field.
- The field's country table is put in on the server from the same file the app loads; what the request carried is not used.
- Scores go to the model out of 100, as the app shows them (`score100`), so it has nothing to convert. In the first runs the model turned a compatibility of 0.86 into "86 %", a number that stands in no source, and the answer was dropped.
- A result with rows carries a `cite` id that follows the ids of the passages. A second call with the same input returns the same result under the same id.

**The number check** (`unsupportedNumbers` in `src/rag/numberGuard.ts`, pure). Every number of the answer is looked for in what the model was given: the user turn (question, field context, passages) and the results of its calls. `7,089,041` and `7.089.041` are one number and `6,1` is `6.1`; a lone mark before three digits (`6.094`, `1,173`) is tried both ways. A number may be a rounding of its source to the digits it is written with: `6,1` for 6.094, `43 %` for 43.2, `7.1 million` for 7,089,041, `7,100,000` for 7,089,041 when at least two digits stand before the zeros. Citation marks, the numbering of a list and digits inside a name (`ERA5`, `MOD13Q1`, `v2.0`, `Sentinel-2`) are not numbers of the answer, and a version number in a source (`SoilGrids v2.0`) supports only that version, not a quantity "2".

It is a net, not a proof. It does not see a number said of the wrong thing, a claim without a number, or a quantity written in words. With some eighty field facts and six passages in the sources, a small number of the model's own can find an unrelated match: in one run "nearly 70 %", the sum of two shares of a table, passed because "70 %" stood in a retrieved passage about irrigated land in Asia, which the answer did not cite. Counting a passage as a source only when the answer cites it would have caught that; it was not done, because the model does not always cite the passage it used.

**The two providers** (`server/llm.ts`). A provider opens a conversation; the loop is written once over that interface, so the limits are the same for both.

| | Claude | Gemini |
|---|---|---|
| API | Messages API through `@anthropic-ai/sdk` 1.8 (`client.beta.messages.create`) | Interactions API (`POST /v1beta/interactions`) with `fetch`, no SDK |
| Key and model | `ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | `GEMINI_API_KEY`, sent in the `x-goog-api-key` header only; `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) |
| How much it thinks | `ANTHROPIC_EFFORT` (default `low`) as `output_config.effort`, for the models that take it | `GEMINI_THINKING_LEVEL` (default `low`; `model` sends none) as `generation_config.thinking_level` |
| Output cap | `ANTHROPIC_MAX_TOKENS` (8000) | `GEMINI_MAX_TOKENS` (8000), thinking included |
| A function | `{ name, description, input_schema }`; `tool_choice` left at `auto`, since the current models reject a forced call | `{ type: "function", name, description, parameters }` |
| A call | a `tool_use` block, `stop_reason: "tool_use"` | a `function_call` step, status `requires_action` |
| The results | the model's content appended unchanged (thinking blocks too), then one user message of `tool_result` blocks only, `is_error: true` on a failed call | the model's steps appended as received (its `thought` steps with their signatures), then `function_result` steps, `is_error: true` on a failed call |
| State | the conversation is sent again with each request | `store: false`, and the conversation is sent again with each request: nothing is kept on Google's side for a later request to refer to |
| Not an answer | `refusal`, `max_tokens`, `model_context_window_exceeded`, `pause_turn` | status `incomplete`, `failed`, `cancelled`; an error code that says the content is blocked is a refusal |
| Other | cached system prompt, with the function definitions under the same cache breakpoint; server-side refusal fallback (`fallbacks: "default"`) for the models that have it, and after such a fallback only the calls of the model that finished the turn are run and echoed | a rate limit or a server error is tried again twice (1 s, 3 s) inside the time left; no sampling parameter is sent, since the current models ignore `temperature` and are announced to reject it |
| Run against the live API | **no**: no Anthropic key was configured. Request assembly, the reading of a response and the loop are tested against a fake client | **yes**: the 30 conversations below |

With both keys set, Claude is used unless `LLM_PROVIDER=gemini`; `LLM_PROVIDER` naming a provider whose key is missing gives no generative mode, not the other provider.

Documentation read on 15 November 2026. Claude: `platform.claude.com/docs/en/agents-and-tools/tool-use/overview`, `/define-tools`, `/handle-tool-calls`, `/parallel-tool-use`, `/tool-runner` (the SDK's own loop; the hand-written loop is kept because the request needs the deadline, the per-call record and the citation ids, and because it is shared with Gemini), `platform.claude.com/docs/en/build-with-claude/handling-stop-reasons`, `/effort` (the models that take `effort`: Claude Sonnet 4.5 and Claude Haiku 4.5 are not among them, as `NO_EFFORT` has it), `/refusals-and-fallback` (the models with a server-side fallback: Claude Fable 5 was missing from `FALLBACK_MODELS` and was added; Claude Haiku 5.5 has none). Gemini: `aistudio.google.com/docs/migrate-to-interactions` (the Interactions API is recommended for all new development; `generateContent` stays supported), `/docs/function-calling`, `/docs/thinking`, `/docs/models`, `/docs/pricing`, `/docs/deprecations`, `/docs/logs-policy`, `/api-reference/interactions-api/create-interaction`; the shapes were then checked against the live API.

**Choice of the Gemini model.** Six of the live-run questions (01, 06, 09, 21, 24, 28) were asked once of each setting on 15 November 2026. Every answer was given and passed the number check; the settings differ in time and in which function the model took.

| Model, thinking level | Right function | Time per answer: shortest / median / longest | Output tokens, median (thinking included) |
|---|---:|---|---:|
| `gemini-3.5-flash-lite`, its default (`minimal`) | 4 of 6 | 2.5 / 3.2 / 3.7 s | 327 |
| **`gemini-3.5-flash-lite`, `low`** | 6 of 6 | 2.6 / 4.5 / 6.8 s | 1,011 |
| `gemini-3.5-flash-lite`, `medium` | 6 of 6 | 4.2 / 6.3 / 8.3 s | 1,941 |
| `gemini-3.8-flash`, `low` | 6 of 6 | 4.0 / 6.6 / 12.9 s | 418 |
| `gemini-3.8-flash`, its default (`medium`) | 6 of 6 | 12.9 / 17.7 / 39.4 s | 1,898 |
| `gemini-4-hydrogen`, its default (`high`) | 6 of 6 | 15.4 / 20.9 / 34.8 s | 4,397 |

At its own default Flash-Lite answered the rotation question without calling `rotationOptions`, with three strategies that are not the planner's (one of them a species the atlas dropped), and took `compareCrops` where `fieldSuitability` was the lookup for the question. No number was wrong, so the number check could not catch either; one level of thinking more did. Gemini 3.8 Flash and Gemini 4 Hydrogen wrote the fuller answers, closer to the form the system prompt asks for, at four to five times the wait, and Hydrogen's longest answer came within 15 s of the deadline. Google's model page names Gemini 4 Hydrogen and Gemini 3.5 Flash-Lite for new projects; list prices on the pricing page are 0.30 / 2.50 USD per million tokens in / out for Flash-Lite, 0.75 / 3.75 for 3.8 Flash until 31 December 2026 (double after), 1.50 / 7.50 for Hydrogen. Six questions asked once are a trial, not a benchmark: the default is the cheapest setting that made no wrong call, and `GEMINI_MODEL` and `GEMINI_THINKING_LEVEL` change it.

**The live run** (`npx tsx scripts/rag/live-run.ts`, 15 November 2026). The 30 questions of `data/rag/transcripts/questions.json` were asked through the server's own app (`createApp`, called without the HTTP listener; the requests to Gemini are real), with the context and the telemetry of a demo field where the question has one. Each transcript holds the question, every function called with its input and its result, the answer, the model, the tokens in and out, the time and what the number check found; `data/rag/transcripts/README.md` has the table of all 30. No transcript holds a key or a header, and a test searches them for both.

| | |
|---|---|
| Questions | 30: 15 in Vietnamese, 15 in English; 14 on a demo field (all four fields) |
| Asked of the model | 25, `gemini-3.5-flash-lite` at thinking level `low` |
| Answered by the router without the model | 5: four declined (price forecast, pesticide product and dose, photo diagnosis, legal), one about a dropped species |
| Generated answers given | 25 of 25 |
| Number check | 25 of 25 answers held only numbers of their sources |
| Function calls | 18, none failed; 43 requests to the model; three calls returned "no data" (durian, asked about for Viet Nam and for Thailand: counted inside a group item; quinoa: no reference price) and the answer said so |
| Tokens | 318,594 in, 18,423 out |
| Time per answer | median 3.4 s, longest 6.4 s |

This is the fifth run of the same 30 questions; the code changed between runs as the runs showed what was wrong, and the last run followed the corrections to the sheets on where a crop is grown. In the fourth, as in this one, every answer passed. In the first three the number check dropped two, one and one answers: a harvested area with two digits transposed (671,148 ha for 667,148), a sum of two shares the model made ("over 99 %", twice), and a score turned into a percentage (which is why scores now go out of 100). The first run also showed two questions the router did not decline ("Nên phun thuốc gì và liều bao nhiêu cho bệnh đạo ôn?", "Is it legal to lease farmland to a foreign company?"); the model declined both by itself, the rules were then widened, and both questions are in the eval set.

What the runs show that no check catches (the first two are in the recorded transcripts, the last two were seen in earlier runs):

- **A caveat left out.** The figures for coffee are those of the FAOSTAT item "Coffee, green", which four coffee crops share, and the function result says so. The recorded answer (16) gives them as coffee's without saying the item is shared; an earlier one gave them as robusta's.
- **A looser reading of the days asked about.** "Is there frost next week?" (12) is answered with the warning of the week after as well, each with its dates. The rule-based answer keeps to the days asked about.
- **A citation of the wrong source.** In an earlier run the model cited the EcoCrop sheet for figures it had taken from the suitability score, so the list of sources named EcoCrop where the number came from the model's score.
- **A wrong function, or none.** At the model's own thinking level (see the trial above), not at the level the run used.

In the browser (headless Chrome, the assistant panel, the Đắk Lắk and Cần Thơ demo fields, with `npm run server` and `npm run dev`): a question about a table ("Tỉnh Đắk Lắk của Việt Nam trồng cây gì nhiều nhất?") is answered with the label "Tạo sinh", a list, and one source, the MapSPAM table. A question about the field reaches the four field lookups only once the panel sends the field: `src/ui/ask/index.tsx` does not yet, and was not changed here (it is the interface owner's). With `field: toModelInput(useMission.getState())` added to its call of `ask` for the test and removed again, "Tôi nên luân canh thế nào trên thửa này?" on the Cần Thơ field was answered from `rotationOptions`, with the planner's margins.

**What is sent to the provider.** For each question that reaches the model: the system prompt; the question; the field context when a field is locked, which holds the name of the parcel, its place, its coordinates and area, the crop, and some eighty readings with their sources; the retrieved passages; the definitions of the functions; and, in the later requests of the loop, the results of the functions called, which for the field lookups hold the model's assessment of the field, its rotations and the reference prices. The telemetry itself (`field`) stays on the server. Nothing is sent for a question the router answers. The key is in `.env`, which git ignores, and is read by the server only; it is in no log line, no error message and no transcript.

Google's side, as its pages said on 15 November 2026: with `store: false` an interaction cannot be fetched or continued later; the project's own logs are a separate setting of the project (on by default for the Interactions API in a project with billing, kept 55 days at most, turned off in AI Studio by the owner of the project); on the free tier, content is used to improve Google's products, on the paid tier it is not. Which tier the key of the live run is on was not checked. The demo fields are public sample data; a grower's own field is not, and whoever turns the generative mode on for real users has to settle that first.

## Evaluation

`data/rag/eval.json`: 134 hand-written questions (58 English, 76 Vietnamese, three without diacritics, 72 asked with a field context). `npx tsx scripts/rag/eval.ts` prints the tables below; `scripts/rag/eval.test.ts` guards them. The first 62 are the set the retrieval was built against; 48 were added for the questions about the field itself; 24 are in the group `regression`: 22 questions that an earlier state of that change answered wrongly and that its review found, and 2 that the live run of the generative mode showed the router did not decline.

**Retrieval** is scored on the 72 questions that state expected documents or crops (the other 62 are answered from the field's own readings or declined, where nothing is retrieved). A retrieved chunk counts as relevant when its document or one of its crops is expected. The test fails if the full pipeline drops below recall@5 0.95 or MRR 0.90.

| Variant | recall@5 (all / en / vi) | MRR (all / en / vi) |
|---|---|---|
| BM25 only (field boosts, no query analysis) | 0.90 / 0.97 / 0.84 | 0.81 / 0.95 / 0.69 |
| + Vietnamese→English expansion | 0.90 / 1.00 / 0.82 | 0.81 / 0.93 / 0.70 |
| + crop linking (alias boost, fact sheet pinned) | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| Full pipeline (+ intent kind boost, language boost) | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |

Plain BM25 misses "Is my soil too acid for soybean?" (it ranks pH articles above soybean), "Mè cần loại đất gì?", three questions about garlic and one about rice (one-syllable crop names: "mè", "tỏi", "lúa"), and one question whose crop is the crop of the field and is not named; expansion alone trades one Vietnamese miss for another; crop linking fixes all of them. The first two rows are lower than on the first 62 questions (0.97 and 0.86) because five of the ten questions added with a crop are of those kinds. The numbers are those of the corpus cut down to the crops of the atlas; on the corpus of all 2,568 EcoCrop species the MRR of the first two rows was 0.80. Before 15 November 2026 the last two rows had an MRR of 0.98 (Vietnamese 0.97): "Cây che phủ nào giúp cố định đạm?" and "Cây nào giúp cố định đạm cho đất?" were linked to the greater yam through "đạm" and found their document second. With "đạm" excluded from crop linking both find it first.

**Routing** is scored on the 128 questions that state an expected intent; the questions about the field also state the kind of question (value, month, forecast), the focus, a focus that must not be found ("năng suất" is not "nắng") and, for a declined question, the reason. The test requires every question of the field groups and of the regression group to be routed as stated, and at least four questions per field group in both languages.

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
| regression (found by the review of the change, and by the live run) | 24 (6 / 18) | 24 |

**Content** is scored on the 29 questions about a value of the field that state what the answer is made of: the readings (keys of the fixture's facts) it must give and no others, and the readings it must name as missing. Routing alone does not show an answer that brings the pH along with the soil moisture; this does. All 29 are made of the stated readings.

The answers themselves are checked in `src/rag/fieldAnswer.test.ts`: on the fixture field and on the four demo fields (`scripts/rag/sample-context.ts` builds the context the app gives the assistant from the cached telemetry), every number in an answer about a reading has to be a number of that field's facts, or one the test names (the day a question's horizon ends, the count of warnings, the thresholds of the warning rules, the numbers of the months).

**Embeddings: not added.** The lexical pipeline leaves no measurable headroom on this set (recall@5 1.00, MRR 1.00), while a multilingual embedding model in the browser would add tens of megabytes (a small multilingual sentence encoder is roughly 30 MB quantised, plus about 2-9 MB of vectors for 6,108 chunks) to a first load of about 1 MB. Embeddings were therefore not installed or measured. Caveat: the eval was written by the same agent that built the retrieval and uses a lenient relevance rule; paraphrased questions that share no words with any crop name or glossary alias ("which plant fixes nitrogen and tolerates shade?") are where an embedding pass would help, and an optional lazy hybrid stage could be added behind the same `search` interface if real user questions show that gap.

## Sizes

| Artifact | Raw | gzip | Loaded |
|---|---|---|---|
| `public/rag/core.json` (1,522 chunks, 70 crops, index over core) | 4,067 kB | 1,000 kB | on the first question (or `warmUp()`) |
| `public/rag/full.json` (index over all 2,951 chunks + 1,429 extra chunks, 317 crops, names of 2,178 dropped species) | 6,012 kB | 1,155 kB | in the background after core; awaited when a question matches nothing in core, or asks what a crop needs and names no curated crop |

Before the corpus was cut down to the atlas (13 November 2026): 4,130 kB (1,015 kB gzip) and 16,266 kB (2,962 kB gzip), 6,108 chunks. The first load is 2 % smaller, the lazy file 63 % smaller.

The serialised MiniSearch index is about two thirds of each file.

## Using it from the UI

```ts
import { ask, buildFieldContext, suggestQuestions, warmUp } from '@/rag';
const context = buildFieldContext({ parcel, telemetry, score, cursor: timeline.cursor, cropId, groundTruth });
const result = await ask({ query, lang, context });   // AskResult: answer with [S#], citations, followUps, confidence, mode
const starters = suggestQuestions(context, lang);
```

`ask` also takes `field`, the locked field as the models read it (`toModelInput` of the mission state). Only the API server uses it, for the four lookups that run the models on the field; without it the generative mode answers a question about the field from `context` and the passages.

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
npm run server                 # the API server; generative with GEMINI_API_KEY or ANTHROPIC_API_KEY in .env
npx tsx scripts/rag/live-run.ts        # ask the 30 questions of data/rag/transcripts/questions.json (spends the provider's quota)
npx tsx scripts/rag/live-run.ts 06 21  # only these
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
- Generative mode was run against the live API with Gemini only (30 conversations, one model, one day). The Claude provider is tested against a fake client and has not been run live.
- The number check is a net over numbers: a number of the sources said of the wrong thing, a citation of the wrong source, a caveat left out and a claim without a number pass it ("Generative mode" lists what the transcripts show). A right answer can also be dropped: a sum or a share the model worked out is a number of its own.
- The generated answer for a question about a reading of the field is looser than the rule-based one (the days a forecast question asks about, the source of a factor). Whether those questions should go to the model at all is open.
- In the browser the four field lookups are not reached until the assistant panel sends the field with the question; until then the model answers a field question from the field context and the passages.
- A country is found by its code or by FAOSTAT's English name (Viet Nam and the United States also in Vietnamese); a province by the name MapSPAM gives it. A crop name the alias table does not know is "not in the atlas".
- The model answers in one turn: it has no memory of the questions before (issue C5).
