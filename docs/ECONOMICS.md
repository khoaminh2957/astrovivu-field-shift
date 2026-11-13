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
break-even yield      = operating cost per ha / price
```

For the selected crop the fraction is the season outcome of the score; for any other crop it is the compatibility at its best sowing window. A rotation is the sum of its seasons divided by its length in years (`strategyEconomics`).

**Cost is the operating (variable) cost**: inputs, hired work, machinery running costs. Land, family labour and overhead are left out because they do not change with the crop choice, so the margin is a gross margin over operating costs. Where a source publishes total cost, the total is quoted in the source line. Perennials: production years only, no establishment cost. Cover crops: no yield and no price, only the cost of seed and drilling, so their margin is negative by construction; their benefit is counted by the rotation planner, not here.

**The farmer's numbers win.** `lastYieldTHa`, `pricePerT` and `costPerHa` (in USD or VND) replace the reference values for the selected crop; a farmer's yield is used as it is (range +/- 15 %) and not scaled by the score again. `usesReferenceValues` stays true while any of the three is a reference value.

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

Reference prices are annual averages or single quotes, not forecasts; price risk is not modelled. Yields are national or state averages, so the "attainable" yield of a well-managed field is understated for good farmers and overstated on poor land; the farmer's own yield corrects this. Irrigation water, drying, storage and transport costs are included only where the source budget includes them.
