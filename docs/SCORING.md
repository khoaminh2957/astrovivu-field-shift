# Productivity scoring (Astrovivu-AEZ v2)

Code: `src/core/scoring/index.ts` and `src/core/scoring/literature.ts` (pure TypeScript). Crop data: `src/core/crops`, built by `npm run crops:build`. Unit tests: `src/core/scoring/scoring.test.ts` and `src/core/scoring/literature.test.ts`. Full mathematical derivations, 20-paper literature review, formal proofs, and empirical/sensitivity benchmarks: `docs/SCORING_PAPER.md` (reproducible via `npx tsx scripts/crops/evaluate-scoring-paper.ts` -> `data/crops/scoring-paper-results.json`). A second suitability method, CropSuite (Zabel et al. 2025), lives in `src/core/scoring/cropsuite.ts`; section 9 describes it and its comparison with v2.

## 1. What is computed

| Output | Meaning |
|---|---|
| compatibility (0-100) | How well the crop fits the site in a normal year: growing-window climate, continuous soil chemistry/fertility, physical soil, terrain, and survival gates |
| condition(t) (0-100) | How the season is going on day t: dynamic root-zone water & aeration, asymmetric heat and cold, PAR radiation, and 4-stream satellite anomalies |
| productivity(t) | compatibility x condition(t) / 100 (or compatibility during off-season / winter dormancy). Without a crop: generic growing-condition index |
| reliability | Share of analysed historical years (20-year ERA5) in which the growing window met temperature, water, and survival thresholds |
| seasonalGdd | Growing Degree Days (°C·d above `tempC[0]`) accumulated over the active growing window |
| expected yield fraction | Stage-weighted seasonal water-and-aeration outcome combined with non-water compatibility, input to `src/core/economics` |

## 2. Crop catalogue

`data/ecocrop/ecocrop_2568_plants.csv` (FAO EcoCrop) is cleaned by `scripts/crops/parse.ts`; every repair is listed in `data/crops/CLEANING_LOG.md`. Of 2,568 rows, 501 have no temperature or rainfall window and cannot be scored, 5 repeat another row of the same species and are merged, and 2,062 EcoCrop species remain (2,063 total with `tagetes-erecta`). 47 repairs fix wrong-scale values, swapped absolute/optimal limits, latitudes above 90, and missing cycle lengths (flag `cycle-assumed`).

73 crops are curated (`scripts/crops/overlay-*.ts`): English and Vietnamese names, FAO-56 water model, rotation and urban traits, and reference economics. Every threshold differing from EcoCrop is logged with its source in `data/crops/CLEANING_LOG.md`.

## 3. Compatibility

**Growing window.** `N = clamp(round(meanCycleDays / 30.4), 1, 12)` months (Hijmans; Ramirez-Villegas et al. 2013). All 12 sowing months are scored; the farmer's sowing date selects one, otherwise the best month is chosen (breaking ties by 20-year reliability).

**Graded factors and Saaty AHP exponents.** Pairwise judgements across four agro-ecological criticality tiers (`AHP_PAIRWISE_MATRIX` in `src/core/scoring/literature.ts`, synthesized from Akıncı et al. 2013, Herzberg et al. 2019, Pilevar et al. 2020) are solved by power iteration (`solveAhpMatrix`): `lambda_max = 9.034306`, `CI = 0.004288`, `CR = 0.002957` (`0.30 % << 10 %`). Exponents are `alpha_i = w_i / max(w_j)` so primary climate acts at 1.0:

| Factor | Kind | Response function | AHP weight `w_i` | Exponent `alpha_i` |
|---|---|---|---|---|
| temperature | fixed | EcoCrop trapezoid on each month's mean T in the window; worst month counts | 0.2251 | 1.000 |
| water | manageable | EcoCrop trapezoid on season water supply (window rain + fallow storage + irrigation) | 0.2251 | 1.000 |
| pH | manageable | EcoCrop trapezoid on soil pH | 0.1175 | 0.522 |
| salinity (EC) | manageable | Continuous Maas & Hoffman (1977) threshold-slope `1 - b(ECe - a)` (`a = 1.3 / 2.0 / 4.5 / 8.0 dS/m`, floor 0.10) | 0.1175 | 0.522 |
| drainage | manageable | Sys et al. (1991) class scores: optimal 1.0, tolerated 0.70, outside 0.15 | 0.1175 | 0.522 |
| texture | fixed | Sys et al. (1991) class scores: 1.0 / 0.70 / 0.15 | 0.0538 | 0.239 |
| soil depth | fixed | Ranked depth class (`<20`, `20-50`, `50-150`, `>150 cm`): 1.0 / 0.70 / 0.15 | 0.0538 | 0.239 |
| fertility | manageable | Continuous Oldfield et al. (2019) & Sanchez et al. (2003) Michaelis-Menten SOC & CEC index (plateau at 20 g/kg SOC and 20 cmol(+)/kg CEC, `Km = 8`), mapped to `[0.20, 1.0]` | 0.0448 | 0.199 |
| slope | fixed | FAO GAEZ v4 ramp: 1.0 up to 4.6° (annuals) or 9.0° (perennials), linear to 0.15 at 16.7° / 24.0° | 0.0448 | 0.199 |

**Water supply.** Rain summed over the N-month growing window plus, for annuals, fallow root-zone storage over the 6 months before sowing: `S = clamp(S + Peff - 0.4 ET0, 0, TAW)` month by month (`Peff` = USDA-SCS effective rainfall, `TAW = 1000 x AWC x Zr,max`). EcoCrop annual rainfall thresholds apply directly for `N >= 4` months and scale by `N / 4` for shorter cycles. Irrigation removes deficits only: `full` sets deficit-side water score to 1, `supplemental` adds up to 30 % of optimal season water. Excess rain is never removed.

**Hybrid Liebig-Khiddir rank-damped combination (`aggregateSuitability`, `'astrovivu-v2'`).**
- Primary climate factors (`temperature`, `water`) multiply at full strength: `s_temp^1 * s_water^1` (Ramirez-Villegas et al. 2013).
- Observed edaphic/terrain contributions `c_i = s_i ^ alpha_i` are sorted ascending `c_(1) <= c_(2) <= ... <= c_(m)` and combined with Khiddir (1986) / GAEZ v4 harmonic-root rank damping: `product_{r=1..m} c_(r) ^ (1 / sqrt(r))`.
- Any single edaphic limitation acts at its exact AHP exponent (`r = 1`), any zero gives zero (Theorem 1), ties swap continuously without jumps (Theorem 3), and multiple moderate soil sub-optima do not suffer Storie multiplicative collapse (Theorem 4). Missing data (`score: null`) are skipped, never zeroed. Weighted Linear Combination (`wlc`) was tested and rejected (`20 %` false-positive rate at `S >= 60` on the 56-case parcel benchmark).

**Bioclimatic & geographical gates** (non-compensatory multipliers; trigger `needsLocalReview` when `< 1` on zone/photo/lat/alt):

| Gate | Rule | Value |
|---|---|---|
| killing temperature (`frost` / `winterSurvival`) | Any window month with mean daily min `< Tkill + 4 °C` (and rest months `< TkillRest + 4 °C` for perennials) | 0 |
| active season (`activeSeason`) | Dormant perennials: `min(1, activeMonths / windowMonths)` where `Tmean > tempC[0]` | `0..1` |
| climate zone (`climateZone`) | Site's Köppen-Trewartha code (Belda et al. 2014) not in crop's list | 0.5 curated, 0.7 raw EcoCrop |
| photoperiod (`photoperiod`) | Share `f` of window months matching crop's day-length class (`<12 h`, `12-14 h`, `>14 h`) | `0.7 + 0.3 f` |
| latitude / altitude | Beyond EcoCrop latitude by `> 3°` / above `110 %` of maximum altitude | 0.7 / 0.8 |

**Reliability.** Each year of `climateHistory` is scored with its own monthly sequence; a year counts as meeting the crop's needs when `min(temperature, water, kill, restKill) >= 0.5`.

