# Farm economics

Code: `src/core/economics/index.ts`. Reference table: `scripts/crops/economics.ts`, generated into `src/core/crops/curated.generated.ts` and listed in full, with every source line, in `data/crops/curated-crops.csv`. Collected on 2026-11-14.

## 1. Formulas

```
expected yield (t/ha) = reference yield x expected yield fraction      (docs/SCORING.md §4)
low / high yield      = reference yield x 10th / 90th percentile of the yearly fractions (else -20 % / +20 %)
production (t)        = expected yield x area
revenue               = production x price
cost                  = operating cost per ha x area
margin                = revenue - cost            margin % = margin / revenue
low / high margin     = low / high yield x area x price - cost          (section 6)
break-even yield      = operating cost per ha / price
```

For the selected crop the fraction is the season outcome of the score; for any other crop it is the compatibility at its best sowing window. A rotation is the sum of its seasons divided by its length in years (`strategyEconomics`).

**Cost is the operating (variable) cost**: inputs, hired work, machinery running costs. Land, family labour and overhead are left out because they do not change with the crop choice, so the margin is a gross margin over operating costs. Where a source publishes total cost, the total is quoted in the source line. Perennials: production years only, no establishment cost. Cover crops: no yield and no price, only the cost of seed and drilling, so their margin is negative by construction; their benefit is counted by the rotation planner, not here.

**The farmer's numbers win.** `lastYieldTHa`, `pricePerT` and `costPerHa` (in USD or VND) replace the reference values for the selected crop, in the season economics and in every rotation that contains the crop. Price and cost are converted to USD in one place, `ownEconomics` in `src/core/economics/index.ts`: an amount is read in `groundTruth.currency`, and in USD when no currency is stored, so the entry form stores the currency it shows with every amount. A farmer's yield is used as it is (range +/- 15 %) and not scaled by the score again. `usesReferenceValues` stays true while any of the three is a reference value.

**Nothing is assumed.** If yield, price or cost is known neither from the farmer nor from a reference, `estimateSeasonEconomics` returns `null`.

