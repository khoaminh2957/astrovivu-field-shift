# Crop atlas

The same tables as a Google Sheet (uploaded 2026-11-15 from `.cache/atlas/astrovivu-crop-atlas.xlsx`; the sheet is a copy for reading and for filling in prices, the CSV files here are the source): <https://docs.google.com/spreadsheets/d/1AWTjpsYIUrwBiPcq9UKlxkZezkZLP5gJOZiXXD6Abto/edit>. Two tables are shortened in the sheet to stay within its size: `crop_country` leaves out the rows with level `absent`, and `region_crops` keeps the 15 largest crops of each region.

`data/crops/atlas/` answers three questions with data that is merged from published datasets and never typed in: which plants are farmed, what each needs, and where each is grown. It is built by `scripts/crops/atlas/build.ts`. This document lists the sources, every rule and threshold, the counts of the current build and the known gaps.

The one principle: every value is copied or computed from a named source file by a rule written in code. The build contains no list of plants, countries, quantities, names or translations. An unknown is an empty cell; a mapping that the rules cannot make says `match = none`.

## 1. Files

| File | Rows | Content |
|---|---|---|
| `crops.csv` | 387 | One row per kept crop: ids, names, EcoCrop description and requirements, FAOSTAT item, match, MapSPAM crop, evidence, commonness, world totals |
| `crop_country.csv` | 72,666 | One row per crop and country: area, production, yield, share, rank, level (11,399 with quantities, 21,271 `absent`, 39,996 `unknown`) |
| `item_country.csv` | 9,358 | The same quantities per FAOSTAT item and country, group items included |
| `country_crops.csv` | 198 | One row per country: what is grown there, largest first |
| `region_crops.csv` | 50,967 | MapSPAM 2020 harvested area per country and first-level region, per SPAM crop |
| `items.csv` | 157 | Crosswalk FAOSTAT item to species, with the definition text it was read from |
| `spam_crops.csv` | 46 | Crosswalk MapSPAM crop to FAOSTAT items and to our crops |
| `dropped.csv` | 2,182 | Every EcoCrop species that was not kept, with the reason |
| `economics_template.csv` | 0 | Header only; yields, prices and costs are for the team to fill |
| `sources.csv` | 22 | Source, URL, licence, access date, file, SHA-256, rows used |
| `columns.csv` | 207 | Every column: meaning in English and Vietnamese, unit, source, rule |
| `summary.csv` | 52 | The counts of the build |

`.cache/atlas/astrovivu-crop-atlas.xlsx` (git-ignored, 5.9 MB, 1,419,230 cells) holds one sheet per table behind a README sheet, for upload to Google Sheets. It leaves out the `absent` rows of `crop_country` and keeps the 15 largest crops of each region in `region_crops`; the CSV files are complete. Values are plain: numbers are numeric cells, codes such as CPC `0113` are text, there are no formulas and no dates. Excel 16 opens it without repair (checked).

## 2. Sources

Access date of every download: 2026-11-15. Checksums and sizes are in `sources.csv`.

| Source | What it provided | Licence as read |
|---|---|---|
| FAO EcoCrop, `data/ecocrop/ecocrop_2568_plants.csv` (in the repository) | 2,568 species: names, synonyms, common names, description, requirements | Property of FAO, used with attribution for a non-commercial project (`data/ecocrop/README.md`) |
| FAOSTAT, Crops and livestock products (QCL), normalized bulk file, `bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip` (34 MB; 4,209,110 rows read, 1,195,494 used) | Area harvested, production and yield per country, item and year up to 2024; item names and CPC codes; area names and M49 codes | CC BY 4.0, FAO Statistical Database Terms of Use |
| FAO, "Definition and classification of commodities" (draft), chapters 1 to 13, `www.fao.org/es/faodef/fdef01e.htm` to `fdef13e.htm` | The scientific names behind each FAOSTAT item code (501 commodity rows) | FAO website terms: may be copied for private study, research, teaching and non-commercial products with acknowledgement |
| CPC Ver. 2.1 structure and explanatory notes, FAO Caliper, `stats.fao.org/caliper/download/CPCv2.1/CPC21-core.csv` | Plant names in the notes of 35 classes that FAOSTAT items use; class hierarchy | None stated on the download page; FAO website terms apply; a United Nations classification |
| UN M49 overview, `unstats.un.org/unsd/methodology/m49/overview/` | M49 code to ISO alpha-3 (196 codes used) | (c) United Nations; no data licence on the page; the UN terms page answered HTTP 403 and was not read |
| GeoNames `countryInfo.txt` | FIPS 10-4 to ISO alpha-3 for MapSPAM (175 codes); ISO numeric fallback for 2 FAOSTAT areas | CC BY 4.0 |
| mapspamc, `inst/mappings/faostat2crop.csv` (GitHub michielvandijk/mapspamc, commit e729598) | FAOSTAT item code to SPAM crop, 156 rows | MIT |
| MapSPAM 2020 V2r2 readme | The 46 crop codes and names, file layout | CC BY 4.0, IFPRI Dataverse Terms of Use |
| MapSPAM 2020 V2r2, global harvested area, CSV (109 MB zip; 964,647 grid cells of `spam2020V2r2_global_H_TA.csv`) | Harvested area per 5-arc-minute cell with country and admin-1 names | CC BY 4.0 with citation and the notice below |
| `data/crops/curated-crops.csv` | Our `crop_id`, `name_en`, `name_vi` for 73 crops | Project file |

