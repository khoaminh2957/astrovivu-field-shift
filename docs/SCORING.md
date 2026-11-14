# Productivity scoring (Astrovivu-AEZ v2)

Code: `src/core/scoring/index.ts` and `src/core/scoring/literature.ts` (pure TypeScript). Crop data: `src/core/crops`, built by `npm run crops:build`. Unit tests: `src/core/scoring/scoring.test.ts` and `src/core/scoring/literature.test.ts`. Full mathematical derivations, 20-paper literature review, formal proofs, and empirical/sensitivity benchmarks: `docs/SCORING_PAPER.md` (reproducible via `npx tsx scripts/crops/evaluate-scoring-paper.ts` -> `data/crops/scoring-paper-results.json`).

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
