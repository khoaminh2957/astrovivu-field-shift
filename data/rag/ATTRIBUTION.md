# Attribution for the crop-knowledge corpus

The index in `public/rag/` is built from the sources below. Every chunk carries its source name, URL and licence (`KnowledgeChunk.source`), and every citation shown to the user repeats them.

| Source | What we use | Licence | Where |
|---|---|---|---|
| FAO EcoCrop (Food and Agriculture Organization of the United Nations, Land and Water Division) | Requirement columns and `notes`/`uses` narrative of 2,568 species | © FAO. Used with attribution for a non-commercial hackathon project; check FAO's terms before other reuse | `data/ecocrop/ecocrop_2568_plants.csv` |
| Wikipedia, English and Vietnamese | Plain-text extracts (lead + cultivation, climate, soil, pest, rotation… sections) of 74 crop articles and 24 method articles | CC BY-SA 4.0. Each chunk links to the exact revision (`oldid`). Excerpts are redistributed in `public/rag/*.json` under the same licence | `data/rag/raw/wikipedia/{en,vi}/*.json` (snapshot with title, page id, revision id, fetch time) |
| Astrovivu glossary | 28 term and method explainers in English and Vietnamese, written for this project from `docs/ARCHITECTURE.md` and `docs/DATA_SOURCES.md` | CC BY 4.0, Astrovivu team | `data/rag/glossary.en.md`, `data/rag/glossary.vi.md` |

Wikipedia snapshots were fetched on 2026-11-14 through the MediaWiki Action API (`prop=extracts`), one request per second with `maxlag=5` (Wikimedia answered HTTP 429 at four requests per second). Raw API responses are cached in `.cache/rag/wikipedia/` (git-ignored).

Attribution line for Wikipedia text: "Text from Wikipedia, the free encyclopedia, by its contributors, licensed under CC BY-SA 4.0; see the revision link of each passage."

## Considered and not used

| Source | Decision | Why |
|---|---|---|
| FAO crop water information pages, FAO-56 Kc tables | Not copied | © FAO; FAO-56 (1998) carries no open licence. The glossary explains the method in our own words; numbers come from the crop catalogue, not from copied tables |
| USDA SARE "Managing Cover Crops Profitably" and rotation bulletins | Not used | We could not confirm an open licence (CC or public-domain statement) for the text; not used until that is checked |
| USDA PLANTS / NRCS Plant Guides | Deferred | Public domain (US Government work) and a good fit for cover crops, but the guides are PDFs (no PDF parser without a new dependency) and US-centred |
| NASA Earth Observatory / Earthdata explainers (NDVI, SMAP) | Deferred | Public domain and directly relevant to the challenge's term explanations; HTML extraction was out of time. First candidate to add |
| Plants For A Future, Feedipedia | Not used | Non-commercial or unclear licences |