How three of them were obtained, since it was not straightforward:

- **FAO commodity definitions.** FAOSTAT's own item descriptions sit behind the definitions API, which now answers "Missing Authorization Header" (401), and the pages have left fao.org (404). The build reads the copies the Internet Archive holds, at fixed snapshot addresses (2021 and 2022, listed in `sources.csv`). The text is FAO's; it dates from the 1990s, so its botanical names are old ones (`Lycopersicon esculentum`, `Glycine soja`), which is why EcoCrop's synonyms are part of the match.
- **MapSPAM.** Harvard Dataverse refuses the file without a guestbook form ("You may not download this file without the required Guestbook response"), which the build does not fill in. The build downloads the same file from the Dropbox link that IFPRI publishes on `mapspam.info/data`, and refuses it unless its MD5 equals the one in the Dataverse record (`9e82eb7c6202cdcf10daf3508356c2dd`, datafile 13740106). `mapspam.info` itself rejects non-browser clients; its link list was read once by hand with a browser user agent, and the build does not contact it.
- **Dataverse record.** Node cannot validate the certificate chain of `dataverse.harvard.edu`, so the record is not downloaded by the build; the MD5 was read from it with curl and is pinned in `scripts/crops/atlas/fetch.ts`.

Required notices. FAOSTAT: "FAO. 2025. FAOSTAT: Crops and livestock products. Accessed on 15 November 2026. https://www.fao.org/faostat/en/#data/QCL Licence: CC-BY-4.0." MapSPAM: International Food Policy Research Institute (IFPRI), 2025, "Global Spatially-Disaggregated Crop Production Statistics Data for 2020 Version 2.0.0", https://doi.org/10.7910/DVN/SWPENT, Harvard Dataverse, V2. This data was provided by the International Food Policy Research Institute (IFPRI). IFPRI bears no responsibility for the analyses or interpretations of the data presented here.

## 3. EcoCrop columns

Text columns are copied. Numbers are cleaned by removal only (`ecocrop.ts`); nothing is repaired or imputed, unlike the scoring catalogue (`scripts/crops/parse.ts`), which may rescale or widen a window.

| Rule | Effect |
|---|---|
| `-`, `--`, `---`, `no input`, `na`, empty | empty cell |
| Temperature outside -60..60 °C, rainfall outside 0..12,000 mm, pH outside 0..14, altitude outside -500..9,000 m | value dropped, noted in `ecocrop_cleaning` |
| Latitude above 90 | an altitude typed into the wrong field: dropped, noted |
| Cycle of 0 days | missing |
| Cycle with a thousands separator (`1,500`) or outside 1..366 | dropped, noted |
| Limits out of order (optimal outside absolute) | kept as published, noted |

EcoCrop's latitude "min" and "max" are the southern and northern limits in degrees from the equator (rice: 36 and 55), so they are not checked for order. Among the 386 kept EcoCrop rows, 4 carry a note.

