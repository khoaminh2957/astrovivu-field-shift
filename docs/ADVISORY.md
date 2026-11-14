# Advisory engine (Tier 5, rule-based core)

Code: `src/core/advisory` (insights, rotations, actions), `src/core/tracking`, `src/core/urban`. All functions are pure functions of `ModelInput`. `buildAdvisoryReport` and the rotation search are memoised on the telemetry object plus the value of crop, ground truth, priorities, parcel and date. Tests: `src/core/advisory/advisory.test.ts` loads the four real demo samples.

## 1. Insights (Anomaly Markers)

| Rule | Trigger | Severity |
|---|---|---|
| Persistent departure (NDVI, root-zone soil moisture, daytime LST) | z = (v - mean)/sd, sd = (p90 - p10)/2.563 from the series' day-of-year baseline; \|z\| >= 1 held for >= 24 d (NDVI), 14 d (soil moisture), 16 d (LST) | alert \|z\| >= 2, watch >= 1.5, info otherwise or when the direction is harmless (greener, cooler) |
| 30-day rainfall | ERA5 rain over 30 d against the sum of its baseline means (normal >= 30 mm) | dry < 50 % (alert < 25 % with normal >= 60 mm), wet > 180 % |
| Dry spell | >= 15 consecutive days < 1 mm (CHIRPS, ERA5 fill) | watch if the days normally get >= 1.5 mm/d, alert if also >= 25 d in season; info when normal dry season but crop in season |
| Heat | >= 3 days t2m_max above the crop's absolute maximum temperature (EcoCrop) | watch, alert if >= 5 d or 3 °C over |
| Frost / cold | t2m_min <= crop kill temperature (rest kill temperature for a perennial in a month normally below its growth minimum); cold spell >= 3 nights below absolute minimum, skipped while dormant | frost alert, cold watch |
| Growth stage | stage change in the score timeline (modelled from sowing date or assumed best month) | info |
| Score swing | productivity changes >= 12 points in 14 days, attributed to the factor whose score moved most; skipped when the crop is out of season | watch if a fall >= 20 |
| Forecast | risk-branch events; else any forecast day >= 50 mm | by event severity |
| Pest / disease pressure | per week in susceptible stages: share of humid mild days (RH >= 85 % and 15-30 °C, or RH >= 75 % with rain) and warm dry days (>= 25 °C, RH < 70 %) | watch; labelled a weather pressure index that needs scouting, never a diagnosis; no products |

Resolution: sources with pixels >= 1 km are described as "across the area around the field" with the pixel size; NDVI (250 m) speaks about the field. Ranking: severity + \|z\| + duration; duplicates of the same metric within 10 days dropped; at most 4 per month (alerts exempt), 36 per year; sorted by date.

## 2. Rotation strategies

Current strategy: `groundTruth.currentRotation` (entries whose months overlap an earlier entry become later years, e.g. corn then soybean), else the last two years of `cropHistory` (CDL names mapped to catalogue ids), else the selected crop repeated in back-to-back windows that score >= 60 (flagged as assumed in the gaps).

