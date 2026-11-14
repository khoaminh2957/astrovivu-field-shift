# Productivity scoring

Code: `src/core/scoring/index.ts` (pure TypeScript), crop data: `src/core/crops`, built by `npm run crops:build`. Tests: `src/core/scoring/scoring.test.ts`, on real ERA5 data for the Đắk Lắk test point.

## 1. What is computed

| Output | Meaning |
|---|---|
| compatibility (0-100) | How well the crop fits the site in a normal year: climate of the growing window, soil, terrain |
| condition(t) (0-100) | How the season is going on day t: root-zone water, heat and cold, what satellites see against normal |
| productivity(t) | compatibility x condition(t) / 100. Without a crop: condition for a generic crop |
| reliability | In how many of the analysed years the season met the crop's needs |
| expected yield fraction | Season outcome as a share of attainable yield, input to the economics |

## 2. Crop catalogue

`data/ecocrop/ecocrop_2568_plants.csv` (FAO EcoCrop) is cleaned by `scripts/crops/parse.ts`; every repair is listed in `data/crops/CLEANING_LOG.md`. Of 2,568 rows, 501 have no temperature or rainfall window and cannot be scored, 5 repeat another row of the same species and are merged, 2,062 species remain. 47 repairs: wrong-scale values, swapped absolute/optimal limits, latitudes above 90 (altitudes typed into the wrong field, dropped), cycle 0 treated as missing (185 species get an assumed cycle, flag `cycle-assumed`).

73 crops are curated (`scripts/crops/overlay-*.ts`): names in English and Vietnamese, FAO-56 water model, rotation and urban traits, reference economics. Every threshold that differs from EcoCrop is listed with its reason in the cleaning log. Crop ids are the slug of the EcoCrop name, the same ids the knowledge base uses.

## 3. Compatibility

**Growing window.** N months = mean cycle length / 30.4, rounded (Hijmans: average of GMIN and GMAX). All 12 sowing months are scored; the farmer's sowing date selects one, otherwise the best one is used.

**Factor score.** EcoCrop trapezoid on `[absMin, optMin, optMax, absMax]`: 0 at or beyond the absolute limits, 1 inside the optimum, linear between.

| Factor | Kind | How | Exponent |
|---|---|---|---|
| temperature | fixed | trapezoid of each month's mean temperature in the window; the worst month counts | 1 |
| water | manageable | trapezoid of the season water supply (below) | 1 |
| pH | manageable | trapezoid | 0.5 |
| salinity (EC) | manageable | class: <2 none, <4 low, <=10 medium, >10 high dS/m, against the crop's tolerated class | 0.5 |
| drainage | manageable | class in optimal list 1, tolerated 0.7, outside 0.15 | 0.5 |
| texture | fixed | same class scores | 0.25 |
| soil depth | fixed | same class scores | 0.25 |
| fertility | manageable | proxy: mean of organic carbon (0 at 4 g/kg, 1 at 20) and CEC (0 at 4 cmol/kg, 1 at 20), in thirds, against the crop's class | 0.2 |
| slope | fixed | 1 up to 8 % (annuals) or 16 % (perennials), falling to 0.15 at 30 % / 45 % | 0.2 |

**Water supply.** Rain summed over the window (not the calendar year), plus, for annual crops, the water a fallow soil stored in the six months before sowing: `S = clamp(S + Peff - 0.4 ET0, 0, TAW)` month by month, `Peff` = USDA-SCS effective rainfall, `TAW = 1000 x AWC x Zr`. EcoCrop publishes annual rainfall; it is read as the season total for windows of four months or more and scaled by N/4 for shorter ones. Irrigation removes deficits only: `full` sets the deficit side to 1, `supplemental` adds up to 30 % of the crop's optimal season water. Excess rain is never removed.

**Combination.** `compatibility = product(score_i ^ exponent_i) x product(gates)`. Exponents are weight / largest weight, so temperature and water act at full strength (Ramirez-Villegas et al. 2013: SUIT = TSUIT x RSUIT) and soil factors are damped. Any zero gives zero. A factor with no data is skipped and flagged (`score: null`), never scored as zero. The limiting factor is the one with the smallest contribution. A weighted sum was rejected: it scored rainfed rice 0.75 with rain below the absolute minimum.

**Gates** (multipliers; each one sets "needs local review"):