## 4. Condition and productivity

Daily two-pass FAO-56 root-zone balance (eq. 82-86) extended with dynamic root expansion, climatic `Kc` adjustment, and root-zone aeration stress:

1. **Dynamic root depth (Borg & Grimes 1986, eq. 3):** Annual crops expand sigmoidally from `Zr,min = min(0.15 m, Zr,max)` at sowing to `Zr,max` at the end of vegetative development (`ini + dev` stages); established perennials keep `Zr,max` year-round. `TAW(t) = 1000 x AWC x Zr(t)`.
2. **Climatic `Kc` adjustment (FAO-56 eq. 11, 19, 62, 65):** `RH_min` is estimated from daily `RH_mean`, `T_min`, and `T_max` via saturation vapour pressure; 7-day trailing wind speed `u2` and `RH_min` adjust `Kc,mid` and `Kc,end` when `Kc_tab >= 0.45`: `Kc = Kc_tab + [0.04(u2 - 2) - 0.004(RH_min - 45)](h / 3)^0.3`.
3. **Water depletion & Feddes/AquaCrop anaerobiosis (`Kaer`):** Rain `< 0.2 ET0` evaporates; surface runoff uses USDA-SCS Curve Numbers (67 light, 78 medium, 85 heavy). Water exceeding field capacity enters a saturation-excess reservoir drained at `P_perc` (`3.5-5.5 mm/d` poor drainage, `14-28 mm/d` well drained, `35 mm/d` excessive). Hydrophytic crops (`oryza-sativa`, `ipomoea-aquatica`, `sesbania-rostrata`, or `drainage.opt` containing `'poor'`) have `Kaer = 1`; upland crops decline linearly to `0.30` once saturation surplus exceeds 25 % of drainable macro-porosity (`80 x Zr mm`).
4. **Thermal, radiation, and 4-stream EO assimilation:**
   ```
   water(t)    = 1 - Ky x s(stage) x (1 - Ks(t) x Kaer(t))     s = 0.4 ini, 0.7 dev, 1.0 mid, 0.4 late
   heat(t)     = min(trapezoid_high(T7d), Tmax_3d reproductive shock)   (Schlenker & Roberts 2009; Sánchez et al. 2014)
   cold(t)     = trapezoid_low(T7d), capped at 0.1 on frost night <= Tkill
   rad(t)      = Michaelis-Menten PAR7d sufficiency (saturates at 8.0 MJ/m²/d C4, 6.2 C3; exponent 0.35)
   model(t)    = water(t) x min(heat(t), cold(t)) x rad(t)^0.35
   observed(t) = weighted anomaly fusion over available EO streams:
                 0.42 NDVI + 0.24 ESI + 0.20 SM_root + 0.14 LST_day   (renormalized over non-null streams)
   condition   = 0.70 model + 0.30 observed   (or either alone when the other is unavailable)
   productivity(t) = compatibility x condition   (compatibility during off-season / dormancy)
   expected yield fraction = (compatibility / water_static) x min(water_static, 1 - Ky (1 - ET_ratio))
   ```
   where `ET_ratio` blends seasonal `ETa / ETc` (0.5) and stage-sensitivity-weighted `sum(s ETa) / sum(s ETc)` (0.5; Jensen 1968; Steduto et al. 2012). All coarse EO streams (`NDVI`, `ESI`, `SM_root`, `LST_day`) enter strictly as pixel-climatology anomalies (ARCHITECTURE §4.1 rule S3). Farmer `measuredRain` and `measuredSoilMoisture` bias-scale satellite rainfall and root-zone moisture on shared dates, and every ground-truth override records its counterfactual `scoreEffect` in the calibration ledger.

## 5. Reproduce a score by hand: robusta, Đắk Lắk, rainfed

On the cached Đắk Lắk basalt parcel (`public/data/samples/daklak-coffee.json`), Robusta (`coffea-canephora`) has a 10-month active cycle (`270-330 d`) and rainfall trapezoid `900 / 1700 / 3000 / 4000 mm`. In the best 10-month window, rainfall supplies ~`1,492 mm` (`0.74` on `[900, 1700]`), monthly temperatures `20.7-25.7 °C` score `1.0` inside `20-30 °C`, basaltic soil pH and medium texture lie in the optimum (`1.0`), and no gate triggers: `compatibility = 74/100`, limiting factor `water`. Under supplemental or full irrigation, water rises to `1.0` and compatibility reaches `100/100`. On the independent `scoring.test.ts` ERA5 2005-2024 fixture (`1,477 mm` window rain, pH 5.6), rainfed compatibility is ~`72/100`, rainfed rice and black pepper stay below `20/100` (`water`), sunn hemp (`crotalaria-juncea`) is limited solely by pH (`0.6 ^ 0.522 = 0.766`), and temperate wheat stays below `40/100`.

## 6. Sources

Full bibliographic details and DOIs for all 36 cited publications are in `docs/SCORING_PAPER.md`. Core references:
- Parametric AEZ & aggregation: FAO (1976) Soils Bull. 32; Storie (1933, 1978); Khiddir (1986); Sys, Van Ranst & Debaveye (1991); Rabia & Terribile (2013, DOI: `10.7763/IJESD.2013.V4.295`); Ramirez-Villegas, Jarvis & Läderach (2013, DOI: `10.1016/j.agrformet.2011.09.005`); Fischer et al. (2021, FAO/IIASA GAEZ v4, DOI: `10.4060/cb4744en`).
- AHP weighting: Saaty (1980; 1987, DOI: `10.1016/0270-0255(87)90473-8`); Akıncı et al. (2013, DOI: `10.1016/j.compag.2013.07.006`); Pramanik (2016); Seyedmohammadi et al. (2018); Herzberg et al. (2019, Central Vietnam, DOI: `10.3390/land8060090`); Pilevar et al. (2020).
- Edaphic & thermal physiology: Maas & Hoffman (1977, DOI: `10.1061/JRCEA4.0001137`); Oldfield, Bradford & Wood (2019, DOI: `10.5194/soil-5-15-2019`); Sanchez et al. (2003); Schlenker & Roberts (2009, DOI: `10.1073/pnas.0906865106`); Sánchez et al. (2014); Monteith (1977); Belda et al. (2014).
- Agro-hydrology, root growth & EO assimilation: Allen et al. (1998, FAO-56); Steduto et al. (2012, FAO-66); Borg & Grimes (1986, DOI: `10.13031/2013.30125`); Feddes et al. (1978); Raes et al. (2009, AquaCrop, DOI: `10.2134/agronj2008.0140s`); Anderson et al. (2011); Ines et al. (2013, DOI: `10.1016/j.rse.2013.07.018`); Reichle et al. (2019); Saltelli et al. (2019).

## 7. Verified and not verified

- **Verified mathematically and empirically (`literature.test.ts`, `scoring.test.ts`, `evaluate-scoring-paper.ts`):** Saaty AHP eigenvector weights and consistency (`CR = 0.0030`, 1,000-run Monte Carlo stability), Theorems 1-4 of Liebig-Khiddir aggregation, 56-case parcel viability benchmark (`0 %` FPR at `S >= 60`, `J = 0.871`), FAO-56 table parameters for FAO-listed curated crops, Borg-Grimes root curve, FAO-56 eq. 62/65 climatic `Kc` scaling, Maas-Hoffman salinity response against FAO-56 Table 23 (`14.56 %` overall RMSE reduction; `86.7 %` for rice), Oldfield Michaelis-Menten SOC plateau, and Sobol-Jansen/Morris sensitivity indices.
- **Still assumed / heuristic engineering choices (review locally before relying on them):** Specific pairwise integer ratios in `AHP_PAIRWISE_MATRIX` (synthesized from published AHP tiers rather than a local stakeholder survey), categorical ratings `1.0 / 0.70 / 0.15` (from Sys et al. 1991 tables), gate multipliers (`0.5 / 0.7 / 0.8`), `0.70 / 0.30` model-to-EO blend weight, `0.42 / 0.24 / 0.20 / 0.14` EO stream weights, `30 %` supplemental irrigation cap, `0.4` fallow `Kc`, macro-porosity percolation rates (`3.5-35 mm/d`), and FAO-56 water parameters for crops flagged `water-model-assumed` (e.g., black pepper, durian, cashew, mango, culinary herbs).

