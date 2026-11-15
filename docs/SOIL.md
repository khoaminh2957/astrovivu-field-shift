# Soil Diagnostics, Buffering & Management

Engine: `src/core/soil` (diagnostics, buffering-capacity liming and acidification, action plan). All functions are pure functions of `ModelInput`. Tests: `src/core/soil/soil.test.ts` loads the four real demo sample parcels.

---

## 1. Overview & Objectives

The soil module delivers three core capabilities:

1. **[S1] Soil Diagnostics (`diagnoseSoil`)**: Evaluates on-field physical and chemical soil properties (from SoilGrids, SSURGO, or farmer ground truth) against ecological crop thresholds (`CropRequirements`, primarily FAO EcoCrop) and standard 6-soil-type agronomic benchmarks. Identifies the primary limiting factor (`mostLimitingFactor`).
2. **[S2] Soil Action Plan (`buildSoilPlan`)**: Converts diagnostic deficits into actionable interventions (buffer-adjusted liming, acidification, salinity leaching, drainage remediation, organic matter restoration, baseline N-P-K maintenance), complete with application rate ranges, timing, re-testing verification, evidence citations, caveats, and local review flags. Missing data triggers a "Measure & Validate first" protocol rather than blind inputs.
3. **[S3] Buffering-Capacity Liming & Acidification (`calculateBufferPhPlan`)**: Scales amendment rates based on the soil buffering capacity ($B$), accounting for texture (clay/sand ratio), organic matter (SOC), and cation exchange capacity (CEC), replacing static table estimates.

---

## 2. Master Reference Baselines for 6 Soil Types

Reference thresholds and annual maintenance inputs integrated from `v2_nutrient_for_6_soil_type/`:

| Soil Type | pH (Min / Opt / Max) | AWC (Min / Opt / Max) (in/ft) | CEC (Min / Opt / Max) (meq/100g) | N (kg/ha/yr) | P2O5 (kg/ha/yr) | K2O (kg/ha/yr) | Ca / Mg / S (kg/ha/yr) | Micronutrients Fe / Zn / Mn / Cu / B (kg/ha/yr) |
|---|---|---|---|---|---|---|---|---|
| **Sandy** | 4.50 / 6.25 / 7.50 | 0.40 / 0.80 / 1.25 | 1.0 / 3.5 / 5.0 | 150.0 | 60.0 | 140.0 | 200.0 / 40.0 / 30.0 | 3.0 / 4.0 / 3.0 / 1.5 / 1.5 |
| **Loamy** | 5.50 / 6.50 / 7.50 | 1.50 / 2.00 / 2.30 | 10.0 / 13.5 / 20.0 | 120.0 | 60.0 | 100.0 | 100.0 / 25.0 / 20.0 | 2.0 / 3.0 / 2.0 / 1.0 / 1.0 |
| **Silty** | 5.50 / 6.50 / 8.00 | 1.50 / 2.10 / 2.50 | 15.0 / 20.0 / 25.0 | 110.0 | 55.0 | 110.0 | 120.0 / 25.0 / 20.0 | 2.0 / 3.0 / 2.0 / 1.0 / 1.0 |
| **Clay** | 5.50 / 6.75 / 8.50 | 1.60 / 2.00 / 2.50 | 25.0 / 35.0 / 50.0 | 100.0 | 80.0 | 70.0 | 300.0 / 15.0 / 25.0 | 5.0 / 5.0 / 4.0 / 1.0 / 1.0 |
| **Peat / Organic** | 3.50 / 5.75 / 7.00 | 2.50 / 3.00 / 4.00 | 50.0 / 75.0 / 100.0 | 60.0 | 90.0 | 150.0 | 500.0 / 50.0 / 15.0 | 3.0 / 6.0 / 5.0 / 6.0 / 1.5 |
| **Chalky / Calcareous** | 7.10 / 7.35 / 8.50 | 1.00 / 1.50 / 2.00 | 10.0 / 20.0 / 30.0 | 120.0 | 95.0 | 120.0 | 0.0 / 35.0 / 45.0 | 10.0 / 7.0 / 8.0 / 2.0 / 2.0 |

### Literature Citations
1. **Primary Macronutrients (N, P2O5, K2O)**: International Fertilizer Association (IFA) World Fertilizer Use Manual; FAO Fertilizer and Plant Nutrition Bulletin 16.
2. **Secondary Macronutrients (Ca, Mg, S)**: USDA NRCS Nutrient Management Technical Notes; University of California ANR Soil Fertility Guidelines.
3. **Micronutrients (Fe, Zn, Mn, Cu, B)**: FAO Soils Bulletin 63 – Micronutrient Assessment at the Country Level; Purdue University & Michigan State University Extension Soil Guides.
4. **Physical & Chemical Thresholds (pH, AWC, CEC)**: FAO Harmonized World Soil Database (HWSD v2); USDA NRCS National Engineering Handbook (NEH).

