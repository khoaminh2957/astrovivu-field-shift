# Market database (Supabase)

Code: `supabase/` (migrations, seed, pgTAP tests, configuration) and `scripts/market/` (the adapter of the crop atlas, the FAOSTAT price reader, the loader). Unit tests: `scripts/market/market.test.ts`. Deployment: `docs/CI_CD.md`, section 5.

The database answers one question for the economics side of the app: **what does a farmer get for this crop in this country, and how far can that number be trusted.** It holds three tables of the crop atlas (`data/crops/atlas/`, `docs/CROP_DATA.md`) and FAOSTAT producer prices, joined on the atlas's own keys: `crop_id` and `iso3`.

Nothing in the browser reads it yet. `src/core/economics` still uses the reference table in `scripts/crops/economics.ts`; section 9 says what is missing.

## 1. Sources

| Source | Where | Release | Licence |
|---|---|---|---|
| Crop atlas: `crops.csv`, `items.csv`, `crop_country.csv`, `sources.csv` | `data/crops/atlas/` in this repository, built by `scripts/crops/atlas/build.ts` | the build committed with it | per source, in `sources.csv` |
| FAOSTAT, Prices: Producer Prices (PP), normalized bulk file | `https://bulks-faostat.fao.org/production/Prices_E_All_Data_(Normalized).zip` | 9 Oct 2026, read 15 Nov 2026, SHA-256 `327f70a2…` | CC BY 4.0 with FAO's additional terms |
| FAOSTAT, Production (QCL): the list of countries with their FAOSTAT and M49 codes | `data/market/faostat_areas.csv`, written by `npm run market:areas` | 31 Dec 2025, the release the atlas is built on | same |