## 8. Known limits

- **Species-level EcoCrop thresholds:** One envelope per species, not per local cultivar; legacy EcoCrop class coding can under-state salt sensitivity where EcoCrop lists `low` instead of `none` (e.g., `phaseolus-vulgaris`, documented in `docs/SCORING_PAPER.md` §7.1). Non-curated species always set `needsLocalReview: true`.
- **Historical yield ranges (`yieldFractions`):** Multi-year ranges over the 20-year ERA5 history evaluate monthly growing-window climate scores rather than 20 sequential daily water balances, and have not yet been calibrated against weighed farm harvest trials in Vietnam.
- **Winter vernalization & bunded rice hydraulics:** Dormant perennial survival is modelled via `winterSurvival` and `activeSeason`, whereas winter annual vernalization chill hours and bunded paddy plough-pan percolation hydraulics are not explicitly simulated.
- **Biotic & market risks:** Pests, diseases, typhoon lodging, and contract pricing lie outside the biophysical engine.

## 9. CropSuite as a second suitability method

Code: `src/core/scoring/cropsuite.ts` (the model), `assessWithCropSuite` in `src/core/scoring/index.ts` (the adapter to the scoring API), `src/core/scoring/cropsuite.test.ts`. Comparison: `npx tsx scripts/crops/evaluate-cropsuite.ts` -> `data/crops/cropsuite-comparison.json`. Source: Zabel, Knüttel & Poschlod (2025), *CropSuite v1.0 – a comprehensive open-source crop suitability model considering climate variability for climate impact assessment*, Geosci. Model Dev. 18, 1067-1087, DOI `10.5194/gmd-18-1067-2025`.

### 9.1 The method, step by step

