# Market database (Supabase)

Code: `supabase/` (migrations, seed, pgTAP tests, configuration) and `scripts/market/` (the link to FAOSTAT and the loader). Data: `data/market/`. Unit tests: `scripts/market/market.test.ts`. Deployment: `docs/CI_CD.md`, section 5.

The database answers one question for the economics side of the app: **what does a farmer get for this crop in this country, and how good is that number.** It holds the crop atlas, the FAOSTAT item each crop is counted under, the countries FAOSTAT reports as producers, and FAOSTAT producer prices of those items.

Nothing in the browser reads it yet. `src/core/economics` still uses the reference table in `scripts/crops/economics.ts`; wiring a price lookup into it is a separate change (section 9).

## 1. Sources

Every value comes from one of three files. Accessed 15 November 2026.

| Source | File | Release | Licence |
|---|---|---|---|
| Crop atlas, 489 crops x 38 columns: EcoCrop requirements selected by the team, plus `faostat_cac_nuoc_san_xuat`, the producing countries | Google Sheet "thái", sheet "Bản sao của atlas", exported as CSV, line endings normalised to LF: `data/market/atlas.csv` (SHA-256 `ea320e54…e8e318aa`) | sheet state of 15 Nov 2026 | EcoCrop: FAO; the country lists derive from FAOSTAT |
| FAOSTAT, Production: Crops and livestock products (QCL) | `https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip` | 31 Dec 2025 | CC BY 4.0 with FAO's additional terms |
| FAOSTAT, Prices: Producer Prices (PP) | `https://bulks-faostat.fao.org/production/Prices_E_All_Data_(Normalized).zip` | 9 Oct 2026 | same |

