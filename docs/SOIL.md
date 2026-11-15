# Soil diagnosis and improvement

Engine: `src/core/soil`. Every function is a pure function of `ModelInput` (no network, no DOM, no clock). Tests: `src/core/soil/*.test.ts`, on the four sample fields of `public/data/samples/`.

The rule of this module: every number, threshold and formula has a source that can be opened and checked (publication, and table, page or equation). Where there is no source, or no reading of the field, the output says so and gives no number. Section 6 lists what was taken out of the output for lack of a source.

## 1. What the module gives

| Function | File | Gives | Reaches the grower through |
|---|---|---|---|
| `diagnoseSoil(input)` | `diagnosis.ts` | One row per soil factor: the reading of the field (source, interval), what the selected crop needs, a status, the distance from the optimum, and the factor to look at first | `AdvisoryReport.soilPlan` (via `buildSoilPlan`) |
| `buildSoilPlan(diagnosis, input, ph)` | `plan.ts` | The steps that follow from the diagnosis: measure first, correct pH, leach salts, drain | `AdvisoryReport.soilPlan` |
| `leachingRequirement(input, measured)` | `salinity.ts` | Salinity and sodicity class, leaching requirement, gypsum requirement | The salinity item of the soil plan (leaching note); the gypsum dose is not in the report yet |
| `aluminiumRisk(input, measured)` | `aluminium.ts` | What is known about exchangeable aluminium and the lime that neutralises a measured amount | Not in the report yet |
| `calculateBufferPhPlan(input)` | `buffer.ts` | A pH plan scaled by buffer capacity | **Not used.** See section 3 |

Statuses of a diagnosis row: `optimal`, `tolerable`, `outside`, `uncertain` (a map estimate whose interval reaches across a limit of the crop), `no_data` (no reading: the value is `null`, nothing stands in for it), `reading_only` (a reading with no requirement in the crop catalogue: no verdict).

## 2. Diagnosis: the crop's own requirement

The requirement is read from the crop catalogue (`getCrop(id).req`, FAO EcoCrop for most crops; `docs/CROP_DATA.md`) with the same rules as the suitability model (`fitFor` in `src/core/scoring/index.ts`, `docs/SCORING.md`). A row is `optimal` exactly when the model scores that factor 1, and has no verdict exactly when the model has no score; `soil.test.ts` ("agrees with the suitability model") checks this on the four sample fields and on four cases with grower readings, 40 comparisons.

| Row | Reading | Requirement | `optimal` | `tolerable` | `outside` |
|---|---|---|---|---|---|
| `ph` | `groundTruth.ph`, else the `ph` fact | `req.ph` = [absMin, optMin, optMax, absMax] | optMin to optMax | absMin to absMax | beyond |
| `texture` | `groundTruth.texture`, else the `texture_class` fact | `req.texture` (lists of classes) | class in `opt` | class in `abs` | in neither |
| `drainage` | `groundTruth.drainage` (or the issue `waterlogging`), else `drainage_class` brought to poor / well / excessive as the model does | `req.drainage` | class in `opt` | class in `abs` | in neither |
| `depth` | `groundTruth.soilDepthCm`, else `depth_cm`; classes of EcoCrop: under 20 cm, 20-50, 50-150, over 150 | `req.depth` (least depth) | at least `opt` | at least `abs` | shallower |
| `salinity` | `groundTruth.ecDsM`, else `ec_dsm` | threshold of the crop's salinity class, `MAAS_HOFFMAN_PARAMS` in `src/core/scoring/literature.ts` (1.3, 2.0, 4.5, 8.0 dS/m for the classes none, low, medium, high) | EC up to the threshold of `req.salinity.opt` | up to the threshold of `req.salinity.abs` | above |
| `organic_matter`, `cec`, `awc`, `nitrogen` | the facts of the soil branch | none in the catalogue | never judged: `reading_only` | | |

Notes.

