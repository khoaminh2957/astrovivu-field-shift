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

Code: `src/core/urban/index.ts`, `calendar.ts`, `climateFit.ts`, `familiarity.ts`, `sun.ts`, `water.ts`, `plan.ts`, `ecocrop.ts`. Data: `data/crops/atlas/crops.csv` (`urban_candidate`), `data/crops/atlas/urban.csv` (container traits), `src/core/crops/curated.generated.ts` (`CURATED_CROPS` and `URBAN_CANDIDATE_CROPS`), and real 3-city climate fixtures in `src/core/urban/__fixtures__/cities.ts`. Reproducible by running `npm run crops:build` and `npx vitest run src/core/urban scripts/crops`.

### 4.1 Candidates (`D1`, #14)

`scripts/crops/atlas/urban-candidates.ts` (`isUrbanCandidate`) flags every species in `data/crops/atlas/crops.csv` (`367` rows) that satisfies all four deterministic rules on FAO EcoCrop attributes:

1. `life_form` is in `{herb, sub-shrub, shrub, climber, vine}` (trees excluded).
2. `category` is in `{vegetables, herbs, spices, ornamentals, cover-crops}` or `category = pulses` when `name_en` names a fresh/pod vegetable (`bean`, `pea`, `cowpea`, `yardlong`, `lablab`, `hyacinth`, `winged`).
3. `cycle_max_d <= 180` days (or `0`/missing when `life_span = annual`).
4. Not an open-field bulk staple (`cereals`, `oilseeds`, `roots-tubers`, `forage`, `industrial`, `trees`, `fruits`).

Result on `data/crops/atlas/crops.csv` (`npm run crops:atlas`): **`130`** crops receive `urban_candidate = yes` (`30` of the 32 hand-curated urban crops in `scripts/crops/overlay-garden.ts` plus `100` uncurated EcoCrop species). Two hand-curated urban crops are intentionally skipped by the general rule because their EcoCrop life-history exceeds annual vegetable limits: dwarf Cavendish banana (`musa-acuminata`, `category = fruits`, `cycle_max_d = 450`) and sweet potato grown for shoots/leaves (`ipomoea-batatas`, `category = roots-tubers`, `cycle_max_d = 180`); both remain in the urban pool via `CURATED_CROPS`. Full criteria and breakdown: `docs/CROP_DATA.md` §11.

### 4.2 Container table (`D2`, #15)

`data/crops/atlas/urban.csv` (`454` rows across `50` crops; parsed by `scripts/crops/urban-table.ts`) records per-attribute container horticulture numbers with mandatory `source`, `url`, `accessed`, and `year` on every row:

- Attributes: `sun_hours_min` (h/day), `pot_depth_min` (cm), `pot_volume_min` (L), `spacing_cm` (cm), `plants_per_pot` (count), `days_to_harvest` (d), `trellis` (`yes`/`no`), `cut_and_come_again` (`yes`/`no`), `yield_g_m2` (g/m²), and `difficulty` (`easy`/`medium`/`hard`, mapped to `1`/`2`/`3`).
- Multi-source conservative resolution (`resolveCrop` in `scripts/crops/urban-table.ts`): when multiple extension publications report different numbers for the same crop and attribute, the build takes `max` for minimum requirements (`sun_hours_min`, `pot_depth_min`, `pot_volume_min`, `spacing_cm`, `days_to_harvest`), `min` for `plants_per_pot` and `yield_g_m2`, and the hardest rating (`hard > medium > easy`) for `difficulty`. Every multi-source resolution is logged in `data/crops/CLEANING_LOG.md`.
- Urban catalogue size (`listUrbanCrops()` in `src/core/crops/index.ts`): **`48`** crops (`32` curated + `16` uncurated `urban_candidate = yes` species that have complete sourced `sun_hours_min`, `pot_depth_min`, and `difficulty` in `data/crops/atlas/urban.csv`). Two `urban_candidate = yes` species (`foeniculum-vulgare`, `nasturtium-officinale`) have partial rows lacking `difficulty` and are excluded by `qualifiesForUrbanCatalog`.
- Sources: Royal Horticultural Society (RHS *Grow Your Own*), Cornell University Cooperative Extension (*Home Gardening*), Texas A&M AgriLife Extension (Pub. E-545 *Vegetable Gardening in Containers*), University of Minnesota Extension (*Growing Vegetables in Containers*), UC ANR (Pub. 8402 *Container Gardening*), Clemson Cooperative Extension (HGIC 1251 *Container Vegetable Gardening*), UF/IFAS Extension, and Viện Nghiên cứu Rau Quả (FAVRI/VAAS). Full schema: `docs/CROP_DATA.md` §14.