`crop_id` is the slug of the EcoCrop scientific name, the rule of the app catalogue (`src/core/crops/text.ts`), with the EcoCrop id appended when two rows share a name; a curated crop keeps its curated id. `name_vi` comes from the curated list only. `name_en` is the curated name, else the FAOSTAT item name when the item is that one species, else the vernacular name the FAO definition prints before the scientific name ("durian (Durio zibethinus)"), else empty: EcoCrop's common names carry no language, so none can be called English by rule. `name_ecocrop_first` gives the first common name in plain Latin letters, which is what the app shows today (often Portuguese or Spanish). 138 kept crops have no `name_en`.

## 4. FAOSTAT

- **Elements.** 5312 area harvested (ha), 5510 production (t), 5412 yield (kg/ha, divided by 1,000). The build stops if a unit differs.
- **Crop items.** The 157 items for which FAOSTAT reports an area harvested. Items whose CPC code starts with `F` are FAOSTAT's own aggregates ("Cereals, primary") and are skipped.
- **Mean.** For each country, item and element: the mean of the latest 3 years that have a value, taken from the last 10 years of the file (2015 to 2024). A series that stopped before 2015 is not used. Rows flagged `M` or without a value are not observations. `year_from` and `year_to` say which years entered.
- **Countries.** A FAOSTAT area is a country when its M49 code has an ISO alpha-3 code in the UN M49 list; two areas absent from that list take the code GeoNames gives their ISO number. 198 areas qualify. 36 do not: World, the continents and sub-regions, the European Union, the income and development groups, "Sudan (former)" and "China" (M49 159), which is the sum of China mainland, Hong Kong, Macao and Taiwan and would double count them; "China, mainland" is `CHN`.
- **World totals** are sums over these countries, not the FAOSTAT World row.

## 5. Which species is which item

FAOSTAT items are commodities. Two published texts say which plants an item means, and both are parsed by rule (`definitions.ts`, `taxa.ts`):

1. the FAO commodity definitions, keyed by the FAOSTAT item code: `0430 OKRA Abelmoschus esculentus; Hibiscus esculentus`;
2. the CPC 2.1 explanatory notes, keyed by the item's CPC code, up to "This subclass does not include".

151 of the 157 crop items get at least one plant name this way. Names are read from italics; abbreviations are expanded with the genus named before them (`T. aestivum` after `Triticum spp.`); a name the page left outside italics is read only if its genus exists in EcoCrop, because plain text also holds phrases shaped like a name ("Indian corn").

A name from a definition is compared with each EcoCrop species (`match_method`):

| Method | Meaning |
|---|---|
| `variety` | same species and same variety |
| `species` | same binomial as the EcoCrop name |
| `synonym` | same binomial as one of the EcoCrop synonyms |
| `species-variety` | the definition names one variety, the EcoCrop row is the whole species |
| `genus` | the definition says `Genus spp.` and the species is of that genus; only for species EcoCrop describes as grown on a large or small scale |
| `name` | no scientific name worked; an EcoCrop common name equals the item name (see below) |

An item is a **group** when its name is a residual class ("n.e.c.", "Other ..."), when the FAO definition is an open list ("Including inter alia"), or when its definition resolves to EcoCrop species of more than one genus. Otherwise it is **single**. 128 items are single, 29 are groups. Names in a definition that resolve to no EcoCrop species do not count as a further genus: they cannot be told from an unlisted synonym ("Thea sinensis" beside "Camellia sinensis").

`match` of a species:

- `exact`: a single item names this species, or names only its genus without singling out any species (coffee: "Coffea spp."). When several single items name it (dry and green peas), all are attached and the one with the largest world area is `faostat_item_code`.
- `group`: the species is named in a group item; or it belongs to the genus of a single item whose definition singles out other species ("Oryza spp., mainly Oryza sativa" makes *Oryza sativa* exact and *Oryza glaberrima* a member). The item's quantities are never shown as the species'.
- `none`: no item names it.

The common-name fallback is deliberately narrow: it applies only to a species no definition names, and only into an item whose own scientific names resolved to no EcoCrop species. It made 3 matches, all visible in `matched_common_name`: soybean ("Glycine soja" in the definition, *Glycine max* in EcoCrop), walnut (the definition misspells the genus) and raspberry. Without the second condition it also attached *Apios americana* to groundnuts and *Parkinsonia aculeata* to horse beans, on a shared vernacular name.

Of all 2,568 species: 165 exact, 226 group, 2,177 none.

## 6. What is kept