Fit per crop and sowing month comes from `scanSowingWindows` with the effective irrigation (the farmer's entry; else full irrigation is inferred when normal rain < 350 mm and the field is cropped, and said so). Annual systems fill free months greedily (cash crops need fit >= 55, covers >= 35, no pest group back to back):

- soil-health: main crop + legumes/covers; a legume year when the main crop fixes no N.
- water-saver: crop with the best fit per mm of ETc, at most one more low/medium water crop.
- income: highest reference margin per season, then best-paying fillers.
- resilience: up to three years and three families, weighted by reliability.

Perennials are not rotated yearly. Tree crops get an inter-row N-fixing cover (~25 % area), a companion tree (~20 %), a partial conversion (~30 %) to a lower-water crop, or a mix. Stands (forage, sugarcane) are renewed after 4 years with break crops (paddy rice excluded). Area shares are written in the season label.

Metrics: suitability = month- and area-weighted fit; water use = Σ mean Kc (FAO-56 stage-weighted) × normal monthly ET0 per year; water fit = min(1, (0.8 × rain + irrigation supply) / ETc); N = indicative credit 40 (grain legume), 90 (cover legume), 150 (forage legume) kg/ha per season × area share; ground cover = covered months; pest break = 1 for a different family, 0.5 same family other pest group, 0 same pest group, over consecutive seasons (perennial mixes capped at 60); soil health = 30 cover + 20 N + 20 residue + 15 family diversity + 15 cover/perennial; risk = 50 (1 - reliability) + 25 / families + 25 (1 - water fit). Economics: `seasonEconomics` with yield fraction = fit at the sowing month and reference values, `strategyEconomics` over the rotation years. Score: each priority metric normalised 0..1 (margin and cost min-max across the strategies), weight 0.5 + 3/2/1 for the first/second/third priority.

The five lists are generated from the field: evidence cites the climate source, soil source, CDL history and reference economics; gaps name the missing soil test, coarse climate pixel, reference prices, irrigation assumptions, assumed rotation, perennial establishment, cover-crop literature values; risks name market and seed checks, upland crops after paddy, cover-crop timing, frost calendars, limiting soil chemistry, intercropping, monoculture, low suitability, and always local extension review.

## 3. Actions

- Irrigation: FAO-56 single-layer root-zone balance over the telemetry year and the forecast. TAW = 1000 × AWC × Zr (AWC from SSURGO or by texture 0.09-0.20), RAW = p × TAW, effective rain 0.8 × rain on days >= 2 mm, irrigate the net depletion when Dr > RAW. Kc from the modelled stage; tree crops keep Kc end between cycles; dormant = 0. Rice uses AWD wording. Savings against a calendar schedule of RAW every round(RAW / (Kc mid × mean ET0)) days, applied only in dry weeks.
- pH: target = optimum edge ± 0.3. Lime per pH unit: light 1.5-3, medium 3-5, heavy 5-8 t/ha CaCO3 eq. (typical extension liming tables, top ~20 cm), max 1.5 units; sulfur 0.4-0.8 / 0.8-1.5 / 1.5-2.5 t/ha per unit. No rate for organic soils or pH >= 7.5 (calcareous). Always flagged to need a lab test.
- Advisories: irrigation, pH, sowing shift, drainage (score deltas from `whatIf`), the best-scoring rotation vs current, forecast risks (non-chemical actions), organic matter < 2 %, erosion on slopes >= 8° with < 80 % cover.
- Annual plan: first year of the best-scoring strategy from the current month; costs 30 % before sowing, 50 % in season, 20 % at harvest; revenue at harvest (forage across warm months; perennials at sowing month + cycle).

## 4. Tracking (demo fields only)

Past 5 seasons follow the current rotation or CDL history; yield = reference yield × 0.9 × min(temperature fit, water fit) of that year's real monthly climate × deterministic ±6 % noise. Rain per season is the real climate value. Soil tests (two, simulated) are derived from the soil facts with typical interpretation bands (Mehlich-3 K/Mg, DTPA Cu/Fe/Mn/Zn). NDVI of earlier years is the real current curve scaled by the year's fit. Everything invented is `simulated: true`; alerts are the real insights. A user's parcel gets alerts only.

## 5. Urban

Curated crops with `urban.suitable`; windowsill and balcony require container crops (windowsill excludes climbers, fruit, difficulty 3). Sowing months are those whose first months fit the crop's temperature window >= 0.6 (frost below the kill temperature excluded). Score = temperature fit now/next month and length of season × light match × preference match × difficulty.

## Limits

- Not verified against field data. Thresholds are rules of thumb; z-scores rely on short MODIS baselines.
- Suitability inherits the scorer: the real SSURGO pH 8.8 at the Nevada field makes alfalfa score low although it has grown there since 2019; the report flags the soil test.
- Reference economics dominate the income strategy (e.g. potato in Iowa); markets are not modelled.
- First report call costs 70-150 ms, mostly `whatIf`; repeat calls are memoised.