- pH from a soil map carries the interval of the estimate. When that interval reaches across a limit of the crop the status is `uncertain` and the note asks for a measurement; `deficit` keeps the distance of the central value.
- A crop without a requirement for a factor (two crops of the catalogue have no salinity class, for example) gets `reading_only`: no threshold is assumed.
- No texture class, no drainage class, no depth, no EC, no available water capacity: `no_data`. Texture is not taken as medium, and available water capacity is not taken from a soil group.
- Organic matter is the reading, or organic carbon x 1.724 (the factor `src/core/scoring` uses). Available water capacity is shown in mm of water per metre of soil (cm/cm x 1,000).
- Not mirrored from the model: the 6 dS/m it assumes when the grower ticks the issue "salinity" without a reading, and the texture class it derives from clay and sand when the map has no class. The diagnosis reports `no_data` in both cases.

## 3. pH plan

The pH plan of the report (`AdvisoryReport.ph`) is `phPlan` in `src/core/advisory/actions.ts`, unchanged from `main`: the gap to the crop's optimum, capped at 1.5 pH units per application for lime and 1 unit for sulfur, times a rate per texture class. The pH item of the soil plan carries that same plan (`buildSoilPlan(diagnosis, input, ph)`), so the report shows one lime figure.

**The buffer method (`calculateBufferPhPlan`, `buffer.ts`) is not used by the report**, and will not be until each of its coefficients has a source with a table or page:

- the factors per soil group (`LIME_BUFFER_FACTORS`, `SULFUR_BUFFER_FACTORS`),
- `0.12 x CEC + 0.8` and `0.06 x clay + 1.2`,
- the band of 15 percent around them,
- the soil group itself (`classifyReferenceSoilType`: organic carbon above 120 g/kg, pH 7.6).

Three more things to settle before it is wired in: organic carbon is read but not used; the correction is not capped per application; with a map pH the range is too wide to act on (table 4.3: 0.2-18.8 t/ha where the report gives 5.5-8.8).

## 4. Results on the sample fields

These tables are the output of the code. `soil.test.ts` ("tables of docs/SOIL.md, section 4") builds every row and fails when the document does not contain it.

### 4.1 Diagnosis, default crop

Status of the five factors the crop has a requirement for, with the reading in brackets.

| Field | Crop | pH | Texture | Drainage | Depth | Salinity (dS/m) | Look first at |
|---|---|---|---|---|---|---|---|
| daklak-coffee | coffea-canephora | uncertain (5.7) | optimal (clay loam) | no_data | no_data | no_data | ph |
| cantho-rice | oryza-sativa | uncertain (6.1) | optimal (silty clay loam) | no_data | no_data | no_data | ph |
| iowa-corn-soy | zea-mays | optimal (6.2) | optimal (loam) | optimal (Moderately well drained) | no_data | optimal (0) | none |
| nevada-alfalfa | medicago-sativa | tolerable (8.8) | optimal (sandy loam) | optimal (Well drained) | no_data | optimal (1) | ph |

The pH of the two Vietnamese fields comes from SoilGrids with intervals of 4.3-7.4 and 4.2-8.2, which reach across the limits of the crop: the central value is inside the optimum, the verdict is `uncertain`.

### 4.2 Soil plan, default crop

| Field | pH plan of the report | Items of the soil plan |
|---|---|---|
| daklak-coffee | none | drainage: measure first; depth: measure first; salinity: measure first |
| cantho-rice | none | drainage: measure first; depth: measure first; salinity: measure first |
| iowa-corn-soy | none | depth: measure first |
| nevada-alfalfa | sulfur, no rate | ph: no rate; depth: measure first |

Nevada: at pH 8.8 the soil is probably calcareous, so the pH plan names sulfur and gives no rate.

### 4.3 pH plan: the report and the buffer method

Six cases. "Report" is what a grower sees (`phPlan`, same as `main`). "Buffer method" is `calculateBufferPhPlan`, shown for comparison only.

