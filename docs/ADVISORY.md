# Advisory engine (Tier 5, rule-based core)

Code: `src/core/advisory` (insights, rotations, custom season swaps, actions), `src/core/urban`. All functions are pure functions of `ModelInput`. `buildAdvisoryReport` and the rotation search are memoised on the telemetry object plus the value of crop, ground truth, priorities, parcel and date. Tests: `src/core/advisory/advisory.test.ts`, `seasonDetail.test.ts` and `customRotation.test.ts` load the four real demo samples.

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

Current strategy: `groundTruth.currentRotation` (entries whose months overlap an earlier entry become later years, e.g. corn then soybean; entries with the same `season` number grow side by side in that season, each on `share` of the area, by default split equally, the second and later ones labelled as companion crops), else the last two years of `cropHistory` (CDL names mapped to catalogue ids), else the selected crop repeated in back-to-back windows that score >= 60 (flagged as assumed in the gaps). The farmer enters the rotation as seasons in the Soil and practice tab (`src/ui/field/SeasonPlanner.tsx`): each season has months, one or more crops and an optional sowing date; the first crop of the season running today becomes the field's crop and that season's sowing date becomes `groundTruth.sowingDate`.

Fit per crop and sowing month comes from `scanSowingWindows` with the effective irrigation (the farmer's entry; else full irrigation is inferred when normal rain < 350 mm and the field is cropped, and said so). Annual systems fill free months greedily (cash crops need fit >= 55, covers >= 35, no pest group back to back):

- soil-health: main crop + legumes/covers; a legume year when the main crop fixes no N.
- water-saver: crop with the best fit per mm of ETc, at most one more low/medium water crop; the other months stay fallow (not necessarily the driest ones, and the text no longer says so).
- income: highest reference margin per season, then best-paying fillers.
- resilience: up to three years and three families, weighted by reliability.

Perennials are not rotated yearly. Tree crops get an inter-row N-fixing cover (~25 % area), a companion tree (~20 %), a partial conversion (~30 %) to a lower-water crop, or a mix. Stands (forage, sugarcane) are renewed after 4 years with break crops (paddy rice excluded); when no break crop from another family reaches a fit of 20 (Nevada demo field at SSURGO pH 8.8), `soil-health` renews after 4 stand years with 1 fallow rest year and `resilience` after 3 stand years with 2 rest years, and the strategy text says so. If fewer than two alternatives survive deduplication, the fallback fills only free months in year 0 or appends a rest year rather than overlapping a full-area season. Fractional area shares are stored in `RotationSeason.share` (with `slotRole`) and written in the season label.

Metrics: suitability = month- and area-weighted fit; water use = Σ mean Kc (FAO-56 stage-weighted) × normal monthly ET0 per year; water fit = min(1, (0.8 × rain + irrigation supply) / ETc); N = indicative credit 40 (grain legume), 90 (cover legume), 150 (forage legume) kg/ha per season × area share; ground cover = covered months; pest break = 1 for a different family, 0.5 same family other pest group, 0 same pest group, over consecutive seasons (perennial mixes capped at 60); soil health = 30 cover + 20 N + 20 residue + 15 family diversity + 15 cover/perennial; risk = 50 (1 - reliability) + 25 / families + 25 (1 - water fit). Economics: `seasonEconomics` with yield fraction = fit at the sowing month and reference values, `strategyEconomics` over the rotation years. Score: each priority metric normalised 0..1 (margin and cost min-max across the strategies), weight 0.5 + 3/2/1 for the first/second/third priority.

The five lists are generated from the field: evidence cites the climate source, soil source, CDL history and reference economics (with `EvidenceItem.value` and `ActionStep.amount` localised in both English and Vietnamese); gaps name the missing soil test, coarse climate pixel, reference prices, a margin range that has zero inside it (`docs/ECONOMICS.md`, section 6), crops of which no statistic says whether the country grows them, irrigation assumptions, assumed rotation, perennial establishment, cover-crop literature values; risks name market and seed checks, upland crops after paddy, cover-crop timing, frost calendars, limiting soil chemistry, intercropping, monoculture, low suitability, and always local extension review.

### Custom season swaps (`src/core/advisory/customRotation.ts`)

Clicking a season block (crop or fallow) on the selected strategy lets the farmer test another crop in that slot without altering the baseline `current` strategy:

- With a country table (`ModelInput.country`), the builder proposes no crop the country's statistics report none of, and every choice of `slotCropChoices` carries the country's level (`SlotCropChoice.prevalence`); such a crop is offered last, from a suitability of 60, and a rotation the grower puts it into gets the risk line "New crop, needs a trial". Rules and limits: `docs/SCORING.md`, section 12.5.
- `slotCropChoices(input, strategy, seasonIndex)` finds the contiguous free calendar months around a full-area slot (merging adjacent fallow months, excluding paddy rice on upland forage stands) or the valid crop pool for a fractional tree/cover slot (`share < 1`), scores every curated crop that fits the window, and offers `'fallow'` when at least one other crop season remains.
- `swapRotationSeason` and `evaluateCustomRotation` build a `Candidate` with `kind: 'custom'` (`id: 'custom'`) and run the same `evaluate` and `scoreAll` pipeline alongside the engine strategies so metrics, priority scores, trade-offs, the five lists and `annualPlan(input, custom)` stay consistent.

### Per-season detail

Every season of every strategy (the current one included) carries `detail`, filled in `src/core/advisory/seasonDetail.ts` from the numbers `evaluate` already uses for the strategy metrics. Months no crop covers in a rotation year are emitted as extra seasons with `cropId: 'fallow'`, one per run of bare months, after the crop seasons; they are the months the ground-cover metric counts as bare. Every season has `year` (0-based) and the full crop name as `label` (area shares and "cover crop" / "break crop" are appended in brackets).

| Field | What it is | How it is computed | Left undefined when |
|---|---|---|---|
| `role` | what the season is there for | `fallow` for a bare run; `cover` for a catalogue cover crop (inter-row covers included); `perennial` for any non-annual crop; `legume` for an annual N-fixing crop the soil-health rules placed for its nitrogen (the legume year, and legumes picked by the soil chooser); `cash` otherwise, so soybean in the current practice or in the income strategy is `cash` | never |
| `suitability` | 0..100 fit | the scorer's fit at the sowing month (`scanSowingWindows`); for a perennial the best month's fit. Same value the strategy suitability is averaged from | fallow; the scorer returned no windows |
| `metInYears` | years the crop's needs were met | `round(reliability × years in climateHistory)` of `years`, the same arithmetic as the evidence line. Reliability is stored to two decimals, so `met` is approximate | fallow; no reliability or no climate history |
| `waterNeedMm` | crop water need over the season | mean Kc (FAO-56 stage-weighted) × normal ET0 of the season's months, rounded | fallow; a month has no ET0 normal; the crop has no Kc curve (the strategy metric then uses an assumed value, the detail shows none) |
| `rainMm` | normal rain over the season | sum of `monthlyNormals(climateHistory).rainMm` over the months, wrapping over December, rounded to 1 mm. Total rain, not the 0.8 effective share used in water fit | a month has no rain normal |
| `yieldTHa` | expected yield | `SeasonEconomics.yield.expectedTHa` of the same season | no economics; a cover crop with a reference yield of 0 |
| `marginUsdPerHa` | margin of the season | `marginUsd / areaHa` of the same `economics.seasons` entry, rounded. A cover crop with a seed cost shows a negative margin | no reference economics |
| `nitrogenKgHa` | indicative N credit | the per-season credit of the metrics (40 / 90 / 150 kg N/ha) for any N-fixing crop, whatever its role | the crop fixes no nitrogen |
| `reason` | one sentence, EN and VI | built from the fields above, wording by role (below) | never |

Units are per hectare of the area the crop occupies. For a full-area strategy the seasons add up to the metrics: length-weighted suitability and summed nitrogen match exactly, water need and margin to within rounding (half a unit per season). For a tree-crop mix (`RotationSeason.share < 1`, also written in the label as "~N % of area") each figure must be weighted by that share first.

Reason wording. Cash: "sits inside the rains" when season rain >= water need; otherwise rain against need, and where the rest comes from (irrigation, supplemental irrigation plus stored soil water, or stored soil water when rainfed); "best-fitting month" only when the sowing month is the crop's best one. Legume: the N credit and the next harvested crop in the sequence (covers skipped). Cover: "through the wet months" when the season's rain per month is above the annual monthly mean, else "between cash crops"; an inter-row cover names the host crop and its share. Perennial: annual rain against annual use, plus the months whose normal rain is below Kc × ET0. Fallow: a whole bare year is called a rest year; a run with a monthly mean temperature below 5 °C is called the cold season and quotes that temperature; otherwise rain against what the year's longest full-area crop would use over those months (Kc × ET0), called the dry season when rain per month is under half the annual monthly mean; with rain above that use only the rain is stated. A fallow season carries `role`, `rainMm` and `reason` only.

Limits: normals hide year-to-year spread (the calendar's rain strip shows the 10th and 90th percentile, the sentence does not); mean Kc spreads the season's demand evenly over its months, so the "dry months" of a perennial are indicative; seasons are placed on calendar months of one cyclic year, so a season sown late in a rotation year is drawn wrapping into January of the same year; the 5 °C and half-of-average thresholds only choose words, they do not change any number.

## 3. Actions

- Irrigation: FAO-56 single-layer root-zone balance over the telemetry year and the forecast. TAW = 1000 × AWC × Zr (AWC from SSURGO or by texture 0.09-0.20), RAW = p × TAW, effective rain 0.8 × rain on days >= 2 mm, irrigate the net depletion when Dr > RAW. Kc from the modelled stage; tree crops keep Kc end between cycles; dormant = 0. Rice uses AWD wording. Savings against a calendar schedule of RAW every round(RAW / (Kc mid × mean ET0)) days, applied only in dry weeks.
- pH: target = optimum edge ± 0.3. Lime per pH unit: light 1.5-3, medium 3-5, heavy 5-8 t/ha CaCO3 eq. (typical extension liming tables, top ~20 cm), max 1.5 units; sulfur 0.4-0.8 / 0.8-1.5 / 1.5-2.5 t/ha per unit. No rate for organic soils or pH >= 7.5 (calcareous). Always flagged to need a lab test.
- Advisories: irrigation, pH, sowing shift, drainage (score deltas from `whatIf`), the best-scoring rotation vs current, forecast risks (non-chemical actions), organic matter < 2 %, erosion on slopes >= 8° with < 80 % cover.
- Second opinion: `AdvisoryReport.cropSuite` carries the CropSuite result for the selected crop (`assessCropSuite`, docs/SCORING.md section 9), shown under the sowing window. It is informative only: no advisory, score or ranking is derived from it.
- Annual plan: first year of the best-scoring strategy from the current month; costs 30 % before sowing, 50 % in season, 20 % at harvest; revenue at harvest (forage across warm months; perennials at sowing month + cycle).

## 4. Urban

Curated crops with `urban.suitable`; windowsill and balcony require container crops (windowsill excludes climbers, fruit, difficulty 3). Sowing months are those whose first months fit the crop's temperature window >= 0.6 (frost below the kill temperature excluded). Score = temperature fit now/next month and length of season × light match × preference match × difficulty.

Each pick carries `care.sowFit`, the temperature fit of sowing in each month (0 to 1). Months at 0.6 or more are sowing months; 0.3 to 0.6 are drawn as marginal (possible, slower growth). When no crop scores 20 or more this month, `recommendUrbanAhead` returns the picks of the first later month in which one of them can be sown, scored for that month; the screen says which month and that scores apply then. Photographs come from FAO EcoCrop (see DATA_SOURCES.md) and are not part of the recommendation.

## Limits

- Not verified against field data. Thresholds are rules of thumb; z-scores rely on short MODIS baselines.
- Suitability inherits the scorer: the real SSURGO pH 8.8 at the Nevada field makes alfalfa score low although it has grown there since 2019; the report flags the soil test.
- Reference economics dominate the income strategy (e.g. potato in Iowa); markets are not modelled.
- First report call costs 70-150 ms, mostly `whatIf`; repeat calls are memoised.