A species is kept when at least one holds (`evidence`):

| Evidence | Rule | Crops |
|---|---|---|
| `faostat-exact` | `match = exact` and some country has area or production above zero | 165 |
| `faostat-group` | `match = group` and EcoCrop describes the plant as "grown on large scale" or "grown on small scale" | 201 |
| `mapspam` | its item belongs to an individual MapSPAM crop (and, for a group match, EcoCrop describes it as grown) | 86 |
| `curated` | it is in our curated list; `curated-only` when nothing else holds | 73, of which 21 `curated-only` |

Kept: 387 (386 EcoCrop species and *Tagetes erecta*, which EcoCrop lacks). By match: 165 exact, 202 group, 20 none. Dropped: 2,182, of which 2,158 because no FAOSTAT crop item names them and 24 because they are named only in a group item and EcoCrop does not describe them as grown.

All 73 curated crops are kept. The 21 `curated-only` ones: amaranthus-tricolor, arachis-pintoi, basella-alba, brassica-juncea, brassica-rapa-pak-choi, catharanthus-roseus, cymbopogon-citratus, ipomoea-aquatica, medicago-sativa, momordica-charantia, mucuna-pruriens, musa-acuminata, ocimum-basilicum, sesbania-rostrata, sorghum-x-drummondii, tagetes-erecta, trifolium-incarnatum, trifolium-pratense, vicia-villosa-ssp-villosa, vigna-radiata, vigna-unguiculata-ssp-sesquipedalis. They are forage and cover crops, which FAOSTAT's crop statistics do not carry, leafy vegetables and herbs that fall in "Other vegetables" without being named, and three cases explained in section 10.

`commonness` (exact matches only), from the number of producing countries and the world harvested area, both required:

| Tier | Countries | Area | Crops |
|---|---|---|---|
| `global` | 50 | 1,000,000 ha | 85 |
| `widespread` | 20 | 100,000 ha | 54 |
| `regional` | 5 | 10,000 ha | 20 |
| `local` | less | | 6 |

All thresholds are in `scripts/crops/atlas/levels.ts`.

## 7. Countries

`crop_country.csv` has one row per kept crop and FAOSTAT country.

- **Exact crops.** Area and production are the sums over the crop's own items that the country reports above zero; `faostat_item_code` lists them, largest first. Tonnes of different products are added when a crop has several items (maize grain and green corn). The yield is FAOSTAT's yield of the first item, not production divided by area. `share_of_country_harvested_area_pct` is the area over the area of all 157 crop items of the country; `rank_in_country` is 1 plus the number of other items with a larger area.
- **Level.** `major` from 5 % of the country's harvested area, `common` from 0.5 %, `minor` below, `present` when production is reported without area, `absent` when FAOSTAT covers the country and none of the crop's items is above zero.
- **Group crops.** `level = unknown` in every country; `item_reported` says whether the country reports the group item at all. The quantities are in `item_country.csv`, attached to the item.
- **Shared items.** 30 single items belong to more than one crop (wheat to 3 Triticum rows, coffee to 4 Coffea species, cabbages to 6 Brassica rows). Each of those crops shows the item's full quantities; `item_shared_by_n_crops` in `crops.csv` says so, and `country_crops.crops_by_area` lists them after one arrow. FAOSTAT cannot split arabica from robusta; MapSPAM can.

`country_crops.csv` gives, per country: the 15 largest items, the crop ids at each level, the items with their crops in order of area, the group items reported, and the kept crops that are members of those (`possible_crop_ids`).

## 8. Regions (MapSPAM 2020)

Harvested area (file `H`, technology `A`, all technologies) is summed from 964,647 cells to 179 countries and 2,273 first-level units. The cell table has no unit column; the SPAM documentation gives hectares, and the world total agrees with FAOSTAT (1,441 million ha against 1,480 million ha). Rows that round to 0 ha are left out. `share_of_region_pct` is over the 46 SPAM crops of the unit.

ISO alpha-3: MapSPAM identifies a country by a FIPS 10-4 code, joined to GeoNames (175 countries). Four of its codes are not FIPS codes (Togo `TG`, Montenegro `MW`, Puerto Rico `PQ`, United Arab Emirates `TC`); for those the country name is looked up in the UN M49 list. Region names are MapSPAM's (Viet Nam has 64 units, on the pre-2008 map: "Ha Tay" is still separate).