| Gate | Rule | Value |
|---|---|---|
| killing temperature | a month whose mean daily minimum is below Tkill + 4 °C (perennials: also the months outside the window, against the rest value) | 0 |
| climate zone | site's Köppen-Trewartha zone not in the crop's list; a dry site may also match on its thermal zone | 0.5 curated, 0.7 raw EcoCrop |
| photoperiod | share f of window months whose day length class (<12 h, 12-14 h, >14 h) the crop lists | 0.7 + 0.3 f |
| latitude | beyond EcoCrop's limit by more than 3° | 0.7 |
| altitude | above 110 % of EcoCrop's maximum | 0.8 |

**Sowing date** is reported as a `choice` factor: score of the chosen month / score of the best month.

**Reliability.** Every year of `climateHistory` is scored with its own months; a year counts when min(temperature, water, kill) >= 0.5.

## 4. Condition and productivity

Daily FAO-56 root-zone balance (eq. 82-86): `TAW = 1000 AWC Zr`, `RAW = p TAW`, `p = pTable + 0.04 (5 - ETc)` within 0.1-0.8, `Ks = (TAW - Dr) / (TAW - RAW)` when `Dr > RAW`, `Dr = Dr - (P - RO) + Ks Kc ET0`. Kc follows the four FAO-56 stages from the sowing date (ground truth) or day 1 of the best month, repeated yearly. Rain below 0.2 ET0 is ignored (FAO-56); runoff uses the curve number (67 light, 78 medium, 85 heavy soil). The balance runs twice so the starting state is not arbitrary. Missing ET0 is filled with Hargreaves (FAO-56 eq. 52), then with the climatology; missing days are never zeroed. Irrigation is applied on demand when `Dr > RAW`: unlimited for `full`, up to 30 % of the optimal season water for `supplemental` or an unreliable source. A farmer's rain gauge scales the satellite rain by the ratio of totals on shared days.

```
water(t)    = 1 - Ky x s(stage) x (1 - Ks)        s = 0.4 initial, 0.7 development, 1 mid-season, 0.4 late
thermal(t)  = trapezoid of the 7-day mean temperature; 0.1 on a night at or below Tkill
model(t)    = water x thermal
observed(t) = 0.65 x NDVI score + 0.35 x ESI score   (only the ones available)
condition   = 0.7 model + 0.3 observed                (model alone, or observed alone, if one is missing)
productivity(t) = compatibility x condition
expected yield fraction = (compatibility / water factor) x min(water factor, 1 - Ky (1 - ETa/ETm))
```

NDVI is scored against the pixel's own day-of-year baseline (1 at or above the mean, 0.5 at the 10th percentile); ESI from 1 at -0.5 sigma to 0 at -3. Regional sources therefore enter as anomalies (ARCHITECTURE §4.1 S3); rainfall is the one regional quantity used in absolute terms. Confidence is the mean confidence of the branches used (soil counts as measured when ground truth is present).

## 5. Reproduce a score by hand: robusta, Đắk Lắk, rainfed

ERA5 2005-2024 monthly rain (mm, Jan-Dec): 15 8 22 64 162 171 237 206 273 188 113 41. Robusta: cycle 270-330 days, so N = 10 months; rain window 900 / 1700 / 3000 / 4000 mm. Best window March-December: 22+64+162+171+237+206+273+188+113+41 = 1,477 mm, 223 mm short of 1,700. Water = (1477 - 900) / (1700 - 900) = 0.72. Monthly means 20.7-25.7 °C lie inside 20-30 °C: temperature 1. pH 5.6 inside 5-6.3: 1. Texture medium: 1. No gate triggers. Compatibility = 0.72 x 1 x ... = about **72**, limiting factor water (the regression test asserts 60-85 and a shortfall of 190-250 mm). With full irrigation the water factor is 1 and compatibility is above 95.

Same data, tested: rainfed rice and black pepper fail on water and pass irrigated; sunn hemp is held back only by pH (0.6 ^ 0.5 = 0.77); wheat stays below 40; sesame, groundnut and soybean exceed 80 with sesame the most reliable.

## 6. Sources

