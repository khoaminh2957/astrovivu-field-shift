# Crop atlas

The same tables as a Google Sheet (uploaded 2026-11-15 from `.cache/atlas/astrovivu-crop-atlas.xlsx`; the sheet is a copy for reading and for filling in prices, the CSV files here are the source): <https://docs.google.com/spreadsheets/d/1AWTjpsYIUrwBiPcq9UKlxkZezkZLP5gJOZiXXD6Abto/edit>. Two tables are shortened in the sheet to stay within its size: `crop_country` leaves out the rows with level `absent`, and `region_crops` keeps the 15 largest crops of each region.

`data/crops/atlas/` answers three questions with data that is merged from published datasets and never typed in: which plants are farmed, what each needs, and where each is grown. It is built by `scripts/crops/atlas/build.ts`. This document lists the sources, every rule and threshold, the counts of the current build and the known gaps.

The one principle: every value is copied or computed from a named source file by a rule written in code. The build contains no list of plants, countries, quantities, names or translations. An unknown is an empty cell; a mapping that the rules cannot make says `match = none`.

## 1. Files

| File | Rows | Content |
|---|---|---|
| `crops.csv` | 387 | One row per kept crop: ids, names, EcoCrop description and requirements, FAOSTAT item, match, MapSPAM crop, evidence, commonness, world totals |
| `urban_candidates.csv` | 387 | One row per crop of `crops.csv`, in its order: whether the EcoCrop rule selects it as an urban / container candidate, and the clause that matched (section 13) |
| `crop_country.csv` | 72,706 | One row per crop and country: area, production, yield, share, rank, level, source (15 columns, the ones the market database mirrors; 11,416 with quantities, 21,260 `absent`, 40,030 `unknown`; 59 `match = national`, of which 17 with a figure and 42 without) |
| `item_country.csv` | 9,358 | The same quantities per FAOSTAT item and country, group items included |
| `country_crops.csv` | 198 | One row per country: what is grown there, largest first |
| `region_crops.csv` | 50,967 | MapSPAM 2020 harvested area per country and first-level region, per SPAM crop |
| `items.csv` | 157 | Crosswalk FAOSTAT item to species, with the definition text it was read from |
| `spam_crops.csv` | 46 | Crosswalk MapSPAM crop to FAOSTAT items and to our crops |
| `dropped.csv` | 2,182 | Every EcoCrop species that was not kept, with the reason |
| `economics_template.csv` | 0 | Header only; yields, prices and costs are for the team to fill |
| `sources.csv` | 33 | Source, URL, licence, access date, file, SHA-256, rows used (22 files of the build and the 11 publications the national rows cite, which have no checksum: the build keeps no copy) |
| `columns.csv` | 210 | Every column: meaning in English and Vietnamese, unit, source, rule |
| `summary.csv` | 58 | The counts of the build |

`.cache/atlas/astrovivu-crop-atlas.xlsx` (git-ignored, 6.0 MB, 1,421,337 cells) holds one sheet per table behind a README sheet, for upload to Google Sheets. It leaves out the `absent` rows of `crop_country` and keeps the 15 largest crops of each region in `region_crops`; the CSV files are complete. Values are plain: numbers are numeric cells, codes such as CPC `0113` are text, there are no formulas and no dates. Excel 16 opens it without repair (checked).

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
| `data/crops/national/prevalence.csv` | National statistical figures and notes for `VNM` and `USA` (76 rows, 17 with a figure and 59 with a note only: all 32 `group` + `none` curated crops in both countries, plus 12 `sai-absent`/`thieu` rows from T1 `#8`) | Official public statistics of Viet Nam (NSO, MARD) and the United States (USDA NASS, public domain, 17 U.S.C. § 105); see Section 7.1 |

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

### 3.1 Aluminium toxicity (`eco_soil_al_tox_opt`, `eco_soil_al_tox_abs`)

FAO EcoCrop records aluminium saturation tolerance (% of effective CEC occupied by exchangeable $\text{Al}^{3+}$) in two text columns, `eco_soil_al_tox_opt` (optimal) and `eco_soil_al_tox_abs` (tolerated), on 62 of the 2,568 EcoCrop rows (8 of the 387 kept atlas crops, and 1 of the 73 curated crops: `arachis-pintoi`). `scripts/crops/parse.ts` maps these strings to `CropRequirements.alToxicity?: { opt: AlToxicityClass; abs: AlToxicityClass }` (`AlToxicityClass = 'none' | 'low' | 'medium' | 'high'` in `src/contracts/crop.ts`), and `src/core/crops/codec.ts` preserves them in `public/data/crops/ecocrop.json`. Crops without an EcoCrop value omit `req.alToxicity` (`undefined`).

| Raw EcoCrop string | `AlToxicityClass` | Aluminium saturation (% of CEC) | Rows in EcoCrop (`opt` / `abs`) | Notes |
|---|---|---|---:|---|
| `none (<5% of CEC)` | `none` | $< 5\%$ | 4 / 1 | Sensitive to exchangeable $\text{Al}^{3+}$ |
| `low (6-15% of CEC)` | `low` | $6\text{–}15\%$ | 54 / 14 | Low aluminium saturation |
| `medium (16-25% of CEC` | `medium` | $16\text{–}25\%$ | 4 / 25 | Raw EcoCrop string is missing the closing parenthesis `)` |
| `high (<5% of CEC)` | `high` | $> 25\%$ | 0 / 22 | Raw EcoCrop string misprints `<5% of CEC` inside the `high` label (e.g. `beta-vulgaris-var-saccharifera` has `opt = medium (16-25% of CEC` and `abs = high (<5% of CEC)`); the class prefix `high` is authoritative |