### 4.3 Local familiarity (`D3`, #16)

`src/core/urban/familiarity.ts` (`familiarityFactor`, `selectFamiliarity`, `familiarityReason`) multiplies a crop's suitability score by `FAMILIARITY_FACTOR[level]` when an optional `familiarity?: (cropId: string) => UrbanFamiliarity | null` callback is passed to `recommendUrban` or `recommendUrbanAhead`:

- Multipliers (`FAMILIARITY_FACTOR`): `major = 1.25`, `common = 1.18`, `minor = 1.10`, `present = 1.06`, `unknown = 1.00`, `absent = 1.00`.
- Neutral safeguards (`factor = 1.00`):
  - `unknown` or missing (`null`): no statistical record exists for the crop in that country/region; never penalised.
  - `absent`: FAOSTAT QCL omits many tropical leafy vegetables or merges them into aggregate item `463` (*Other vegetables, fresh n.e.c.*, 898,373 ha in Vietnam); `absent` is kept strictly neutral (`1.00`) and never excludes a crop.
  - `shared = true` (`item_shared_by_n_crops > 1` in `data/crops/atlas/crops.csv`, e.g. FAOSTAT item `358` *Cabbages* shared across 6 `Brassica oleracea` varieties including kale `brassica-oleracea-var-acephala`): kept neutral (`1.00`) so a shared commodity total does not falsely boost an unfamiliar variety.
- Region vs country (`selectFamiliarity`): uses the regional MapSPAM 2020 V2r2 level (`data/crops/atlas/region_crops.csv`) only when `spamGroup === 'individual'` and `admin1Name` matches the user's `admin1` (case-insensitive); otherwise falls back to the country level (`data/crops/atlas/crop_country.csv`).
- Before vs after ranking on `HO_CHI_MINH_CITY` (`month = 11`, `prefs = []`, `light = 'full'`, `space = 'rooftop'`):
  - Without `familiarity`: 10+ crops tie at raw score `80` in catalogue declaration order (`fagopyrum-esculentum`, `vigna-radiata`, `helianthus-annuus`, `ipomoea-batatas`, `capsicum-annuum`, `ipomoea-aquatica`, ...).
  - With `familiarity` from `T4 (#9)` (`common` for `ipomoea-aquatica`, `basella-alba`, `ocimum-basilicum`; `minor, shared = true` for `brassica-oleracea-var-acephala`): `ipomoea-aquatica` (`94`), `basella-alba` (`94`), and `ocimum-basilicum` (`94`) move to ranks 1–3 with a bilingual `why` line citing the country and source, while `brassica-oleracea-var-acephala` receives no shared-item boost.

### 4.4 Climate fit (`D4`, #17)

`src/core/urban/climateFit.ts` (`windowFit(crop, climate, start)`) evaluates the container growing window `ms` (`min(windowMonths(crop), 6)` calendar months starting at `start`) and returns `{ fit, mean, cold, heat, photo, limiting }`:

$$\text{fit} = \min(\text{mean},\, \text{cold},\, \text{heat}) \times \text{photo}$$