**Currency.** USD is the base. `getCurrency('VND')` returns 25,600 VND per USD, the State Bank of Vietnam central rate of 10 Nov 2026, read from a press report of the official rate (https://thitruongtaichinhtiente.vn/ngay-10-11-ty-gia-trung-tam-giam-10-dong-86927.html), not from sbv.gov.vn.

**Region.** Vietnam uses `VN`; the United States uses `US-HEARTLAND` (east of 104° W, north of 36° N), `US-WEST` (west of 104° W) or `US`; elsewhere the US or VN record is used and its region is shown in the source lines.

## 2. Reference values

Quality: official = statistics agency; budget = university enterprise budget; press = article quoting a farm or a demonstration; derived = computed from two published statements.

| Crop | Region | Yield t/ha | Price USD/t | Operating cost USD/ha | Cost source (quality, year) |
|---|---|---|---|---|---|
| Rice (paddy) | VN | 6.15 | 228.5 | 867 | An Giang demonstration models, Nhân Dân (press, 2026) |
| Maize | VN | 5.11 | 260.1 | 1,053 | Gia Lai demonstration, Việt Báo (press, 2026) |
| Soybean | VN | 1.63 | 927.9 | 737 | 70 % of the maize cost (derived, 2026) |
| Groundnut | VN | 2.68 | 1,226.7 | 2,402 | Bình Định extension trial (press, 2023) |
| Sweet potato | VN | 12.04 | 480.0 | 4,688 | one grower, Đắk Lắk (press, 2022) |
| Sugarcane | VN | 67.75 | 45.7 | 1,953 | ratoon cane, Tây Ninh (press, 2026) |
| Watermelon | VN | 25.66 | 327.1 | 6,055 | Gia Lai, includes land rent (press, 2024) |
| Robusta coffee | VN | 2.97 | 3,359 | 2,363 | Dr Trương Hồng's budget for the 2021 season, Công Thương (press) |
| Maize | US / Iowa | 12.43 / 13.18 | 154.7 / 161.4 | 1,126 / 1,195 | USDA ERS 2025 (official) / Iowa State A1-20 2026 (budget) |
| Soybean | US / Iowa | 3.90 / 4.27 | 358.6 / 374.8 | 620 / 717 | same |
| Wheat | US / Heartland | 3.63 / 5.85 | 186.3 / 190.3 | 403 / 570 | USDA ERS 2025 (official) |
| Sorghum, barley, oats, rice, peanuts | US | 4.96, 3.66, 2.30, 9.08, 4.74 | 133.9, 242.1, 230.1, 291.2, 529.1 | 453, 484, 433, 1,957, 1,588 | USDA ERS 2025 (official) |
| Sunflower, canola, dry beans, dry peas | US | 2.09, 2.26, 2.26, 1.95 | 504.9, 452.0, 665.8, 249.1 | 544, 641, 701, 431 | NDSU 2026 budgets, direct costs (budget) |
| Potato | US | 51.56 | 246.9 | 4,020 | University of Idaho budget, 2019 dollars (budget) |
| Alfalfa hay | US / Iowa / Nevada | 7.67 / 9.42 / 10.54 | 187.4 / 117.9 / 179.7 | 1,184 / 599 / 1,184 | Idaho 2025 budget; Iowa State 2026 (budget) |
| Cover crops (rye, hairy vetch, crimson clover, buckwheat, radish, sunn hemp) | US | 0 | 0 | 152, 152, 89, 160, 100, 215 | USDA-ARS fact sheet 04o, 2014 seed prices plus drilling (budget) |
| Cereal rye | Iowa | 0 | 0 | 70 | farmdoc daily, central Illinois 2018 (budget) |

Yields: FAOSTAT 2024 (Vietnam), USDA ERS and NASS 2025 (US). Prices: FAOSTAT producer prices 2024 (Vietnam) unless a press price is named in the source line; USDA ERS and NASS 2025 (US).

## 3. Not found, weak or old: read before using

- **No Vietnamese cost per hectare in any opened source**: sesame, mung bean, cassava, black pepper, arabica, cashew, tea, mango, banana, pomelo, cabbage, avocado, coconut, durian and all cover crops. Yield and price are stored where they exist, the cost is `null`, and no margin is computed unless the farmer enters a cost.
- **Soybean (Vietnam) cost is derived**, not published: 70 % of the maize cost, from a press statement that soybean inputs and care cost about 30 % less than maize.
- **All Vietnamese costs are press figures** from single farms or demonstration models, with the scope often not itemised. No official provincial cost of production was found.
- **Robusta cost refers to the 2021 season**; input prices have risen since. Robusta and pepper prices (Nov 2026) were read from search results; the pages were not opened. FAOSTAT's 2024 coffee producer price (709 USD/t) contradicts the market and is not used.
- **Rice**: the cost is for demonstration models; the article puts conventional practice more than 3.2 million VND/ha higher. The price is a trader price of April 2026, lower than FAOSTAT 2024 (356 USD/t).
- **Mung bean** uses the FAOSTAT item "Beans, dry"; mung bean is not reported separately.
- **Cassava price** is a 2026 factory price for Tây Ninh; FAOSTAT 2024 gives 260 USD/t and was not cross-checked.
- **Potato cost is in 2019 dollars; Nevada alfalfa uses a 2025 eastern Idaho budget** because the only Nevada study found dates from 2008 (operating 618 USD/acre).
- **Cover-crop seed prices are from 2014** (south-eastern US retailers). Red clover: not found.
- No US cost for onion or chickpea. No world-average fallback exists: outside Vietnam and the US the nearest record is shown with its region.

## 4. Limits

Reference prices are annual averages or single quotes, not forecasts. Section 6 gives the margin when a price, a yield or a cost is off by 20 %; how likely such a move is, is not modelled. Yields are national or state averages, so the "attainable" yield of a well-managed field is understated for good farmers and overstated on poor land; the farmer's own yield corrects this. Irrigation water, drying, storage and transport costs are included only where the source budget includes them.

## 5. The most profitable sequence under constraints

Code: `profitSearch`, `meetsConstraints` and `profitSearchFor` in `src/core/advisory/rotation.ts`. Tests: `src/core/economics/profit-search.test.ts`.

On a field whose main crop is an annual, the "income" rotation of the advisory report is the sequence of crops with the highest expected margin among all sequences that could be compared, under three constraints. It replaces a greedy rule (best-paying crop first, then the best-paying crop for the months left), which stays as the fallback.

**Expected margin of a season.** As in section 1: reference yield x field score / 100 x price - cost, for the whole parcel; the grower's own yield, price and cost replace the reference for the crop they grow. A sequence is worth the sum of its seasons, per year.

**What is compared.**

| Rule | Value | Where it comes from |
|---|---|---|
| Crops | annual cash crops with rotation traits, not on the grower's avoid list | the pool the rotation engine has always used |
| Price and cost | a reference of the parcel's own region, or the grower's own numbers | `referenceEconomics` falls back to another region when a crop has no figure here; a comparison of margins does not use such a figure |
| A season | a crop sown in a month in which the field scores at least 55 for it | the threshold of the greedy rule |
| Reliability | the sowing month met the crop's needs in at least half of the analysed years, when a history exists | the scorer's reliability threshold (0.5) |
| One year | every set of up to four seasons that do not overlap; two seasons that follow each other, the last and the first included, are of different pest groups | the pest-group rule of the greedy rule |
| Two years | every pair of different one-year sequences in alternation (maize, then soybean), with the same two rules across the turn of the year | from the best 300 one-year sequences when there are more |

Nothing is sampled: the sequences are enumerated, sorted by margin, and equal margins are ordered by the names of their crops, so the same field gives the same answer.

**Constraints.** The sequences are checked best margin first, and the first one that passes is chosen:

- its soil-health index is not below that of the current rotation;
- its water fit (modelled supply over demand, with the grower's irrigation and the reliability of their water source) is not below that of the current rotation;
- when "low risk" is among the grower's priorities, its risk score is not above that of the current rotation.

The floor is what the grower does now, not a fixed number: a plan may earn more, it may not leave soil or water worse off than today. The three indices are those of the rotation report (`evaluate`); the search adds no threshold of its own. When the current rotation itself comes out first, the report says so and shows the next sequence.

**On the demo fields** (15 November 2026, default priorities profit, water, soil):

| Field | Compared: one-year sequences | two-year alternations | Current rotation, USD/ha/year | Chosen | USD/ha/year | Set aside for a constraint | Crops that suit the field but have no price or cost for the region |
|---|---:|---:|---:|---|---:|---:|---:|
| Mekong Delta paddy | 1,278 | 11,676 | 1,616 (rice three times) | soybean in January, sweet potato in May, rice in September | 2,284 | 0 | 31 |
| Story County corn-soybean field | 23 | 204 | 407 (maize, then soybean) | maize in June; the next year common bean in May and canola in August | 613 | 56 (soil health 54, water fit 54) | 13 |

The table is the search without the country's crop table. With it, as the app runs since the builder reads that table (docs/SCORING.md, 12.5), the same sequences are compared and the same one is chosen on both fields; only the last column of the paddy field changes, from 31 to 20, because 11 of the 31 crops are ones Viet Nam's statistics report none of and are no longer candidates.

In Iowa the sequence with the highest margin outright would earn 8,710 USD/ha/year; it and 55 others lower the soil-health index or the water fit below the maize-soybean rotation. On the two other demo fields the main crop is a perennial stand (robusta coffee, alfalfa): the search is not run there, and the report keeps its own alternatives for stands.

**Time.** First call of the advisory report, three fresh runs each, in milliseconds, before and after: Mekong Delta paddy 37-43 and 67-68; Story County 33-35 and 37-38; the two perennial fields unchanged (55-97 and 25-27).

**Limits.**

- **The comparison is only as wide as the reference table.** 31 crops that suit the paddy field and 13 that suit the Iowa field were left out because no price or cost is known for their region; the report names them. Outside Viet Nam and the United States there is no figure of the field's own region at all: the search does not run, the greedy rule is used on the figures of another region, and the report says that its margins then show an order of magnitude only.
- **The indices are the report's own.** Soil health, water fit and risk are scores built for comparing rotations (section 4 and `docs/ADVISORY.md`), not measurements.
- **No effect of one crop on the next.** The yield of a season depends on the field score alone; a legume before a cereal changes the soil-health index, not the cereal's yield.
- **One and two years.** Longer rotations are not searched; the report's other alternatives cover three years.
- **Reference prices are single values.** How the choice moves when prices, yields or costs move is the subject of section 6.
- **The floor is as good as the current practice.** Where today's rotation is hard on the soil, the constraint asks for no more than that.

## 6. Sensitivity

Code: `marginSensitivity`, `seasonSensitivity` and `rankFlips` in `src/core/economics/index.ts`; the margin range in `seasonEconomics` and `strategyEconomics`; the lines of the rotation report in `src/core/advisory/rotation.ts`. Tests: `src/core/economics/economics.test.ts`, which computes every row of the four tables below and fails when this section and the code disagree.

A margin is the difference of two larger numbers, so an error in a price, a yield or a cost moves it by more than the error itself. This section says by how much, in two ways: a range that every margin now carries, and a "what if" of 20 %.

### 6.1 What is computed

**A range for every margin.** A season has a low, an expected and a high yield (section 1). `marginLowUsd` and `marginHighUsd` are the margin at the low and at the high yield, with price and cost unchanged. The yield range has one of three origins, and `yield.basis` says which, in English and in Vietnamese:

| Origin | Low and high yield | When |
|---|---|---|
| The analysed years | reference yield x the 10th and the 90th percentile of the yearly outcomes of the score (`yieldRange`) | the crop the field grows, on the season card, when at least five years of climate history exist |
| The grower's last yield | 15 % below and above it | `lastYieldTHa` is entered |
| A default | 20 % below the expected yield; 20 % above it, but not above the reference yield | every other crop, and every season of a rotation |

For a rotation the low ends of its seasons are added, and so are the high ends: `perHaMarginLowUsd` and `perHaMarginHighUsd`, per hectare and year. This takes every season to be poor, or good, in the same year, so it is the widest range the seasons allow and not a probability interval. The rotation report prints the range in its evidence line on the margin, and adds a line to its gaps when zero lies inside the range.

**A "what if" of 20 %.** `marginSensitivity` takes a yield, a price, an operating cost per hectare and an area. It returns the margin with each of the three lower and higher by 20 %, one at a time; with all three against the grower (price and yield down, cost up) and all three in their favour; the price at which the margin is zero (cost per hectare / yield) and the yield at which it is zero (cost per hectare / price). `seasonSensitivity` does the same for a season that was already computed.

**20 % is a level to ask "what if" with (docs/PLAN.md, step K8). It is not an estimate of how far prices, yields or costs do move**: nothing in the repository measures that (6.5).

Revenue is yield x price, and the operating cost per hectare does not depend on the yield in this model. A yield that is 20 % off therefore moves the margin exactly as a price that is 20 % off, and the tables give the two in one column.

**Source quality.** The quality of the three reference figures (section 2: official, budget, press, derived) travels with the season as `SeasonEconomics.reference`: country, region, year, the quality of yield, price and cost, and whether the record is of the parcel's own country. A range can so be shown next to how good its inputs are.

### 6.2 Five crops on the demo fields, 20 % up and down

One hectare, one season, reference values, the fields as the app opens them (15 November 2026). USD per hectare. The country's crop table does not enter these: a season's margin does not depend on it.

| Crop, field | Margin | Price or yield -20 % | +20 % | Cost +20 % | -20 % | All three against the grower | All three in favour | Break-even price, USD/t (assumed) | Break-even yield, t/ha (expected) | Source of yield, price, cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Robusta coffee, Central Highlands robusta block | 7,614 | 5,619 | 9,609 | 7,141 | 8,087 | 3,550 | 12,476 | 796 (3,359) | 0.70 (2.97) | official, press, press |
| Rice, Mekong Delta paddy | 538 | 257 | 819 | 365 | 711 | -141 | 1,330 | 141 (229) | 3.79 (6.15) | official, press, press |
| Maize, Story County corn-soybean field | 932 | 507 | 1,357 | 693 | 1,171 | -73 | 2,107 | 91 (161) | 7.40 (13.18) | official, official, budget |
| Soybean, Story County corn-soybean field | 749 | 456 | 1,042 | 606 | 892 | 78 | 1,537 | 183 (375) | 1.91 (3.91) | official, official, budget |
| Alfalfa, Diamond Valley alfalfa pivot | -182 | -382 | 18 | -419 | 55 | -780 | 496 | 212 (180) | 6.59 (5.58) | official, official, budget |

What the table says:

- A price 20 % lower takes 26 % of the coffee margin, 39 % of the soybean margin, 46 % of the maize margin and 52 % of the rice margin. The smaller the margin is against the revenue, the more a price moves it.
- Rice and maize lose money when all three go against the grower; soybean and coffee do not.
- Alfalfa on the pivot loses money as assumed: the field scores 53 % of the reference yield, and the cost is that of an eastern Idaho budget (section 3). It breaks even at a price 18 % above the reference, or at a yield of 6.59 t/ha against the 5.58 expected.
- The two Vietnamese rows rest on press figures for price and cost; the three American rows on an official price and a university budget.

### 6.3 The yield range of the same five seasons

The margin range the season card can show, from the yield range of 6.1. Yields in t/ha, margins in USD per hectare.

| Crop, field | Low yield | Expected | High | Margin at the low yield | Margin | At the high yield | Origin of the range |
|---|---:|---:|---:|---:|---:|---:|---|
| Robusta coffee, Central Highlands robusta block | 2.87 | 2.97 | 2.97 | 7,266 | 7,614 | 7,614 | the analysed years |
| Rice, Mekong Delta paddy | 5.86 | 6.15 | 6.15 | 473 | 538 | 538 | the analysed years |
| Maize, Story County corn-soybean field | 0.14 | 13.18 | 13.18 | -1,173 | 932 | 932 | the analysed years |
| Soybean, Story County corn-soybean field | 3.13 | 3.91 | 4.27 | 456 | 749 | 883 | default of 20 % |
| Alfalfa, Diamond Valley alfalfa pivot | 3.86 | 5.58 | 5.58 | -491 | -182 | -182 | the analysed years |

- Where the field scores 100 % of the reference yield the range has one side only: the model has no yield above the reference.
- **Maize in Iowa: the low end is not credible as a harvest.** The yearly outcomes of the score put four of the 20 analysed years at a tenth of the reference yield or less (0.00, 0.00, 0.01 and 0.10), so the 10th percentile is 1 %. These outcomes come from monthly climate scores, not from a daily water balance, and were not calibrated against harvests (docs/SCORING.md, section 8); they were not compared with county yields here. The range is shown as the model gives it; it is a reason to check the yearly outcomes, not a forecast of a lost crop.

### 6.4 The rotations of the demo fields

Margin per hectare and year, with the range of 6.1. Every season of a rotation uses the default of 20 %, the field's own crop included, so the same crop can have another range here than on the season card (6.5). The rotations are built as the app builds them, with the crop table of the field's country (docs/SCORING.md, 12.5): since the builder reads that table, the water-saver rotation of the paddy field is common bean and daikon radish (283; 66 to 499) and no longer common bean and buckwheat (223; 6 to 439), which Viet Nam's statistics report none of. No other row changed.

| Field | Rotation | Margin | Low | High |
|---|---|---:|---:|---:|
| Central Highlands robusta block | Current practice | 7,614 | 5,619 | 7,614 |
| Central Highlands robusta block | Soil-health rotation | 7,614 | 5,619 | 7,614 |
| Central Highlands robusta block | Water-saver rotation | 5,522 | 4,044 | 5,572 |
| Central Highlands robusta block | Resilience rotation | 4,696 | 3,445 | 4,729 |
| Mekong Delta paddy | Income rotation | 2,284 | 570 | 2,405 |
| Mekong Delta paddy | Current practice | 1,616 | 773 | 1,616 |
| Mekong Delta paddy | Soil-health rotation | 1,453 | 294 | 1,645 |
| Mekong Delta paddy | Resilience rotation | 761 | 190 | 802 |
| Mekong Delta paddy | Water-saver rotation | 283 | 66 | 499 |
| Story County corn-soybean field | Resilience rotation | 3,290 | 2,238 | 3,454 |
| Story County corn-soybean field | Water-saver rotation | 2,011 | 366 | 2,178 |
| Story County corn-soybean field | Soil-health rotation | 631 | 314 | 865 |
| Story County corn-soybean field | Income rotation | 613 | 237 | 777 |
| Story County corn-soybean field | Current practice | 407 | 134 | 680 |
| Diamond Valley alfalfa pivot | Resilience rotation | -108 | -229 | 12 |
| Diamond Valley alfalfa pivot | Soil-health rotation | -144 | -305 | 16 |
| Diamond Valley alfalfa pivot | Current practice | -180 | -381 | 21 |

Zero lies inside the range of the three rotations of the alfalfa pivot, and of no other rotation; the report says so in their gaps. On the paddy field the income rotation of section 5 earns more than three rice crops as assumed (2,284 against 1,616), and less at the low end (570 against 773): it sells about twice as much and spends more than twice as much (revenue 11,577 against 5,691 USD a year on the 1.35 ha, cost 8,494 against 3,510), so a poor year costs it more.

**Does the order hold?** `rankFlips` asks at which common move the margins of two rotations are equal: all prices (or all yields) of a field moving by the same share, or all costs. Within 20 %:

| Field | Ahead as assumed | Overtaken by | When all |
|---|---|---|---|
| Mekong Delta paddy | Current practice | Soil-health rotation | costs fall by 9 % |
| Mekong Delta paddy | Current practice | Soil-health rotation | prices or yields rise by 10 % |
| Mekong Delta paddy | Income rotation | Current practice | prices or yields fall by 15 % |
| Mekong Delta paddy | Income rotation | Current practice | costs rise by 18 % |
| Story County corn-soybean field | Soil-health rotation | Income rotation | costs fall by 6 % |
| Story County corn-soybean field | Soil-health rotation | Income rotation | prices or yields rise by 6 % |
| Diamond Valley alfalfa pivot | Resilience rotation | Current practice | costs fall by 15 % |
| Diamond Valley alfalfa pivot | Resilience rotation | Soil-health rotation | costs fall by 15 % |
| Diamond Valley alfalfa pivot | Soil-health rotation | Current practice | costs fall by 15 % |
| Diamond Valley alfalfa pivot | Resilience rotation | Current practice | prices or yields rise by 18 % |
| Diamond Valley alfalfa pivot | Soil-health rotation | Current practice | prices or yields rise by 18 % |
| Diamond Valley alfalfa pivot | Resilience rotation | Soil-health rotation | prices or yields rise by 18 % |

- **Mekong Delta paddy.** The advice to change to the income rotation holds unless all prices fall by 15 % or all costs rise by 18 %.
- **Story County.** The income rotation stays ahead of the maize-soybean rotation over the whole range. It and the soil-health rotation are 18 USD apart and change places at 6 %: on margin the two are not to be told apart.
- **Diamond Valley.** The three rotations are the same alfalfa in five, four and three years out of five; the break years have no price or cost in the reference table and count as nothing. So the three reach zero together and the order turns round there: once alfalfa pays, more of it pays more.
- **Central Highlands.** No two rotations change places.

### 6.5 Limits, and what was not done

- **How far prices do move is not measured.** A range from observed prices needs a series of several years per crop and country in a file a pure function can read, each price checked. The FAOSTAT producer prices are in the price database (docs/DATABASE.md), not in such a file, and at least one series is known to be off (Viet Nam, coffee, 2024: section 3). Left as an idea; until then the 20 % stays a "what if".
- **One input at a time, or all three together.** Price and yield are not tied to each other, although a poor harvest often comes with a higher price. "All three against the grower" is a corner of the cube, not a likely year.
- **A common move only.** `rankFlips` moves all prices of a field together. Rice falling while soybean rises is not examined.
- **The yield range of a rotation is the default.** Passing the 10th and 90th percentile of the years to every season of a rotation was left out: the rotation planner scores a crop by month, not year by year. The season card of the field's own crop and the same crop inside a rotation can therefore show different ranges (rice: 473 to 538 on the card, the default inside a rotation).
- **The ends of a rotation's range add up**, as if all its seasons were poor in the same year.
- **Cost does not move with the yield.** Harvest, drying and transport do in practice; with them a yield that is off would move the margin by less than a price that is off.
- **Source quality is shown, not used.** A press figure does not get a wider range than an official one.
