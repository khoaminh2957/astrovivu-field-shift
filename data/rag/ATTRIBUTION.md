# Attribution for the crop-knowledge corpus

The index in `public/rag/` is built from the sources below. Every chunk carries its source name, URL and licence (`KnowledgeChunk.source`), and every citation shown to the user repeats them.

| Source | What we use | Licence | Where |
|---|---|---|---|
| FAO EcoCrop (Food and Agriculture Organization of the United Nations, Land and Water Division) | Requirement columns and `notes`/`uses` narrative of the 386 species the crop atlas keeps (of 2,568 in the file) | © FAO. Used with attribution for a non-commercial hackathon project; check FAO's terms before other reuse | `data/ecocrop/ecocrop_2568_plants.csv` |
| FAOSTAT, Crops and livestock products (QCL), Food and Agriculture Organization of the United Nations, read through the Astrovivu crop atlas | For each of the 387 crops: the FAOSTAT item it is tied to, the number of countries reporting production, the harvested area of the world, the countries with the largest harvested area and their level. Means of the years each sheet states (between 2015-2024 and 2022-2024). Accessed 15 November 2026 by the atlas build (`docs/CROP_DATA.md`, section 2) | CC BY 4.0, © FAO (FAO Statistical Database Terms of Use, https://www.fao.org/contact-us/terms/db-terms-of-use/en/). Attribution line below | `data/crops/atlas/crops.csv`, `data/crops/atlas/crop_country.csv`; which species are not kept and why: `data/crops/atlas/dropped.csv` |
| Wikipedia, English and Vietnamese | Plain-text extracts (lead + cultivation, climate, soil, pest, rotation… sections) of 70 crop articles and 24 method articles | CC BY-SA 4.0. Each chunk links to the exact revision (`oldid`). Excerpts are redistributed in `public/rag/*.json` under the same licence | `data/rag/raw/wikipedia/{en,vi}/*.json` (snapshot with title, page id, revision id, fetch time) |
| Astrovivu glossary | 28 term and method explainers in English and Vietnamese, written for this project from `docs/ARCHITECTURE.md` and `docs/DATA_SOURCES.md` | CC BY 4.0, Astrovivu team | `data/rag/glossary.en.md`, `data/rag/glossary.vi.md` |

Wikipedia snapshots were fetched on 2026-11-14 through the MediaWiki Action API (`prop=extracts`), one request per second with `maxlag=5` (Wikimedia answered HTTP 429 at four requests per second). Raw API responses are cached in `.cache/rag/wikipedia/` (git-ignored).

National statistics, read through the same atlas: for 17 crop and country pairs of Viet Nam and the United States a sheet gives the figure of a national publication, named in the sentence that gives it (the Statistical Yearbook of Viet Nam 2025 and the annual fruit and vegetable market report 2025 of the Ministry of Agriculture and Environment; USDA NASS Crop Production 2025 Summary, Vegetables 2025 Summary and the 2022 Census of Agriculture). Title, publisher, address, terms and day of access of each: the `national-*` rows of `data/crops/atlas/sources.csv`.

Attribution line for FAOSTAT figures: "FAO. FAOSTAT, Crops and livestock products. Licence: CC BY 4.0. Figures are means over the years stated, computed for the Astrovivu crop atlas; FAO does not endorse this use."

The Wikipedia snapshots of four articles (Lablab, Macadamia integrifolia, Stylosanthes guianensis, Trifolium repens) are still in `data/rag/raw/wikipedia/` and are no longer indexed: their species are not crops of the atlas.

Attribution line for Wikipedia text: "Text from Wikipedia, the free encyclopedia, by its contributors, licensed under CC BY-SA 4.0; see the revision link of each passage."

## Considered and not used

| Source | Decision | Why |
|---|---|---|
| FAO crop water information pages, FAO-56 Kc tables | Not copied | © FAO; FAO-56 (1998) carries no open licence. The glossary explains the method in our own words; numbers come from the crop catalogue, not from copied tables |
| USDA SARE "Managing Cover Crops Profitably" and rotation bulletins | Not used | We could not confirm an open licence (CC or public-domain statement) for the text; not used until that is checked |
| USDA PLANTS / NRCS Plant Guides | Deferred | Public domain (US Government work) and a good fit for cover crops, but the guides are PDFs (no PDF parser without a new dependency) and US-centred |
| NASA Earth Observatory / Earthdata explainers (NDVI, SMAP) | Deferred | Public domain and directly relevant to the challenge's term explanations; HTML extraction was out of time. First candidate to add |
| Plants For A Future, Feedipedia | Not used | Non-commercial or unclear licences |