- `mean`: worst-month `trapezoid(m.tMean, crop.req.tempC)` over `ms`.
- `cold`: worst-month `min(killScore, baseScore)` on `m.tMin`. In `src/data/urban.ts` (`loadUrban`), `tMin` and `tMax` are 10-year ERA5 **monthly means of daily minimum and maximum temperatures**, not absolute monthly extremes; the coldest night of a month is ~`KILL_MARGIN_C = 4 °C` below `tMin` (Ramirez-Villegas et al. 2013, *Agric. For. Meteorol.* 170:67–78). Accordingly, `killScore` is `0.10` when `tMin <= killTempC`, ramps from `0.10` to `0.55` (`< SOW_FIT = 0.60`) across `(killTempC, killTempC + 4 °C]`, and ramps from `0.55` to `1.00` across `(killTempC + 4 °C, killTempC + 6 °C]`. `baseScore` ramps linearly from `0.10` at `tempC[0] - COLD_MARGIN_C` (`4 °C`) to `1.00` at `tempC[0]`.
- `heat`: worst-month daytime heat check on `m.tMax` against `tempC[3]` (`T_absMax`): `1.00` when `tMax <= tempC[3]`, ramping linearly to `0.00` at `tempC[3] + HEAT_MARGIN_C` (`6 °C`).
- `photo`: astronomical day length `dayLengthHours(latDeg, MID_DOY[m - 1])` (FAO-56 Eq. 24, 25, 34) classified into `short` (`< 12` h), `neutral` (`12–14` h), and `long` (`> 14` h). When `crop.req.photoperiod` is empty or lists all 3 classes, `photo = 1`. Otherwise:

$$\text{photo} = \text{PHOTOPERIOD\_MIN} + (1 - \text{PHOTOPERIOD\_MIN}) \times \frac{\text{photoHits}}{|\text{ms}|}, \quad \text{PHOTOPERIOD\_MIN} = 0.70$$

  Because `PHOTOPERIOD_MIN = 0.70 >= SOW_FIT (0.60)`, photoperiod acts as a soft score modifier and never disqualifies a vegetable crop on its own.

### 4.5 Sun hours (`D5`, #18)

`src/core/urban/sun.ts` (`solarPosition`, `sunHours`, `sunHoursByMonth`, `lightClass`) computes clear-sky direct sunlight hours on an oriented balcony wall or open rooftop from Duffie & Beckman (*Solar Engineering of Thermal Processes*, 4th ed., Wiley, 2013, Eq. 1.4.2, 1.6.2, 1.6.3, 1.6.5) and FAO-56 Eq. 24:

- Solar declination: $\delta = 0.409 \sin\!\left(\frac{2\pi \cdot \text{doy}}{365} - 1.39\right)$ rad (FAO-56 Eq. 24).
- Solar altitude $\alpha$: $\sin\alpha = \sin\phi\sin\delta + \cos\phi\cos\delta\cos\omega$ (Duffie & Beckman Eq. 1.6.2), integrated across solar hour angle $\omega \in [-\pi, \pi]$ in `STEP_MINUTES = 5` min (`0.0833` h) steps using `MID_DOY = [16, 45, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350]` (Duffie & Beckman Table 1.6.1).
- Azimuth convention: `0° = North, 90° = East, 180° = South, 270° = West`. A vertical balcony wall with outward normal `facingDeg` receives direct beam radiation during a time step iff:
  1. $\alpha > \max(0^\circ, \text{horizonDeg})$,
  2. $|\Delta\gamma| < 90^\circ$ ($\cos\Delta\gamma > 0$), where $\Delta\gamma = \gamma_{\text{sun}} - \text{facingDeg}$, and
  3. Vertical profile angle $\tan\alpha_p = \tan\alpha / \cos\Delta\gamma < \tan(90^\circ - \text{overhangDeg})$ when `overhangDeg > 0`.
- Light classification (`lightClass`): `full` when `sunHours >= 6` h, `partial` when `3 <= sunHours < 6` h, `shade` when `< 3` h.