- EcoCrop model: Hijmans et al., DIVA-GIS manual v7 pp. 54-55 (https://diva-gis.org/docs/DIVA-GIS_manual_7.pdf); Ramirez-Villegas, Jarvis, Läderach 2013, Agric. For. Meteorol. 170: 67-78 (https://cgspace.cgiar.org/handle/10568/42056): trapezoid, season from GMIN/GMAX, season rainfall, Tkill + 4 °C, product of the two scores.
- FAO-56 (Allen et al. 1998): Tables 11, 12 (https://www.fao.org/4/X0490E/x0490e0b.htm), Tables 22, 24 and eq. 82-90 (https://www.fao.org/4/X0490E/x0490e0e.htm), Table 19 (x0490e0c.htm), eq. 52 (x0490e07.htm). Ky from FAO-33 as reproduced in Table 24.
- Köppen-Trewartha criteria: Belda et al. 2014, Climate Research 59: 1-13 (https://www.int-res.com/articles/cr_oa/c059p001.pdf).
- Effective rainfall: FAO I&D Paper 46 (CROPWAT), USDA-SCS method. Curve numbers: USDA TR-55 (1986), row crops, good condition.
- Suitability class names (very suitable >= 80 ... not suitable) and slope classes: FAO/IIASA GAEZ v4 documentation (https://www.fao.org/3/cb4744en/cb4744en.pdf).
- Wheat optimum 15-20 °C: FAO crop information, wheat (archived).

## 7. Verified and not verified

Verified against the source: FAO-56 table values used by curated crops, the equations above, EcoCrop model rules, Köppen-Trewartha thresholds, effective-rainfall formula, curve numbers.

Not verified, our own judgement (review before relying on them): the factor weights (no AHP elicitation was done), class scores 1 / 0.7 / 0.15, gate values, the 0.5 reliability threshold, stage sensitivities (averaged from FAO-33 per-period Ky of seven crops), the 0.7 / 0.3 model-observation blend, the 30 % supplemental allowance, the fallow Kc of 0.4, the fertility proxy, the slope ramp. Water models of crops FAO-56 does not list (flag `water-model-assumed`, e.g. black pepper, durian, cashew, mango, herbs, cover legumes) are mapped to a named row and not checked against a crop-specific study. Marigold and perilla thresholds are borrowed from comparable species.

## 8. Limits

- EcoCrop is coarse: one window per species, no varieties. Any score needs review by someone who knows the land; non-curated species always say so.
- Monthly means hide short frosts and heat waves in the static score; the daily condition sees them only for the last 365 days.
- Winter rest is not modelled: winter wheat, rye and vetch are scored on their active growth window.
- Not implemented: soil-moisture, land-surface-temperature and radiation components of the condition, root growth during the season, waterlogging, climatic adjustment of Kc, thermal time, a year-by-year water-balance yield (yearly yield fractions use the EcoCrop climate score).
- Paddy rice percolation is not in the water balance; EcoCrop's 1,000 mm season minimum stands in for it.
- Pest, disease, variety, management and market access are outside the model.

## Perennials, off-season and the calibration ledger (integration fixes, 2026-11-14)

| Topic | Rule |
|---|---|
| Active season | A perennial's active months are those whose mean temperature is above its absolute minimum (`req.tempC[0]`). If every month is active (evergreen, e.g. robusta at Đắk Lắk) nothing changes. |
| Dormant perennial | The growth window (`windowMonths`) is placed inside the active season on temperature first; the farmer's planting date does not move it. Temperature is scored only in that window. Two gates are added: `winterSurvival` (rest months against `killTempRestC` + 4 °C; a note says so when the value is unknown) and `activeSeason` (active months / window months, capped at 1). Yearly reliability uses the same window and the survival gate. |
| Stages | A dormant perennial outside its window is `dormant`; an evergreen between cycles is shown as "between cycles" and still scored. An annual listed in `currentRotation` follows those blocks (e.g. three rice crops a year). |
| Off-season | On `fallow`, `pre-sowing` (annuals) and `dormant` days `productivity` = compatibility (the outlook), `offSeason: true`, the limiting factor is the static one, and `summary.seasonNow` / the headline say off-season or dormant. |
| Ledger | Each calibration line carries `scoreEffect` {with, without, delta}: the season score re-computed without that one override. |
| Alfalfa pH | Curated pH 4.3/6.5/8.2/9.2 (EcoCrop 4.3/6.5/7.5/8.7): the Diamond Valley pivot (SSURGO pH 8.8) is alfalfa in every CDL year 2019-2025. pH remains its limiting factor. |