The 8 kept atlas crops with `alToxicity` values are: `arachis-pintoi` (`opt: 'low'`, `abs: 'medium'`, curated), `amaranthus-caudatus` (`none` / `low`), `beta-vulgaris-var-saccharifera` (`medium` / `high`), `sorbus-domestica` (`low` / `low`), `vigna-parkeri` (`low` / `medium`), `vigna-parkeri-sp-acutifolia` (`low` / `medium`), `vigna-parkeri-sp-maranguensis` (`low` / `medium`), and `vigna-vexillata` (`low` / `medium`). The five sample-parcel crops (`coffea-canephora`, `oryza-sativa`, `zea-mays`, `glycine-max`, `medicago-sativa`) have empty cells in EcoCrop and therefore `req.alToxicity === undefined`.

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
- **Group crops.** `level = unknown` in every country unless supplied by `data/crops/national/prevalence.csv`; `item_reported` says whether the country reports the group item at all. The quantities are in `item_country.csv`, attached to the item.
- **National prevalence (`match = national`).** Read by `scripts/crops/atlas/national.ts` from `data/crops/national/prevalence.csv`. For `group` and `none` crops (and false-`absent` rows identified in T1 `#8`), a row with a national figure writes `match = national`, an empty `faostat_item_code`, `year_from = year_to = year`, `share_of_country_harvested_area_pct = (area_ha / total_harvested_area_ha) * 100` (**the numerator is the national `area_ha` and the denominator is FAOSTAT's `total_harvested_area_ha` of the country**), `level = levelFor(area_ha, share, production_t)`, and adds the crop to `cropsOfCountry` so `country_crops.csv` lists it. A row without a national figure leaves `area_ha` empty and keeps `level = unknown` (never inferred from a group item); on a `group` crop the FAOSTAT group row stays as it is, on a crop with no item or an `absent` row it is written with `match = national`. **`crop_country.csv` gets no new column**: a national row is recognised by `match = national` and by `source`, which names the national statistic instead of `FAOSTAT QCL`. The URL, access date, table and `note` of every national row (the reason, when there is no figure) are in `data/crops/national/prevalence.csv`, keyed by `crop_id` and `iso3`, and the publication is a row of `sources.csv`. Outside `VNM` and `USA` the file is byte for byte what it was. A national row only replaces `unknown` or `absent`; it **never** changes an `exact` row for which FAOSTAT reports the crop in the country, with an area or with production alone (`present`), whether the national row has a figure or not. Such a row is ignored and the build says so (`national rows ignored` in its report, `national_rows_ignored` in `summary.csv`; none today). **A figure is entered only when the source gives it for the species and for the whole country.** The area of one city, one commune or one demonstration plot is not a national figure, and the figure of a group (all dry edible beans, pumpkins and squash of every species, all Chinese cabbages, all vetches) is not the figure of one species: in both cases `area_ha` and `production_t` stay empty, the level is `unknown`, and the `note` gives what the source does say. `summary.csv` counts the `match = national` rows with a figure (`crop_country_rows_national_with_figure`, 17) apart from those without (`crop_country_rows_national_without_figure`, 42); the publications are rows of `sources.csv` (`national-…`), written by the build from `NATIONAL_SOURCES` in `national.ts`, and a row citing a URL that is not registered there stops the build.
- **Shared items.** 30 single items belong to more than one crop (wheat to 3 Triticum rows, coffee to 4 Coffea species, cabbages to 6 Brassica rows). Each of those crops shows the item's full quantities; `item_shared_by_n_crops` in `crops.csv` says so, and `country_crops.crops_by_area` lists them after one arrow. FAOSTAT cannot split arabica from robusta; MapSPAM can.

`country_crops.csv` gives, per country: the 15 largest items, the crop ids at each level, the items with their crops in order of area, the group items reported, and the kept crops that are members of those (`possible_crop_ids`).

### 7.1 National prevalence sources and tables (`VNM`, `USA`, `IND`, and `BRA`, T4 `#9` & T7 `#12`)

All 73 curated crops now have a row in `crop_country.csv` across `VNM`, `USA`, `IND`, and `BRA`, with a level computed from a named source or `unknown`, in which case the `note` of the row in `data/crops/national/prevalence.csv` gives the reason (the notes quoted below are that column).

- **Why `IND` and `BRA` were selected after `VNM` and `USA` (T7 `#12`):**
  - `VNM` (Viet Nam) and `USA` (United States of America) hold the four demo parcels (`daklak-coffee`, `cantho-rice`, `iowa-corn-soy`, `nevada-alfalfa`).
  - `IND` (India) and `BRA` (Brazil) are the two additional countries pinned in `src/data/country.test.ts` (`it.each(['VNM', 'USA', 'IND', 'BRA'])`, added in B20): `IND` is #1 in global harvested area in the FAOSTAT atlas (`209,666,183 ha`, 80 reported items; South Asian monsoon reference), and `BRA` is #1 in South America (`95,728,729 ha`, 69 reported items; tropical/subtropical Latin American reference).
- **Denominator rule:** For every `match = national` row, `share_of_country_harvested_area_pct` divides the **national harvested area (`area_ha`, numerator)** by **FAOSTAT's `total_harvested_area_ha` for that country (denominator)**:
  - `VNM`: denominator = `13,504,720 ha` (FAOSTAT 2022–2024 mean across 43 reported items)
  - `USA`: denominator = `98,830,011 ha` (FAOSTAT 2022–2024 mean across 89 reported items)
  - `IND`: denominator = `209,666,183 ha` (FAOSTAT 2022–2024 mean across 80 reported items)
  - `BRA`: denominator = `95,728,729 ha` (FAOSTAT 2022–2024 mean across 69 reported items)

| Country | Source | Tables used & crops covered | URL & access date | Licence |
|---|---|---|---|---|
| `VNM` | Cục Thống kê (NSO, Bộ Tài chính), *Niên giám Thống kê Việt Nam năm 2025* (*Statistical Yearbook of Viet Nam 2025*, Nxb Thống kê, 07/2026) | **Biểu 220 & 221** (pp. 612–613, *Diện tích cho sản phẩm và sản lượng một số cây lâu năm chủ yếu*, năm 2024): `musa-acuminata` (`144,600 ha`, `2,997,900 t`, `1.071%` -> `common`), `mangifera-indica` (`96,500 ha`, `1,094,100 t`, `0.715%` -> `common`), `litchi-chinensis` (`51,900 ha`, `255,000 t`, `0.384%` -> `minor`). **Chương 6** (pp. 534, 540) & **Biểu 187–188** (pp. 558–559): documents why vegetables, pulses, annual spices and cover/forage crops (`1,148,000 ha` rau đậu các loại) have no species-level national table (`level = unknown` with `note`, including the 9 `sai-absent` crops from T1 `#8`: `abelmoschus-esculentus`, `allium-fistulosum`, `cucumis-sativus`, `fragaria-x-ananassa`, `lycopersicon-esculentum`, `pisum-sativum`, `solanum-melongena`, `vigna-unguiculata`, `zingiber-officinale`). | <https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf> (accessed `2026-11-15`) | Official government statistical publication of Viet Nam (Law on Statistics No. 89/2015/QH13 and Law No. 01/2021/QH15; open for public citation with source attribution) |
| `VNM` | Bộ Nông nghiệp và Môi trường (Cục Trồng trọt và Bảo vệ thực vật / IPSARD), *Báo cáo thường niên thị trường Rau quả 2025* | **Mục 1.2.1 & 1.2.2.(i)** (pp. 13, 15–17, *Sản xuất sầu riêng*, năm 2024): `durio-zibethinus` (`178,800 ha`, `1,470,000 t`, `1.324%` -> `common`). | <https://thitruongnongsan.gov.vn/images/2013/DANGNHAP/Bao%20cao%20thuong%20nien%20rau%20qua%202025.pdf> (accessed `2026-11-15`) | Official ministry/sector report of Viet Nam; public citation with attribution |
| `VNM` | Trung tâm Khuyến nông Quốc gia (Bộ Nông nghiệp và Môi trường); Trung tâm Khuyến nông TP. Hồ Chí Minh; Văn phòng Điều phối NTM tỉnh Hà Tĩnh | **No national figure.** Each page describes one place: `ipomoea-aquatica` (the water-spinach area of Ho Chi Minh City alone, about 508.4 ha), `ocimum-basilicum` (one 3 ha demonstration model in Lạc Sơn commune, Đô Lương district, Nghệ An), `basella-alba` (about 1.2 ha grown by some 5 households in Hưng Điền commune, Tân Hưng district, Long An). A local area is not the area of the country: `area_ha` and `production_t` are empty, `level = unknown`, and the `note` says what the page covers. | <https://khuyennongtphcm.vn/cam-nang-trong-rau-muon-nuoc-toan/>, <https://khuyennongvn.gov.vn/chuong-trinh-nganh-nong-nghiep/tai-co-cau-nganh-nong-nghiep/nghe-an-hieu-qua-mo-hinh-tham-canh-cay-hung-que-gan-voi-che-bien-tinh-dau-va-tieu-thu-san-pham-19592.html>, <https://nongthonmoi.hatinh.gov.vn/Tin-trong-nuoc/long-an-trong-mong-toi-tot-um-tum-nong-dan-o-day-khong-hai-la-ma-tuot-hat-dem-ban-200-000-dong-kg-110805.html> (accessed `2026-11-15`) | Official agricultural extension publications (`.gov.vn` / Khuyến nông); public citation with attribution |
| `USA` | USDA National Agricultural Statistics Service (NASS), *Crop Production 2025 Summary* (January 2026, ISSN 1057-7823) | **Crop Area Planted and Harvested, Yield, and Production in Metric Units** (pp. 96–97, year 2025): `medicago-sativa` (*Hay, Alfalfa*: `5,939,230 ha`, `45,552,470 t`, `6.010%` -> `major`), `mentha-spicata-var-crispa` (*Spearmint oil*: `4,690 ha`, `730 t`, `0.005%` -> `minor`). *Dry edible beans* (`540,100 ha`, `1,218,120 t`) is the figure of a group of commercial classes of more than one species (lima and blackeye among them), not of `phaseolus-vulgaris`: that row has no figure, `level = unknown`, and the group figure is in its `note`. | <https://release.nass.usda.gov/reports/cropan26.txt> (accessed `2026-11-15`) | Public domain of the United States federal government (17 U.S.C. § 105) |
| `USA` | USDA NASS, *Vegetables 2025 Summary* (February 2026, ISSN 0884-6413) | **Area Planted and Harvested, Yield, Production, Price, and Value** (pp. 45, 54, 58, year 2025; tonnes are hundredweight × 45.359237 kg, hectares are acres × 0.40468564): `lactuca-sativa-var-capitata` (*Head lettuce*: `111,600 acres` = `45,163 ha`, `38,313.0` thousand cwt = `1,737,848 t`, `0.046%` -> `minor`), `capsicum-annuum` (*Bell peppers* `32,300 acres` + *Chile peppers* `13,200 acres` = `18,413 ha`, `10,578.0` + `2,623.5` thousand cwt = `598,810 t`, `0.019%` -> `minor`). *Pumpkins* (`68,100 acres`, `14,654.5` thousand cwt, p. 60) and *Squash* (`37,200 acres`, `6,388.0` thousand cwt, p. 66) cover every *Cucurbita* species, not `cucurbita-moschata`: no figure, `level = unknown`, the group figures are in the `note`. | <https://release.nass.usda.gov/reports/vegean26.txt> (accessed `2026-11-15`) | Public domain (17 U.S.C. § 105) |
| `USA` | USDA NASS, *2022 Census of Agriculture*, Vol. 1, Ch. 1 (U.S. National Level Data) & Ch. 2 (U.S. State-Level Data), issued February 2024 | **Ch. 1, Table 36** (*Vegetables, Potatoes, and Melons Harvested for Sale*, pp. 32–36, year 2022): `raphanus-sativus` (*Radishes* `20,405 acres` + *Daikon* `4,044 acres` = `9,894 ha` -> `minor`), `brassica-juncea` (*Mustard greens* `10,478 acres` + *Cabbage, mustard* `342 acres` = `4,379 ha` -> `minor`), `allium-fistulosum` (*Onions, green*, p. 35: `6,018 acres` = `2,435 ha` -> `minor`, fixing `sai-absent` from T1 `#8`). **Ch. 1, Table 37** (*Specified Fruits and Nuts*, pp. 37, 39, bearing acreage, year 2022): `mangifera-indica` (*Mangoes*: `3,144 acres` = `1,272 ha` -> `minor`), `musa-acuminata` (*Bananas*: `1,230 acres` = `498 ha` -> `minor`). **Ch. 2, Table 26** (*Field Seeds, Grass Seeds, Forage, Hay, and Silage*, pp. 482–485, year 2022): `trifolium-pratense` (*Red clover seed*: `14,362 acres` = `5,812 ha`, `4,172 t` -> `minor`), `sorghum-x-drummondii` (*Sudangrass seed*: `10,838 acres` = `4,386 ha`, `7,344 t` -> `minor`), `trifolium-incarnatum` (*Crimson clover seed*: `8,509 acres` = `3,443 ha`, `3,414 t` -> `minor`). **Ch. 2, Table 27** (*Other Crops*, p. 496, year 2022): `sesamum-indicum` (*Sesame*: `43,837 acres` = `17,740 ha`, `12,465 t` -> `minor`, fixing `sai-absent` from T1 `#8`). Two lines of these tables are groups, so the crop has no figure, `level = unknown`, and the group figure is in the `note`: *Cabbage, Chinese (nappa, bok choy, etc.)* (`15,626 acres`, Table 36, p. 32) for `brassica-rapa-pak-choi`, and *Vetch seed* (`2,122 acres`, `1,204,720 lb`, Table 26, p. 485) for `vicia-villosa-ssp-villosa`. *Herbs, fresh cut* (Table 36, p. 34) is `21,543 acres` on `8,136` farms, all herbs together. With the rows of the two summaries above, 21 crops have no separate national row in the United States (`level = unknown` with `note`). | <https://www.nass.usda.gov/sites/default/files/publications/agcensus/2022/Full_Report/Volume_1,_Chapter_1_US/st99_1_036_036.pdf>, `st99_1_037_037.pdf`, `st99_2_026_026.pdf`, `st99_2_027_027.pdf` (accessed `2026-11-15`) | Public domain (17 U.S.C. § 105) |
| `IND` | Ministry of Agriculture & Farmers Welfare (MoAFW, Government of India), *Horticultural Statistics at a Glance* & DES *Agricultural Statistics at a Glance 2022* (2021–22 Final Estimates) | **All-India Area and Production of Horticultural Crops & Pulses** (year 2022): `vigna-radiata` (*Moong / Green gram*: `5,540,000 ha`, `3,170,000 t`, `2.642%` -> `common`), `mangifera-indica` (*Mango*: `2,350,000 ha`, `20,772,000 t`, `1.121%` -> `common`), `musa-acuminata` (*Banana*: `963,000 ha`, `34,528,000 t`, `0.459%` -> `minor`), `coriandrum-sativum` (*Coriander*: `639,000 ha`, `847,000 t`, `0.305%` -> `minor`), `raphanus-sativus` (*Radish*: `209,000 ha`, `3,351,000 t`, `0.100%` -> `minor`), `momordica-charantia` (*Bitter gourd*: `107,000 ha`, `1,330,000 t`, `0.051%` -> `minor`), plus `unknown` with `note` for the remaining 26 `group`/`none` curated crops. | <https://agriwelfare.gov.in/en/StatHortEst> (accessed `2026-11-15`) | Government of India Open Data License (GODL-India) / Open Government Data Platform India |
| `BRA` | Instituto Brasileiro de Geografia e Estatística (IBGE), *Produção Agrícola Municipal (PAM) 2022*, SIDRA Tabela 5457 | **Tabela 5457** (*Área plantada, área colhida, quantidade produzida e rendimento médio das lavouras temporárias e permanentes*, year 2022): `musa-acuminata` (*Banana, cacho*: `457,915 ha`, `6,854,222 t`, `0.478%` -> `minor`), `mangifera-indica` (*Manga*: `73,967 ha`, `1,546,295 t`, `0.077%` -> `minor`), plus `unknown` with `note` for the remaining 30 `group`/`none` curated crops (including *Phaseolus vulgaris*, which IBGE PAM Tabela 5457 pools with *Vigna unguiculata* under *Feijão, em grão*). | <https://sidra.ibge.gov.br/tabela/5457> (accessed `2026-11-15`) | Open statistical database of IBGE (Brazilian Federal Government open data policy; free reuse with source attribution) |

## 8. Regions (MapSPAM 2020)

Harvested area (file `H`, technology `A`, all technologies) is summed from 964,647 cells to 179 countries and 2,273 first-level units. The cell table has no unit column; the SPAM documentation gives hectares, and the world total agrees with FAOSTAT (1,441 million ha against 1,480 million ha). Rows that round to 0 ha are left out. `share_of_region_pct` is over the 46 SPAM crops of the unit.

- **Missing administrative regions in MapSPAM 2020 V2r2 (`region_crops.csv`):**
  - **United States (`USA`):** `region_crops.csv` has **44** of the 50 US states. Six US states have **no** cells or rows in `spam2020V2r2_global_H_TA.csv`: **Connecticut, Hawaii, Nevada, New Hampshire, Rhode Island, and Vermont** (nor the District of Columbia). In particular, the demo parcel `nevada-alfalfa` (Diamond Valley, Eureka County, Nevada) has no admin-1 row in `region_crops.csv` and therefore relies on the national `USA` table (`medicago-sativa` = `major`, `5,939,230 ha`, from USDA NASS *Crop Production 2025 Summary*).
  - **Viet Nam (`VNM`):** MapSPAM uses the pre-2008 64-province boundary map (where `Ha Tay` is still separate from `Ha Noi`).

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
| Durian | `group`, member of "Other tropical fruits, n.e.c." (603). Viet Nam: `match = national`, 178,800 ha, 1,470,000 t (2024, MARD *Báo cáo thường niên thị trường Rau quả 2025*), 1.324 %, `common`; United States: `unknown` (with `note`) |
| Aibika (*Abelmoschus manihot*) | dropped: no FAOSTAT crop item names it. It no longer inherits the countries of "other vegetables" |
| Rice | exact; 116 countries; Viet Nam 7,089,041 ha, 6.09 t/ha, `major`; United States 1,064,067 ha, `common` |
| Maize | exact (items 56 and 446); 172 countries; Viet Nam 875,899 ha, `major`; United States 33,613,081 ha, `major` |
| Soybean | exact by common name; 104 countries; Viet Nam 30,237 ha, `minor`; United States 34,330,527 ha, `major` |
| Robusta coffee | exact through the genus, item shared by 4 Coffea species; Viet Nam 667,148 ha, `common` (4.94 %); MapSPAM `rcof` |
| Sweet potato | exact; 117 countries; Viet Nam 82,109 ha, `common`; United States 55,915 ha, `minor` |
| Alfalfa | `curated-only`; United States: `match = national`, 5,939,230 ha, 45,552,470 t (2025, USDA NASS *Crop Production 2025 Summary*), 6.01 %, `major`; Viet Nam: `unknown` (with `note`) |

`npx vitest run scripts/crops/atlas`: 6 files, 62 tests pass. `npx tsc --noEmit`: no errors. A second run with `--offline` reproduces all 12 CSV files and the workbook byte for byte.

### 9.1. National statistics cross-check (`VNM` and `USA`, T1 #8)

`data/crops/review/atlas-check-vnm-usa.csv` cross-checks 62 rows (the 15 largest items in `VNM`, the 15 largest items in `USA`, 20 curated `absent` crops in `VNM`, 9 curated `absent` crops in `USA`, and 3 key missing curated crops: `musa-acuminata` and `durio-zibethinus` in `VNM`, `medicago-sativa` in `USA`) against official national statistics accessed on `2026-11-15`:

- **Viet Nam (`VNM`):** *Niên giám Thống kê Việt Nam năm 2025* (*Statistical Yearbook of Viet Nam 2025*, Cục Thống kê / National Statistics Office, NXB Kinh tế - Tài chính, July 2026, ISBN 978-604-79-5878-8, Chapter 6 Agriculture, Forestry and Fishing, pp. 531–612, `https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf`). Licence: under Vietnam's Law on Statistics (*Luật Thống kê* No. 89/2015/QH13, Article 65) and the `nso.gov.vn` terms of use, published state statistical figures may be freely cited and reused with attribution to Cục Thống kê.
- **Periods.** The atlas levels are means of 2022 to 2024. The Viet Nam figures are means of the same three years. The United States figures are the mean of 2024 and 2025 (2023 to 2025 where a row says so), the years the *Crop Production 2025 Summary* tabulates in metric units; 2022 is not in that report. Levels are the same either way except where a row notes it: sunflower sits at the `minor`/`common` threshold, and barley differs by 20 % between the two periods (924,713 against 737,750 ha) without changing level.
- **United States (`USA`):** USDA NASS *Crop Production 2025 Summary* (January 2026, ISSN 1057-7823, Metric Units table pp. 96–97, `https://release.nass.usda.gov/reports/cropan26.txt`), *Noncitrus Fruits and Nuts 2025 Summary* (May 2026, ISSN 1948-2698, p. 65, `https://release.nass.usda.gov/reports/ncit0526.txt`), *Vegetables 2025 Summary* (February 2026, ISSN 0884-6413, `https://release.nass.usda.gov/reports/vegean26.txt`), and *2022 Census of Agriculture* (Volume 1, Chapter 1 Table 36 p. 35 and Chapter 2 Table 27 p. 496). Licence: US Federal Government work in the public domain (`17 U.S.C. § 105`).

#### Row counts by verdict (`data/crops/review/atlas-check-vnm-usa.csv`)

| Verdict (`verdict`) | `VNM` | `USA` | Total | Summary |
|---|---:|---:|---:|---|
| `dung` | 7 | 11 | **18** | National area and `LEVEL` (`major` >= 5%, `common` >= 0.5%, `minor` > 0) match the atlas (`oryza-sativa`, `zea-mays`, `hevea-brasiliensis`, `manihot-esculenta`, `anacardium-occidentale`, `saccharum-officinarum`, `arachis-hypogaea` in `VNM`; `glycine-max`, `zea-mays`, `sorghum-bicolor`, `oryza-sativa`, `brassica-napus`, `hordeum-vulgare`, `arachis-hypogaea`, `prunus-amygdalus`, `helianthus-annuus`, `solanum-tuberosum`, `saccharum-officinarum` in `USA`). |
| `sai-muc` | 0 | 0 | **0** | No single-species exact row has a conflicting level on the 3-year mean, though two crops sit right on threshold boundaries (`coffea-canephora` in `VNM` is `common` at 4.94% on the 2022–2024 harvested mean `667,067 ha` vs `major` at 5.02% in 2024 `678,500 ha`, 5.10% in prelim. 2025 `689,300 ha`, and 5.33% on planted area `719,767 ha`; `helianthus-annuus` in `USA` is `minor` at 0.48% / `390,420 ha` 2024–2025 mean vs `common` at 0.51% in 2025 `504,320 ha`). |
| `sai-absent` | 0 | 2 | **2** | Atlas marks `absent`, and a national source reports an area above zero: 2 crops in `USA` reported in the 2022 Census of Agriculture. |
| `sai-cay` | 1 | 1 | **2** | `VNM` item `486` (Bananas, `144,947 ha` vs NSO `144,867 ha`) is attached to uncurated `musa-sapientum` ("Plantains and cooking bananas") while curated `musa-acuminata` stays `curated-only`. `USA` item `157` (Sugar beet, `451,943 ha` vs NASS `434,230 ha`) is attached to plain `beta-vulgaris` while EcoCrop's sugar beet `beta-vulgaris-var-saccharifera` is routed to group item 463 (`unknown`). |
| `chung-hang` | 2 | 2 | **4** | Shared genus/group item assigns the full area to multiple species: `VNM` item `656` (`667,148 ha` across 4 *Coffea* species, >95% `coffea-canephora`) and item `693` (`191,575 ha` across `cinnamomum-cassia` and `-verum`); `USA` item `15` (`15,004,017 ha` across 3 *Triticum* species, where NASS splits `triticum-aestivum` `14,511,170 ha` `major` [94.5%] from `triticum-durum` `841,555 ha` `common` [5.5%]) and item `328` (`3,052,090 ha` across 4 *Gossypium* species, where NASS splits Upland `gossypium-hirsutum` `3,090,095 ha` `common` [97.8%] from Pima `gossypium-barbadense` `68,535 ha` `minor` [2.2%], and cotton has no curated species). |
| `thieu` | 6 | 2 | **8** | Major/common crops with no level in the atlas: `VNM` items `463` (`898,373 ha` vegetables), `619` (`246,756 ha` other fruits, where NSO Biểu 220 separately reports `litchi-chinensis` `51,833 ha` `minor` and dropped `dimocarpus-longan` `69,933 ha` `common`), `211` (`160,061 ha` pulses including `vigna-radiata`), `571` (`mangifera-indica`, where NSO Biểu 220 reports `93,867 ha` harvested / `115,133 ha` planted `common`), `musa-acuminata` (`144,867 ha` `common`, `curated-only`), and `durio-zibethinus` (`unknown`, NSO 2025 output `1.86 Mt`); `USA` item `176` (`phaseolus-vulgaris`, where NASS reports `574,415 ha` dry edible beans `common`, >95% *Phaseolus vulgaris*) and `medicago-sativa` (`curated-only`, where NASS reports `5,926,280 ha` Alfalfa hay `major`, #4 crop in the US). |
| `khong-co-nguon` | 21 | 7 | **28** | Not separately tabulated in the national statistical yearbook/summaries (`cocos-nucifera` in `VNM` top 15; 11 temperate/arid `absent` crops in `VNM` including `cicer-arietinum`, `triticum-aestivum`, `hordeum-vulgare`, `avena-sativa`; 7 tropical `absent` crops in `USA` including `hevea-brasiliensis`, `manihot-esculenta`, `cocos-nucifera`, `piper-nigrum`). Also 9 vegetables, pulses, spices and fruit in `VNM` that FAOSTAT pools into items 463, 211 and 619 and that the yearbook pools as well: they are believed to be grown, but no national source gives an area for the crop itself, so the atlas level is not called wrong here. |
| **Total** | **37** | **25** | **62** | |

#### Sample regions in `region_crops.csv` (MapSPAM 2020 V2r2)

1. **`Dak Lak` (`VNM`, `admin1 = VM16`, 24 rows):** MapSPAM lists Rice (`oryza-sativa`) #1 at `100,041 ha` (25.88%, close to NSO Biểu 196 2020 `107,600 ha` and 2022–2024 mean `115,967 ha`), Maize #2 at `85,873 ha` (NSO Biểu 208 2020 `87,300 ha`, 2022–2024 mean `80,000 ha`), Rubber #3 at `60,017 ha`, Cassava #4 at `39,571 ha` (NSO Biểu 213 2020 `44,161 ha`, 2022–2024 mean `43,097 ha`), and Robusta coffee (`rcof`, `coffea-canephora`) only #5 at **`23,871 ha`** (6.18%). MapSPAM 2020 V2r2 severely under-allocates coffee in Đắk Lắk (Vietnam's leading coffee province, >200,000 ha) because its spatial disaggregation smeared `613,125 ha` of national `rcof` into Northern mountain provinces (`Son La` `92,517 ha`, `Dien Bien` `80,097 ha` #1, `Ha Giang` `45,081 ha`, `Hoa Binh` `42,379 ha` #1).
2. **`Can Tho city` (`VNM`, `admin1 = VM13`, 21 rows):** MapSPAM lists Rice #1 at `225,397 ha` (86.68%, matching NSO Biểu 196 2020 `223,000 ha` and 2022–2024 mean `215,067 ha`), the residual classes Rest Of Crops (`rest`) #2 at `6,699 ha` and Other Vegetables (`vege`) #3 at `6,596 ha`, Sugarcane (`sugc`) #7 at `2,413 ha` (an artifact of pre-2004 Cần Thơ–Hậu Giang boundaries; NSO Biểu 215 reports `3–5 ha` in Cần Thơ city and `4,462 ha` in Hậu Giang), Other Tropical Fruit (`trof`) #8 at `2,166 ha`, and erroneously allocates **`2,430 ha` of Robusta coffee (`rcof`, #6)** and **`432 ha` of Arabica coffee (`coff`, #15)** to an alluvial Mekong Delta floodplain city where coffee is not grown.
3. **`Iowa` (`USA`, `admin1 = US16`, 13 rows):** MapSPAM lists Maize (`zea-mays`) #1 at `4,601,295 ha` (54.56% vs USDA NASS `cropan26.txt` 2023–2025 mean `5,152,997 ha` corn for grain + `130,848 ha` silage) and Soybean (`glycine-max`) #2 at `3,786,696 ha` (44.90% vs NASS `3,941,638 ha`), matching NASS closely. However, MapSPAM completely omits **Alfalfa hay (`medicago-sativa`)** (NASS 2023–2025 mean `295,421 ha`, `All Hay` `407,384 ha`, the #3 crop in Iowa) and pools **Oats (`avena-sativa`)** (NASS `29,407 ha` harvested, `61,377 ha` planted) into `ocer` (`Other Cereals`, `40,299 ha`, no `crop_ids`).
4. **`Nevada` (`USA`, `0` rows in `region_crops.csv`):** `region_crops.csv` covers 44 US states and has **no rows for Nevada** (where the sample parcel `nevada-alfalfa` is located). In USDA NASS `cropan26.txt`, Nevada has `152,027 ha` of harvested principal crops (2023–2025 mean), of which **All Hay accounts for `145,012 ha` (95.4%)** and **Alfalfa hay (`medicago-sativa`) accounts for `91,054 ha` (59.9%)** (`240,000`, `220,000`, and `215,000 acres` in 2023–2025). Because MapSPAM 2020 excludes forage and hay crops, Nevada receives zero rows.

#### Hand-off to T4 (#9) and K3 (#23)

- **Forwarded to T4 (#9) — 2 `sai-absent` rows to override, and 9 rows that need a source first:**
  - `VNM` (9 curated crops marked `absent` that are believed to be grown; no national area was found for any of them, so each needs a source that names the crop before its level changes. FAOSTAT pools Vietnam's vegetables, pulses, spices, and minor fruits into items 463, 211, and 619): `abelmoschus-esculentus` (430), `allium-fistulosum` (402), `cucumis-sativus` (397), `fragaria-x-ananassa` (544), `lycopersicon-esculentum` (388), `pisum-sativum` (187;417), `solanum-melongena` (399), `vigna-unguiculata` (195), `zingiber-officinale` (720). (The remaining 11 temperate/arid `absent` crops in `VNM` — including `cicer-arietinum`, `triticum-aestivum`, `hordeum-vulgare`, `avena-sativa` — remain `absent`.)
  - `USA` (2 curated crops with positive harvested area in the 2022 USDA Census of Agriculture): `allium-fistulosum` (`2,435 ha`, Table 36 p. 35 -> `minor`) and `sesamum-indicum` (`17,740 ha`, Table 27 p. 496 -> `minor`).
- **Forwarded to T4 (#9) — 8 `thieu` (and 2 `sai-cay`) gaps to supplement:**
  - `VNM`: `musa-acuminata` (`144,867 ha` harvested in NSO Biểu 220 -> `common`, fixing `curated-only` caused by item 486 mapping to `musa-sapientum`), `mangifera-indica` (`93,867 ha` harvested / `115,133 ha` planted in NSO Biểu 220 -> `common`, currently `unknown` in group 571), `litchi-chinensis` (`51,833 ha` harvested in NSO Biểu 220 -> `minor`, currently `unknown` in group 619; note dropped `dimocarpus-longan` is `69,933 ha` -> `common`), `durio-zibethinus` (curated durian, `unknown` in unreported group 603, NSO 2025 production `1.86 Mt`), plus curated members of group items `463` (`raphanus-sativus`, `coriandrum-sativum`, `perilla-frutescens`, `mentha-arvensis`) and `211` (`vigna-radiata`, `phaseolus-vulgaris`).
  - `USA`: `medicago-sativa` (`5,926,280 ha` harvested in NASS `cropan26.txt` -> `major`, and `91,054 ha` in Nevada / `295,421 ha` in Iowa, fixing `curated-only` for `nevada-alfalfa`), `phaseolus-vulgaris` (`574,415 ha` dry edible beans in item 176 -> `common`), and `beta-vulgaris-var-saccharifera` (`434,230 ha` sugar beet in item 157 -> `minor`).
- **Forwarded to K3 (#23) — `LEVEL` threshold notes:**
  - Percentage thresholds (`majorPct: 5`, `commonPct: 0.5`) put Vietnam's coffee (`coffea-canephora`, `667,148 ha`, 4.94%) just 0.06 percentage points below `major` and US sunflower (`helianthus-annuus`, `478,763 ha`, 0.48%) just 0.02 percentage points below `common`, while in a large country like `USA` (`98.83M ha`), a crop needed `494,150 ha` to reach `common`, pushing major commercial crops like potatoes (`378,223 ha`), sugar beet (`451,943 ha`), and sugarcane (`376,267 ha`) into `minor`.

## 10. Known gaps

- **Group crops have no country level.** 202 kept crops, 12 of them curated (common bean, mung bean, chili, mango, lettuce, pumpkin, durian, radish, coriander, sunn hemp, perilla, mint), are `unknown` in every country because FAOSTAT pools them with other plants. For a gate, use `item_reported`, the MapSPAM crop, or a national source.
- **EcoCrop row and FAO name differ.** The curated banana is EcoCrop's *Musa acuminata*, while the FAO definition of bananas names *Musa sapientum*, *M. cavendishii* and *M. nana*; EcoCrop has a *Musa sapientum* row, which gets the banana and plantain data, and *Musa acuminata* stays `curated-only`. EcoCrop's sugar beet row is *Beta vulgaris var. saccharifera*, the definition says *var. altissima*: the item goes to the plain *Beta vulgaris* row and the sugar beet row lands in "Other vegetables" (the definition lists "beets, chards (Beta vulgaris)"). Sudangrass (*Sorghum x drummondii*) is of the sorghum genus but EcoCrop does not mark it as grown, so it does not take the sorghum item.
- **Purely genus-level items are shared** by every cultivated EcoCrop species of the genus: coffee (4 species), cotton (4), lupins (5), strawberries (2). The quantities cannot be split.
- **Ten crop items have no kept crop**: triticale, mixed grain, karite nuts, other beans green, string beans, chicory roots, other stone fruits, other pome fruits, maté, pyrethrum. Their definitions name nothing EcoCrop resolves (spelling: "Ilex paraguayensis", "Butyrospermum parkii") or name nothing at all.
- **676 species that EcoCrop describes as grown (194 on a large scale) are dropped** because no FAOSTAT crop item names them: forage grasses and legumes, timber, ornamentals, medicinals, and some food plants (25 of the large-scale ones are in food categories: *Aesculus hippocastanum*, *Amaranthus hypochondriacus*, *Amaranthus lividus*, *Amaranthus sp.*, *Arachis glabrata*, *Bactris gasipaes*, *Citrus sp.*, *Couma utilis*, *Cucumis ficifolius*, *Cyphomandra betacea*, *Fagopyrum emarginatum*, *Lablab purpureus*, *Lathyrus sativus*, *Macrotyloma uniflorum*, *Musa acuminata x balbisiana*, *Musa sp.*, *Orbignya phalerata*, *Passiflora incarnata*, *Prosopis juliflora*, *Pueraria phaseoloides*, *Ribes sativum*, *Rubus sp.*, *Salicornia bigelovii*, *Sesbania grandiflora*, *Teramnus labialis*). **Decision (T7 `#12`):** **0** additional species are kept (`kept_crops = 387`, `dropped_species = 2,182`). Five of the 25 are unspecified genus/hybrid rows (`*sp.*`), several are primarily timber/forage/cover plants, and none of the 25 maps to a species-level FAOSTAT item or MapSPAM crop, so keeping them without national statistics would only add `match = none` rows with `unknown` prevalence and empty economics across all 198 countries. They remain audited in `dropped.csv`.
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
| `national.ts` | reader and merge rules for `data/crops/national/prevalence.csv` |
| `urban.ts` | rule-based urban / container candidate classification |
| `columns.ts` | column dictionary (English and Vietnamese) |
| `csv.ts`, `zip.ts`, `xlsx.ts` | file formats |

### 11.1 The table the app loads (`public/data/crops/country/`)

```
npx tsx scripts/crops/country-tables.ts   # after an atlas build: 198 files and index.json, 3.5 MB, under a second
npx vitest run src/data/country.test.ts
```

The app does not read `crop_country.csv` (5.7 MB) or the Google Sheet. `scripts/crops/country-tables.ts` writes the rows of each country to `public/data/crops/country/<ISO3>.json` (15 to 30 KB), and the app fetches the one file of the country a field lies in when the field is opened (`src/data/country.ts`), then hands it to the model as `ModelInput.country`.

- **Nothing is computed.** A file holds the atlas rows of its country. Crops with a reported quantity keep the full record (level, share, rank, area, production, years, source), and so does every row from a national source (`match = national`), which is `unknown` when that source has no figure; the `absent` rows and the group rows of FAOSTAT are stored as lists of crop ids, and `expandCountryTable` (`src/data/countryTable.ts`) gives every record back. The test compares the files of four countries with `crop_country.csv` record by record, and every file with a fresh build.
- **`index.json`** lists the countries by two-letter code (the code a geocoder returns) with the three-letter code, the name, the number of crops with a quantity (`grown`: the records whose level is `major`, `common`, `minor` or `present`, so a national row without a figure is not counted; 64 for Viet Nam, 120 for the United States) and a hash of the file; the hash is part of the browser's cache key, so a rebuilt table is fetched again. The two-letter codes come from the GeoNames country list the atlas build downloads (`sources.csv`, row `geonames`, CC BY 4.0).
- **No date in the output**: a second run writes the same bytes.
- **What the user sees today**: the Data tab of a field names the table ("Viet Nam: 64 crops with a reported area or harvest (FAOSTAT QCL)"; 60 of them are FAOSTAT rows and 4 come from national statistics), and the "switch to another crop" what-if no longer proposes a crop the country's statistics do not report. The rotation builder does not read the table yet (K10, issue #92), and the labels on crops are B2 (#56).
- **Known gap carried over**: an `absent` row is "not reported", not "not grown" (section 10; docs/SCORING.md section 12.4 names tomato, cucumber, eggplant, ginger and okra in Viet Nam). Until national statistics are added (T4, #9) those crops are left out of the switch-to suggestion in Viet Nam.

## 12. Prices and reference economics (`data/crops/atlas/economics.csv`)

`data/crops/atlas/economics.csv` follows the 13-column schema of `economics_template.csv` (`crop_id, iso3, region, yield_t_ha, price_usd_t, cost_usd_ha, year, quality_yield, quality_price, quality_cost, source, url, accessed`) and covers all 73 curated crops across `VNM`, `USA`, `IND`, and `BRA` (292 national pairs with `region` empty, plus 7 regional rows: 6 `US-HEARTLAND` and 1 `US-WEST`, for **299 rows** in total).

### 12.1 Conventions

- **49 existing records preserved.** All 49 records from `scripts/crops/economics.ts` (`data/crops/curated-crops.csv`) are carried over with their exact figures, years and `SourceQuality` values (`VN` -> `iso3 = VNM, region = ""`; `US` -> `iso3 = USA, region = ""`; `US-HEARTLAND` and `US-WEST` -> `iso3 = USA` with `region` kept until K2, #22).
- **Operating cost only.** `cost_usd_ha` is the variable (operating) cost per hectare, matching `costUsdPerHa` of `ReferenceEconomics` (`docs/ECONOMICS.md` section 1). Where a budget also prints total cost including land and overhead, the total is noted in `source` and not used.
- **Three-part provenance.** Both `source` and `url` list the three figures in `yield | price | cost` order (`yield: ... | price: ... | cost: ...`), matching `data/crops/curated-crops.csv`. Every figure has a quality tag from `SourceQuality` (`official`, `budget`, `press`, `derived`, `none`); a quality is `none` if and only if its cell is empty, and `source` records `NOT FOUND: <reason>`.
- **Remaining curated crops in `VNM`, `USA`, `IND`, and `BRA`.**
  - *Yield (`yield_t_ha`)*: filled from `crop_country.csv` (2022–2024 three-year mean or national figure, `quality_yield = official`) where the FAOSTAT item belongs to this crop alone. Where the item is shared by several species (`coffea-arabica`, `coffea-canephora`, `allium-cepa`, `brassica-oleracea-var-capitata`, `citrus-grandis`, `fragaria-x-ananassa`, `persea-americana`) the cell stays empty and `source` gives the item's yield with the reason, the same rule as for prices: the item's figure is not the species' own (robusta coffee in `USA` would otherwise carry the yield of Hawaiian arabica).
  - *Price (`price_usd_t`)*: filled from the `crop_latest_prices` view of the market database (`match = exact`, `item_shared_by_n_crops = 1`, primary item; 11 curated crops in `VNM`, 20 in `USA`, 18 in `IND`, 16 in `BRA`), cross-checked against market and USDA NASS prices (`docs/DATABASE.md` section 8). Shared-item prices (such as FAOSTAT item 656 `Coffee, green` at 709 USD/t in `VNM` vs ~3,359.4 USD/t on the domestic robusta market, or 55,997.5 USD/t in `USA` vs $2.37/lb = 5,225 USD/t cherry in USDA NASS) and pooled `group` item prices are not assigned to single species outside the existing proxy rows (`vigna-radiata`, `mangifera-indica`, `citrus-grandis`, `brassica-oleracea-var-capitata` in `VNM`); both figures are quoted in `source`.
  - *Cost (`cost_usd_ha`)*: no cross-country extrapolation is performed; crops without an opened national or state enterprise budget remain empty (`quality_cost = none`).
- **10-year rule for FAOSTAT prices.** `year` is the year of the row's figures (`columns.csv`), so a FAOSTAT producer price whose year is more than 10 years before the row's `year` is not used: the cell stays empty (`quality_price = none`) and `source` quotes the FAOSTAT figure and its year under `NOT FOUND`. The 10-year limit is a choice of this project, not taken from a publication. It empties 4 `USA` prices, all rows with `year = 2024` from the 2022–2024 yield: okra (item 430, 1,642 USD/t from 1997), eggplant (item 399, 610 USD/t from 2004), dry cowpea (item 195, 842 USD/t from 2005) and ginger (item 720, 3,527 USD/t from 2008). Three FAOSTAT prices stay although their year differs from `year` by 1 or 2 years: sugar cane in `USA` (2023 price, `year = 2024`; 2023 is FAOSTAT's latest US year) and soybean and maize in `VNM` (2024 prices, `year = 2026` in the reference records carried over from `curated-crops.csv`, which this file keeps unchanged). Their source text states the price year.
- **FAOSTAT price extract.** `data/crops/review/prices-from-faostat.csv` holds, for each of the 59 prices across `VNM`, `USA`, `IND`, and `BRA` whose `source` cites FAOSTAT producer prices, the FAOSTAT row it equals: 37 used prices (21 in `VNM`/`USA`, 16 in `BRA`) and the 22 prices left out under the 10-year rule (4 in `USA`, 18 in `IND`), whose `NOT FOUND` text quotes them. Each row gives item, year, element 5532 `Producer Price (USD/tonne)` (annual value; FAOSTAT's `Unit` column reads `USD`), value and flag as written in `Prices_E_All_Data_(Normalized).zip` (file dated 2026-10-09 on the server, read 2026-11-15). `npx tsx scripts/crops/atlas/prices-extract.ts` rebuilds it from the cached bulk file and stops if a cited price has no FAOSTAT row; `scripts/crops/atlas/economics.test.ts` checks, without the bulk file, that every such price equals its extract row, that every extract row is referenced by a filled price or a `NOT FOUND` text quoting its value and year, and that no filled FAOSTAT price is more than 10 years older than its row's `year`.

### 12.2 Sources and licences

| Source | Figures used | Licence |
|---|---|---|
| FAOSTAT QCL & Producer Prices (PP) | `yield_t_ha` (2022–2024 mean in `crop_country.csv`) and `price_usd_t` (`crop_latest_prices`) | CC BY 4.0 with FAO Statistical Database Terms of Use |
| USDA ERS Commodity Costs and Returns (2025) | `USA` national and `US-HEARTLAND` yields, harvest prices and operating costs for major field crops | Public domain (17 U.S.C. § 105) |
| USDA NASS (`cropan26.txt`, `cpvl0226.txt`, `vegean26.txt`, `ncit0526.txt`) | `USA` national and state yields and marketing-year prices (2024–2025) and cross-checks | Public domain (17 U.S.C. § 105) |
| USDA-ARS National Soil Dynamics Laboratory Fact Sheet 04o (2014) | `USA` cover-crop seed and no-till drilling costs | Public domain (17 U.S.C. § 105) |
| University extension budgets (`ISU` Ag Decision Maker A1-20, `NDSU` EC1654, `IDAHO` EBB series, University of Illinois `farmdoc daily`) | Operating / direct costs per acre for Iowa, North Dakota, Idaho and Illinois (`budget`) | Educational / extension publication terms; cited per row |
| Vietnamese press reports (`Nhân Dân`, `Việt Báo`, `Báo Văn Hoá`, `Nông nghiệp và Môi trường`, `VnBusiness`, `Thanh Tra`, `Báo Lào Cai`, `Công Thương`) | Farm-gate trader prices and demonstration/grower operating costs (`press`, `derived`), converted at `VND_PER_USD = 25,600` (State Bank of Vietnam central rate on 2026-11-10) | Factual numerical citations with URL and access date |
| MoAFW & DES (India) / IBGE PAM 5457 (Brazil) | National yields (`yield_t_ha`, `official`) for `match = national` crops in `IND` and `BRA` | GODL-India / IBGE open data |

### 12.3 Row counts by country and `SourceQuality`

| Country (`iso3`) | Total rows | Rows with all 3 figures (`yield`, `price`, `cost`) | Measure | `official` | `budget` | `press` | `derived` | `none` (empty) |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| `VNM` (national) | 73 | **8** | `yield_t_ha` | 22 | 0 | 0 | 0 | 51 |
| `VNM` (national) | 73 | **8** | `price_usd_t` | 15 | 0 | 5 | 0 | 53 |
| `VNM` (national) | 73 | **8** | `cost_usd_ha` | 0 | 0 | 7 | 1 | 65 |
| `USA` (all: 73 national + 7 regional) | 80 | **27** (20 national + 7 regional) | `yield_t_ha` | 39 | 0 | 0 | 0 | 41 |
| `USA` (all: 73 national + 7 regional) | 80 | **27** (20 national + 7 regional) | `price_usd_t` | 35 | 0 | 0 | 0 | 45 |
| `USA` (all: 73 national + 7 regional) | 80 | **27** (20 national + 7 regional) | `cost_usd_ha` | 10 | 17 | 0 | 0 | 53 |
| `IND` (national) | 73 | **0** | `yield_t_ha` | 25 | 0 | 0 | 0 | 48 |
| `IND` (national) | 73 | **0** | `price_usd_t` | 0 | 0 | 0 | 0 | 73 |
| `IND` (national) | 73 | **0** | `cost_usd_ha` | 0 | 0 | 0 | 0 | 73 |
| `BRA` (national) | 73 | **0** | `yield_t_ha` | 20 | 0 | 0 | 0 | 53 |
| `BRA` (national) | 73 | **0** | `price_usd_t` | 16 | 0 | 0 | 0 | 57 |
| `BRA` (national) | 73 | **0** | `cost_usd_ha` | 0 | 0 | 0 | 0 | 73 |
| **Total (`VNM`, `USA`, `IND`, `BRA`)** | **299** | **35** (28 national + 7 regional) | `yield_t_ha` / `price_usd_t` / `cost_usd_ha` | 106 / 66 / 10 | 0 / 0 / 17 | 0 / 5 / 7 | 0 / 0 / 1 | 193 / 228 / 264 |

`economics_template.csv` has the header `crop_id, iso3, region, yield_t_ha, price_usd_t, cost_usd_ha, year, quality_yield, quality_price, quality_cost, source, url, accessed`. Use `crop_id` from `crops.csv` and `iso3` from `country_crops.csv`; one row per crop and place; every figure with its source and the date it was read. `crop_country.yield_t_ha` already gives the FAOSTAT yield for exact crops, so the work is prices and costs. FAOSTAT producer prices are already joined to `crop_id` and `iso3` in the market database (`docs/DATABASE.md`): its view `crop_latest_prices` gives, per crop and country, the latest price with its year, its FAOSTAT flag and the match of the crop. For an exact crop that is alone on its item this is a `price_usd_t` from an `official` source; `docs/DATABASE.md` section 8 gives a case (coffee in Viet Nam) where the FAOSTAT figure is far from the market. FAOSTAT has no costs.

## 13. Atlas coverage summary (`summary.csv`, T7 `#12`)

Every metric below is emitted into `data/crops/atlas/summary.csv` by `scripts/crops/atlas/build.ts`:

| Metric (`summary.csv`) | Value | Meaning |
|---|---:|---|
| `ecocrop_species` | 2,568 | Total species in `data/ecocrop/ecocrop_2568_plants.csv` |
| `kept_crops` | 387 | Kept crops in `crops.csv` (386 EcoCrop + *Tagetes erecta*) |
| `dropped_species` | 2,182 | Dropped EcoCrop species in `dropped.csv` |
| `crops_with_name_en` | 230 | Kept crops with a sourced `name_en` (`curated`: 73, `fao-definition`: 99, `faostat-item`: 58) |
| `crops_without_name_en` | 157 | Kept crops with an empty `name_en` |
| `crops_with_name_vi` | 73 | Kept crops with a sourced `name_vi` (from `curated-crops.csv`; Wikidata expansion in C6 `#73`) |
| `crop_country_rows` | 72,746 | Total `(crop_id, iso3)` rows in `crop_country.csv` |
| `crop_country_rows_present` | 11,424 | Rows with a grown level (`major`, `common`, `minor`, `present`) |
| `crop_country_rows_absent` | 21,260 | Rows with `level = absent` (`match = exact`, `item_reported = no`) |
| `crop_country_rows_unknown` | 40,062 | Rows with `level = unknown` |
| `crop_country_exact_with_level` | 32,659 | `match = exact` rows with a non-`unknown` level (11,399 grown + 21,260 `absent`) |
| `crop_country_exact_grown` | 11,399 | `match = exact` rows with `level` in `major`, `common`, `minor`, `present` |
| `crop_country_rows_national` | 104 | Rows in `crop_country.csv` with `match = national` |
| `crop_country_rows_national_with_figure` | 25 | `match = national` rows with a grown level (`VNM`: 4, `USA`: 13, `IND`: 6, `BRA`: 2) |
| `crop_country_rows_national_without_figure` | 79 | `match = national` rows without a national figure (`level = unknown`, reason in `prevalence.csv`) |
| `national_rows_read` | 140 | Total rows in `data/crops/national/prevalence.csv` across `VNM`, `USA`, `IND`, `BRA` |
| `economics_rows` | 299 | Total rows in `data/crops/atlas/economics.csv` (`BRA;IND;USA;VNM`) |
| `economics_with_yield` | 106 | Rows with `yield_t_ha` (`official`: 106, `none`: 193; shared-item yields left empty) |
| `economics_with_price` | 71 | Rows with `price_usd_t` (`official`: 66, `press`: 5, `none`: 228) |
| `economics_with_cost` | 35 | Rows with `cost_usd_ha` (`official`: 10, `budget`: 17, `press`: 7, `derived`: 1, `none`: 264) |
| `economics_complete` | 35 | Rows with all 3 figures (`yield_t_ha`, `price_usd_t`, `cost_usd_ha`) |

## 14. Urban candidates (`urban_candidates.csv`)

`scripts/crops/atlas/urban.ts` (`urbanCandidate(s)`, constants in `URBAN_RULE`) selects urban / container candidate crops from the 387 kept atlas rows using only EcoCrop columns (`life_form`, `habit`, `category`, `life_span`, `cycle_min_days`) and writes one row per crop to `data/crops/atlas/urban_candidates.csv`, in the order of `crops.csv`: `crop_id`, `urban_candidate` (`yes` or empty) and `urban_candidate_rule` (`short-cycle`, `perennial-aromatic-herb`, or `short-cycle;perennial-aromatic-herb`). The count goes to `urban_candidates` in `data/crops/atlas/summary.csv`.

The result has a file of its own and `crops.csv` has no `urban_` column: the market database mirrors `crops.csv` column for column (`scripts/market/atlas.ts`, `docs/DATABASE.md`), so a column added there would change the table of a migration that is already applied. Join on `crop_id`.

### 13.1 Rule and variants tested

A row qualifies when all three conditions hold:

1. **Life form (`life_form`)**: contains `herb`, `sub-shrub`, `shrub` or `vine`, and does **not** contain `tree`.
2. **Use category & broadacre field-crop filter (`category`, `habit`, `cycle_min_days`)**:
   - `category` contains at least one of `vegetables`, `fruits & nuts`, `ornamentals/turf`, or `medicinals & aromatic`.
   - If the only qualifying category is `medicinals & aromatic` and the row also carries a broadacre field/industrial category (`cereals & pseudocereals`, `pulses (grain legumes)`, `roots/tubers`, `forage/pasture`, `materials`, `cover crop`, `forest/wood`), it is excluded unless `habit` contains `climber/scrambler/scadent`.
   - If `category` includes a staple field-crop category (`cereals & pseudocereals`, `pulses (grain legumes)`, `roots/tubers`), it must either have `habit` containing `climber/scrambler/scadent` or `cycle_min_days <= 60` (`maxStapleVegetableCycleMinDays`).
3. **Cycle / longevity (`cycle_min_days`, `life_span`)**:
   - **`short-cycle`**: `cycle_min_days <= 120` (`maxCycleMinDays`), **or**
   - **`perennial-aromatic-herb`**: `life_span` contains `perennial`, `category` contains `medicinals & aromatic`, and `life_form` contains `herb` or `sub-shrub`.

| Variant | Rule summary | Atlas rows matched | Of 32 hand-curated urban crops | Union (`rule ∪ overlay`) | Broadacre field crops excluded (`arachis-hypogaea`, `solanum-tuberosum`, `lens-culinaris`, `linum-usitatissimum`) |
|---|---|---:|---:|---:|---|
| `R0` (issue baseline) | Any of the 4 categories + non-tree life form + (`cycle_min_days <= 120` or perennial aromatic herb) | 128 (110 short-cycle, 18 perennial herb) | 23 / 32 | 137 | None (all 4 included) |
| `R1` (strict medicinal only) | Disqualify `medicinals & aromatic`-only rows when paired with any field category | 106 | 22 / 32 (drops `pisum-sativum`) | 116 | Excludes `solanum-tuberosum`, `lens-culinaris`, `linum-usitatissimum`; keeps `arachis-hypogaea` |
| **`R` (adopted in `urban.ts`)** | `R1` + allow `climber/scrambler/scadent` on pulses (`pisum-sativum`) + require `climber` or `cycle_min_days <= 60` on staple categories | **106** (79 `short-cycle`, 15 `perennial-aromatic-herb`, 12 both) | **23 / 32** | **115** | **All 4 excluded** |

### 13.2 Hand-curated urban crops not matched by the rule (9 of 32)

The 9 hand-curated crops (`urban.suitable = true` in `scripts/crops/overlay-*.ts`) that the EcoCrop rule does not select remain in the urban pool through the overlay (`candidate set = rule ∪ overlay = 115 crops`):

| `crop_id` | Name | Why `urbanCandidate` returns `false` on its EcoCrop row |
|---|---|---|
| `ipomoea-batatas` | Sweet potato (Khoai lang) | `life_form`, `habit`, and `category` are empty in EcoCrop (`ecocrop_id = 1265`) |
| `tagetes-erecta` | Marigold (Cúc vạn thọ) | Not in the FAO EcoCrop CSV (`curated-only`, `ecocrop_id` empty) |
| `mentha-spicata-var-crispa` | Spearmint (Húng lủi) | EcoCrop `category` is only `materials` (missing `medicinals & aromatic` and `vegetables`) |
| `cymbopogon-citratus` | Lemongrass (Sả) | EcoCrop `life_form` is `grass` (excluded so cereal/forage grasses do not enter) |
| `vigna-radiata` | Mung bean (Đậu xanh) | EcoCrop `category` is `pulses (grain legumes), forage/pasture, cover crop, environmental` (lacks `vegetables`) |
| `vigna-unguiculata-ssp-sesquipedalis` | Yardlong bean (Đậu đũa) | EcoCrop `category` is `pulses (grain legumes), forage/pasture, environmental` (lacks `vegetables`) |
| `arachis-pintoi` | Pinto peanut (Lạc dại) | `cycle_min_days = 180` (> 120) and `category` lacks `medicinals & aromatic` |
| `musa-acuminata` | Banana (Chuối) | `cycle_min_days = 180` (> 120) and `category` lacks `medicinals & aromatic` |
| `fragaria-x-ananassa` | Strawberry (Dâu tây) | `cycle_min_days = 180` (> 120) and `category` is `fruits & nuts` without `medicinals & aromatic` |

### 13.3 Limitations

- **The thresholds are a choice of the project.** The 120-day limit of the short-cycle clause (`maxCycleMinDays`) and the 60-day limit for staple categories (`maxStapleVegetableCycleMinDays`) are a choice of the project, not taken from a publication.
- **The rule selects more than a balcony can hold.** It reads only EcoCrop's life form, category, life span and shortest cycle, so `yes` also falls on crops that are not pot crops: papaya (`carica-papaya`: life form `herb`, `perennial`, `medicinals & aromatic`), vanilla (`vanilla-planifolia`: `herb, vine`, `perennial`, `medicinals & aromatic`), jojoba and myrtle (`simmondsia-chinensis`, `myrtus-communis`: `shrub`, shortest cycle 120 days), pigeon pea (`cajanus-cajan`: `shrub`, 90 days) and rapeseed (`brassica-napus`: 85 days). `yes` means the crop passes this filter, not that it is recommended: a crop may be offered to a balcony grower only when it also has container figures with a source.
- **Empty EcoCrop cells.** Missing `life_form`, `category`, or `cycle_min_days` evaluates to `false` rather than guessing.
- **Dropped species.** 676 cultivated EcoCrop species with no FAOSTAT crop item are in `dropped.csv` (section 10), including many ornamentals and culinary herbs; the rule is evaluated on the 387 kept atlas crops only.