SPAM crop to FAOSTAT items (`spam_crops.csv`): the mapspamc table gives the items of 40 crops (`crosswalk_method = mapspamc`). SPAM 2020 has six crops the table does not know, and no machine-readable crosswalk for them was found; they are matched on their name (`name`): the head noun of the SPAM crop name is looked up in the FAOSTAT item names and in the label of each item's CPC parent class. That gives tomato (388), onion (402, 403), rubber (836), citrus (the five items of CPC 0132 "Citrus fruits"), pearl millet (79) and robusta coffee (656), and removes those items from the residual class the older table had them in. Where two SPAM crops share an item, a species goes to the crop whose name its EcoCrop common names carry ("pearl millet"; "robusta coffee" for SPAM's "Robust Coffee") and otherwise stays with the table's crop.

A SPAM crop is `residual` when its name starts with "Other" or "Rest" or it has more than 3 items (10 crops: other cereals, other roots, other pulses, other oil crops, other fibres, citrus, tropical fruit, temperate fruit, vegetables, rest); the other 36 are `individual`. `region_crops.crop_ids` lists our crops for individual SPAM crops only.

## 9. Checks of this build

Top items by harvested area as the data gives them (mean 2022 to 2024):

| | Viet Nam | ha | United States | ha |
|---|---|---|---|---|
| 1 | Rice | 7,089,041 | Soya beans | 34,330,527 |
| 2 | Other vegetables, fresh n.e.c. (group) | 898,373 | Maize (corn) | 33,469,753 |
| 3 | Maize (corn) | 875,899 | Wheat | 15,004,017 |
| 4 | Natural rubber | 728,509 | Seed cotton | 3,052,090 |
| 5 | Coffee, green | 667,148 | Sorghum | 2,197,467 |
| 6 | Cassava | 519,296 | Rice | 1,064,067 |
| 7 | Cashew nuts | 286,817 | Rape or colza seed | 975,183 |
| 8 | Other fruits, n.e.c. (group) | 246,756 | Barley | 924,713 |
| 9 | Cinnamon | 191,575 | Groundnuts | 633,530 |
| 10 | Coconuts | 177,318 | Almonds | 554,425 |
| 11 | Sugar cane | 173,030 | Beans, dry (group) | 519,517 |
| 12 | Other pulses n.e.c. (group) | 160,061 | Sunflower seed | 478,763 |
| 13 | Groundnuts | 152,837 | Sugar beet | 451,943 |
| 14 | Bananas | 144,947 | Potatoes | 378,223 |
| 15 | Mangoes, guavas and mangosteens (group) | 122,892 | Sugar cane | 376,267 |

| Crop | Result |
|---|---|
| Durian | `group`, member of "Other tropical fruits, n.e.c." (603). Viet Nam: `unknown`, `item_reported = no`: FAOSTAT has no record of item 603 for Viet Nam, so the source neither shows nor excludes durian there |
| Aibika (*Abelmoschus manihot*) | dropped: no FAOSTAT crop item names it. It no longer inherits the countries of "other vegetables" |
| Rice | exact; 116 countries; Viet Nam 7,089,041 ha, 6.09 t/ha, `major`; United States 1,064,067 ha, `common` |
| Maize | exact (items 56 and 446); 172 countries; Viet Nam 875,899 ha, `major`; United States 33,613,081 ha, `major` |
| Soybean | exact by common name; 104 countries; Viet Nam 30,237 ha, `minor`; United States 34,330,527 ha, `major` |
| Robusta coffee | exact through the genus, item shared by 4 Coffea species; Viet Nam 667,148 ha, `common` (4.94 %); MapSPAM `rcof` |
| Sweet potato | exact; 117 countries; Viet Nam 82,109 ha, `common`; United States 55,915 ha, `minor` |
| Alfalfa | `curated-only`, no country rows: FAOSTAT's crop statistics have no forage items |

`npx vitest run scripts/crops/atlas`: 4 files, 46 tests pass. `npx tsc --noEmit`: no errors. A second run with `--offline` reproduces all 12 CSV files and the workbook byte for byte.

## 10. Known gaps