| Paper (section 2) | In this repository |
|---|---|
| Fuzzy membership functions, 0 (not suitable) to 100, one per requirement | `MembershipFunction` (piecewise linear) and `membership()`; one function per crop and factor from `cropSuiteParams(crop)` |
| Climate suitability for every sowing day of the year, from the mean temperature and the total precipitation over the growing cycle that starts on that day | `runCropSuite` evaluates all 365 sowing days; cycle length = mean of `cycleDays`; perennials use 365 days and sowing day 1 |
| Climate variability: recurrence rate of potential crop failure = share of years in which the cycle's temperature or precipitation leaves the band between the lower and upper threshold; thresholds at 5-10 % suitability of the membership function | `failures()` over the 20-year history; thresholds at 7.5 % (`variabilityThresholds`); a side of a function that never comes down uses its outermost node |
| Sigmoid membership function of the recurrence rate, 0 from 25 % (one year in four) | `variabilitySuitability`: logistic centred on 12.5 %, 100 at 0 %, 73 at 10 %, 27 at 15 %, 0 from 25 % |
| Rainfed and irrigated systems; irrigated: precipitation is no constraint, only excess rain still counts as failure | `irrigation: 'rainfed' \| 'full'`; `'supplemental'` (this app's third mode) adds up to 30 % of the optimal season water, as v2 does |
| Lethal limits: permafrost (annual mean below 0 °C), cycle mean above 40 °C, crop-specific killing temperature, day length, vernalization, consecutive dry days, germination | `limits()`: each is 100 or 0. Killing temperature and day length come from EcoCrop. Vernalization, dry-spell and germination limits are implemented and tested but no crop sets them, because the catalogue has no source for their values |
| Liebig's law of the minimum: climate = min(temperature, precipitation, variability), soil = min(soil and terrain factors), crop = min(climate, soil) | `evaluateCropSuite`; a missing value is skipped, never scored as 0 |
| Optimal sowing date = day with the highest climate suitability; number of suitable sowing days | `optimalSowingDoy`, `suitableSowingDays`. Among equal days the middle of the longest run is taken; the paper leaves this open |
| Multiple cropping: one, two or three sowing dates maximising the summed climate suitability, 21 days between harvest and sowing | `multipleCropping()`, exact search over all combinations |
| Most-limiting factor and the magnitude of every constraint | `limiting` and `limitation` (100 - suitability per factor) in `CropSuiteSummary` |
| Classes: 0 unsuitable, 1-32 marginally, 33-74 moderately, 75-100 highly suitable (Table 3) | `suitabilityClass` |
| Spatial downscaling of gridded climate data; GeoTIFF/NetCDF maps | Not applicable: the model runs on one parcel, and `climateHistory` already arrives lapse-rate adjusted to the parcel (docs/DATA_SOURCES.md) |

### 9.2 Where the membership functions come from

The paper takes the membership functions of most of its 48 crops from Sys et al. (1993) and those of cowpea, rye and yam from EcoCrop. This catalogue is EcoCrop throughout, so every function is built from the EcoCrop columns:

| EcoCrop column | Membership function |
|---|---|
| `eco_temperat_requir_*` | Trapezoid on the mean temperature of the growing cycle: 0 at the absolute limits, 100 across the optimum |
| `eco_rainfall_annual_*` | Trapezoid on the precipitation of the growing cycle, scaled by `min(1, months / 4)` for short cycles (same scaling as v2) |
| `eco_soil_ph_*` | Trapezoid on soil pH |
| `eco_soil_depth_*` | Rises from 0 at the shallow edge of the tolerated class to 100 at the edge of the optimal class (class edges 20, 50, 150 cm) |
| `eco_soil_salinity_*` | 100 up to the upper EC of the optimal class, 0 at the upper EC of the tolerated class (2, 4, 10, 16 dS/m) |
| `eco_soil_fertility_*` | On the organic-carbon and CEC index of v2, between the class thresholds v2 uses |
| `eco_soil_texture_*`, `eco_soil_drainage_*` | Class values: optimal 100, tolerated 60, outside 0 |
| `cult_cycle_min/max` | Length of the growing cycle |
| killing temperatures, photoperiod | Lethal limits |
| slope (no EcoCrop column) | 100 up to 4.6° (annuals) or 9° (perennials), 0 at 16.7° / 24° (the GAEZ v4 limits v2 uses) |

Not used: `eco_latitude_*`, `eco_altitude_*` and `clim_climate_zone` (the method reads the climate itself; v2 keeps them as review gates), `eco_light_intensity_*` and `eco_soil_al_tox_*` (no parcel observation to compare with; aluminium toxicity is empty for 98 % of EcoCrop rows), `desc_plant_attributes` (a description, not a requirement).

Two values are assumptions of this port, not of the paper: 60 for a tolerated soil class (lower edge of S2 "moderately suitable" in the Sys et al. scale the paper reproduces in Table 3) and 7.5 % for the variability thresholds (middle of the recommended 5-10 % band). The sigmoid was read off Fig. 5 of the paper (about 95 at 5 %, 73 at 10 %, 27 at 15 %, 5 at 20 %, 0 at 25 %); the paper prints no formula for it.

### 9.3 Climate data

The paper uses daily temperature and precipitation. The parcel history is monthly (20 years of ERA5), so each day takes its month's mean temperature and an equal share of its month's rainfall. Cycle means and totals are exact for whole months. What a monthly record cannot show is not modelled: single extreme days, and dry spells shorter than a month.

### 9.4 Comparison with Astrovivu-AEZ v2

Same parcels, same crop catalogue, same 56-case viability benchmark (31 viable, 25 non-viable) as `docs/SCORING_PAPER.md` section 6.2. Each method is also judged at the score from which it calls a crop suitable itself: 45 for v2, 33 ("moderately suitable") for CropSuite.

| Method | ROC-AUC | Brier | Sensitivity | Specificity | Youden J | False negatives / false positives |
|---|---:|---:|---:|---:|---:|---:|
| Astrovivu-AEZ v2 | 0.955 | 0.076 | 0.871 | 1.000 | 0.871 | 4 / 0 |
| CropSuite, as published | 0.842 | 0.225 | 0.645 | 0.840 | 0.485 | 11 / 4 |
| CropSuite without climate variability | 0.897 | 0.179 | 0.774 | 0.840 | 0.614 | 7 / 4 |
| CropSuite without the day-length limit | 0.842 | 0.225 | 0.645 | 0.840 | 0.485 | 11 / 4 |

Per parcel (ROC-AUC, v2 / CropSuite): Đắk Lắk 1.00 / 0.81, An Giang 1.00 / 0.93, Iowa 1.00 / 0.81, Nevada 0.67 / 0.67.

Why CropSuite misses 11 viable cases:

- **Climate variability, 7 cases** (rainfed maize, soybean, rye, sorghum, sunflower and red clover in Iowa; rainfed rice in An Giang). The EcoCrop rainfall thresholds are compared with the rain of the growing cycle alone. In Iowa that rain falls below the lower threshold in 15 % (sorghum, red clover) to 55 % (soybean) of the 20 years. From 25 % the suitability is 0 (maize, soybean, rye); at 15-20 % the sigmoid already brings it to 27 or 4, under the 33 of "moderately suitable". v2 adds the water a fallow soil stores before sowing, which is what carries a Corn Belt crop, and it accepts all six. Rainfed rice in An Giang (55 %) is rejected by v2 as well. The paper itself notes that its variability limits "might be parameterized slightly too exclusively".
- **Temperature, 2 cases** (alfalfa in Iowa and Nevada). A perennial is judged on the mean of all 365 days. EcoCrop temperatures describe the growing season, so a winter-dormant perennial scores low (31 and 27). v2 separates the active season from dormancy and accepts the irrigated Nevada stand; it rejects the rainfed Iowa one on water.
- **pH, 2 cases** (irrigated barley and wheat in Nevada, pH 8.8). v2 rejects them too (barley on pH, wheat on frost).

All four cases v2 misses are among the eleven; CropSuite adds seven of its own. Switching climate variability off entirely recovers four cases and still leaves CropSuite behind v2 (ROC-AUC 0.897 against 0.955), so the result does not depend on the 7.5 % level or on the shape of the sigmoid.

Its 4 false positives (wheat and oat at Đắk Lắk, pea and oat in An Giang) are cool-season crops sown in the cooler part of the year (sowing days 243-287), where the mean temperature of the cycle still falls inside their EcoCrop window. v2 rejects three of them through the climate-zone gate and the An Giang oat on temperature.

On the 73 curated crops, rainfed, the two methods rank crops alike only in part (Spearman 0.48 at Đắk Lắk, 0.77 at An Giang, 0.51 in Iowa) and CropSuite scores lower on average (0.48 against 0.64 at Đắk Lắk) because the minimum of several factors is never above the weakest one. Cost is similar: 0.23 ms (v2) and 0.31 ms (CropSuite) per crop and parcel.

### 9.5 Decision

`DEFAULT_SUITABILITY_METHOD = 'astrovivu-v2'`. The rule is fixed in the evaluation script (higher ROC-AUC, then lower Brier score) and a unit test fails if the constant and `cropsuite-comparison.json` disagree. Every score in the app therefore stays on v2.

CropSuite is kept for what v2 does not report:

- sowing day at day-of-year resolution and the number of suitable sowing days (v2 works in months);
- potential harvests per year with their sowing days;
- recurrence rate of potential crop failure as a suitability factor;
- the paper's three suitabilities (climate, soil, crop) and its class.

It reaches the user as a "Second opinion: CropSuite" block under the sowing window of the advisory (`AdvisoryReport.cropSuite`). The block states that the other scores on the page come from the main method, and when rain is what limits the crop it adds why CropSuite is stricter there. Any caller can ask for it with `assessCropSuite(input, cropId)` or `assessCrop(input, cropId, { method: 'cropsuite' })`; `rankCrops` and `computeScoreDetail` accept the same `method`.

### 9.6 Limits

- The benchmark was assembled for v2 and has 56 cases on four parcels. Section 10 repeats the comparison on independent statistics: the order of the two methods holds, the level of skill does not.
- CropSuite was built and evaluated for Africa with Sys et al. membership functions. The gaps found here (soil-water carry-over, dormant perennials) are those of the EcoCrop parameterisation outside the tropics, not a verdict on the published model.
- Monthly climate: see 9.3.
- Vernalization, dry-spell and germination limits are inactive until a crop supplies values with a source.

## 10. Independent validation on agricultural statistics (MIRCA-OS 2015)

Code: `scripts/crops/build-mirca-validation.ts` (builds the set, network), `scripts/crops/evaluate-mirca-validation.ts` (scores both methods, offline), `scripts/crops/mirca-validation.test.ts`. Data: `data/crops/validation/mirca-os-2015-sites.json` -> `data/crops/mirca-validation-results.json`.

### 10.1 Why this dataset

The 56 cases of section 9.4 were written for v2 by the team that wrote v2. A validation set has to come from somewhere else. Candidates that were examined:

| Dataset | What it holds | Verdict |
|---|---|---|
| **MIRCA-OS** (Kebede et al. 2025, Sci. Data 12, 208; HydroShare `10.4211/hs.60a890eb841c460192c03bb590687145`, CC BY 4.0) | Harvested area in 2015 per administrative unit, 23 crop classes, rainfed and irrigated separately, with planting and maturity months. 4,887 units, zeros included | **Used.** Statistics, not a model output; tells where a crop is absent; matches both water modes and the sowing calendar; two CSV files of 9 MB |
| SPAM 2020 v2r2 (IFPRI, Harvard Dataverse `10.7910/DVN/SWPENT`) | Harvested area on a 5-arcmin grid, 46 crops, by water system. The set the CropSuite paper validates against | Not used: the download asks for a personal form. Its within-unit pattern is allocated with a suitability prior, which favours AEZ-type scorers |
| CROPGRIDS v1.08 (Tang et al. 2024, figshare `22491997`) | Harvested area for 173 crops, 0.05° grid, 2020 | Not used: no rainfed/irrigated split; 800 MB of NetCDF |
| LUCAS 2018 (JRC, harmonised) | 340,000 surveyed points with the crop seen in the field | Not used: European Union only |
| GGCMI Phase 3 crop calendar (Jägermeyr et al. 2021) | Planting and maturity day, 18 crops, 0.5° | Not used: calendar only; MIRCA-OS carries a calendar already |

Viet Nam is one national unit in MIRCA-OS, as are Thailand, Indonesia and the Philippines, so the set cannot localise crops inside them. Monsoon Asia enters through 28 Indian and 6 Bangladeshi districts.

### 10.2 The validation set

- **Units.** Subnational units with at least 10,000 ha harvested, drawn at random with a fixed seed and a cap per country (28 for the United States and India, fewer elsewhere), kept only if their outline is at most 200 km wide. 153 units in 35 countries: 58 temperate, 48 subtropical, 27 tropical, 20 dry.
- **Site.** One point per unit: the MODIS (MCD12Q1, 2015) cropland pixel nearest the unit centre (144 units; the centre itself in 8 where the land-cover request failed).
- **Inputs.** Temperature 2001-2020 from NASA POWER, lapse-adjusted to the site; rainfall from GPCC Full Data Monthly v2025 (gauges), NASA POWER rainfall in 8 units outside GPCC; soil from SoilGrids. Slope is not scored: a unit tens of kilometres wide has no single slope.
- **Labels.** A crop is *grown* in a water system from 1 % of the unit's harvested area (and 100 ha). It is *not grown* rainfed where its rainfed area is zero, and not grown irrigated where it is absent from a unit that irrigates. Trace areas are left out. 2,422 cases on 14 crop classes of the curated catalogue (682 grown), 1,015 on 5 classes scored from raw EcoCrop values.

### 10.3 Suitability

| Cases | n | Astrovivu-AEZ v2 | CropSuite | CropSuite without variability |
|---|---:|---:|---:|---:|
| Curated crops, both water systems (ROC-AUC) | 2,422 | **0.662** | 0.548 | 0.566 |
| Rainfed | 1,640 | **0.663** | 0.527 | 0.554 |
| Irrigated | 782 | **0.724** | 0.660 | 0.659 |
| Raw-catalogue crops (cocoa, cotton, millet, oil palm, sugar beet) | 1,015 | **0.854** | 0.720 | 0.757 |
| Ranking the crops of one unit, rainfed (mean ROC-AUC over 134 units) | | **0.690** | 0.538 | 0.577 |

- v2 minus CropSuite on the curated crops: 0.114, 95 % interval 0.093 to 0.135 (2,000 resamples of whole units).
- Per unit, rainfed: v2 ranks better in 101 units, CropSuite in 19, equal in 14.
- v2 is ahead in 13 of 14 crop classes; sugar cane is level (CropSuite 0.87, v2 0.86). Neither method beats chance on sunflower (0.43, 0.41), coffee (0.45, 0.35; grown in 7 cases only) or potatoes (0.53, 0.49).
- The order does not depend on the choices made here: rainfall from NASA POWER instead of GPCC (0.657 against 0.541), presence from 0.5 %, 5 % or 10 % of the area (v2 0.67-0.68, CropSuite 0.53-0.57), units narrower or wider than 100 km (0.66 against 0.53, 0.67 against 0.57).
- Dry climates are the exception (341 cases): level in the dry subtropics (0.61, 0.61), CropSuite slightly ahead in dry temperate and dry tropical units (0.58 against 0.54 on 62 cases, 0.56 against 0.54 on 85). Both are close to chance there.

At the score each method uses itself, v2 calls 56 % of the grown crops suitable and CropSuite 51 %; both reject two thirds or fewer of the crops that are not grown (v2 65 %, CropSuite 56 %).

### 10.4 Sowing calendar and harvests per year

736 cases of an annual crop a unit grows, against the months MIRCA-OS gives for planting:

| | v2 | CropSuite |
|---|---:|---:|
| Planting month rated suitable (cases the method rates suitable at all) | 63 % | 76 % |
| Months of the year rated suitable, mean | 5.0 | 6.6 |
| Best month within one month of planting (chance: 27 %) | 48 % | 43 % |

CropSuite covers the farmers' month more often because it opens a wider window; v2 points closer to it.

Rice grown in two or more seasons a year (28 units): CropSuite finds two or more harvests in 23. Where rice is grown once (17 units) it reports exactly one harvest in 3: the figure is a climatic potential, not a forecast of practice.

### 10.5 What this changes

- **The default stays.** `selectedMethod` is `astrovivu-v2` here as in section 9; `mirca-validation.test.ts` fails if `DEFAULT_SUITABILITY_METHOD` disagrees with either result.
- **The 56-case figure overstates skill.** ROC-AUC 0.955 on the team's own cases becomes 0.66 on statistics. Part of the gap is noise in the test itself (one site standing for a unit, crops not grown for economic reasons), part is the model.
- **Autumn-sown cereals are a known gap of both methods.** Wheat is grown in 131 of 152 labelled cases and v2 calls it suitable in 23 % (CropSuite 38 %). Both judge the whole cycle on EcoCrop growing-season temperatures, so a cycle that crosses a winter fails; v2 treats dormancy for perennials only. Rye and barley show the same pattern (v2 calls 39 % of each suitable where grown).

### 10.6 Limits

- A label says what is grown in a unit of up to 200 km, the score says what would grow at one cropland pixel in it.
- "Not grown" includes crops that would grow but do not pay; this lowers every method's score and should not change their order.
- MIRCA-OS derives the rainfed/irrigated split from national sources of unequal quality.
- 2015 statistics against a 2001-2020 climate.
- Rebuilding the set calls public services (Nominatim, ORNL DAAC, NASA POWER, NOAA PSL, SoilGrids) and takes about 90 minutes; responses are cached under `.cache/`.

## 11. Ranking baseline, before country prevalence (K1)

Code: `scripts/crops/rank-baseline.ts`, `scripts/crops/rank-baseline.test.ts`. Result: `data/crops/rank-baseline.json`. Re-run: `npx tsx scripts/crops/rank-baseline.ts` (prints the tables below).

`rankCrops` orders the 73 curated crops by climate and soil at the field alone. It knows nothing about which crops the country grows. This section records what it returns today, so that the changes planned in `docs/PLAN.md` (prevalence in the ranking, K3; the tie-break, K4; the evaluation against prevalence, K5) can be compared with it. Taken on 15 November 2026, commit `c11874c`, with the telemetry of the demo caches (day 2026-11-14) and the practice each demo field opens with.

Beside each crop stands what the crop atlas (`data/crops/atlas/crop_country.csv`, `docs/CROP_DATA.md` section 7) says about it in the field's country: `major`, `common`, `minor` or `present` when FAOSTAT reports it, `absent` when FAOSTAT covers the country and reports nothing, `unknown` when the crop is counted inside a group item, and `no-item` when no FAOSTAT item names the crop at all. The ranking did not use this column.

### 11.1 Summary

| Field | Country | Ranked | At compatibility 100 | Tied for first | Field's own crop | Top 15: grown | absent | unknown (group) | no FAOSTAT item |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|
| Central Highlands robusta block | VNM | 73 | 1 | 1 | Robusta coffee: rank 1 | 5 | 3 | 3 | 4 |
| Mekong Delta paddy | VNM | 73 | 13 | 13 | Rice: rank 7 | 7 | 3 | 0 | 5 |
| Story County corn-soybean field | USA | 73 | 8 | 4 | Maize: rank 9 | 11 | 0 | 2 | 2 |
| Diamond Valley alfalfa pivot | USA | 73 | 0 | 1 | Alfalfa: rank 2 | 7 | 2 | 1 | 5 |

"Tied for first" counts the crops that share the highest rank score; among them the order is alphabetical by crop id (`out.sort(...)` in `rankCrops`).

### 11.2 What the baseline shows

- **Ties decide the order.** On the Mekong Delta paddy field 13 crops reach the full score, and rice, which covers 52.5 % of Viet Nam's harvested area, comes seventh because its id starts with "o". Okra, amaranth greens, chickpea and robusta coffee stand before it. In Iowa four crops tie for first (onion, cabbage, coriander, potato); maize is ninth and soybean fifteenth, each on about 34 % of the country's harvested area.
- **Crops the country does not report are proposed.** Three of the first 15 in Đắk Lắk (okra, sorghum, pigeon pea) and three in An Giang (okra, chickpea, sorghum) are `absent` for Viet Nam.
- **For a third to a half of the list the atlas cannot say.** `unknown` or `no-item`: 7 of 15 in Đắk Lắk, 5 in An Giang, 4 in Iowa, 6 in Nevada. A prevalence gate that drops only `absent` leaves these in; one that keeps only reported crops removes forage and cover crops such as alfalfa and sesbania, which FAOSTAT's crop statistics do not carry.
- **A score of 0 is still listed.** On the Nevada pivot (soil pH 8.8) four crops score above 0. Places 5 to 15 are crops at 0, in alphabetical order.
- **The field's own crop is not found by the ranking alone** on two of the four fields: rice is seventh, maize ninth. Robusta coffee is first in Đắk Lắk and alfalfa second in Nevada.

`absent` is a statement about FAOSTAT, not about the fields of a country. Viet Nam has no okra series in FAOSTAT, so the atlas reads okra as absent there; whether farmers grow it is what the national statistics of task T4 are meant to answer. K3 has to treat `absent` with that in mind.

### 11.3 The first 15 crops per field

Compatibility, reliability and rank score are on 0-100. Rank score = compatibility x (0.5 + 0.5 x reliability).

**Central Highlands robusta block** (`daklak-coffee`, VNM)

| # | Crop | Compatibility | Reliability | Rank score | Best sowing | Limiting factor | Atlas match | In the country | Share of harvested area |
|---:|---|---:|---:|---:|---|---|---|---|---:|
| 1 | Robusta coffee (`coffea-canephora`) | 100 | 100 | 100 | Feb | none | exact | common | 4.9 % |
| 2 | Okra (`abelmoschus-esculentus`) | 95.2 | 100 | 95.2 | Oct | slope | exact | absent |  |
| 3 | Amaranth greens (`amaranthus-tricolor`) | 95.2 | 100 | 95.2 | Jun | slope | none | no-item |  |
| 4 | Sweet potato (`ipomoea-batatas`) | 95.2 | 100 | 95.2 | Mar | slope | exact | common | 0.6 % |
| 5 | Sorghum (`sorghum-bicolor`) | 95.2 | 100 | 95.2 | Mar | slope | exact | absent |  |
| 6 | Yardlong bean (`vigna-unguiculata-ssp-sesquipedalis`) | 95.2 | 100 | 95.2 | Jul | slope | none | no-item |  |
| 7 | Cashew (`anacardium-occidentale`) | 91.8 | 100 | 91.8 | Jan | texture | exact | common | 2.1 % |
| 8 | Mint (`mentha-spicata-var-crispa`) | 91.8 | 100 | 91.8 | May | texture | group | unknown |  |
| 9 | Groundnut (`arachis-hypogaea`) | 88.7 | 100 | 88.7 | Apr | texture | exact | common | 1.1 % |
| 10 | Mustard greens (`brassica-juncea`) | 88.7 | 100 | 88.7 | May | texture | none | no-item |  |
| 11 | Pak choi (`brassica-rapa-pak-choi`) | 88.7 | 100 | 88.7 | Jun | texture | none | no-item |  |
| 12 | Pigeon pea (`cajanus-cajan`) | 88.7 | 100 | 88.7 | Feb | texture | exact | absent |  |
| 13 | Coriander (`coriandrum-sativum`) | 88.7 | 100 | 88.7 | May | texture | group | unknown |  |
| 14 | Pumpkin (`cucurbita-moschata`) | 88.7 | 100 | 88.7 | Mar | texture | group | unknown |  |
| 15 | Soybean (`glycine-max`) | 88.7 | 100 | 88.7 | Apr | texture | exact | minor | 0.2 % |

**Mekong Delta paddy** (`cantho-rice`, VNM)

| # | Crop | Compatibility | Reliability | Rank score | Best sowing | Limiting factor | Atlas match | In the country | Share of harvested area |
|---:|---|---:|---:|---:|---|---|---|---|---:|
| 1 | Okra (`abelmoschus-esculentus`) | 100 | 100 | 100 | Jan | none | exact | absent |  |
| 2 | Amaranth greens (`amaranthus-tricolor`) | 100 | 100 | 100 | Jan | none | none | no-item |  |
| 3 | Chickpea (`cicer-arietinum`) | 100 | 100 | 100 | Jan | none | exact | absent |  |
| 4 | Robusta coffee (`coffea-canephora`) | 100 | 100 | 100 | Jan | none | exact | common | 4.9 % |
| 5 | Water spinach (`ipomoea-aquatica`) | 100 | 100 | 100 | Jan | none | none | no-item |  |
| 6 | Sweet potato (`ipomoea-batatas`) | 100 | 100 | 100 | Jun | none | exact | common | 0.6 % |
| 7 | Rice (`oryza-sativa`) | 100 | 100 | 100 | Jan | none | exact | major | 52.5 % |
| 8 | Black pepper (`piper-nigrum`) | 100 | 100 | 100 | Jan | none | exact | common | 0.8 % |
| 9 | Sugarcane (`saccharum-officinarum`) | 100 | 100 | 100 | Jan | none | exact | common | 1.3 % |
| 10 | Sesbania (`sesbania-rostrata`) | 100 | 100 | 100 | Jan | none | none | no-item |  |
| 11 | Sorghum (`sorghum-bicolor`) | 100 | 100 | 100 | Jan | none | exact | absent |  |
| 12 | Sudangrass (`sorghum-x-drummondii`) | 100 | 100 | 100 | Jan | none | none | no-item |  |
| 13 | Yardlong bean (`vigna-unguiculata-ssp-sesquipedalis`) | 100 | 100 | 100 | Jan | none | none | no-item |  |
| 14 | Cashew (`anacardium-occidentale`) | 91.8 | 100 | 91.8 | Jan | texture | exact | common | 2.1 % |
| 15 | Groundnut (`arachis-hypogaea`) | 91.8 | 100 | 91.8 | Jan | texture | exact | common | 1.1 % |

**Story County corn-soybean field** (`iowa-corn-soy`, USA)

| # | Crop | Compatibility | Reliability | Rank score | Best sowing | Limiting factor | Atlas match | In the country | Share of harvested area |
|---:|---|---:|---:|---:|---|---|---|---|---:|
| 1 | Onion (`allium-cepa`) | 100 | 95 | 97.5 | May | none | exact | minor | 0.055 % |
| 2 | Cabbage (`brassica-oleracea-var-capitata`) | 100 | 95 | 97.5 | May | none | exact | minor | 0.021 % |
| 3 | Coriander (`coriandrum-sativum`) | 100 | 95 | 97.5 | May | none | group | unknown |  |
| 4 | Potato (`solanum-tuberosum`) | 100 | 95 | 97.5 | May | none | exact | minor | 0.4 % |
| 5 | Watermelon (`citrullus-lanatus`) | 98.2 | 95 | 95.8 | Jun | water | exact | minor | 0.043 % |
| 6 | Buckwheat (`fagopyrum-esculentum`) | 100 | 85 | 92.5 | Jun | none | exact | minor | 0.082 % |
| 7 | Sunflower (`helianthus-annuus`) | 100 | 80 | 90 | Jun | none | exact | minor | 0.5 % |
| 8 | Marigold (`tagetes-erecta`) | 100 | 80 | 90 | Jun | none | none | no-item |  |
| 9 | Maize (`zea-mays`) | 100 | 80 | 90 | Jun | none | exact | major | 34.0 % |
| 10 | Common bean (`phaseolus-vulgaris`) | 90 | 85 | 83.3 | Jul | photoperiod | group | unknown |  |
| 11 | Mustard greens (`brassica-juncea`) | 99.5 | 65 | 82.1 | May | water | none | no-item |  |
| 12 | Tomato (`lycopersicon-esculentum`) | 93.5 | 75 | 81.8 | Jun | temperature | exact | minor | 0.1 % |
| 13 | Canola (`brassica-napus`) | 83 | 95 | 80.9 | May | ph | exact | common | 1.0 % |
| 14 | Sorghum (`sorghum-bicolor`) | 79.7 | 100 | 79.7 | Jun | temperature | exact | common | 2.2 % |
| 15 | Soybean (`glycine-max`) | 91.6 | 70 | 77.9 | Jun | temperature | exact | major | 34.7 % |

**Diamond Valley alfalfa pivot** (`nevada-alfalfa`, USA)

| # | Crop | Compatibility | Reliability | Rank score | Best sowing | Limiting factor | Atlas match | In the country | Share of harvested area |
|---:|---|---:|---:|---:|---|---|---|---|---:|
| 1 | Chickpea (`cicer-arietinum`) | 66.4 | 100 | 66.4 | Jun | ph | exact | minor | 0.2 % |
| 2 | Alfalfa (`medicago-sativa`) | 52.9 | 100 | 52.9 | Jun | ph | none | no-item |  |
| 3 | Common bean (`phaseolus-vulgaris`) | 27.7 | 100 | 27.7 | Jul | ph | group | unknown |  |
| 4 | Rice (`oryza-sativa`) | 12.9 | 100 | 12.9 | Jun | ph | exact | common | 1.1 % |
| 5 | Okra (`abelmoschus-esculentus`) | 0 | 100 | 0 | Jul | ph | exact | minor | 0.001 % |
| 6 | Onion (`allium-cepa`) | 0 | 100 | 0 | May | ph | exact | minor | 0.055 % |
| 7 | Spring onion (`allium-fistulosum`) | 0 | 100 | 0 | Jun | ph | exact | absent |  |
| 8 | Amaranth greens (`amaranthus-tricolor`) | 0 | 100 | 0 | Jun | ph | none | no-item |  |
| 9 | Cashew (`anacardium-occidentale`) | 0 | 0 | 0 | Apr | ph | exact | absent |  |
| 10 | Groundnut (`arachis-hypogaea`) | 0 | 90 | 0 | Jun | ph | exact | common | 0.6 % |
| 11 | Pinto peanut (`arachis-pintoi`) | 0 | 0 | 0 | May | temperature | none | no-item |  |
| 12 | Oats (`avena-sativa`) | 0 | 25 | 0 | Jun | ph | exact | minor | 0.4 % |
| 13 | Malabar spinach (`basella-alba`) | 0 | 100 | 0 | Jul | ph | none | no-item |  |
| 14 | Mustard greens (`brassica-juncea`) | 0 | 100 | 0 | Jun | ph | none | no-item |  |
| 15 | Canola (`brassica-napus`) | 0 | 100 | 0 | Jun | ph | exact | common | 1.0 % |

### 11.4 Limits

- The curated list only (73 crops); the 1,990 species of the full catalogue are not ranked by `rankCrops`.
- One day of telemetry and the default practice of each demo field; another irrigation setting changes the order.
- The atlas level is per country, three-year mean of FAOSTAT production data up to 2024. Regions inside a country (`region_crops.csv`, MapSPAM 2020) are not used here: coffee is `common` for Viet Nam as a whole, which says nothing about the Mekong Delta.
- The two country codes of the demo fields are written in the script (`VN` to `VNM`, `US` to `USA`); the app's own conversion is part of K2.

## 12. Ranking with what the country grows (K3, K4)

Code: `rankCrops`, `rankCropLists`, `prevalenceStatus` in `src/core/scoring/index.ts`; tests in `src/core/scoring/prevalence.test.ts` and `scripts/crops/rank-prevalence.test.ts`. Tables below: `npx tsx scripts/crops/rank-prevalence.ts` (writes `data/crops/rank-prevalence.json`).

The model takes the crop table of the parcel's country as `ModelInput.country` (`CountryCrops` in `src/contracts/country.ts`). The suitability score of a crop does not change. What changes is which list a crop is in, and the order among crops with the same score.

### 12.1 Rules

| The country's record of the crop | Read as | Where the crop goes |
|---|---|---|
| `major`, `common`, `minor`, `present`, from a record of the crop itself (`match` `exact` or `national`) | grown | main list |
| `absent`, from a record of the crop itself | absent | second list when its compatibility is at least 60 ("suitable" in the score classes); otherwise in neither list |
| record of a group item (`match = group`), whatever its level | unknown | main list, marked unknown |
| no record | unknown | main list, marked unknown |

- **Unknown is never treated as absent.** A group item says nothing about one species in it, and 20 of the 73 curated crops (forage, cover crops, leafy vegetables) have no FAOSTAT item at all.
- **No country, no gate.** Without `ModelInput.country` every crop is ranked on climate and soil as before, and `rankCropLists(...).gate` says in both languages that the gate was not applied.
- **The second list is not a list of crops proven new.** `absent` means FAOSTAT has no figure above zero for the crop in the country. Each entry therefore carries a note that the crop may be new there or grown without being reported, to ask locally, and to try a new crop on a small area first (section 12.4).

`rankCrops(input)` returns the main list; `rankCrops(input, { include: 'all' })` every crop; `rankCropLists(input)` both lists and the gate note.

### 12.2 Order among equal scores

Rank score first, as before. Among crops with the same rank score: the level in the country (`major`, `common`, `minor`, `present`, then unknown, then absent), then the share of the country's harvested area, then the reliability over the analysed years, and the crop id last, so that the same input always gives the same list. The alphabetical order is now the last resort instead of the first.

Rounding is kept (compatibility to 3 decimals, rank score to 4). It is not what causes the ties: with unrounded scores exactly as many crops are tied, 31 of 73 in Đắk Lắk, 45 in An Giang, 30 in Iowa and 69 in Nevada, rounded and unrounded alike. The ties come from the score itself, which reaches the same class values (100, 95.2, 91.8, ...) for many crops.

### 12.3 Before and after on the four demo fields

Baseline: section 11. "Baseline place" is the crop's place among the first 15 of the baseline, empty when it was not among them.

| Field | Field's own crop: baseline place | now | Without reported production among the first 15: baseline | now | Crops in the second list |
|---|---:|---:|---:|---:|---:|
| Central Highlands robusta block (Robusta coffee) | 1 | 1 | 3 | 0 | 12 |
| Mekong Delta paddy (Rice) | 7 | 1 | 3 | 0 | 12 |
| Story County corn-soybean field (Maize) | 9 | 7 | 0 | 0 | 0 |
| Diamond Valley alfalfa pivot (Alfalfa) | 2 | 2 | 2 | 0 | 0 |

**Central Highlands robusta block** (`daklak-coffee`, VNM): main list, 53 crops

| # | Crop | Compatibility | Reliability | Rank score | In the country | Share of harvested area | Baseline place |
|---:|---|---:|---:|---:|---|---:|---:|
| 1 | Robusta coffee (`coffea-canephora`) | 100 | 100 | 100 | common | 4.9 % | 1 |
| 2 | Sweet potato (`ipomoea-batatas`) | 95.2 | 100 | 95.2 | common | 0.6 % | 4 |
| 3 | Amaranth greens (`amaranthus-tricolor`) | 95.2 | 100 | 95.2 | unknown |  | 3 |
| 4 | Yardlong bean (`vigna-unguiculata-ssp-sesquipedalis`) | 95.2 | 100 | 95.2 | unknown |  | 6 |
| 5 | Cashew (`anacardium-occidentale`) | 91.8 | 100 | 91.8 | common | 2.1 % | 7 |
| 6 | Mint (`mentha-spicata-var-crispa`) | 91.8 | 100 | 91.8 | unknown |  | 8 |
| 7 | Maize (`zea-mays`) | 88.7 | 100 | 88.7 | major | 6.5 % |  |
| 8 | Groundnut (`arachis-hypogaea`) | 88.7 | 100 | 88.7 | common | 1.1 % | 9 |
| 9 | Soybean (`glycine-max`) | 88.7 | 100 | 88.7 | minor | 0.2 % | 15 |
| 10 | Sesame (`sesamum-indicum`) | 88.7 | 100 | 88.7 | minor | 0.2 % |  |
| 11 | Mustard greens (`brassica-juncea`) | 88.7 | 100 | 88.7 | unknown |  | 10 |
| 12 | Pak choi (`brassica-rapa-pak-choi`) | 88.7 | 100 | 88.7 | unknown |  | 11 |
| 13 | Coriander (`coriandrum-sativum`) | 88.7 | 100 | 88.7 | unknown |  | 13 |
| 14 | Pumpkin (`cucurbita-moschata`) | 88.7 | 100 | 88.7 | unknown |  | 14 |
| 15 | Velvet bean (`mucuna-pruriens`) | 88.7 | 100 | 88.7 | unknown |  |  |

Without reported production in the country, compatibility from 60 (12): Okra 95.2, Sorghum 95.2, Pigeon pea 88.7, Tomato 88.7, Chickpea 84.2, Strawberry 83.8, Ginger 82.7, Cucumber 81.5, Cowpea 81.2, Eggplant 71, Safflower 61.5, Buckwheat 61.4.

**Mekong Delta paddy** (`cantho-rice`, VNM): main list, 53 crops

| # | Crop | Compatibility | Reliability | Rank score | In the country | Share of harvested area | Baseline place |
|---:|---|---:|---:|---:|---|---:|---:|
| 1 | Rice (`oryza-sativa`) | 100 | 100 | 100 | major | 52.5 % | 7 |
| 2 | Robusta coffee (`coffea-canephora`) | 100 | 100 | 100 | common | 4.9 % | 4 |
| 3 | Sugarcane (`saccharum-officinarum`) | 100 | 100 | 100 | common | 1.3 % | 9 |
| 4 | Black pepper (`piper-nigrum`) | 100 | 100 | 100 | common | 0.8 % | 8 |
| 5 | Sweet potato (`ipomoea-batatas`) | 100 | 100 | 100 | common | 0.6 % | 6 |
| 6 | Amaranth greens (`amaranthus-tricolor`) | 100 | 100 | 100 | unknown |  | 2 |
| 7 | Water spinach (`ipomoea-aquatica`) | 100 | 100 | 100 | unknown |  | 5 |
| 8 | Sesbania (`sesbania-rostrata`) | 100 | 100 | 100 | unknown |  | 10 |
| 9 | Sudangrass (`sorghum-x-drummondii`) | 100 | 100 | 100 | unknown |  | 12 |
| 10 | Yardlong bean (`vigna-unguiculata-ssp-sesquipedalis`) | 100 | 100 | 100 | unknown |  | 13 |
| 11 | Maize (`zea-mays`) | 91.8 | 100 | 91.8 | major | 6.5 % |  |
| 12 | Cassava (`manihot-esculenta`) | 91.8 | 100 | 91.8 | common | 3.8 % |  |
| 13 | Cashew (`anacardium-occidentale`) | 91.8 | 100 | 91.8 | common | 2.1 % | 14 |
| 14 | Coconut (`cocos-nucifera`) | 91.8 | 100 | 91.8 | common | 1.3 % |  |
| 15 | Groundnut (`arachis-hypogaea`) | 91.8 | 100 | 91.8 | common | 1.1 % | 15 |

Without reported production in the country, compatibility from 60 (12): Okra 100, Chickpea 100, Sorghum 100, Pigeon pea 91.8, Cucumber 91.8, Sunflower 91.8, Tomato 91.8, Eggplant 91.8, Cowpea 91.8, Ginger 91.8, Safflower 80.1, Buckwheat 63.5.

**Story County corn-soybean field** (`iowa-corn-soy`, USA): main list, 64 crops

| # | Crop | Compatibility | Reliability | Rank score | In the country | Share of harvested area | Baseline place |
|---:|---|---:|---:|---:|---|---:|---:|
| 1 | Potato (`solanum-tuberosum`) | 100 | 95 | 97.5 | minor | 0.4 % | 4 |
| 2 | Onion (`allium-cepa`) | 100 | 95 | 97.5 | minor | 0.055 % | 1 |
| 3 | Cabbage (`brassica-oleracea-var-capitata`) | 100 | 95 | 97.5 | minor | 0.021 % | 2 |
| 4 | Coriander (`coriandrum-sativum`) | 100 | 95 | 97.5 | unknown |  | 3 |
| 5 | Watermelon (`citrullus-lanatus`) | 98.2 | 95 | 95.8 | minor | 0.043 % | 5 |
| 6 | Buckwheat (`fagopyrum-esculentum`) | 100 | 85 | 92.5 | minor | 0.082 % | 6 |
| 7 | Maize (`zea-mays`) | 100 | 80 | 90 | major | 34.0 % | 9 |
| 8 | Sunflower (`helianthus-annuus`) | 100 | 80 | 90 | minor | 0.5 % | 7 |
| 9 | Marigold (`tagetes-erecta`) | 100 | 80 | 90 | unknown |  | 8 |
| 10 | Common bean (`phaseolus-vulgaris`) | 90 | 85 | 83.3 | unknown |  | 10 |
| 11 | Mustard greens (`brassica-juncea`) | 99.5 | 65 | 82.1 | unknown |  | 11 |
| 12 | Tomato (`lycopersicon-esculentum`) | 93.5 | 75 | 81.8 | minor | 0.1 % | 12 |
| 13 | Canola (`brassica-napus`) | 83 | 95 | 80.9 | common | 1.0 % | 13 |
| 14 | Sorghum (`sorghum-bicolor`) | 79.7 | 100 | 79.7 | common | 2.2 % | 14 |
| 15 | Soybean (`glycine-max`) | 91.6 | 70 | 77.9 | major | 34.7 % | 15 |

Without reported production in the country, compatibility from 60: none.

**Diamond Valley alfalfa pivot** (`nevada-alfalfa`, USA): main list, 64 crops

| # | Crop | Compatibility | Reliability | Rank score | In the country | Share of harvested area | Baseline place |
|---:|---|---:|---:|---:|---|---:|---:|
| 1 | Chickpea (`cicer-arietinum`) | 66.4 | 100 | 66.4 | minor | 0.2 % | 1 |
| 2 | Alfalfa (`medicago-sativa`) | 52.9 | 100 | 52.9 | unknown |  | 2 |
| 3 | Common bean (`phaseolus-vulgaris`) | 27.7 | 100 | 27.7 | unknown |  | 3 |
| 4 | Rice (`oryza-sativa`) | 12.9 | 100 | 12.9 | common | 1.1 % | 4 |
| 5 | Soybean (`glycine-max`) | 0 | 100 | 0 | major | 34.7 % |  |
| 6 | Maize (`zea-mays`) | 0 | 100 | 0 | major | 34.0 % |  |
| 7 | Wheat (`triticum-aestivum`) | 0 | 0 | 0 | major | 15.2 % |  |
| 8 | Sorghum (`sorghum-bicolor`) | 0 | 100 | 0 | common | 2.2 % |  |
| 9 | Canola (`brassica-napus`) | 0 | 100 | 0 | common | 1.0 % | 15 |
| 10 | Barley (`hordeum-vulgare`) | 0 | 100 | 0 | common | 0.9 % |  |
| 11 | Groundnut (`arachis-hypogaea`) | 0 | 90 | 0 | common | 0.6 % | 10 |
| 12 | Sunflower (`helianthus-annuus`) | 0 | 100 | 0 | minor | 0.5 % |  |
| 13 | Field pea (`pisum-sativum`) | 0 | 95 | 0 | minor | 0.4 % |  |
| 14 | Potato (`solanum-tuberosum`) | 0 | 100 | 0 | minor | 0.4 % |  |
| 15 | Sugarcane (`saccharum-officinarum`) | 0 | 0 | 0 | minor | 0.4 % |  |

Without reported production in the country, compatibility from 60: none.

### 12.4 What this does and does not settle

- **Unreported is not the same as not grown.** The second list of both Vietnamese fields holds tomato, cucumber, eggplant, ginger, okra and cowpea, because FAOSTAT has no series of these for Viet Nam. The rule does what `absent` says; the data cannot tell a crop that is not grown from one that is not reported. Records from national statistics (`match = national`, task T4) are what will move such crops to the main list, and the wording of the note is chosen so that it is true in both cases.
- **The level is per country.** Robusta coffee is second on the Mekong Delta paddy field: it reaches the full score there and is `common` in Viet Nam as a whole. Regions inside a country (`region_crops.csv`) are not used yet.
- **Prevalence breaks ties, it does not re-weight scores.** Maize is seventh in Iowa, not first: its rank score is 90 against 97.5 for potato, onion and cabbage, because 20 % of the analysed years fell short of its needs. Whether a crop grown on a third of the country's cropland should rank above a better-scoring minor crop is a question for K5.
- **Crops at score 0 are still listed** (Nevada, places 5 to 15), now ordered by what the country grows.
- **The app does not pass a country table yet** (tasks T6 and B1). Until it does, the lists in the app are as before, except that equal scores are ordered by reliability before the crop id.