---

## 3. Buffering-Capacity Formulas & Decision Logic

### 3.1. Lime Requirement (LR)
When field pH is below crop optimal minimum ($pH < pH_{\text{optLo}}$):
$$\text{LR} = \Delta pH \times B$$
Where:
- $\Delta pH = \min(pH_{\text{optHi}}, pH_{\text{optLo}} + 0.3) - pH$
- $B$ is the soil buffering capacity factor (metric tonnes pure $\text{CaCO}_3$ equivalent per hectare per 1.0 pH unit in the top ~20 cm root zone):
  - **Sandy**: $B \in [1.2, 2.5]$
  - **Loamy**: $B \in [2.5, 4.5]$
  - **Silty**: $B \in [2.8, 4.8]$
  - **Clay**: $B \in [4.5, 7.5]$
  - **Peat / Organic**: $B \in [5.0, 9.0]$
- Dynamic calibration when CEC or clay % is available:
  $$B_{\text{dynamic}} \approx 0.12 \times \text{CEC} + 0.8 \quad \text{or} \quad B_{\text{dynamic}} \approx 0.06 \times \text{Clay}\% + 1.2$$
- Published sources: McLean, E.O. (1982). *Soil pH and Lime Requirement*, Agronomy Monograph 9, ASA-SSSA; USDA NRCS National Soil Survey Handbook §618.45.

### 3.2. Alkaline Soils & Acidification (Elemental Sulfur)
- When $pH \ge 7.5$ or classified as **Chalky / Calcareous**: The soil contains significant free calcium carbonate ($\text{CaCO}_3$) buffering acid. Broadcasting elemental sulfur is slow, unpredictable, and economically unviable. The engine flags this condition, advising alkaline-tolerant crop varieties and band-applied acidifying fertilizers (such as ammonium sulfate) instead of broadcast sulfur.
- For moderately alkaline, non-calcareous soils: Elemental sulfur rate is adjusted for soil buffering ($0.3 - 0.7$ t S/ha/pH for light soils, $0.6 - 1.3$ for medium, $1.2 - 2.2$ for clay).

### 3.3. Exchangeable Aluminum Toxicity & Kamprath Liming (`aluminiumRisk`)
On strongly acidic mineral soils ($pH < 5.0$), exchangeable trivalent aluminum ($\text{Al}^{3+}$) hydrolyzes into the soil solution, severely inhibiting root elongation and precipitating available phosphorus. When laboratory-measured exchangeable aluminum ($\text{Al}^{3+}_{\text{ex}}$ in $\text{cmol}(+)/\text{kg}$ or $\text{meq}/100\text{g}$) is available, the lime requirement is calculated directly to neutralize exchangeable aluminum rather than aiming for neutral pH:

$$\text{Lime (t CaCO}_3\text{ eq/ha)} = f \times \text{Al}^{3+}_{\text{ex}}$$

Where:
- $f = 1.5$ for low-to-medium organic matter mineral soils.
- $f = 2.0$ for soils with high organic matter ($>5\%$) or higher buffer capacity.
- **Published Source**: Kamprath, E.J. (1970). *Exchangeable aluminum as a criterion for liming leached mineral soils*. Soil Science Society of America Proceedings, 34(2): 252–254.
- **Tropical Regional Context**: Applicable to highly weathered tropical Ultisols and Oxisols (such as the Central Highlands basalt plateau in Vietnam, represented by `daklak-coffee`). Liming to neutralize aluminum avoids micronutrient deficiency and structural dispersion caused by over-liming to pH 6.5–7.0 (Cochrane, Salinas & Sanchez, 1980, *Tropical Agriculture* 57(2): 133–140).
- **Data Gap Handling**: When $\text{Al}^{3+}_{\text{ex}}$ is not measured, the diagnosis returns `status: 'unknown'` or flags `potential_risk` if $pH < 5.5$, issuing a diagnostic protocol for 1M KCl laboratory extraction. Crop tolerance thresholds are only evaluated when verified literature values exist (e.g., cassava, cowpea); uncataloged crops (e.g., *Coffea canephora*) explicitly report that species tolerance data is unavailable and are never guessed from other crops.

### 3.4. Leaching Requirement (LR) & Gypsum Requirement (GR) (`leachingRequirement`)
For salt-affected and sodic soils, the module calculates the seasonal leaching fraction and calcium amendment requirement:

#### A. Leaching Requirement (LR)
Calculates the fraction of applied irrigation water that must pass through the root zone to prevent root-zone salt accumulation from exceeding crop tolerance:

$$LR = \frac{EC_w}{5 \cdot EC_e - EC_w}$$