- **Group crops have no country level.** 202 kept crops, 12 of them curated (common bean, mung bean, chili, mango, lettuce, pumpkin, durian, radish, coriander, sunn hemp, perilla, mint), are `unknown` in every country because FAOSTAT pools them with other plants. For a gate, use `item_reported`, the MapSPAM crop, or a national source.
- **EcoCrop row and FAO name differ.** The curated banana is EcoCrop's *Musa acuminata*, while the FAO definition of bananas names *Musa sapientum*, *M. cavendishii* and *M. nana*; EcoCrop has a *Musa sapientum* row, which gets the banana and plantain data, and *Musa acuminata* stays `curated-only`. EcoCrop's sugar beet row is *Beta vulgaris var. saccharifera*, the definition says *var. altissima*: the item goes to the plain *Beta vulgaris* row and the sugar beet row lands in "Other vegetables" (the definition lists "beets, chards (Beta vulgaris)"). Sudangrass (*Sorghum x drummondii*) is of the sorghum genus but EcoCrop does not mark it as grown, so it does not take the sorghum item.
- **Purely genus-level items are shared** by every cultivated EcoCrop species of the genus: coffee (4 species), cotton (4), lupins (5), strawberries (2). The quantities cannot be split.
- **Ten crop items have no kept crop**: triticale, mixed grain, karite nuts, other beans green, string beans, chicory roots, other stone fruits, other pome fruits, maté, pyrethrum. Their definitions name nothing EcoCrop resolves (spelling: "Ilex paraguayensis", "Butyrospermum parkii") or name nothing at all.
- **676 species that EcoCrop describes as grown (194 on a large scale) are dropped** because no FAOSTAT crop item names them: forage grasses and legumes, timber, ornamentals, medicinals, and some food plants (25 of the large-scale ones are in food categories, such as *Lablab purpureus*, *Lathyrus sativus*, *Bactris gasipaes*). The keep rule of the brief excludes them; they are in `dropped.csv`, and the rule is the `evidence` block of `build.ts` if the team wants them kept under a further evidence value.
- **Old definitions.** The FAO text predates some current items: "Mangoes, guavas and mangosteens" is recognised as a group only through the CPC note; an item whose scope widened without a CPC note would still read as single.
- **MapSPAM is a model.** It allocates national and sub-national statistics to cells; a region's figure is an estimate (Dak Lak shows 23,871 ha of robusta). The six name-matched SPAM crops rest on a name rule, not on a published table.
- **Synonym matching is by binomial.** Two EcoCrop rows that list the same old name as a synonym would both match it.
- **Licences.** The FAO definitions and the CPC file are not openly licensed (non-commercial use with acknowledgement). The crosswalk derived from them is in the repository; check before any commercial reuse.

## 11. Rebuild

```
npx tsx scripts/crops/atlas/build.ts            # downloads what .cache/atlas/raw lacks (about 145 MB), then builds: 35 s
npx tsx scripts/crops/atlas/build.ts --offline  # from the cache only
npx vitest run scripts/crops/atlas
```

Downloads are sequential, each with a timeout and at most 3 retries with backoff; `.cache/atlas/raw/manifest.json` records URL, date, size and SHA-256. To refresh a source, delete its file from the cache. No package was installed: the zip reader, the xlsx writer and the CSV code are in the folder.

| Module | Role |
|---|---|
| `build.ts` | entry point: reads, joins, writes |
| `fetch.ts` | source registry, cached downloads, checksums |
| `ecocrop.ts` | EcoCrop cleaning |
| `definitions.ts`, `taxa.ts` | item definitions, scientific names, matching |
| `crosswalk.ts` | item classes, species matches, SPAM crosswalk |
| `faostat.ts`, `spam.ts` | streaming readers of the two large tables |
| `levels.ts` | thresholds, three-year mean, ranks |
| `columns.ts` | column dictionary (English and Vietnamese) |
| `csv.ts`, `zip.ts`, `xlsx.ts` | file formats |

## 12. Prices

`economics_template.csv` has the header `crop_id, iso3, region, yield_t_ha, price_usd_t, cost_usd_ha, year, quality_yield, quality_price, quality_cost, source, url, accessed`. Use `crop_id` from `crops.csv` and `iso3` from `country_crops.csv`; one row per crop and place; every figure with its source and the date it was read. `crop_country.yield_t_ha` already gives the FAOSTAT yield for exact crops, so the work is prices and costs.