FAOSTAT licence: "FAO Statistical Database Terms of Use" (<https://www.fao.org/contact-us/terms/db-terms-of-use/en/>): datasets are under CC BY 4.0, must be attributed to FAO, and may not be used to promote a commercial product or to suggest FAO's endorsement. The bulk server is public; no account or key is involved.

The table `data_sources` holds one row per source with URL, licence, access date and SHA-256: the 22 sources of the atlas as its build recorded them, and the price file with the checksum of the copy that was loaded and the release date FAOSTAT's catalogue gives.

## 2. From the atlas to the database

**Rule.** `crops`, `items` and `crop_country` are the atlas files of the same name, column for column: same names, same order. `data/crops/atlas/columns.csv` is therefore the dictionary of these tables too. The loader changes two things only: an empty cell becomes null, and each column gets the type its name declares (`scripts/market/atlas.ts`):

| Column name | Type | Examples |
|---|---|---|
| ends in a unit: `_c`, `_mm`, `_deg`, `_m`, `_ha`, `_t`, `_pct`, or starts with `ph_` | numeric | `temp_opt_min_c`, `area_ha`, `ph_abs_max` |
| a count, a year, a rank, a day count, one item code | integer | `cycle_min_days`, `year_to`, `faostat_item_code` in `crops` |
| written yes/no | boolean | `curated`, `item_reported` |
| anything else, codes included | text | `cpc_code`, `match`, `faostat_item_code` in `crop_country` ("56;446") |

No value is cleaned or corrected here: the atlas build does that and writes what it dropped to `crops.ecocrop_cleaning`. A value that does not fit its column stops the load with the file, row and column. A unit test compares the atlas headers, these types and the `create table` statements, so a column added to the atlas fails CI until a migration adds it.

**Two things are derived.**

- `crop_items`, one row per crop and FAOSTAT item. The atlas names the item a crop is attached to in `crops.faostat_item_code` and its other items in `crops.faostat_other_item_codes` (maize: grain 56, green corn 446). Prices are per item, so the join needs rows. `is_primary` marks the first. 382 rows for 367 crops; the 20 crops with `match = none` have none.
- `areas.iso3`. A FAOSTAT price line names its country by a FAOSTAT area code; the atlas uses ISO 3166-1 alpha-3. Both take the country name from FAOSTAT's production file, so the name joins them exactly: all 198 atlas countries have one area. 11 further areas have no ISO code here because they are not atlas countries (Belgium-Luxembourg, Czechoslovakia, Ethiopia PDR, French Guiana, Guadeloupe, Martinique, Réunion, Serbia and Montenegro, Sudan (former), USSR, Yugoslav SFR). Their prices are loaded and carry no crop-country information. A unit test holds this list: a change in either file shows there.

**Not loaded:** `item_country`, `country_crops`, `region_crops`, `spam_crops`, `dropped`, `columns`, `summary`, `economics_template`. The CSV files are the place to read them.

## 3. Schema

Migrations in `supabase/migrations/`, applied in file order. `20261115100000_market_from_atlas.sql` replaces the tables of the first four files; section 10 says why.

| Table | Key | Rows (full load, 15 Nov 2026) | Content |
|---|---|---:|---|
| `data_sources` | `code` | 23 | every source: publisher, URL, licence, access date, SHA-256, release, load time |
| `areas` | `area_code` | 209 | FAOSTAT countries and territories, with M49 code and `iso3` |
| `items` | `faostat_item_code` | 157 | FAOSTAT crop items: `item_class` single or group, the definition the species were read from |
| `crops` | `crop_id` | 387 | kept crops: names, EcoCrop requirements, FAOSTAT item, `match`, `item_shared_by_n_crops`, commonness |
| `crop_items` | `crop_id, faostat_item_code` | 382 | crop to item, `is_primary` |
| `crop_country` | `crop_id, iso3` | 72,666 | area, production, yield, share, rank and `level` of each crop in each country |
| `producer_prices` | `area_code, faostat_item_code, year, month` | 249,700 | `lcu_per_tonne`, `slc_per_tonne`, `usd_per_tonne`, `price_index` (2014-2016 = 100) and one FAOSTAT flag per value; `month` 0 is the annual value |

`crops.crop_id` is the app's crop id. The CHECK constraints of `crops` repeat the limits of the atlas build (`RANGES` in `scripts/crops/atlas/ecocrop.ts`) and the vocabularies of `match`, `item_class` and `level`: a row that breaks one means the atlas and the database have drifted apart, and it is refused instead of stored.

LCU is the local currency of the year, SLC the standard local currency (today's currency for the whole series); a country can have LCU and SLC without USD. Flags are FAOSTAT's: `A` official, `E` estimated, `I` imputed, `X` from an international organisation, `B` break in the series. Of the 128,752 annual rows with a USD value, 127,818 are flagged `A`.

## 4. Reading a price

| Object | Returns |
|---|---|
| view `crop_prices` | annual prices per crop, item and country, with `iso3`, `faostat_item`, `is_primary_item`, `item_class`, `match`, `item_shared_by_n_crops`, and `level`, `item_reported` from `crop_country` |
| view `crop_latest_prices` | the most recent priced year of each crop, item and country |
| function `crop_price_series(p_crop_id, p_iso3)` | the annual series of one crop in one country, the crop's own item first, oldest year first |

```bash
curl "$SUPABASE_URL/rest/v1/crop_latest_prices?crop_id=eq.oryza-sativa&iso3=eq.VNM&select=year,usd_per_tonne,usd_flag,faostat_item,match,item_shared_by_n_crops,level" -H "apikey: $SUPABASE_ANON_KEY"
# [{"year":2024,"usd_per_tonne":356,"usd_flag":"A","faostat_item":"Rice","match":"exact","item_shared_by_n_crops":3,"level":"major"}]
```

**A price is the price of a FAOSTAT item.** Whether it is the price of the crop depends on three columns the views return with it:

| `match` | `item_shared_by_n_crops` | The price is | Crops |
|---|---|---|---:|
| `exact` | 1 | the crop's own | 85 (83 with a price) |
| `exact` | above 1 | that of an item several atlas crops share (rice: *Oryza sativa* and two subspecies rows; coffee: four *Coffea* species) | 80 |
| `group` | any | that of a class which covers more than this crop (mango under *Mangoes, guavas and mangosteens*) | 202 |
| `none` | | absent: no FAOSTAT item names the crop | 20 |

`is_primary_item = false` marks a price of another product of the same crop. United States, 2024, maize: 171.3 USD/t for *Maize (corn)*, 1,042.8 USD/t for *Green corn (maize)*.

`level` says how much of the crop the country grows (`major` from 5 % of its harvested area, `common` from 0.5 %, `minor` below, `present`, `absent`, and `unknown` for every group crop; thresholds in `docs/CROP_DATA.md` section 7). A price can exist where the level is `absent`: the country reports a price for the item and no area or production in the atlas window.

For `docs/CROP_DATA.md` section 12 (the economics table to fill): `crop_latest_prices` filtered on `match = exact`, `item_shared_by_n_crops = 1` and `is_primary_item` gives `price_usd_t` with its `year` for `crop_id` and `iso3`; the source is FAOSTAT, which `src/core/economics/types.ts` counts as `official`. Of the 73 curated crops, 20 have such a price in the United States and 11 in Viet Nam (16 and 10 from 2022 or later).

## 5. Who may do what

| Role | Tables and views | How |
|---|---|---|
| `anon`, `authenticated` (browser, anyone) | read everything, write nothing | row level security on all seven tables with one `select` policy each; no insert, update or delete grant; views run with the caller's rights (`security_invoker`) |
| `service_role` (loader, CI) | read and write | bypasses row level security; the key stays in `.env` or a CI secret |

`supabase/config.toml` sets `auto_expose_new_tables = false`: a new table is not reachable through the Data API until a migration grants it. `supabase/tests/002_security.test.sql` checks that no table in `public` is without row level security and no view without `security_invoker`, and then, as `anon` and as `authenticated`, that reads work and that insert, update, delete and truncate are refused (permission denied), and as `service_role` that the loader's writes go through.

## 6. Running it

Needs Docker. The Supabase CLI (3.1.0) is fetched by `npx`; it is not a dependency of the project.

| Command | Does |
|---|---|
| `npm run db:start` | local Postgres 17 and Data API (`http://127.0.0.1:54321`), all migrations, then `supabase/seed.sql` |
| `npm run db:reset` | drop, re-apply migrations, re-seed |
| `npm run db:test` | lint the SQL functions, then the 67 pgTAP tests in `supabase/tests/` |
| `npm run db:load -- --dry-run` | download FAOSTAT prices (12 MB, cached a week in `.cache/faostat/`), assemble every row, write nothing |
| `npm run db:load` | write everything through the Data API; needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (`.env.example`); `-- --monthly` adds monthly prices |
| `npm run market:areas` | rebuild `data/market/faostat_areas.csv` from FAOSTAT's production file (34 MB); needed only when the atlas moves to another FAOSTAT release |
| `npm run db:stop` | stop the containers |

**A load makes the database equal to the repository.** Rows are upserted on their keys; crops, items and crop-item links that the atlas no longer holds are deleted, and their country rows and prices go with them (`on delete cascade`). After the atlas is rebuilt, run the load again. A second run with nothing changed writes the same rows. A full load takes about 5 seconds locally.

The seed is a real sample, not invented rows: seven crops (rice, maize, robusta coffee, black pepper, cassava, soybean, mango) in Viet Nam, the United States and India, annual prices since 2015, cut from a full load.

## 7. Coverage

Full load of annual prices, FAOSTAT release of 9 October 2026:

| | |
|---|---:|
| Price rows | 249,700 (1991-2025) |
| Countries with a price | 176 |
| Items with a price | 154 of 157 (none for *Jojoba seeds*, *Tallowtree seeds*, *Flax, raw or retted*) |
| Rows with a USD value | 128,752; the rest have local currency or the index only |
| Crops with a price | 365 of 387: 163 exact, 202 group. Without: the 20 crops with `match = none`, jojoba and tallow tree |
| Crop-country pairs with a latest price (own item) | 18,065: 8,081 where the country grows the crop, 9,356 `unknown` (group crops), 323 `absent`, 305 in an area without ISO code |
| Latest priced year | 2024 for 7,736 pairs, 2023 for 1,427, 2022 for 938, older for the rest |
| Crops with a price in Viet Nam | 96: 7 major, 26 common, 15 minor, 48 `unknown` |
| Crops with a price in the United States | 196: 7 major, 9 common, 82 minor, 3 `absent`, 95 `unknown` |

Database size after one load: 63 MB (`producer_prices` 39 MB, `crop_country` 12 MB). Monthly prices add 301,456 rows.

## 8. Limits

- **Group and shared prices are not crop prices.** Section 4. 83 crops have a price that is their own: the 85 that are alone on an item, less jojoba and tallow tree, whose items have no price.
- **FAOSTAT producer prices are what countries report, on the product basis they choose.** Viet Nam, *Coffee, green*, 2024: 709 USD/t (17,754 VND/kg), against 86,000 VND/kg of green bean in the Central Highlands in the source `scripts/crops/economics.ts` already uses, which notes that the FAOSTAT figure "contradicts the market". A price from this database needs the same check before it enters a profit calculation.
- **A crop's `level` in a country and its price come from different FAOSTAT domains and years.** `crop_country` is a three-year mean of production data; a price is one year of the price domain.
- **Countries are joined by name between two FAOSTAT releases** (production of December 2025, prices of October 2026). A country renamed in between would get its prices under a new area without ISO code: the loader counts such areas, and none appeared in this load.
- **No cost data.** FAOSTAT has producer prices, not production costs.
- **The loader is not transactional.** It writes table by table through the Data API; a reader during a load can see new crops with old prices.

## 9. Not done

- No hosted project holds data yet. One was created and its first deployment stopped on a wrong database password before anything was applied (`docs/CI_CD.md`, section 5).
- The app does not query the database. The natural first use is a price with its year, flag, match and level beside the reference economics.
- `item_country` (quantities of group items) is not loaded, so a group price cannot yet be shown next to the production of its group.

## 10. Why the tables were replaced

The first schema (migrations `…000100` to `…000400`) was written for the team's crop sheet of 489 crops, before the atlas existed in the repository. That sheet had no FAOSTAT item code, so the link was recovered from each crop's list of producing countries, and the sheet's entry errors were repaired by rules of this module. The atlas now does both from sources, with a match read from FAOSTAT's item definitions and a cleaning that drops instead of repairing, and it keeps other crops (387, of which 299 were in the sheet). Keeping two crop tables would give two answers to "which item is this crop", so the sheet copy, the recovered link and the repair rules were removed. No hosted database had been deployed, and every row is loaded again from sources, so the migration drops and recreates instead of converting.