Where:
- $EC_w$ is the electrical conductivity of the irrigation water (dS/m).
- $EC_e$ is the crop electrical conductivity threshold at 100% attainable yield, linked to Maas & Hoffman (1977) parameterizations (`MAAS_HOFFMAN_PARAMS`).
- **Published Source**: FAO Irrigation and Drainage Paper 29 Rev. 1 (Ayers, R.S. & Westcot, D.W., 1985), *Water Quality for Agriculture*, Section 2.4.2, p. 20–22, Eq. 4.
- **Data Gap Rule**: If irrigation water conductivity ($EC_w$) is unmeasured, the engine sets `leachingFraction = null` and prescribes laboratory measurement of the irrigation water source.

#### B. Gypsum Requirement (GR) for Sodic Soils
When sodium adsorption ratio (SAR) or exchangeable sodium percentage (ESP) is measured, agricultural gypsum ($\text{CaSO}_4 \cdot 2\text{H}_2\text{O}$) dosage is calculated to displace adsorbed sodium and restore clay flocculation:

$$GR (\text{t pure gypsum/ha}) = 0.086 \times \text{CEC} \times (ESP_{\text{initial}} - ESP_{\text{target}}) \times F$$

Where:
- $\text{CEC}$ is cation exchange capacity in $\text{cmol}(+)/\text{kg}$ (or $\text{meq}/100\text{g}$).
- $ESP_{\text{target}} = 10\%$ (safe threshold to prevent clay platelet dispersion and crusting; Oster et al., 1999).
- $F \in [1.1, 1.3]$ accounts for agricultural purity (80%–95%) and field cation exchange displacement efficiency.
- **Published Source**: USDA Agriculture Handbook 60 (L.A. Richards, ed., 1954), *Diagnosis and Improvement of Saline and Alkali Soils*, Chapter 2, p. 38–41, Eq. 6.
- **Data Gap Rule**: No gypsum dosage is calculated without measured sodium (ESP or SAR). If soil $pH \ge 8.5$, suspected sodicity is flagged with a diagnostic testing protocol.

---

## 4. Benchmark Evaluation on Four Sample Parcels

| Sample Parcel | Selected Crop | Current pH & Texture | Diagnostic Result (S1) | Action Plan Summary (S2) | Old vs. New Buffer Plan (S3) |
|---|---|---|---|---|---|
| **daklak-coffee** | Robusta Coffee (*Coffea canephora*) | pH 5.7 (SoilGrids, uncert [4.3, 7.4]), Clay loam (36% clay, CEC 16.9) | `tolerable` (optimal 5.5–6.5), 90% uncertainty interval crosses lower threshold (`uncertain` caveat). Salinity and drainage missing (`no_data`). | Agricultural limestone application; organic matter addition; diagnostic on-site soil sampling. | Old: 1.5–2.4 t/ha. **New**: **1.4–2.3 t/ha** (scaled by clay buffer capacity and 90% confidence bounds). |
| **cantho-rice** | Wet Rice (*Oryza sativa*) | pH 6.1 (SoilGrids, uncert [4.2, 8.2]), Silty clay loam (39% clay, CEC 22.7) | pH inside optimal range (5.5–7.0). **Salinity (EC) and drainage are `no_data`**. | Generates **"Measure & Validate first"** action for salinity and drainage; avoids blind input rates. | Inside optimal: `amendment: 'none'`. |
| **iowa-corn-soy** | Soybean (*Glycine max*) | pH 6.2 (SSURGO), Loam (25% clay, CEC 21.2) | pH optimal (6.0–7.0); EC 0 dS/m (non-saline); drainage moderately well drained. | Annual maintenance fertilizer per Loamy soil baseline; organic matter stewardship. | Inside optimal: `amendment: 'none'`. |
| **nevada-alfalfa** | Alfalfa (*Medicago sativa*) | pH 8.8 (SSURGO), Sandy loam (10% clay, CEC 9.0) | **`tolerable`** (deficit +0.6 vs. 6.5–8.2 optimal). **pH is the primary limiting factor (`isLimiting: true`)**. | Detects free lime carbonate buffering; advises against broadcast sulfur; recommends tolerant varieties / acidifying fertilizers. | Old: unable to estimate. **New**: flags calcareous buffer constraint with safe management guidelines. |

---

## 5. Known Limitations & Next Steps

1. **Salinity and drainage outside the US**: SoilGrids does not map electrical conductivity (EC) or drainage class. Integrating FAO HWSD v2 and local farmer measurements will resolve this gap.
2. **Exchangeable Aluminum ($Al^{3+}$) on acid soils**: Tropical acid sulfate or degraded oxisols require exchangeable aluminum saturation. When $Al^{3+}$ data becomes available, the Kamprath (1970) formula ($\text{Lime} = 1.5 \times Al^{3+}_{\text{ex}}$) will be applied directly.
3. **Economic input costs**: Per-country fertilizer and limestone prices from the crop catalog team will allow automatic calculation of total investment costs ($/ha) and payback timelines.