| Latitude $\phi$ | Day of year (`doy`) | Open-sky day length (`sunHours`) | Solar noon elevation $\alpha_{\text{noon}}$ | Reference (NOAA / FAO-56 Eq. 34) |
|---|---|---|---|---|
| `0°` (Equator) | `80` (equinox) | `12.00` h | `89.6°` | `12.00` h, `90.0°` |
| `10.78° N` (Ho Chi Minh City) | `172` (Jun solstice) | `12.67` h | `77.3°` | `12.63` h, `77.3°` |
| `10.78° N` (Ho Chi Minh City) | `355` (Dec solstice) | `11.33` h | `55.8°` | `11.37` h, `55.8°` |
| `52.52° N` (Berlin) | `172` (Jun solstice) | `16.50` h | `60.9°` | `16.55` h, `60.9°` |
| `52.52° N` (Berlin) | `355` (Dec solstice) | `7.50` h | `14.0°` | `7.43` h, `14.0°` |

### 4.6 Pot water (`D6`, #19)

`src/core/urban/water.ts` (`canopyFromPot`, `potWater`) estimates daily irrigation volume per container for each calendar month (`1..12`):

$$\text{ET}_c = K_c \times \text{ET}_0 \quad (\text{mm/day}), \qquad \text{litres/day} = \frac{\text{ET}_c \times A_{\text{canopy}}}{\eta}, \quad A_{\text{canopy}} = \pi \left(\frac{D_{\text{cm}}}{200}\right)^2$$

- Range: `litresMin` uses initial-stage $K_{c,\text{ini}}$ (`crop.water.kc.ini`) and `litresMax` uses mid-season $K_{c,\text{mid}}$ (`crop.water.kc.mid`) from `scripts/crops/fao56.ts` (FAO Irrigation and Drainage Paper 56, Table 12).
- $\text{ET}_0$ source (`et0From`): uses ERA5-Land monthly $\text{ET}_0$ (`m.et0Mm / DAYS_IN_MONTH[m - 1]`, Open-Meteo, CC BY 4.0) when `et0Mm` is present on `UrbanClimateMonth`; otherwise falls back to FAO-56 Eq. 52 Hargreaves temperature estimate (`hargreaves(tMean, tMax, tMin, latDeg, MID_DOY[m - 1])` from `src/core/scoring/index.ts`).
- Proxy $K_c$ count (`water-model-assumed`): of the `48` urban crops in `listUrbanCrops()`, `12` have an exact species row in FAO-56 Table 12 (`lycopersicon-esculentum`, `capsicum-annuum`, `solanum-melongena`, `lactuca-sativa-var-capitata`, `cucumis-sativus`, `raphanus-sativus`, `fragaria-x-ananassa`, `mentha-spicata-var-crispa`, `allium-fistulosum`, `musa-acuminata`, `ipomoea-batatas`, `pisum-sativum` / `phaseolus-vulgaris` / `helianthus-annuus` / `spinacia-oleracea` / `daucus-carota` / `raphanus-sativus-var-radicula` / `brassica-oleracea-*`) and **`36`** (`27` of the 32 curated urban crops + `9` of the 16 atlas candidates) borrow a proxy row or group default from `scripts/crops/fao56.ts` and carry the flag `water-model-assumed`, which `waterBasis` discloses in both English and Vietnamese.
- Container vs field $K_c$ caveat: FAO-56 $K_c$ values were calibrated on closed field canopies; isolated pots on sunny, windy balconies experience extra lateral advection and pot-wall heating, while sheltered/shaded balconies transpire less. Rainfall is not subtracted because balconies are often roofed.

### 4.7 Balcony plan (`D7`, #20)

`src/core/urban/plan.ts` (`planBalcony`, `plantCanopyM2`) turns a balcony area (`areaM2`), a starting date (`start: ISODate`), and an ordered list of `cropIds` into a printable `UrbanPlan`:

1. **Equal area division (design convention):** If $N$ selected crops have valid `spacingCm` in `data/crops/atlas/urban.csv` and at least one month in the horizon with $\text{sowFit} \ge \text{MARGINAL\_FIT}$ (`0.30`), each crop receives $A_{\text{share}} = \text{areaM2} / N$. A single plant occupies $A_{\text{plant}} = (\text{spacingCm} / 100)^2\;\text{m}^2$, yielding:

   $$\text{plants}_i = \left\lfloor \frac{A_{\text{share}}}{A_{\text{plant},i}} \right\rfloor, \qquad \text{areaM2}_i = \text{plants}_i \times A_{\text{plant},i}, \qquad \text{usedM2} = \sum_{i=1}^{N} \text{areaM2}_i \le \text{areaM2}$$

   Crops without sourced `spacingCm` (or with $\text{plants}_i < 1$) are placed in `unplaced` with a bilingual reason and never guessed.