FAOSTAT licence: "FAO Statistical Database Terms of Use" (<https://www.fao.org/contact-us/terms/db-terms-of-use/en/>): datasets are under CC BY 4.0, must be attributed to FAO, and may not be used to promote a commercial product or to suggest FAO's endorsement. The bulk server is public; no account or key is involved. Release dates are read from FAOSTAT's catalogue (`datasets_E.json`) at load time and stored in `data_sources.released_on`.

## 2. From crop to FAOSTAT item

The atlas has no FAOSTAT item code. It has, per crop, a list of producing countries, and 489 crops share only 146 distinct lists. `scripts/market/match-faostat.ts` recovers the item from the list.

**Rule.** For every FAOSTAT crop item, take the countries (area code below 5000, without the aggregate row "China", code 351) whose *Production* is above zero in at least one year from 2019 to 2024. The atlas list of a crop is matched against these sets, country for country.

**Evidence that this is the rule the atlas was built with.** Each of the 146 lists equals the set of exactly one item, or of several items of one plant, with no country missing or extra. A single differing country would make the script stop (it throws rather than pick the nearest set).

| Outcome | Crops | Items |
|---|---:|---:|
| List equals the set of one item | 482 | 143 |
| List equals the sets of two or three items of the same plant; the raw product is taken | 7 | 3 |
| List fits no item | 0 | |

The three ties, written to `tie_note`: kapok (fruit, seed, fibre -> *Kapok fruit*, 310), cotton (seed cotton, cotton seed, lint -> *Seed cotton, unginned*, 328), oil palm (fruit, kernels -> *Oil palm fruit*, 254).

**What the link means.** An item is a statistical class, and most classes hold more than one atlas crop:

| The crop's item | Crops | In the vocabulary of `docs/PLAN.md` 2.2 |
|---|---:|---|
| Named item that no other atlas crop is linked to (Okra, Pineapple, Soybean) | 76 | `exact` candidates |
| Named item shared with other atlas crops (*Beans, dry* 10 crops, *Pumpkins, squash and gourds* 10, *Millet* 8, *Yams* 7; *Rice* 4: rice, African rice and two subspecies) | 191 | `group` |
| Residual class, "n.e.c." or "Other ..." (*Other vegetables, fresh n.e.c.* 49 crops, *Other tropical fruits, n.e.c.* 47, *Other fruits, n.e.c.* 34) | 222 | `group` |

So 413 of 489 crops carry the countries and the price of a class, not their own. Two columns say so on every price the database returns: `item_is_residual` and `item_crop_count`. "Alone on its item" is counted inside the atlas: an item can still pool species the atlas does not list, which only FAOSTAT's item definitions can settle (planned in `docs/PLAN.md` 2.2).

Output: `data/market/crop_faostat_items.csv` (one row per crop) and `data/market/faostat_areas.csv` (209 countries and territories with their FAOSTAT and M49 codes). Rebuild with `npm run market:match`; the files are committed, so the loader and the tests do not need the 34 MB production file.

## 3. Cleaning the atlas

`scripts/market/atlas.ts` turns the CSV into typed rows. A value is changed only by a rule below, and every change is written to the crop's `quality_notes`; 18 crops carry a note.

| Finding in the source | Rule | Crops |
|---|---|---|
| Temperatures of 1500-4000 and rainfall of 18-34 | all four temperatures above 100 and all four rainfalls below 100: the two blocks are exchanged | Araza |
| A latitude above 90 with an altitude of 90 or less | the two are exchanged; without such an altitude the latitude is dropped (same rule as `scripts/crops/parse.ts`) | Eggplant, Dragon fruit |
| Cycle maximum `2,4` | read as 240 days: the atlas row of the same tree under its older name has 180-240 | Karite |
| Growing cycle 0 | EcoCrop's "not given": stored as null | 13 crops |
| Optimal range partly outside the absolute range | kept as published, flagged | Safou (temperature), Dragon fruit (rainfall), Bergamot orange (pH) |
| `-`, `---` or blank | null | throughout |
| Class labels with a unit, "shallow (20-50 cm)", "low (<4 dS/m)" | the label only: `shallow`, `medium`, `deep`; `low`, `moderate`, `high` | throughout |
| Climate zones "tropical wet & dry (Aw)" | the Köppen-Trewartha code: `Aw` | throughout |

The `crops` table repeats the plausibility limits as CHECK constraints (latitude 0-90, pH 0-14, temperature -30 to 60 °C, rainfall 0-12,000 mm, altitude 0-6,000 m, cycle 1-366 days, the class labels), so a row the cleaning missed is refused by the database instead of stored.

## 4. Schema

Migrations in `supabase/migrations/`, applied in file order.

| Table | Key | Rows (full load, 15 Nov 2026) | Content |
|---|---|---:|---|
| `data_sources` | `code` | 3 | name, publisher, URL, release date, load time and row count of each source |
| `areas` | `area_code` | 209 | FAOSTAT countries and territories, with M49 code |
| `faostat_items` | `item_code` | 146 | items linked to a crop, CPC code, `is_residual` |
| `crops` | `id` | 489 | the atlas: one row per crop, cleaned EcoCrop columns, `quality_notes` |
| `crop_faostat_items` | `crop_id` | 489 | crop -> item, `match_method`, `tie_note` |
| `crop_countries` | `crop_id, area_code` | 41,450 | producing countries of the crop's item |
| `producer_prices` | `area_code, item_code, year, month` | 241,376 | `lcu_per_tonne`, `slc_per_tonne`, `usd_per_tonne`, `price_index` (2014-2016 = 100) and one FAOSTAT flag per value; `month` 0 is the annual value |

`crops.id` is the app's crop id (`slugify(scientific_name)`, as in `src/core/crops`). LCU is the local currency of the year, SLC the standard local currency (today's currency for the whole series); a country can have LCU and SLC without USD. Flags are FAOSTAT's: `A` official, `E` estimated, `I` imputed, `X` from an international organisation, `B` break in the series.

What a client reads:

| Object | Returns |
|---|---|
| view `crop_prices` | annual prices per crop and country, with crop and country names, `item_name`, `item_is_residual`, `item_crop_count`, and `is_producer` (the country is on the crop's producing list) |
| view `crop_latest_prices` | the most recent priced year of each crop and country |
| function `crop_price_series(p_crop_id, p_area_code)` | the annual series of one crop in one country, oldest first |

Example (the anon key of a project is public by design):

```bash
curl "$SUPABASE_URL/rest/v1/crop_latest_prices?crop_id=eq.oryza-sativa&area_code=eq.237&select=year,usd_per_tonne,lcu_per_tonne,usd_flag,item_name,item_crop_count" -H "apikey: $SUPABASE_ANON_KEY"
# [{"year":2024,"usd_per_tonne":356,"lcu_per_tonne":8914228.5,"usd_flag":"A","item_name":"Rice","item_crop_count":4}]
```

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
| `npm run db:test` | lint the SQL functions, then the 49 pgTAP tests in `supabase/tests/` |
| `npm run db:load -- --dry-run` | download FAOSTAT prices (12 MB, cached a week in `.cache/faostat/`), assemble every row, write nothing |
| `npm run db:load` | upsert everything through the Data API; needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (`.env.example`); `-- --monthly` adds monthly prices |
| `npm run db:stop` | stop the containers |

The seed is a real sample, not invented rows: seven crops (rice, maize, robusta coffee, black pepper, cassava, soybean, Ceylon spinach) in Viet Nam, the United States and India, annual prices since 2015, cut from a full load. In the seed `item_crop_count` counts the seeded crops only. A full load takes about 5 seconds locally; rows are upserted on their keys, so a second load changes nothing.

## 7. Coverage

Full load of annual prices, FAOSTAT release of 9 October 2026:

| | |
|---|---:|
| Price rows | 241,376 (1991-2025) |
| Countries with a price | 176 |
| Items with a price | 145 of 146 (none for *Jojoba seeds*) |
| Rows with a USD value | 125,245; the rest have local currency or the index only |
| Crop-country pairs with a latest price | 22,651, of which 20,187 in a producing country |
| Latest priced year | 2024 for 8,841 pairs, 2023 for 1,722, 2022 for 1,153, older for the rest |
| Atlas crops with a price in Viet Nam (producing country) | 90 |
| Atlas crops with a price in the United States (producing country) | 235 |

Database size after the load: 55 MB (37 MB of it `producer_prices`). Monthly prices add 293,208 rows.

## 8. Limits

- **A price is the price of the item.** For 413 crops it is a class price (section 2). The 49 vegetables under *Other vegetables, fresh n.e.c.* all return the same number.
- **The producing-country list says "present", not "how much", and for a class it is the list of the class.** `docs/PLAN.md` 2.1 gives the consequences (aibika in 181 countries; durian without Viet Nam). `is_producer` inherits both.
- **FAOSTAT producer prices are what countries report, on the product basis they choose.** Viet Nam, *Coffee, green*, 2024: 709 USD/t (17,754 VND/kg), against 86,000 VND/kg of green bean in the Central Highlands in the source `scripts/crops/economics.ts` already uses, which notes that the FAOSTAT figure "contradicts the market". A price from this database needs the same check before it enters a profit calculation.
- **The atlas is the sheet as exported on 15 November 2026.** `docs/PLAN.md` 2.2 plans a rebuilt atlas under `data/crops/atlas/`. When it lands, `data/market/atlas.csv` and `scripts/market/atlas.ts` should read that dataset instead, and the item link should come from its `exact`/`group` column.
- **The link depends on a FAOSTAT release.** A later production release can change a country set; `npm run market:match` then stops and names the crop. The committed mapping stays valid for the atlas it was built from.
- **Countries are FAOSTAT area codes**, not ISO codes; `areas.m49_code` is the bridge to ISO 3166 numeric. An `iso3` column is not there yet.
- **No cost data.** FAOSTAT has producer prices, not production costs.
- **The ZIP reader** (`scripts/market/zip.ts`) handles stored and deflated entries only, no ZIP64: enough for FAOSTAT's files, which it refuses loudly otherwise.

## 9. Not done

- No hosted project exists yet: creating one, and the keys that go with it, are the owner's decision (`docs/CI_CD.md`, section 5).
- The app does not query the database. The natural first use is a price with its year, flag and class warning beside the reference economics.
- Yields and harvested area (FAOSTAT QCL) are read for the link only and not stored.