| Field | Crop | pH used | pH now -> target | Report | Buffer method (not used) |
|---|---|---|---|---|---|
| daklak-coffee | coffea-canephora | map pH | 5.7 -> 5.7 | none | none |
| daklak-coffee | medicago-sativa | map pH | 5.7 -> 6.8 | lime, 5.5-8.8 t/ha | lime, 0.2-18.8 t/ha |
| daklak-coffee | coffea-canephora | grower pH 4.5 | 4.5 -> 5.3 | lime, 4-6.4 t/ha | lime, 1.9-6 t/ha |
| cantho-rice | oryza-sativa | map pH | 6.1 -> 6.1 | none | none |
| iowa-corn-soy | zea-mays | map pH | 6.2 -> 6.2 | none | none |
| nevada-alfalfa | medicago-sativa | map pH | 8.8 -> 7.9 | sulfur, no rate | sulfur, no rate |

### 4.4 Worked doses

The laboratory values are test values, not readings of the fields; CEC and bulk density are the ones the sample files hold.

| Dose | Field and test value | Readings used | Result |
|---|---|---|---|
| Gypsum | nevada-alfalfa, test value ESP 22 % | CEC 9 cmol(+)/kg, bulk density 1.43 t/m3, depth 0.2 m | 2.7-3.3 t/ha |
| Lime for aluminium | daklak-coffee, test value Al 2 cmol(+)/kg | bulk density 1.17 t/m3, depth 0.2 m | 3.5-4.7 t/ha |
| Leaching requirement | nevada-alfalfa, test value ECw 1.2 dS/m | crop threshold 2 dS/m | LR 0.136, 116 mm per 100 mm |

By hand. Gypsum: 0.086 x 0.2 m x 1.43 t/m3 x 9 cmol(+)/kg x (22 - 10) = 2.66 t/ha, times 1.25 = 3.32. Lime: 2 cmol(+) Al/kg x 1.5 = 3 cmol(+) CaCO3/kg = 1.5 g/kg, in 10,000 x 0.2 x 1.17 = 2,340 t of soil = 3.51 t/ha; with the factor 2, 4.68 t/ha. Leaching: 1.2 / (5 x 2.0 - 1.2) = 0.136; 100 / (1 - 0.136) = 116.

## 5. Doses: formulas and sources

### 5.1 From cmol(+)/kg to t/ha (`mass.ts`)

A laboratory reports per kilogram of soil; a dose is per hectare. Soil in a layer: 10,000 m2 x depth (m) x bulk density (t/m3). The depth is a stated 0.2 m (`DOSE_DEPTH_M`: the layer sampled and worked), named in every note that carries a dose. The bulk density is the `bulk_density` fact of the field. Without it there is no dose.

### 5.2 Leaching requirement

LR = ECw / (5 x ECe - ECw), and the water to apply AW = ET / (1 - LR).