2. **Succession batches (`harvestType === 'once'`):** Single-harvest crops with $\text{plants}_i \ge 2$ are split into $B = \min(\text{plants}_i, \text{MAX\_SUCCESSION\_BATCHES})$ (`MAX_SUCCESSION_BATCHES = 3`) batches separated by $\Delta d = \max(\text{MIN\_BATCH\_INTERVAL\_DAYS}, \text{round}(d_{\text{min}} / B))$ days (`MIN_BATCH_INTERVAL_DAYS = 7`), where $[d_{\text{min}}, d_{\text{max}}]$ is `firstHarvestDays` (or `cycleDays`). All batches must fall in months with $\text{sowFit} \ge \text{SOW\_FIT}$ (`0.60`), or $\ge \text{MARGINAL\_FIT}$ (`0.30`, flagged `marginal: true`) if no all-good window exists. Cut-and-come-again and repeated-fruit crops are sown in a single batch (`B = 1`).
3. **Worked example (hand calculation):**
   - Inputs: `areaM2 = 2.00 m²`, `start = '2026-11-01'`, `cropIds = ['ipomoea-aquatica', 'raphanus-sativus']` in Ho Chi Minh City (`HO_CHI_MINH_CITY`).
   - Equal share: $N = 2 \Rightarrow A_{\text{share}} = 2.00 / 2 = 1.00\;\text{m}^2$ per crop.
   - `ipomoea-aquatica` (`spacingCm = 15` cm, `harvestType = 'cut-and-come-again'`, `firstHarvestDays = [30, 45]`): $A_{\text{plant}} = 0.15^2 = 0.0225\;\text{m}^2 \Rightarrow \text{plants} = \lfloor 1.00 / 0.0225 \rfloor = 44$ plants, $\text{areaM2}_1 = 44 \times 0.0225 = 0.99\;\text{m}^2$, 1 batch of 44 plants sown `2026-11-01`, `firstHarvest = '2026-12-01'`.
   - `raphanus-sativus` (`spacingCm = 15` cm, `harvestType = 'once'`, `firstHarvestDays = [45, 45]`): $A_{\text{plant}} = 0.0225\;\text{m}^2 \Rightarrow \text{plants} = 44$ plants, $\text{areaM2}_2 = 0.99\;\text{m}^2$, $B = 3$ batches of `15, 15, 14` plants spaced by $\Delta d = \text{round}(45 / 3) = 15$ days (`2026-11-01`, `2026-11-16`, `2026-12-01`) with `firstHarvest` on `2026-12-16`, `2026-12-31`, `2027-01-15` (15 days apart).
   - Total `usedM2 = 0.99 + 0.99 = 1.98 m² <= 2.00 m²` (`0.02 m²` remainder noted in `notes`).

### 4.8 Constants

Every numeric constant in `src/core/urban/*.ts` and its basis:

| Constant | Value | File | Basis / Source |
|---|---|---|---|
| `SOW_FIT` | `0.60` | `src/core/urban/calendar.ts` | Aligns with the field suitability threshold (`>= 0.60` good window in `docs/SCORING.md` §6); verified across 32 crops in `HO_CHI_MINH_CITY`, `BERLIN`, `PHOENIX` (`src/core/urban/urban.test.ts`). |
| `MARGINAL_FIT` | `0.30` | `src/core/urban/calendar.ts` | Lower bound for marginal container sowing (protected microclimate on balconies); verified in `sowLevels` (`src/core/urban/urban.test.ts`). |
| `KILL_MARGIN_C` | `4` °C | `src/core/urban/climateFit.ts` | Ramirez-Villegas et al. (2013, *Agric. For. Meteorol.* 170:67–78): coldest night of a month lies ~4 °C below the monthly mean daily minimum `tMin`. |
| `COLD_MARGIN_C` | `4` °C | `src/core/urban/climateFit.ts` | Linear chilling buffer below EcoCrop `tempC[0]` (`T_absMin`) on monthly mean daily minimum `tMin`; calibrated on Berlin spring/autumn windows (`D4`, #17). |
| `HEAT_MARGIN_C` | `6` °C | `src/core/urban/climateFit.ts` | Linear heat-stress ramp above EcoCrop `tempC[3]` (`T_absMax`) on monthly mean daily maximum `tMax`; blocks cool-season crops in Phoenix May–Sep and HCMC Mar–Apr (`D4`, #17). |
| `PHOTOPERIOD_MIN` | `0.70` | `src/core/urban/climateFit.ts` | Matches `GATE.photoperiodMin = 0.70` in `src/core/scoring/index.ts`; soft floor so photoperiod never eliminates a leafy/vegetable crop on its own (`D4`, #17). |
| Photoperiod class cutoffs | `12` h, `14` h | `src/core/urban/climateFit.ts` | FAO EcoCrop day-length definitions (`short` < 12 h, `neutral` 12–14 h, `long` > 14 h), matching `src/core/scoring/index.ts`. |
| Window cap | `6` months | `src/core/urban/climateFit.ts` | `Math.min(windowMonths(c), 6)`: caps long-cycle perennials at a 6-month establishment window for container sowing. |
| `FAMILIARITY_FACTOR` | `1.25 / 1.18 / 1.10 / 1.06 / 1 / 1` | `src/core/urban/familiarity.ts` | Calibrated on `HO_CHI_MINH_CITY` and `BERLIN` (`D3`, #16) so familiar easy crops (`ipomoea-aquatica`, `basella-alba`, `ocimum-basilicum`) outrank unfamiliar crops of equal climate fit without overriding a light Deficit (`0.5`). |
| `MID_DOY` | `[16, 45, ..., 350]` | `src/core/urban/sun.ts` | Duffie & Beckman (2013, Table 1.6.1) recommended average day of each month; identical to `MID_DOY` in `src/core/scoring/index.ts`. |
| `STEP_MINUTES` | `5` min | `src/core/urban/sun.ts` | Numerical integration step (`1/12` h); matches analytical equinox/solstice day length to within `<= 0.08` h (`src/core/urban/sun.test.ts`). |
| `lightClass` thresholds | `6` h (`full`), `3` h (`partial`) | `src/core/urban/sun.ts` | Standard extension sun-hour classes: Full sun >= 6 h, Partial sun/shade 3–6 h, Shade < 3 h (Cornell / UMN / UC ANR container guides, `D2` #15). |
| `DEFAULT_EFFICIENCY` | `0.85` | `src/core/urban/water.ts` | Container hand-watering application efficiency allowing a 15 % leaching/drainage fraction (FAO-56 / UC ANR container irrigation practice, `D6` #19). |
| `DAYS_IN_MONTH` | `[31, 28, ..., 31]` | `src/core/urban/water.ts` | Standard non-leap calendar month lengths used to convert monthly ERA5 `et0Mm` to mm/day; matches `src/core/scoring/index.ts`. |
| `MAX_SUCCESSION_BATCHES` | `3` | `src/core/urban/plan.ts` | Design convention (`D7`, #20): caps balcony succession sowings per single-harvest crop at 3 batches so batch sizes stay practical. |
| `MIN_BATCH_INTERVAL_DAYS` | `7` d | `src/core/urban/plan.ts` | Design convention (`D7`, #20): minimum 1-week spacing between successive sowings of a `once` crop. |
| Season weights (`soon` vs `sowMonths`) | `0.45`, `0.15` (sum `0.60`) | `src/core/urban/index.ts` | Rule of thumb, not sourced: weights immediate sowing suitability (`0.45 / 0.60 = 75 %`) three times higher than year-round season length (`0.15 / 0.60 = 25 %`). |
| Next-month discount | `0.85` | `src/core/urban/index.ts` | Rule of thumb, not sourced: `soon = Math.max(fits[now - 1], 0.85 * fits[next])` allows a crop whose window opens next month to appear with a 15 % discount. |
| `light` mismatch multipliers | `1.0`, `0.5`, `0.1` | `src/core/urban/index.ts` | Rule of thumb, not sourced: `1.0` when site light meets/exceeds crop need, `0.5` for a 1-class deficit (e.g. `partial` for a `full`-sun crop), `0.1` for a 2-class deficit (`shade` for a `full`-sun crop, dropping score `< 20`). |
| `pref` multipliers | `1.0`, `0.55`, `0.8` | `src/core/urban/index.ts` | Rule of thumb, not sourced: `1.0` when matching a selected preference tag, `0.55` when non-matching, `0.8` when the user selected no preferences (`prefs = []`). |
| `lowLight` PAR threshold & factor | `par < 6` MJ/m²/d → `0.8` | `src/core/urban/index.ts` | Rule of thumb, not sourced: 20 % penalty for `full`-sun crops during dark high-latitude winter/autumn months (`PAR < 6` MJ/m²/day from NASA POWER). |
| Difficulty penalty | `0.06` per step | `src/core/urban/index.ts` | Rule of thumb, not sourced: `1 - 0.06 * (difficulty - 1)` gives `1.00` for easy (`1`), `0.94` for medium (`2`), and `0.88` for hard (`3`). |
| Minimum score & top-N cap | `20` min score, `10` picks | `src/core/urban/index.ts` | Rule of thumb, not sourced: filters out unsuitable crops (`score < 20`, including 2-step light deficits) and caps recommendations at 10 cards. |
| Hot-weather watering note cutoff | `tMax >= 32` °C | `src/core/urban/index.ts` | Rule of thumb, not sourced: adds "twice on the hottest days" to the qualitative watering text for `high` water-use crops when the hottest month's mean daily max reaches 32 °C. |

### 4.9 Urban limits

- **Clear-sky sun geometry (`sun.ts`):** `sunHoursByMonth` computes astronomical direct-beam sun hours on an oriented wall under clear skies; cloud cover is not subtracted (`PAR` from NASA POWER reflects cloudiness separately).
- **Container water estimate (`water.ts`):** `potWater` applies FAO-56 field crop coefficients ($K_{c,\text{ini}}$, $K_{c,\text{mid}}$) to container surface area, uses proxy $K_c$ (`water-model-assumed`) for `36` of the `48` urban crops that FAO-56 Table 12 does not list individually, and does not subtract rainfall.
- **Incomplete species-level vegetable statistics (`familiarity.ts`):** National statistical yearbooks (Vietnam GSO, FAOSTAT QCL) report most culinary herbs and leafy greens in aggregate vegetable categories rather than by species, leaving those rows `unknown` (neutral `1.00`) until a primary survey is published.
- **Relative humidity (`rh`) not scored (`climateFit.ts`):** `UrbanClimateMonth.rh` is fetched from NASA POWER, but neither FAO EcoCrop nor `data/crops/atlas/columns.csv` provides crop relative-humidity thresholds, so `rh` is not used in `windowFit`.
- **UI integration status:** Pure core modules (`D1`–`D7`) are complete and tested in `src/core/urban/`; wiring `countryCode`/`admin1` from `reverseGeocode` into `UrbanSite.place`, the interactive balcony area input, and `@media print` A4 styling in `src/ui/urban/` belong to the UI track (`B1 #55` / `D3` / `D7` UI).

## Limits

- Not verified against field data. Thresholds are rules of thumb; z-scores rely on short MODIS baselines.
- Suitability inherits the scorer: the real SSURGO pH 8.8 at the Nevada field makes alfalfa score low although it has grown there since 2019; the report flags the soil test.
- Reference economics dominate the income strategy (e.g. potato in Iowa); markets are not modelled.
- First report call costs 70-150 ms, mostly `whatIf`; repeat calls are memoised.