- Source: Ayers & Westcot (1985), *Water quality for agriculture*, FAO Irrigation and Drainage Paper 29 Rev. 1, section 2.4.2 "Salinity control by leaching", equation (9) for LR and equation (7) for AW (online edition: https://www.fao.org/4/t0234e/T0234E03.htm).
- Check: Example 3 of that section (maize, ECw 1.2 dS/m, ET 800 mm): ECe 2.5 dS/m gives LR 0.10, ECe 1.7 dS/m gives 0.16, and 890 mm to apply. `salinity.test.ts` reproduces it within rounding.
- ECe: the grower's own figure from FAO 29 Table 4 when given (`measured.cropThresholdEcDsM`); otherwise the threshold of the crop's salinity class (`MAAS_HOFFMAN_PARAMS`), which is the level where yield loss begins. FAO 29 advises the ECe for at least 90 percent yield, which gives a smaller LR; the note says so. A crop without a salinity class gets no LR.
- No figure when ECw is missing, when 5 x ECe - ECw is zero or negative, or when LR reaches 1: the note says the water is too saline for the crop and gives no depth of water.

### 5.3 Salinity and sodicity classes

- Salinity class of the soil by ECe: 0-2 not saline, 2-4 slightly, 4-8 moderately, above 8 strongly saline. Source: Abrol, Yadav & Massoud (1988), *Salt-affected soils and their management*, FAO Soils Bulletin 39, Table 10 (section 3.1.2). The two top classes of the table (8-16, above 16) are reported as one.
- Sodic: exchangeable sodium percentage above 15. Source: FAO Soils Bulletin 39, section 4.1.
- ESP from SAR: ESP = 100 (-0.0126 + 0.01475 SAR) / (1 + (-0.0126 + 0.01475 SAR)). Source: Richards (ed., 1954), *Diagnosis and improvement of saline and alkali soils*, USDA Agriculture Handbook 60, p. 26. The result says when ESP was computed this way.
- A pH of 8.5 or more only asks for ESP or SAR to be measured (Richards 1954, as cited in FAO Soils Bulletin 39 section 4.1, which adds that pH alone is not an index of sodicity).

### 5.4 Gypsum requirement

GR (t/ha of pure gypsum) = 0.086 x depth (m) x bulk density (t/m3) x CEC (cmol(+)/kg) x (ESP - 10), given as a range from that amount to 1.25 times it.

- 0.086: 1 cmol(+) of sodium per kg takes 0.86 g of gypsum per kg of soil. Source: FAO Soils Bulletin 39, section 4.4.1 (iii) "Quantity of amendment" ("86 x 10-5 kg/kg soil"); the same equivalence gives Table 6 of USDA Handbook 60 (p. 49).
- Target ESP 10: USDA Handbook 60, p. 49, works its example down "to about 10"; FAO Soils Bulletin 39, Table 32 (footnote), puts the level above which sensitive crops are seriously affected at about 10.
- 1.25: USDA Handbook 60, pp. 49-50: the amounts of Table 6 are multiplied by 1.25 to compensate for the lack of quantitative replacement.
- Given only when the soil is sodic (ESP above 15) and the field has CEC and bulk density. Missing CEC or bulk density: no dose, and the measurement is added to the list. No default CEC.
- The dose is for pure gypsum; the note says to divide by the purity of the product.

### 5.5 Aluminium

- Lime that neutralises exchangeable aluminium: 1.5 to 2 cmol(+) of CaCO3 per cmol(+) of Al, per kg of soil. Source: Kamprath, E.J. (1970), Exchangeable aluminum as a criterion for liming leached mineral soils, *Soil Science Society of America Proceedings* 34: 252-254. Soils it applies to: leached mineral soils (Ultisols, Oxisols). Turned into t/ha with section 5.1: 1 cmol(+) of CaCO3 is 0.5 g.
- Aluminium saturation = Al / (Al + exchangeable Ca, Mg, K, Na). The CEC of a soil map is measured at pH 7 and is not the effective CEC: without the exchangeable bases the saturation is not computed, and the result asks for them.
- Status: `unknown` without a measurement (or with a negative value, which is not a reading); `safe` when the measurement is 0, with no lime recommended; `potential_risk` when aluminium is present. Nothing is called toxic: the module holds no saturation threshold with a source.
- No crop tolerance is reported for any crop (section 6).

### 5.6 Crop nutrient removal budgets (Issue #49 / S8)

- Nutrient removal per metric ton of harvested product:
  $$\text{Removal (kg/ha)} = \text{Target Yield (t/ha)} \times \text{Removal Factor (kg/t)}$$
- Source: International Plant Nutrition Institute (IPNI, 2014), *Nutrient Removal by Crops*, Table 1; IFA/FAO (2002), *Fertilizer Use by Crop*.

| Crop | Harvested Product | N Removal (kg/t) | P₂O₅ Removal (kg/t) | K₂O Removal (kg/t) | Default Target Yield (t/ha) |
|---|---|---|---|---|---|
| Maize (`zea-mays`) | Grain | 21–25 | 8–10 | 18–24 | 8.0 |
| Paddy Rice (`oryza-sativa`) | Grain | 16–20 | 7–9 | 20–28 | 6.0 |
| Soybean (`glycine-max`) | Seed | 55–65 | 13–17 | 25–35 | 3.5 |
| Coffee (`coffea-canephora`) | Green bean | 30–40 | 6–8 | 35–50 | 2.5 |
| Alfalfa (`medicago-sativa`) | Dry hay | 26–30 | 6–7 | 24–28 | 10.0 |
| Wheat (`triticum-aestivum`) | Grain | 24–28 | 9–11 | 18–22 | 5.0 |

- Soil nitrogen supply and mineralization:
  - Total topsoil (0–20 cm) nitrogen stock = $\text{total N (g/kg)} \times \text{soil mass (t/ha)}$ (from section 5.1).
  - Annual plant-available mineralized N = 1% to 3% of total organic N stock.
- Caveats and rules:
  - Legumes (soybean, alfalfa) note that 50–70% of N requirements are supplied through symbiotic biological $N_2$ fixation.
  - Potassium removal depends on whether straw/stover is exported or retained in the field (straw holds 70–80% of total plant K).
  - No specific P or K fertilizer dosage is stated without an on-farm soil test (e.g. Olsen P, Bray-1 P, or exchangeable K). The module reports harvest removal to prevent nutrient mining.

## 6. Removed from the output for lack of a source

Each can come back with a publication, year, table or page, and licence.

| What | Where it was | Why |
|---|---|---|
| Reference table for six soil groups: pH, AWC, CEC, N, P2O5, K2O, Ca, Mg, S, Fe, Zn, Mn, Cu, B (about 110 numbers) | `reference.ts`, section 2 of this document | Named organisations only; the folder `v2_nutrient_for_6_soil_type/` it came from is not in the repository |
| Yearly fertiliser item of the plan (for example 120 kg N/ha for alfalfa) | `plan.ts` | Rested on the table above |
| "Optimal / outside" verdicts for CEC and AWC, and the AWC put in place of a missing reading | `diagnosis.ts` | Rested on the table above |
| Organic matter verdict at 2.5 % and 1.5 %, nitrogen verdict at 1.5 g/kg | `diagnosis.ts` | No source |
| Compost rates 5-12 and 10-20 t/ha | `plan.ts` | No source |
| Salinity verdict at 1.0 and 2.5 dS/m for every crop; classes at 1.0 / 2.5 / 4.0 dS/m | `diagnosis.ts`, `salinity.ts` | Replaced by the crop's class threshold and by FAO Soils Bulletin 39 Table 10 |
| Default crop threshold 2.0 dS/m; default CEC 15 cmol(+)/kg; default texture "medium" | `salinity.ts`, `aluminium.ts`, `diagnosis.ts` | A default is not a reading |
| Gypsum efficiency 1.1-1.3; sodicity classes at ESP 10 and 15 ("sodic", "severely sodic"); "split gypsum above 5 t/ha" | `salinity.ts` | Replaced by the factor 1.25 of Handbook 60 and the limit of ESP 15 of FAO 39; the split had no source |
| Aluminium saturation threshold 20 %; "toxic below pH 5.0"; "risk below pH 5.5" | `aluminium.ts` | No table or page |
| Aluminium tolerance of cassava (60/80 %), pineapple (50/70 %), cowpea (25/45 %) | `aluminium.ts` | Cited Cochrane, Salinas & Sanchez (1980) and Sanchez (2019) without table or page |
| "Split lime above 3.5-4.0 t/ha" in the aluminium result; re-test "after 60-90 days"; "water table below 1.2 m"; "rain above 30 mm, 24 hours" | `aluminium.ts`, `plan.ts` | No source; the sentences stay without the figures |
| Buffer coefficients (section 3) | `buffer.ts` | Kept in the file, not used by the report |

## 7. Known limits

1. SoilGrids carries no EC, drainage class or depth, so fields outside the United States get `no_data` for three of the five factors until the grower enters them.
2. The gypsum and aluminium results are computed by the module but not yet shown in the report: they need laboratory values (ESP or SAR, exchangeable Al and bases) that the grower's form does not ask for yet (`GroundTruth` has no such fields).
3. Bulk density comes from SoilGrids with a wide interval (Nevada: 1.12-1.72 t/m3). The dose uses the central value and names it; the interval is not yet carried into the range.
4. The upper Kamprath factor (2) and the page of the paper where it stands should be confirmed against the article by whoever has access to it.
5. Prices of lime and gypsum per country are not in the crop tables, so no cost is given.
