# Astrovivu-AEZ v2: A Hybrid Liebig–Khiddir Parametric and Coupled Daily Agro-Hydrological Framework for Parcel-Scale Crop Suitability and Productivity Assessment with Multi-Sensor NASA Earth Observations

**Technical Manuscript & Mathematical Specification — Astrovivu Research Group (NASA Space Apps Challenge 2026: *Adapting Farms with NASA Data*)**  
**Version:** 2.0 (2026-11-14)  
**Implementation:** `src/core/scoring/literature.ts`, `src/core/scoring/index.ts`  
**Reproducibility Suite:** `scripts/crops/evaluate-scoring-paper.ts` $\rightarrow$ `data/crops/scoring-paper-results.json`  
**Keywords:** Land suitability evaluation; Agro-Ecological Zoning (AEZ); Analytic Hierarchy Process (AHP); FAO-56 water balance; Root-zone aeration stress; Maas–Hoffman salinity; Satellite data assimilation; Global sensitivity analysis (Sobol–Morris).

---

## Abstract

**Background:** Smallholder and commercial farmers face intensifying hydroclimatic volatility, soil salinization, and groundwater depletion, yet publicly accessible Earth observation (EO) products span mismatching spatial scales—from 10–30 m optical imagery and 250 m–1 km vegetation/thermal retrievals (MODIS, VIIRS) to 5–25 km hydro-meteorological analyses (CHIRPS, NASA POWER, SMAP L4, ClimateSERV ESI, ERA5-Land). Existing parcel-scale crop suitability engines suffer from two structural defects: (1) static GIS Multi-Criteria Decision Analysis (MCDA) models based on Weighted Linear Combination (WLC) violate Liebig's Law of the Minimum by allowing favourable soil attributes to compensate for lethal drought or frost, whereas unweighted multiplicative indices (Storie, 1933) suffer severe numerical collapse when multiple mild, manageable edaphic sub-optima co-occur; and (2) climatological suitability rules ignore intra-seasonal root expansion, atmospheric evaporative demand shifts, monsoon root-zone anaerobiosis, reproductive daytime heat shocks, and real-time satellite anomalies.

**Methods:** Synthesizing twenty peer-reviewed studies across parametric land evaluation, AHP multi-criteria weighting, soil-plant-atmosphere physics, edaphic response curves, and remote-sensing data assimilation, we formulate **Astrovivu-AEZ v2**, a pure, deterministic two-tier scoring engine. Static crop-site **compatibility** combines continuous biophysical response functions—including Maas–Hoffman threshold-slope salinity and Oldfield Michaelis–Menten soil organic carbon (SOC) saturation—weighted via a four-tier Saaty AHP principal eigenvector ($\mathrm{CR} = 0.0030 \ll 0.10$) under a novel **Hybrid Liebig–Khiddir Rank-Damped Parametric Operator** paired with non-compensatory bioclimatic survival gates. Dynamic daily **condition** couples a two-pass FAO-56 root-zone water balance—enhanced with Borg–Grimes sigmoidal root growth $Z_r(t)$, FAO-56 Eq. 62/65 climatic $K_c$ adjustment, and Feddes/AquaCrop anaerobiosis stress $K_{\mathrm{aer}}$—with asymmetric daytime $T_{\max}$ reproductive heat shock, Monteith PAR light sufficiency, and precision-weighted anomaly assimilation across four EO streams (NDVI, ESI, root-zone soil moisture, daytime canopy LST), calibrated online by farmer ground-truth measurements.

**Results:** Across $M = 1{,}000$ Monte Carlo reciprocal matrix perturbations ($\pm 25\%$ log-uniform judgement noise), $100\%$ of perturbed AHP matrices maintain $\mathrm{CR} < 0.015$ and preserve strict four-tier factor ordering. On a 56-case agro-ecological ground-truth benchmark spanning four contrasting real parcels (Đắk Lắk basalt highland, An Giang Mekong alluvial paddy, Story County Iowa Mollisol, and Diamond Valley Nevada desert pivot), WLC exhibits a $20.0\%$ false-positive rate at the FAO $S_2$ suitability threshold ($S \ge 60$), falsely endorsing rainfed black pepper ($0.634$) and rainfed paddy rice ($0.687$) under four-month dry spells, whereas Storie ($\mathrm{Brier} = 0.1072$) and Khiddir ($\mathrm{Brier} = 0.1007$) under-score viable upland rotations. Astrovivu-AEZ v2 achieves a $0.0\%$ false-positive rate at $S \ge 60$, $100\%$ specificity, the highest Youden's index ($J = 0.8710$), and the lowest non-compensatory Brier score ($0.0759$). Continuous Maas–Hoffman salinity reduces RMSE against FAO-56 Table 23 reference curves by $14.56\%$ overall and $86.7\%$ for rice ($0.3350 \rightarrow 0.0444$). Sobol–Jansen variance decomposition ($45{,}056$ Halton quasi-Monte Carlo evaluations) reveals that non-additive factor interactions ($1 - \sum S_i$) account for $27.58\%\text{–}35.04\%$ of suitability variance, explaining from first principles why linear additive scoring fails. Full-catalogue screening of $2{,}063$ species across four biomes ($99{,}024$ monthly windows) executes in $6.41\text{ s}$ ($776.8\,\mu\text{s}$ per crop–site pair), enabling instant interactive counterfactual (`whatIf`) advisory in browser environments.

---

## 1. Introduction

Translating multi-mission satellite observations into actionable crop switching, sowing-window selection, and irrigation decisions at the individual farm parcel requires bridging three scientific gaps:

1. **The Compensatory vs. Multiplicative Dilemma in Land Evaluation:** Following the FAO *Framework for Land Evaluation* (FAO, 1976), GIS-based agricultural suitability studies predominantly aggregate $m$ standardized factor ratings $s_i \in [0, 1]$ via Weighted Linear Combination, $S_{\mathrm{WLC}} = \sum_{i=1}^m w_i s_i$ (Akıncı et al., 2013; Pramanik, 2016; Herzberg et al., 2019). Because WLC is purely additive, a parcel with zero growing-season water ($s_{\mathrm{water}} = 0$, lethal drought) but optimal temperature and soil ratings still receives $S_{\mathrm{WLC}} > 0.75$ ("Suitable"), violating Liebig's Law of the Minimum. Conversely, pure multiplicative indices such as the Storie Index $S_{\mathrm{Storie}} = \prod_{i=1}^m s_i$ (Storie, 1933, 1978) enforce zero-veto but suffer severe multi-factor compounding collapse: seven mild, agronomically manageable edaphic ratings of $0.75$ multiply to $0.75^7 = 0.133$ ("Not Suitable"), falsely disqualifying productive farmland.
2. **Discontinuous Edaphic Proxies and Uncalibrated Static Weights:** Operational implementations of FAO EcoCrop (Ramirez-Villegas et al., 2013) score only monthly temperature and cumulative precipitation, omitting soil chemistry, drainage, root depth, and terrain. When edaphic layers from global digital soil maps such as SoilGrids 250 m are added via coarse categorical step functions, artificial score cliffs arise at class boundaries (e.g., electrical conductivity jumping from $1.0$ at $1.99\text{ dS m}^{-1}$ to $0.70$ at $2.01\text{ dS m}^{-1}$), while ad-hoc factor exponents lack formal multi-criteria consistency verification.
3. **Decoupling of Climatological Suitability from Intra-Seasonal Agro-Hydrology and Satellite Anomalies:** Static suitability cannot see whether the *current* agricultural year is experiencing a flash drought, early-seedling root-zone desiccation, monsoon waterlogging, or flowering-stage canopy heat shock. Conversely, raw coarse-resolution EO retrievals—such as 9 km SMAP L4 root-zone soil moisture or 5 km Evaporative Stress Index (ESI)—cannot be plugged directly into parcel-level thresholds without inducing severe sub-pixel spatial bias on 0.5–5 ha smallholder fields.

To resolve these challenges within **Astrovivu**, we conduct a systematic synthesis of twenty peer-reviewed foundational and contemporary studies (Section 2), derive the **Astrovivu-AEZ v2** mathematical architecture with formal proofs of its aggregation properties (Section 3) and scale-aware EO assimilation rules (Section 4), and execute six reproducible empirical and variance-based sensitivity experiments on real satellite and agro-climatic datasets across Vietnam and the United States (Sections 5–6).

---

## 2. Systematic Review and Synthesis of Twenty Peer-Reviewed Studies

We selected and verified twenty primary peer-reviewed publications and international technical monographs spanning five methodological pillars: (I) Parametric Land Evaluation & Agro-Ecological Zoning, (II) Analytic Hierarchy Process (AHP) Multi-Criteria Weighting, (III) Dynamic Root-Zone Agro-Hydrology & Aeration Physics, (IV) Continuous Edaphic Chemistry & Thermal/Radiation Crop Physiology, and (V) Agricultural Remote-Sensing Data Assimilation & Global Sensitivity Analysis. Table 1 synthesizes all twenty works, their mathematical mechanisms, documented failure modes, and exact integration into Astrovivu-AEZ v2.

### Table 1. Synthesis of the 20 Peer-Reviewed Studies Underlying Astrovivu-AEZ v2

| # | Study & Verified Identifier | Pillar | Core Mathematical / Biophysical Formulation | Key Strength | Limitation When Used Alone | Integration in Astrovivu-AEZ v2 |
|---|---|---|---|---|---|---|
| 1 | **FAO (1976)** *FAO Soils Bull. 32* | I. Parametric AEZ | Suitability classes $S_1, S_2, S_3, N_1, N_2$ matched by most-limiting land quality | Universal agronomic taxonomy & limiting-factor diagnosis | Qualitative class matching lacks continuous gradients | Defines the 5 suitability tiers ($[80,100]$ to $[0,20)$) & explicit `limiting` factor reporting |
| 2 | **Storie (1933; 1978)** *UC AES Bull. 556 / Spec. Pub. 3203* | I. Parametric AEZ | Multiplicative rating $I = A \cdot B \cdot C \cdot X$ across soil profile, texture, slope & chemistry | Strict non-compensatory zero-veto ($s_i = 0 \Rightarrow I = 0$) | Severe compounding collapse under $m \ge 5$ mild sub-optima | Baseline multiplicative benchmark; zero-veto retained while multi-factor collapse is analytically bounded |
| 3 | **Khiddir (1986); Sys et al. (1991)** *Ghent Univ. / GADC Land Eval. I–III* | I. Parametric AEZ | Square-Root Parametric Index: $I_{\mathrm{SQRI}} = R_{\min} \sqrt{\prod_{j \ne \min} (R_j / 100)}$ | Attenuates secondary factor penalties relative to Storie | Treats climate and minor terrain equally; discontinuous derivative if unweighted | Generalized into continuous rank-damped edaphic exponents $\prod_{r \ge 1} c_{(r)}^{1/\sqrt{r}}$ |
| 4 | **Rabia & Terribile (2013)** *IJESD*, DOI:`10.7763/IJESD.2013.V4.295` | I. Parametric AEZ | Geometric/root-hybrid comparison against Storie & additive WLC on Mediterranean soils | Demonstrates SQRI superiority over WLC & Storie in field mapping | No AHP differential weighting between climatic vs edaphic tiers | Motivates coupling AHP exponents $c_i = s_i^{\alpha_i}$ prior to harmonic-root rank damping |
| 5 | **Ramirez-Villegas et al. (2013)** *Agric. For. Meteorol.*, DOI:`10.1016/j.agrformet.2011.09.005` | I. Parametric AEZ | Calibrated EcoCrop: piecewise trapezoidal $T$ & $R$ response, $T_{\mathrm{kill}} + 4\,^\circ\mathrm{C}$ frost rule, $S = S_T \cdot S_R$ | Scales across $>2{,}000$ species; captures Liebig climate interaction | Ignores soil pH, EC, drainage, fallow water storage & dormancy | Provides exact growing-window length, trapezoidal response, $T_{\mathrm{kill}} + 4\,^\circ\mathrm{C}$ gate & full-strength climate product |
| 6 | **Fischer et al. (2021)** *FAO/IIASA GAEZ v4*, DOI:`10.4060/cb4744en` | I. Parametric AEZ | Tiered agro-climatic thermal/moisture screening $\times$ damped edaphic & terrain reduction factors | Global gold standard separating climate potential from soil modifiers | Complex lookup tables opaque to parcel-level farmer calibration | Structural blueprint for separating full-strength climate multiplication, damped edaphic modifiers & slope ramps |
| 7 | **Saaty (1980; 1987)** *McGraw-Hill* / *Math. Model.*, DOI:`10.1016/0270-0255(87)90473-8` | II. MCDA / AHP | Principal right eigenvector $A w = \lambda_{\max} w$; $\mathrm{CI} = \frac{\lambda_{\max}-n}{n-1}$, $\mathrm{CR} = \mathrm{CI}/\mathrm{RI}_n < 0.10$ | Mathematically rigorous ratio-scale weight elicitation & consistency check | Often paired with compensatory additive WLC in GIS studies | Solves the $9 \times 9$ biophysical criticality matrix ($\mathrm{CR} = 0.0030$) mapped to non-compensatory exponents $\alpha_i = w_i / w_{\max}$ |
| 8 | **Akıncı et al. (2013)** *Comput. Electron. Agric.*, DOI:`10.1016/j.compag.2013.07.006` | II. MCDA / AHP | Hierarchical AHP suitability weighting across soil depth, texture, drainage, slope & erosion | Empirically validated hierarchy of physical edaphic vs topographic limits | Additive WLC aggregation allows slope/soil to mask climate limits | Informs Tier 2 (drainage) > Tier 3 (depth, texture) > Tier 4 (slope) pairwise judgements |
| 9 | **Pramanik (2016)** *Model. Earth Syst. Environ.*, DOI:`10.1007/s40808-016-0116-8` | II. MCDA / AHP | Agro-climatic & topographic AHP land suitability in monsoon hill agro-ecosystems | Quantifies dominance of moisture/thermal availability over terrain | Site-specific static map without inter-annual climate reliability | Supports Tier 1 climate primacy ($\sim 45\%$ weight share) + 20-year ERA5 inter-annual reliability |
| 10 | **Seyedmohammadi et al. (2018)** *Geoderma*, DOI:`10.1016/j.geoderma.2017.09.012` | II. MCDA / AHP | Comparative SAW, TOPSIS & Fuzzy TOPSIS for maize, rapeseed & soybean priority planning | Demonstrates sensitivity of crop rankings to continuous vs crisp boundaries | Requires local laboratory soil grids unavailable globally | Motivates continuous edaphic membership functions + two-stage `rankScore` tie-breaking |
| 11 | **Herzberg et al. (2019)** *Land*, DOI:`10.3390/land8060090` | II. MCDA / AHP | AHP vs FAO limiting-factor evaluation in Central Vietnam smallholder landscapes | Directly proves WLC over-estimates suitability when a single factor is severe in Vietnam | Pure limiting-factor min-rule ignores secondary constraints | Empirical justification for rejecting WLC and retaining strict single-factor limiting attribution in Vietnam |
| 12 | **Pilevar et al. (2020)** *Ecol. Indic.*, DOI:`10.1016/j.ecolind.2019.105887` | II. MCDA / AHP | Integrated fuzzy-AHP weighting of EC salinity, pH, drainage, texture & climate in semi-arid basins | Establishes parity of pH, salinity & drainage above physical texture | Static seasonal snapshot without irrigation budget simulation | Anchors Tier 2 chemical/hydrologic parity ($\alpha_{\mathrm{pH}} = \alpha_{\mathrm{sal}} = \alpha_{\mathrm{drain}} = 0.522$) |
| 13 | **Allen et al. (1998)** *FAO Irrig. Drain. Paper 56* | III. Agro-Hydrology | Penman–Monteith / Hargreaves $ET_0$ (eq. 52), stage $K_c$ climatic adjustment (eq. 62, 65), daily root-zone depletion $D_r$ & $K_s$ (eq. 82–86) | Physically consistent daily root-zone water balance & irrigation scheduling | Assumes well-aerated soil ($K_{\mathrm{aer}} = 1$) & tabulated $Z_r$ unless extended | Core daily $D_r(t)$, $K_s(t)$, vapor-pressure $RH_{\min}$ (eq. 11, 19) & wind/humidity $K_c$ scaling |
| 14 | **Steduto et al. (2012)** *FAO Irrig. Drain. Paper 66* (with Doorenbos & Kassam, 1979; Jensen, 1968) | III. Agro-Hydrology | Relative yield response $1 - Y_a/Y_x = K_y (1 - ET_a/ET_c)$ with phenological stage sensitivity | Directly links daily evapotranspiration deficits to harvestable yield fraction | Uniform seasonal $ET_a/ET_c$ underweights flowering drought unless stage-weighted | Blended seasonal & stage-weighted ($s_{\mathrm{stage}} \in \{0.4, 0.7, 1.0, 0.4\}$) $ET_a/ET_c$ yield fraction |
| 15 | **Borg & Grimes (1986)** *Trans. ASAE*, DOI:`10.13031/2013.30125` | III. Agro-Hydrology | Universal sigmoidal root-depth expansion $Z_r(t) = Z_{r,\min} + (Z_{r,\max}-Z_{r,\min})[0.5 + 0.5\sin(3.03\,t/t_{\max} - 1.47)]$ | Validated across 48 crop species; eliminates early-season $TAW$ inflation | Applies to annual root establishment, not mature orchards | Implemented in daily water balance for annual/biennial crops while preserving $Z_{r,\max}$ for perennials |
| 16 | **Raes et al. (2009)** *Agron. J.*, DOI:`10.2134/agronj2008.0140s` (with Feddes et al., 1978) | III. Agro-Hydrology | AquaCrop dual stress: stomatal drought $K_s$ & root-zone anaerobiosis $K_{\mathrm{aer}}$ above field capacity | Separates drought-tolerant upland crops from flood-adapted hydrophytes | Requires daily drainage percolation flux parameterization | Implemented via saturation-excess reservoir, texture/drainage percolation & hydrophytic exemption |
| 17 | **Maas & Hoffman (1977)** *J. Irrig. Drain. Div. ASCE*, DOI:`10.1061/JRCEA4.0001137` | IV. Edaphic & Thermal | Continuous piecewise linear salt tolerance $Y_r = 1 - b(\mathrm{EC}_e - a)$ for $\mathrm{EC}_e > a$ | Canonical biophysical law reproduced in FAO-56 Table 23 | Species outside FAO-56 lack $(a,b)$ unless mapped to tolerance classes | Parameterizes EcoCrop salinity classes into continuous threshold-slope curves (`maasHoffmanSalinity`) |
| 18 | **Oldfield et al. (2019)** *SOIL*, DOI:`10.5194/soil-5-15-2019` (with Sanchez et al., 2003) | IV. Edaphic & Thermal | Global meta-analysis showing saturating crop yield response to SOC plateauing near $2.0\%$ ($20\text{ g kg}^{-1}$) | Replaces arbitrary linear organic-matter proxies with saturating kinetics | Fertilization can partially substitute low native SOC | Normalized Michaelis–Menten SOC & CEC index ($K_m = 8$) with $[0.20, 1.0]$ manageable floor |
| 19 | **Schlenker & Roberts (2009)** *PNAS*, DOI:`10.1073/pnas.0906865106`; **Sánchez et al. (2014)** *GCB*; **Monteith (1977)** *Phil. Trans. R. Soc. B* | IV. Edaphic & Thermal | Nonlinear steep yield collapse above daytime $T_{\max}$ thresholds at anthesis + PAR radiation-use efficiency | Captures reproductive heat sterility invisible in monthly mean $T$ | Daily reanalysis $T_{\max}$ is smoother than canopy microclimate | 3-day daytime $T_{\max}$ reproductive shock (`asymmetricHeatFactor`) + 7-day PAR Michaelis–Menten factor |
| 20 | **Ines et al. (2013)** *RSE*, DOI:`10.1016/j.rse.2013.07.018` (with Anderson et al., 2011; Reichle et al., 2019; Saltelli et al., 2019) | V. EO Assimilation & GSA | Joint assimilation of satellite soil moisture & vegetation + Sobol–Jansen variance sensitivity protocol | Demonstrates complementary skill of microwave SM & optical/thermal EO | Direct SM insertion biases small fields unless rescaled to pixel climatology | Precision-weighted anomaly fusion (`NDVI` 0.42, `ESI` 0.24, `SM_root` 0.20, `LST` 0.14) + QMC Sobol/Morris audit |

---

## 3. Mathematical Formulation of Astrovivu-AEZ v2

Let $\mathcal{P}$ denote a geographic parcel with centroid $(\lambda, \varphi)$, elevation $z$ (m), terrain slope $\theta$ ($^\circ$), edaphic vector $\mathbf{e} = (\mathrm{pH}, \mathrm{EC}_e, \mathrm{tex}, \mathrm{dr}, d_{\mathrm{soil}}, \mathrm{SOC}, \mathrm{CEC}, \mathrm{AWC})$, multi-decadal monthly climate history $\mathcal{C}$ ($Y$ years $\times 12$ months), 365-day daily hydrometeorological and EO telemetry $\mathcal{D}$, and optional farmer ground-truth overrides $\mathcal{G}$. For any candidate crop $c \in \mathcal{K}$, Astrovivu-AEZ v2 decomposes daily productivity on day $t \in \{1, \dots, N_d\}$ into static site compatibility and dynamic seasonal condition:

$$P(c, t) = \begin{cases} 100 \cdot S_{\mathrm{compat}}(c) & \text{if } \mathrm{stage}(c, t) \in \{\text{fallow}, \text{pre-sowing}, \text{dormant}\}, \\[4pt] 100 \cdot S_{\mathrm{compat}}(c) \cdot K_{\mathrm{cond}}(c, t) & \text{otherwise.} \end{cases}$$

### 3.1 Growing-Window Partitioning, Pre-Season Soil Storage, and Perennial Dormancy

Following Hijmans and Ramirez-Villegas et al. (2013), the active growing window length in months is $N_m = \mathrm{clamp}(\mathrm{round}(\bar{G}/30.4), 1, 12)$, where $\bar{G} = (G_{\min} + G_{\max})/2$ is the mean cycle length in days. For candidate sowing month $m \in \{1, \dots, 12\}$, let $\mathcal{W}(m) = \{m, m+1, \dots, m + N_m - 1\} \pmod{12}$.

For perennial species in extra-tropical climates where at least one calendar month has climatological mean temperature $\bar{T}_k \le T_{\mathrm{abs,min}}$, the year partitions into an active thermal season $\mathcal{A} = \{k : \bar{T}_k > T_{\mathrm{abs,min}}\}$ of length $M_{\mathrm{act}} = |\mathcal{A}|$ and a dormant rest period $\mathcal{A}^c$. Temperature suitability is evaluated over $\mathcal{W}(m) \subseteq \mathcal{A}$, while winter survival is enforced over $\mathcal{A}^c$ against the dormant killing threshold $T_{\mathrm{kill,rest}} + 4\,^\circ\mathrm{C}$.

For annual and biennial crops, seasonal water supply $W_{\mathrm{sup}}(m)$ combines cumulative window precipitation with pre-sowing fallow root-zone storage accumulated over the preceding six months via USDA-SCS effective rainfall $P_{\mathrm{eff}}$ and fallow evaporation ($K_{c,\mathrm{fallow}} = 0.4$):

$$S_{k} = \mathrm{clamp}\!\left(S_{k-1} + P_{\mathrm{eff}}(R_k) - 0.4\,ET_{0,k},\; 0,\; 1000\,\mathrm{AWC}\,Z_{r,\max}\right), \qquad W_{\mathrm{sup}}(m) = \sum_{j \in \mathcal{W}(m)} R_j + S_{\text{pre}} + I_{\mathrm{sup}},$$

where supplemental irrigation closes up to $30\%$ of optimal seasonal demand $R_{\mathrm{opt,scaled}} = R_{\mathrm{opt}} \min(1, N_m/4)$ on the deficit side only (excess monsoon rainfall is never removed by irrigation).

### 3.2 Continuous Biophysical and Edaphic Response Functions

1. **Piecewise Trapezoidal Response (Climate & pH):** Given a crop's cardinal thresholds $\mathbf{q} = (q_0, q_1, q_2, q_3)$ with $q_0 \le q_1 \le q_2 \le q_3$:
   $$\tau(x; \mathbf{q}) = \begin{cases} 0 & x \le q_0 \text{ or } x \ge q_3 \text{ (strictly outside when } q_0 < q_1, q_2 < q_3\text{)}, \\ (x - q_0)/(q_1 - q_0) & q_0 < x < q_1, \\ 1 & q_1 \le x \le q_2, \\ (q_3 - x)/(q_3 - q_2) & q_2 < x < q_3. \end{cases}$$
   Monthly growing-window temperature takes the Liebig minimum across window months: $s_{\mathrm{temp}}(m) = \min_{j \in \mathcal{W}(m)} \tau(T_j; \mathbf{q}_T)$, while seasonal water is $s_{\mathrm{water}}(m) = \tau(W_{\mathrm{sup}}(m); \mathbf{q}_R)$.
2. **Maas–Hoffman Continuous Salinity Response:** Replacing v1's discontinuous 4-bin step function, electrical conductivity of the saturation extract $\mathrm{EC}_e$ ($\text{dS m}^{-1}$) is scored via Maas & Hoffman (1977, Eq. 1) parameterized from FAO-56 Table 23 class anchors $(a_{\mathrm{none}}, b_{\mathrm{none}}) = (1.3, 0.14)$, $(a_{\mathrm{low}}, b_{\mathrm{low}}) = (2.0, 0.095)$, $(a_{\mathrm{med}}, b_{\mathrm{med}}) = (4.5, 0.065)$, and $(a_{\mathrm{high}}, b_{\mathrm{high}}) = (8.0, 0.045)$:
   $$s_{\mathrm{sal}}(\mathrm{EC}_e) = \begin{cases} 1 & \mathrm{EC}_e \le a(c_{\mathrm{opt}}), \\ \mathrm{clamp}\!\left(1 - \min(b(c_{\mathrm{opt}}), b(c_{\mathrm{abs}})) \cdot (\mathrm{EC}_e - a(c_{\mathrm{opt}})),\; 0.10,\; 1\right) & \mathrm{EC}_e > a(c_{\mathrm{opt}}). \end{cases}$$
3. **Oldfield–Sanchez Michaelis–Menten Fertility Curve:** Grounded in the global meta-analysis of Oldfield et al. (2019), which established a yield response plateau near $20\text{ g SOC kg}^{-1}$ ($2.0\%$ SOC), and tropical cation-exchange thresholds of Sanchez et al. (2003) ($20\text{ cmol}_{(+)}\text{ kg}^{-1}$), native soil fertility is mapped via normalized Michaelis–Menten saturation ($K_m = 8$):
   $$\phi(x) = \min\!\left(1,\; \frac{x}{20}\cdot\frac{20 + K_m}{x + K_m}\right), \qquad I_{\mathrm{fert}} = \mathrm{mean}\{\phi(\mathrm{SOC}), \phi(\mathrm{CEC})\},$$
   and converted into a continuous manageable suitability score $s_{\mathrm{fert}} \in [0.20, 1.0]$ against crop-specific optimal and tolerated fertility thresholds.
4. **Categorical Edaphic & GAEZ Terrain Ratings:** Soil texture, drainage class, and effective rooting depth take Sys et al. (1991) parametric ratings $\{1.0, 0.70, 0.15\}$ for optimal, tolerated, and marginal classes, while terrain slope $\theta$ follows FAO GAEZ v4 mechanization/erosion ramps ($1.0$ up to $4.6^\circ$ [8%] for annuals or $9.0^\circ$ [16%] for perennials, declining linearly to $0.15$ at $16.7^\circ$ [30%] or $24.0^\circ$ [45%]). Any factor with missing telemetry receives $s_i = \mathrm{null}$ and is excluded rather than zeroed.

### 3.3 Analytic Hierarchy Process (AHP) Weight Elicitation

Following Saaty (1980, 1987) and empirical agricultural AHP hierarchies (Akıncı et al., 2013; Pramanik, 2016; Herzberg et al., 2019; Pilevar et al., 2020), the nine graded biophysical factors are organized into four criticality tiers:
- **Tier 1 — Primary Agro-Climatic Drivers** (`temperature`, `water`): govern photosynthetic feasibility and transpirational survival; pairwise ratio $1:1$.
- **Tier 2 — Chemical & Hydrologic Root-Zone Constraints** (`ph`, `salinity`, `drainage`): directly regulate nutrient solubility, osmotic potential, and root respiration; pairwise ratio $1/2$ vs. Tier 1.
- **Tier 3 — Intrinsic Physical Matrix** (`texture`, `depth`): modulate water-holding capacity and mechanical anchorage; pairwise ratio $1/4$ vs. Tier 1 and $1/2$ vs. Tier 2.
- **Tier 4 — Manageable Fertility Proxy & Slope** (`fertility`, `slope`): amendable via fertilization or terracing/contouring; pairwise ratio $1/5$ vs. Tier 1, $1/3$ vs. Tier 2, and $1$ vs. Tier 3.

The resulting $9 \times 9$ positive reciprocal matrix $\mathbf{A}$ uses exclusively integer Saaty judgements $\{1, 2, 3, 4, 5\}$ and exact reciprocals:

$$\mathbf{A} = \begin{bmatrix}
1 & 1 & 2 & 2 & 2 & 4 & 4 & 5 & 5 \\
1 & 1 & 2 & 2 & 2 & 4 & 4 & 5 & 5 \\
1/2 & 1/2 & 1 & 1 & 1 & 2 & 2 & 3 & 3 \\
1/2 & 1/2 & 1 & 1 & 1 & 2 & 2 & 3 & 3 \\
1/2 & 1/2 & 1 & 1 & 1 & 2 & 2 & 3 & 3 \\
1/4 & 1/4 & 1/2 & 1/2 & 1/2 & 1 & 1 & 1 & 1 \\
1/4 & 1/4 & 1/2 & 1/2 & 1/2 & 1 & 1 & 1 & 1 \\
1/5 & 1/5 & 1/3 & 1/3 & 1/3 & 1 & 1 & 1 & 1 \\
1/5 & 1/5 & 1/3 & 1/3 & 1/3 & 1 & 1 & 1 & 1
\end{bmatrix}$$

Solving $\mathbf{A}\mathbf{w} = \lambda_{\max}\mathbf{w}$ via power iteration ($\|\mathbf{w}^{(k+1)} - \mathbf{w}^{(k)}\|_\infty < 10^{-13}$) yields $\lambda_{\max} = 9.034306$, Consistency Index $\mathrm{CI} = (\lambda_{\max} - 9)/8 = 0.004288$, and Consistency Ratio $\mathrm{CR} = \mathrm{CI} / \mathrm{RI}_9 = 0.004288 / 1.45 = \mathbf{0.002957}$ ($0.30\% \ll 10\%$ Saaty threshold). Max-normalizing $\alpha_i = w_i / \max_j w_j$ ensures primary climate factors act at unit exponent ($\alpha_{\mathrm{temp}} = \alpha_{\mathrm{water}} = 1.000$), preserving exact compatibility with Ramirez-Villegas et al. (2013) while grounding edaphic exponents ($\alpha_{\mathrm{Tier\,2}} = 0.522$, $\alpha_{\mathrm{Tier\,3}} = 0.239$, $\alpha_{\mathrm{Tier\,4}} = 0.199$) in eigenvector theory.

### 3.4 Hybrid Liebig–Khiddir Rank-Damped Parametric Operator and Formal Proofs

Let $\mathcal{C}_{\mathrm{clim}} = \{\text{temperature}, \text{water}\}$ and $\mathcal{E} = \{\text{ph}, \text{salinity}, \text{drainage}, \text{texture}, \text{depth}, \text{fertility}, \text{slope}\}$. For each observed graded factor $i$, define its AHP-weighted contribution $c_i = s_i^{\alpha_i} \in [0, 1]$. Let $c_{(1)} \le c_{(2)} \le \dots \le c_{(m_e)}$ denote the ascending order statistics of the observed edaphic/terrain contributions $\{c_i : i \in \mathcal{E}, s_i \ne \mathrm{null}\}$, and let $\mathcal{U}$ denote the set of non-compensatory bioclimatic/geographical gates $g_u \in [0, 1]$ (`frost`, `winterSurvival`, `activeSeason`, `climateZone`, `photoperiod`, `latitude`, `altitude`).

**Definition 1 (Astrovivu-AEZ v2 Parametric Suitability Operator):**

$$S_{\mathrm{v2}} = \left(\prod_{k \in \mathcal{C}_{\mathrm{clim}}} s_k^{\alpha_k}\right) \cdot \left(\prod_{r=1}^{m_e} c_{(r)}^{1/\sqrt{r}}\right) \cdot \left(\prod_{u \in \mathcal{U}} g_u\right).$$

We prove four fundamental mathematical properties that distinguish $S_{\mathrm{v2}}$ from WLC, Storie, Khiddir SQRI, and unweighted geometric products.

- **Theorem 1 (Non-Compensatory Zero-Veto):** *If any observed climatic factor, edaphic factor, or bioclimatic gate has $s_i = 0$ (or $g_u = 0$) with $\alpha_i > 0$, then $S_{\mathrm{v2}} = 0$.*  
  *Proof:* If $i \in \mathcal{C}_{\mathrm{clim}}$, $s_i^{\alpha_i} = 0^{\alpha_i} = 0$, annihilating the first product. If $i \in \mathcal{E}$, $c_i = 0^{\alpha_i} = 0$, so the minimum order statistic is $c_{(1)} = 0$ and $c_{(1)}^{1/\sqrt{1}} = 0$, annihilating the second product. If $u \in \mathcal{U}$ has $g_u = 0$, the third product vanishes. By contrast, $S_{\mathrm{WLC}} = \sum_{j \ne i} w_j s_j / \sum_j w_j > 0$ whenever any other factor is positive. $\blacksquare$

- **Theorem 2 (Single-Limitation Equivalence):** *Whenever at most one edaphic factor $k \in \mathcal{E}$ is sub-optimal ($s_k < 1$ and $s_j = 1$ for all $j \in \mathcal{E} \setminus \{k\}$), $S_{\mathrm{v2}}$ reduces identically to the exact AHP power product $S_{\mathrm{GAEZ}} = (\prod_{i} s_i^{\alpha_i}) \prod_u g_u$.*  
  *Proof:* Since $s_j = 1 \implies c_j = 1^{\alpha_j} = 1$ for all $j \ne k$, sorting yields $c_{(1)} = s_k^{\alpha_k}$ and $c_{(r)} = 1$ for all $r \ge 2$. Because $1^{1/\sqrt{r}} = 1$, $\prod_{r=1}^{m_e} c_{(r)}^{1/\sqrt{r}} = c_{(1)}^1 = s_k^{\alpha_k}$. $\blacksquare$

- **Theorem 3 (Global Continuity Across Rank Permutations):** *$S_{\mathrm{v2}}$ is continuous everywhere on $[0, 1]^m$, including across manifolds where two or more edaphic contributions tie and swap rank order.*  
  *Proof:* On $[0, 1]^{m_e}$, the sorting map $\mathbf{c} \mapsto (c_{(1)}, \dots, c_{(m_e)})$ is Lipschitz continuous because each order statistic $c_{(r)}(\mathbf{c}) = \min_{|I|=r} \max_{i \in I} c_i$ is a finite composition of continuous $\min$ and $\max$ operations. On $(0, 1]^{m_e}$, $\ln \prod_{r=1}^{m_e} c_{(r)}^{1/\sqrt{r}} = \sum_{r=1}^{m_e} r^{-1/2} \ln c_{(r)}$ is a composition of continuous functions; at a tie $c_a = c_b = \gamma$, swapping their labels leaves $(c_{(1)}, \dots, c_{(m_e)})$ invariant, yielding zero jump discontinuity. Continuity at $\mathbf{c} \to 0^+$ follows from $0 \le \prod_{r} c_{(r)}^{1/\sqrt{r}} \le c_{(1)}^1 \to 0$. $\blacksquare$

- **Theorem 4 (Strict Monotonicity and Sub-Multiplicative Collapse Bound):** *On $(0, 1]^m$, $S_{\mathrm{v2}}$ is strictly increasing in every observed score $s_i$. Moreover, if all $m_e$ edaphic contributions equal $\gamma \in (0, 1)$, then*
  $$\gamma^{m_e} \;\; (\text{Storie}) \;<\; \gamma^{m_e}\text{-weighted } \gamma^{\sum \alpha_r} \;\; (\text{GAEZ v1}) \;<\; \gamma^{\sum_{r=1}^{m_e} r^{-1/2}} \;\; (\text{Astrovivu-AEZ v2}) \;<\; \gamma \;\; (\text{Liebig min}).$$
  *Proof:* Away from ties, $\partial \ln S_{\mathrm{v2}} / \partial s_i = \alpha_i / (s_i \sqrt{r(i)}) > 0$ for $i \in \mathcal{E}$ and $\alpha_i / s_i > 0$ for $i \in \mathcal{C}_{\mathrm{clim}}$; by Theorem 3, continuous gluing of strictly increasing pieces along tie hyperplanes preserves strict monotonicity globally. For $m_e = 7$ edaphic factors with $c_r = \gamma \in (0, 1)$, $1 < \sum_{r=1}^7 r^{-1/2} \approx 3.593 < 7$, bounding multi-factor damping strictly between pure multiplication and single-minimum insensitivity. $\blacksquare$

### 3.5 Coupled Daily Agro-Hydrological, Aeration, Thermal, and Radiation Dynamics

For each day $t \in \{1, \dots, N_d\}$ of the 365-day telemetry window (run over two full passes so soil moisture spin-up is independent of initial guesses):

1. **Borg–Grimes Sigmoidal Root Growth (Borg & Grimes, 1986):** For annual/biennial crops on day $d_s$ since sowing over vegetative root-development duration $D_{\mathrm{root}} = \mathrm{round}((f_{\mathrm{ini}} + f_{\mathrm{dev}})\bar{G})$:
   $$Z_r(t) = \begin{cases} Z_{r,\max} & \text{perennials or } d_s \ge D_{\mathrm{root}}, \\ Z_{r,\min} + (Z_{r,\max} - Z_{r,\min})\,\mathrm{clamp}_{[0,1]}\!\left[0.5 + 0.5\sin\!\left(3.03\,\frac{d_s}{D_{\mathrm{root}}} - 1.47\right)\right] & 0 \le d_s < D_{\mathrm{root}}, \end{cases}$$
   with $Z_{r,\min} = \min(0.15\text{ m}, Z_{r,\max})$, yielding dynamic Total Available Water $\mathrm{TAW}(t) = 1000\,\mathrm{AWC}\,Z_r(t)$.
2. **FAO-56 Eq. 62/65 Climatic Adjustment of $K_c$ (Allen et al., 1998):** Minimum daily relative humidity is derived from mean $RH$, $T_{\min}$, and $T_{\max}$ via saturation vapour pressure $e^\circ(T) = 0.6108\exp(\frac{17.27 T}{T+237.3})$:
   $$RH_{\min} = \mathrm{clamp}_{[20,80]}\!\left(100 \cdot \frac{RH_{\mathrm{mean}}}{100} \cdot \frac{e^\circ(T_{\max}) + e^\circ(T_{\min})}{2\,e^\circ(T_{\max})}\right),$$
   and 7-day trailing wind speed $u_2$ ($\text{m s}^{-1}$) and $RH_{\min}$ adjust $K_{c,\mathrm{mid}}$ and $K_{c,\mathrm{end}}$ whenever $K_{c,\mathrm{tab}} \ge 0.45$:
   $$K_{c,\mathrm{adj}} = K_{c,\mathrm{tab}} + \left[0.04(u_2 - 2) - 0.004(RH_{\min} - 45)\right]\left(\frac{h}{3}\right)^{0.3}.$$
3. **Two-Pass Root-Zone Water Balance & Feddes/AquaCrop Anaerobiosis ($K_{\mathrm{aer}}$):** Daily root-zone depletion $D_r(t) \in [0, \mathrm{TAW}(t)]$ and gravitational saturation surplus $W_{\mathrm{sur}}(t) \in [0, W_{\mathrm{macro}}(t)]$ (where drainable macro-porosity $W_{\mathrm{macro}}(t) = \max(20, 80\,Z_r(t))\text{ mm}$) evolve with SCS Curve Number runoff $Q_{\mathrm{RO}}$ and drainage-class percolation capacity $P_{\mathrm{perc}} \in [3.5, 35]\text{ mm d}^{-1}$:
   $$K_s(t) = \begin{cases} 1 & D_r(t) \le \mathrm{RAW}(t), \\ \frac{\mathrm{TAW}(t) - D_r(t)}{\mathrm{TAW}(t) - \mathrm{RAW}(t)} & D_r(t) > \mathrm{RAW}(t), \end{cases} \qquad K_{\mathrm{aer}}(t) = \begin{cases} 1 & c \text{ hydrophytic or } W_{\mathrm{sur}}(t) \le 0.25\,W_{\mathrm{macro}}, \\ \mathrm{clamp}_{[0.30, 1]}\!\left(1 - 0.7\,\frac{W_{\mathrm{sur}}(t) - 0.25\,W_{\mathrm{macro}}}{0.75\,W_{\mathrm{macro}}}\right) & \text{otherwise.} \end{cases}$$
   Effective root water uptake is $ET_a(t) = K_s(t)\,K_{\mathrm{aer}}(t)\,K_c(t)\,ET_0(t)$, producing daily agro-hydrological index $I_{\mathrm{water}}(t) = \mathrm{clamp}_{[0,1]}(1 - K_y\,s_{\mathrm{stage}}(t)\,[1 - K_s(t)K_{\mathrm{aer}}(t)])$.
4. **Asymmetric Reproductive Heat Shock & Monteith PAR Sufficiency:** Following Schlenker & Roberts (2009) and Sánchez et al. (2014), 3-day daytime canopy $T_{\max,3\mathrm{d}}$ exceeding $T_{\mathrm{opt,max}} + 5\,^\circ\mathrm{C}$ imposes stage-amplified reproductive sterility ($A_{\mathrm{stage}} = 1.0$ at mid-season anthesis, $0.7$ at development, $0.45$ otherwise):
   $$I_{\mathrm{heat}}(t) = \min\!\left(\tau_{\mathrm{high}}(\bar{T}_{7\mathrm{d}}),\; \mathrm{clamp}_{[0,1]}\!\left(1 - A_{\mathrm{stage}}\frac{T_{\max,3\mathrm{d}} - (T_{\mathrm{opt,max}}+5)}{(T_{\mathrm{abs,max}}+4) - (T_{\mathrm{opt,max}}+5)}\right)\right),$$
   while 7-day photosynthetically active radiation $\mathrm{PAR}_{7\mathrm{d}}$ ($\text{MJ m}^{-2}\text{ d}^{-1}$) modulates radiation-use efficiency via a Michaelis–Menten curve saturating at $8.0\text{ MJ m}^{-2}\text{ d}^{-1}$ for high-light $\mathrm{C}_4$ crops and $6.2\text{ MJ m}^{-2}\text{ d}^{-1}$ for $\mathrm{C}_3$ crops: $I_{\mathrm{model}}(t) = I_{\mathrm{water}}(t) \cdot \min(I_{\mathrm{heat}}(t), I_{\mathrm{cold}}(t)) \cdot I_{\mathrm{PAR}}(t)^{0.35}$.
5. **Stage-Weighted Seasonal Yield Fraction (Jensen, 1968; Steduto et al., 2012):**
   $$Y_{\mathrm{frac}} = \frac{S_{\mathrm{compat}}}{s_{\mathrm{water,static}}} \cdot \min\!\left(s_{\mathrm{water,static}},\; 1 - K_y\!\left[1 - \frac{1}{2}\!\left(\frac{\sum ET_a}{\sum ET_c} + \frac{\sum s_{\mathrm{stage}} ET_a}{\sum s_{\mathrm{stage}} ET_c}\right)\right]\right).$$

---

## 4. Multi-Resolution Earth Observation Assimilation and Farmer Ground-Truth Calibration

Directly inserting coarse satellite retrievals (5–25 km) into parcel-level state variables violates spatial scale compatibility on 0.5–5 ha farms. Astrovivu-AEZ v2 enforces **Pixel-Climatology Anomaly Assimilation**: every EO series $X \in \{\mathrm{NDVI}, \mathrm{ESI}, \mathrm{SM}_{\mathrm{root}}, \mathrm{LST}_{\mathrm{day}}\}$ is normalized against its own 5-year day-of-year baseline $(\mu_X(\mathrm{doy}), p_{10,X}(\mathrm{doy}), p_{90,X}(\mathrm{doy}))$ before precision-weighted fusion (Anderson et al., 2011; Ines et al., 2013; Reichle et al., 2019):

$$I_{\mathrm{obs}}(t) = \frac{\sum_{X \in \mathcal{O}(t)} \omega_X \, \tilde{X}(t)}{\sum_{X \in \mathcal{O}(t)} \omega_X}, \qquad (\omega_{\mathrm{NDVI}}, \omega_{\mathrm{ESI}}, \omega_{\mathrm{SM}}, \omega_{\mathrm{LST}}) = (0.42, 0.24, 0.20, 0.14),$$

where $\mathcal{O}(t)$ is the subset of valid sensors on day $t$, and $K_{\mathrm{cond}}(t) = 0.70\,I_{\mathrm{model}}(t) + 0.30\,I_{\mathrm{obs}}(t)$ (gracefully reducing to $I_{\mathrm{model}}$ or $I_{\mathrm{obs}}$ alone when one branch is unavailable).

When a farmer supplies in-situ measurements $\mathcal{G}$—laboratory soil $\mathrm{pH}$, $\mathrm{EC}_e$, texture, drainage, rooting depth, rain-gauge totals (`measuredRain`), or root-zone moisture probe readings (`measuredSoilMoisture`)—the engine:
1. Multiplicatively bias-corrects satellite rainfall ($\beta_P = \mathrm{clamp}(\sum P_{\mathrm{gauge}} / \sum P_{\mathrm{sat}}, 0.25, 4.0)$) and satellite root-zone moisture ($\beta_{\mathrm{SM}} = \mathrm{clamp}(\sum \theta_{\mathrm{probe}} / \sum \theta_{\mathrm{sat}}, 0.35, 3.0)$) across co-observed dates; and
2. Computes a counterfactual **Calibration Ledger** (`scoreEffect`), re-evaluating the full seasonal model with each single ground-truth override removed so the user sees the exact yield-score delta ($\Delta Y_{\mathrm{frac}}$) attributable to every measurement.

---

## 5. Experimental Design and Study Parcels

All six experiments are implemented in deterministic TypeScript (`scripts/crops/evaluate-scoring-paper.ts`) and executed directly against the repository's cached multi-sensor telemetry (`public/data/samples/*.json`) and cleaned FAO EcoCrop database (`public/data/crops/ecocrop.json`, $2{,}063$ total scorable species including $73$ curated profiles). Table 2 summarizes the four contrasting real-world study parcels.

### Table 2. Real-World Agro-Ecological Study Parcels Used in Empirical Evaluation

| Parcel ID | Location & Coordinates | Köppen–Trewartha Zone | Soil & Terrain Provenance | Dominant Hydroclimatic Constraint | Ground-Truth Cropping System |
|---|---|---|---|---|---|
| `daklak-coffee` | Đắk Lắk, Central Highlands, Vietnam ($12.814^\circ\text{N}, 108.227^\circ\text{E}$) | Tropical wet-dry (`Aw`) | SoilGrids basaltic clay loam ($\mathrm{pH}\approx 5.5$),Copernicus DEM $\sim 490\text{ m}$ | Severe 4-month winter-spring dry spell ($\sim 220\text{ mm}$ short of Robusta optimum) | Perennial *Coffea canephora* with supplemental well irrigation |
| `cantho-rice` | An Giang, Mekong Delta, Vietnam ($10.527^\circ\text{N}, 105.173^\circ\text{E}$) | Tropical wet-dry (`Aw`) | Heavy alluvial paddy clay, poor drainage, flat floodplain ($<1^\circ$ slope) | Monsoon root-zone saturation / waterlogging for upland crops; dry-season heat | Triple-cropped canal-irrigated *Oryza sativa* |
| `iowa-corn-soy` | Story County, Iowa, USA ($42.103^\circ\text{N}, -93.504^\circ\text{W}$) | Humid continental (`Dc`/`Df`) | USDA SSURGO prairie Mollisol, deep medium loam, rainfed | Sub-zero winter freeze ($-12\,^\circ\mathrm{C}$ mean min) killing tropical perennials | Rainfed *Zea mays* – *Glycine max* alternation (verified USDA CDL 2018–2025) |
| `nevada-alfalfa` | Diamond Valley, Nevada, USA ($39.720^\circ\text{N}, -115.969^\circ\text{W}$) | Cold semi-arid (`Bs`) | USDA SSURGO alkaline silt loam ($\mathrm{pH}\ 8.8$), high desert basin ($1{,}810\text{ m}$) | Extreme aridity ($\sim 230\text{ mm yr}^{-1}$), alkaline $\mathrm{pH}\ 8.8$, winter frost ($-8\,^\circ\mathrm{C}$) | Center-pivot irrigated *Medicago sativa* (verified USDA CDL 2019–2025) |

---

## 6. Empirical Results, Process Ablation, and Global Sensitivity Analysis

### 6.1 Experiment 1: AHP Eigenvector Consistency and Monte Carlo Perturbation Stability

Table 3 reports the exact principal eigenvector solution of $\mathbf{A}$ alongside $M = 1{,}000$ seeded Monte Carlo perturbations in which every off-diagonal comparison $A_{ij}$ ($i < j$) was independently perturbed by multiplicative log-uniform noise $A'_{ij} = A_{ij}\exp(u_{ij})$, $u_{ij} \sim \mathcal{U}[-0.25, +0.25]$ ($\approx \pm 28.4\%$ relative swing) while preserving reciprocity $A'_{ji} = 1/A'_{ij}$.

#### Table 3. Exact Saaty AHP Weights, Max-Normalized Exponents, and Monte Carlo Stability ($M = 1{,}000$)

| Criticality Tier | Factor $i$ | Exact Eigenvector $w_i$ | Tier Share | Exact Exponent $\alpha_i$ | MC Mean $\alpha_i$ | MC SD | MC 95% CI |
|---|---|---:|---:|---:|---:|---:|---:|
| **Tier 1: Primary Climate** | `temperature` | $0.225118$ | $45.02\%$ | **1.0000** | $0.9739$ | $0.0367$ | $[0.8800, 1.0000]$ |
| **Tier 1: Primary Climate** | `water` | $0.225118$ | (joint) | **1.0000** | $0.9761$ | $0.0353$ | $[0.8758, 1.0000]$ |
| **Tier 2: Chem./Hydrologic Soil** | `ph` | $0.117518$ | $35.26\%$ | **0.5220** | $0.5125$ | $0.0317$ | $[0.4536, 0.5762]$ |
| **Tier 2: Chem./Hydrologic Soil** | `salinity` | $0.117518$ | (joint) | **0.5220** | $0.5100$ | $0.0307$ | $[0.4527, 0.5721]$ |
| **Tier 2: Chem./Hydrologic Soil** | `drainage` | $0.117518$ | (joint) | **0.5220** | $0.5093$ | $0.0311$ | $[0.4522, 0.5724]$ |
| **Tier 3: Physical Soil Matrix** | `texture` | $0.053800$ | $10.76\%$ | **0.2390** | $0.2341$ | $0.0146$ | $[0.2066, 0.2629]$ |
| **Tier 3: Physical Soil Matrix** | `depth` | $0.053800$ | (joint) | **0.2390** | $0.2338$ | $0.0146$ | $[0.2068, 0.2663]$ |
| **Tier 4: Fertility & Slope** | `fertility` | $0.044804$ | $8.96\%$ | **0.1990** | $0.1942$ | $0.0123$ | $[0.1711, 0.2196]$ |
| **Tier 4: Fertility & Slope** | `slope` | $0.044804$ | (joint) | **0.1990** | $0.1945$ | $0.0120$ | $[0.1711, 0.2179]$ |

Across all $1{,}000$ perturbed matrices, mean $\mathrm{CR} = 0.00865$, 95th-percentile $\mathrm{CR} = 0.01185$, and maximum $\mathrm{CR} = 0.01499$: **$100.0\%$ of realizations remain an order of magnitude below Saaty's $0.10$ threshold**, and **$100.0\%$ preserve strict separation** between Tier 1, Tier 2, and Tier 3/4 weights (zero CI overlap between tiers).

---

### 6.2 Experiment 2: Parametric Aggregation Comparison on Canonical Profiles and 56-Case Real Benchmark

Tables 4a and 4b compare five literature aggregation operators—Additive WLC (`wlc`), Multiplicative Storie (`storie`), Khiddir Square-Root (`khiddir`), Pure AHP Geometric (`ecocrop-gaez`), and Hybrid Liebig–Khiddir (`astrovivu-v2`)—across five canonical diagnostic profiles and the 56-case real parcel viability benchmark ($31$ documented viable regimes, $25$ documented non-viable regimes).

#### Table 4a. Suitability Scores Across Canonical Biophysical Stress Profiles

| Diagnostic Profile | Additive WLC | Storie Product | Khiddir SQRI | Pure AHP Geometric | **Astrovivu-AEZ v2** | Agronomic Diagnosis |
|---|---:|---:|---:|---:|---:|---|
| 1. Lethal drought (`water = 0`, others $= 1$) | **0.7749** *(Fail)* | $0.0000$ | $0.0000$ | $0.0000$ | **0.0000** | WLC violates Liebig's Law; scores dead crop $S_2$ |
| 2. Single moderate acidity (`pH = 0.60`, others $= 1$) | $0.9530$ | $0.6000$ | $0.6000$ | $0.7659$ | **0.7659** | Exact Theorem 2 equivalence ($0.60^{0.522} = 0.7659$) |
| 3. Compound manageable soil limits (7 soil/slope $= 0.70\text{–}0.80$) | $0.8572$ | **0.1152** *(Collapse)* | $0.2840$ | $0.4777$ | **0.6150** | Storie & Khiddir collapse viable land into $N_1/N_2$; v2 retains $S_2$ |
| 4. Tropical highland dry spell (`water = 0.72, pH = 0.92, fert = 0.85, slope = 0.88`) | $0.9155$ | $0.4955$ | $0.5973$ | $0.6506$ | **0.6639** | Realistic $S_2$ rating for rainfed Đắk Lắk upland |
| 5. Irrigated alkaline desert (`temp = 0.95, pH = 0.60, sal = 0.82, fert = 0.65`) | $0.9049$ | $0.3038$ | $0.4269$ | $0.6021$ | **0.6436** | Reflects commercial pivot viability despite alkaline soil |

#### Table 4b. Classification & Probabilistic Calibration Performance on the 56-Case Real Parcel Benchmark

| Parametric Operator | ROC-AUC | Brier Score $\downarrow$ | False Positive Rate at $S \ge 60$ ($S_2$) $\downarrow$ | Sensitivity (Recall at $S \ge 45$) $\uparrow$ | Specificity (at $S < 45$) $\uparrow$ | Youden's $J$ Statistic $\uparrow$ |
|---|---:|---:|---:|---:|---:|---:|
| Additive WLC (`wlc`) | $0.9961$ | $0.0755$ | **20.00%** *(5/25 fatal FPs)* | $1.0000$ | $0.7200$ | $0.7200$ |
| Multiplicative Storie (`storie`) | $0.9548$ | $0.1072$ | $0.00\%$ | $0.8387$ | $1.0000$ | $0.8387$ |
| Khiddir Square-Root (`khiddir`) | $0.9548$ | $0.1007$ | $0.00\%$ | $0.8387$ | $1.0000$ | $0.8387$ |
| Pure AHP Geometric (`ecocrop-gaez`) | $0.9548$ | $0.0761$ | $0.00\%$ | $0.8710$ | $1.0000$ | $0.8710$ |
| **Astrovivu-AEZ v2 (`astrovivu-v2`)** | **0.9548** | **0.0759** | **0.00%** | **0.8710** | **1.0000** | **0.8710** |

*Critical insight:* Although WLC exhibits a high rank-order AUC on cases gated by binary frost multipliers, its probability scale is dangerously miscalibrated for decision support: WLC assigns **63.4/100 ("Suitable") to rainfed black pepper** and **68.7/100 ("Suitable") to rainfed paddy rice** on upland Đắk Lắk basalt where 4-month dry-season precipitation falls far below physiological survival, resulting in a **20.0% false-positive rate at $S_2$**. Conversely, Storie penalizes rainfed wet-season maize and soybean in Đắk Lắk down to $0.5474$ (vs. $0.8871$ in Astrovivu-AEZ v2), inflating Brier error to $0.1072$. Astrovivu-AEZ v2 achieves **zero false positives**, **$100\%$ specificity**, the **highest Youden's $J = 0.8710$**, and the **lowest non-compensatory Brier score ($0.0759$)**.

---

### 6.3 Experiment 3: Daily Physiological Process Ablation on Real Telemetry

1. **FAO-56 Eq. 62/65 Climatic $K_c$ Scaling (Table 5a):** Standard FAO-56 tabulated $K_{c,\mathrm{mid}}$ assumes sub-humid conditions ($RH_{\min} = 45\%, u_2 = 2.0\text{ m s}^{-1}$). On real daily agrometeorology, arid Diamond Valley, Nevada ($\overline{RH}_{\min} = 32.1\%, \bar{u}_2 = 2.33\text{ m s}^{-1}$) increases alfalfa $K_{c,\mathrm{mid}}$ by **$+4.20\%$** ($0.950 \rightarrow 0.990$, driving $652\text{ mm}$ seasonal $ET_c$ and $706\text{ mm}$ gross pivot irrigation), whereas humid, wind-sheltered Đắk Lắk ($\overline{RH}_{\min} = 65.1\%, \bar{u}_2 = 0.22\text{ m s}^{-1}$) reduces coffee $K_{c,\mathrm{mid}}$ by **$-11.74\%$** ($0.950 \rightarrow 0.839$), and humid An Giang ($\overline{RH}_{\min} = 63.1\%$) reduces paddy rice $K_{c,\mathrm{mid}}$ by **$-3.51\%$** ($1.200 \rightarrow 1.158$).

#### Table 5a. Climatic $K_{c,\mathrm{mid}}$ Adjustment Across Contrastive Real Parcels

| Parcel | Crop | Tabulated $K_{c,\mathrm{mid}}$ | Mean $u_2$ ($\text{m s}^{-1}$) | Mean $RH_{\min}$ (%) | Climate-Adjusted $K_{c,\mathrm{mid}}$ | $\Delta K_{c,\mathrm{mid}}$ (%) | Seasonal $ET_c$ (mm) | Irrigation Applied (mm) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `nevada-alfalfa` | *Medicago sativa* | $0.95$ | $2.33$ | $32.1\%$ | $0.9899$ | **$+4.20\%$** | $652$ | $706$ |
| `iowa-corn-soy` | *Zea mays* | $1.20$ | $3.16$ | $55.6\%$ | $1.2019$ | $+0.16\%$ | $383$ | $0$ |
| `cantho-rice` | *Oryza sativa* | $1.20$ | $2.34$ | $63.1\%$ | $1.1579$ | **$-3.51\%$** | $670$ | $642$ |
| `daklak-coffee` | *Coffea canephora* | $0.95$ | $0.22$ | $65.1\%$ | $0.8385$ | **$-11.74\%$** | $1{,}040$ | $466$ |

2. **Borg–Grimes Dynamic Root Expansion:** Assuming static maximum root depth from emergence (`v1`) overestimates seedling Total Available Water on Day 5 ($Z_r(5) = 0.171\text{–}0.189\text{ m}$ on medium loam, $\mathrm{AWC}=0.16$) by **$7.15\times$ for maize** ($216.0\text{ mm}$ static vs. $30.2\text{ mm}$ dynamic), **$5.13\times$ for soybean** ($152.0\text{ mm}$ vs. $29.6\text{ mm}$), and **$2.63\times$ for onion** ($72.0\text{ mm}$ vs. $27.3\text{ mm}$), while leaving established perennial coffee unchanged at $192.0\text{ mm}$ ($1.00\times$). Dynamic rooting restores realistic post-sowing drought vulnerability during germination and emergence.
3. **Feddes/AquaCrop Root-Zone Anaerobiosis ($K_{\mathrm{aer}}$, Table 5b):** Simulating a June monsoon sowing (`2026-06-01`) on An Giang paddy clay (`cantho-rice`) demonstrates clear physiological divergence between hydrophytes and upland crops:

#### Table 5b. Monsoon Waterlogging & Drainage Improvement Counterfactual on Mekong Delta Clay (`cantho-rice`)

| Crop | Hydrophytic Aerenchyma | Waterlogged Stress Days (Poor Drainage) | Minimum $K_{\mathrm{aer}}$ | Expected Yield % (Poor Drainage) | Expected Yield % (Well Drained) | Drainage Upgrade Gain ($\Delta Y_{\mathrm{frac}}$) |
|---|---|---:|---:|---:|---:|---:|
| *Oryza sativa* (Rice) | Yes | **0 days** | $1.000$ | $13.4\%$ *(rainfed)* | $5.0\%$ | $-8.4\text{ pp}$ *(prefers bunded water)* |
| *Glycine max* (Soybean) | No | **65 days** | $0.300$ | $67.4\%$ | $79.1\%$ | **$+11.7\text{ pp}$** |
| *Arachis hypogaea* (Groundnut) | No | **66 days** | $0.300$ | $30.2\%$ | $79.2\%$ | **$+49.0\text{ pp}$** |
| *Zea mays* (Maize) | No | **69 days** | $0.300$ | $32.7\%$ | $85.9\%$ | **$+53.2\text{ pp}$** |

4. **Multi-Sensor Satellite Stream Coverage:** Across all four 365-day parcel caches, assimilating root-zone soil moisture (`sm_root`) expands satellite observation coverage to **365/365 days** (bridging persistent tropical cloud gaps where optical MODIS NDVI is unavailable or interpolated), while MODIS daytime canopy thermal anomaly (`lst_day`) detects **96 canopy heat-anomaly days** in An Giang, **31 days** in Iowa, **18 days** in Đắk Lắk, and **6 days** on the irrigated Nevada pivot.

---

### 6.4 Experiment 4: Maas–Hoffman Continuous Salinity vs. Discrete Step Classes

Evaluated across $72$ crop–salinity combinations ($\mathrm{EC}_e \in [0, 12]\text{ dS m}^{-1}$) against published FAO-56 Table 23 reference response curves (Table 6), continuous Maas–Hoffman scoring reduces overall RMSE by **$14.56\%$** ($0.2655 \rightarrow 0.2268$) and MAE from $0.1743 \rightarrow 0.1583$. Error reductions are largest for **rice ($-86.7\%$, RMSE $0.3350 \rightarrow 0.0444$)**, **soybean ($-30.1\%$, $0.2332 \rightarrow 0.1631$)**, **barley ($-20.7\%$, $0.2041 \rightarrow 0.1619$)**, and **maize ($-13.4\%$, $0.2526 \rightarrow 0.2188$)**.

#### Table 6. Salinity Suitability RMSE Against Published FAO-56 Table 23 Curves ($\mathrm{EC}_e \in [0, 12]\text{ dS m}^{-1}$)

| Crop | EcoCrop Class (`opt` / `abs`) | FAO-56 Threshold $a$ ($\text{dS m}^{-1}$) | FAO-56 Slope $b$ ($\text{dS}^{-1}\text{ m}$) | v1 Step-Class RMSE | **v2 Maas–Hoffman RMSE** | Relative Error Change |
|---|---|---:|---:|---:|---:|---:|
| *Oryza sativa* (Rice) | `low` / `low` | $3.0$ | $0.12$ | $0.3350$ | **0.0444** | **$-86.7\%$** |
| *Glycine max* (Soybean) | `low` / `medium` | $5.0$ | $0.20$ | $0.2332$ | **0.1631** | **$-30.1\%$** |
| *Hordeum vulgare* (Barley) | `low` / `high` | $8.0$ | $0.05$ | $0.2041$ | **0.1619** | **$-20.7\%$** |
| *Zea mays* (Maize) | `low` / `medium` | $1.7$ | $0.12$ | $0.2526$ | **0.2188** | **$-13.4\%$** |
| *Allium cepa* (Onion) | `low` / `medium` | $1.2$ | $0.16$ | $0.3559$ | **0.3411** | $-4.2\%$ |
| *Phaseolus vulgaris* (Bean) | `low` / `low` *(EcoCrop)* | $1.0$ | $0.19$ | $0.1551$ | $0.2994$ | $+93.0\%$ *(see §7)* |
| **All 6 Reference Crops ($n=72$)** | — | — | — | **0.2655** | **0.2268** | **$-14.56\%$** |

---

### 6.5 Experiment 5: Variance-Based Sobol–Jansen and Morris Global Sensitivity Analysis

Following Saltelli et al. (2019) and Jansen (1999), we generated $N = 1{,}024$ low-discrepancy Halton quasi-Monte Carlo base samples across the $k = 9$ biophysical input space ($N(k+2) = 11{,}264$ deterministic evaluations per crop; $45{,}056$ total evaluations across four archetypal crops) alongside $256$-trajectory Morris (1991) elementary effects ($\Delta = 0.10$). Table 7 reports first-order Sobol indices $S_i$, total-effect indices $S_{Ti}$, and Morris $\mu^*$.

#### Table 7. Global Sensitivity Indices ($S_i$, $S_{Ti}$, Morris $\mu^*$) Across Four Archetypal Crops ($N = 1{,}024$ Halton QMC)

| Input Factor | *Zea mays* ($S_i$ / $S_{Ti}$ / $\mu^*$) | *Oryza sativa* ($S_i$ / $S_{Ti}$ / $\mu^*$) | *Coffea canephora* ($S_i$ / $S_{Ti}$ / $\mu^*$) | *Glycine max* ($S_i$ / $S_{Ti}$ / $\mu^*$) |
|---|---|---|---|---|
| `water` (250–2400 mm) | **0.468** / **0.730** / 0.711 | **0.391** / **0.590** / 0.324 | **0.328** / **0.614** / 0.301 | **0.462** / **0.681** / 0.722 |
| `ph` (4.2–8.6) | 0.115 / 0.228 / 0.468 | 0.082 / 0.159 / 0.211 | 0.126 / 0.289 / 0.323 | 0.157 / 0.300 / 0.609 |
| `temperature` (10–36 °C) | 0.060 / 0.165 / 0.229 | 0.115 / 0.220 / 0.382 | 0.138 / **0.329** / **0.527** | 0.088 / 0.217 / 0.370 |
| `drainage` (poor–excessive) | 0.072 / 0.170 / 0.127 | 0.085 / **0.237** / 0.124 | 0.042 / 0.096 / 0.130 | 0.006 / 0.006 / 0.037 |
| `slope` (0–25°) | 0.003 / 0.029 / 0.050 | 0.010 / 0.021 / 0.032 | 0.008 / 0.011 / 0.051 | 0.002 / 0.026 / 0.056 |
| `salinity` (0–8 dS/m) | 0.001 / 0.006 / 0.030 | 0.002 / 0.014 / 0.039 | 0.005 / 0.016 / 0.048 | 0.005 / 0.005 / 0.033 |
| `texture` (light–organic) | 0.000 / 0.001 / 0.037 | 0.000 / 0.011 / 0.081 | 0.001 / 0.011 / 0.110 | 0.000 / 0.001 / 0.039 |
| `depth` (15–180 cm) | 0.001 / 0.007 / 0.033 | 0.001 / 0.003 / 0.015 | 0.001 / 0.005 / 0.022 | 0.005 / 0.006 / 0.030 |
| `fertility` (3–32 g/kg SOC) | 0.000 / 0.000 / 0.003 | 0.000 / 0.000 / 0.004 | 0.000 / 0.000 / 0.002 | 0.000 / 0.000 / 0.003 |
| **Additive Sum $\sum S_i$** | **0.720** | **0.685** | **0.650** | **0.724** |
| **Non-Additive Interaction ($1 - \sum S_i$)** | **28.01%** | **31.47%** | **35.04%** | **27.58%** |

Two major theoretical findings emerge from Table 7:
1. **Structural Proof Against Linear Additive Scoring:** In any linear additive model ($S_{\mathrm{WLC}} = \sum w_i s_i$), higher-order variance interactions vanish identically ($1 - \sum S_i \equiv 0$, $S_{Ti} \equiv S_i$). In Astrovivu-AEZ v2, **non-additive factor interactions account for $27.58\%\text{–}35.04\%$ of total suitability variance** (peaking at $35.04\%$ for narrow-niche perennial *Coffea canephora* and $31.47\%$ for water- and drainage-specialized *Oryza sativa*), quantifying the exact variance share governed by Liebig co-limitation.
2. **Crop-Specific Physiological Signatures:** Total-effect indices accurately recover known agronomy: `drainage` jumps to $S_{T,\mathrm{drain}} = 0.237$ in paddy rice (which requires poor drainage to retain standing water) and $0.170$ in waterlogging-sensitive maize, whereas `temperature` rises to $S_{T,\mathrm{temp}} = 0.329$ ($\mu^* = 0.527$) in frost- and heat-sensitive Robusta coffee.

---

### 6.6 Experiment 6: Global Screening of 2,063 EcoCrop Species Across Four Biomes

Evaluating the entire cleaned catalogue ($2{,}063$ species $\times 4$ parcels $= 8{,}252$ crop–site pairs; $99{,}024$ monthly sowing windows + $20$-year ERA5 reliability histories) completes in **$6{,}410\text{ ms}$** single-threaded on Node.js (**$776.8\,\mu\text{s}$ per complete crop–site evaluation**), confirming sub-millisecond responsiveness for client-side advisory. Table 8 demonstrates that Astrovivu-AEZ v2 reproduces global macro-ecological biodiversity filtering across biomes without site-specific tuning.

#### Table 8. Macro-Ecological Suitability Distribution Across 2,063 Plant Species by Biome

| Parcel & Regime | $S_1$ Very Suitable ($\ge 80$) | $S_2$ Suitable ($60\text{–}79$) | $S_3$ Moderate ($40\text{–}59$) | $N_1$ Marginal ($20\text{–}39$) | $N_2$ Unsuitable ($<20$) | Viable Species ($S_1 + S_2$) | Top 3 Biome Limiting Factors |
|---|---:|---:|---:|---:|---:|---:|---|
| `cantho-rice` (Irrigated tropical delta) | $527$ | $325$ | $352$ | $259$ | $600$ | **852 (41.30%)** | Texture ($24.9\%$), Temp ($24.6\%$), pH ($19.1\%$) |
| `daklak-coffee` (Rainfed tropical highland) | $245$ | $311$ | $415$ | $348$ | $744$ | **556 (26.95%)** | Acid pH ($27.2\%$), Water ($20.1\%$), Texture ($17.3\%$) |
| `iowa-corn-soy` (Rainfed continental prairie) | $61$ | $56$ | $76$ | $106$ | $1{,}764$ | **117 (5.67%)** | Temp ($37.7\%$), Winter kill ($31.9\%$), Frost ($11.7\%$) |
| `nevada-alfalfa` (Irrigated cold alkaline desert) | $1$ | $2$ | $2$ | $8$ | $2{,}050$ | **3 (0.15%)** | Winter kill ($31.9\%$), Temp ($31.5\%$), Alkaline pH 8.8 ($22.8\%$) |

Notably, on the Diamond Valley, Nevada center pivot—where SSURGO records strongly alkaline silt loam ($\mathrm{pH}\ 8.8$) combined with $-8\,^\circ\mathrm{C}$ Great Basin winters—only **$3$ of $2{,}063$ global species ($0.15\%$)** achieve $S_1/S_2$ suitability without chemical soil amendment, and *Medicago sativa* (alfalfa, observed on the parcel in every USDA Cropland Data Layer year 2019–2025) is directly recovered among them.

---

## 7. Discussion, Uncertainty, and Known Scientific Limitations

In accordance with strict scientific transparency, we document five boundaries of the Astrovivu-AEZ v2 engine that users and downstream agronomic modules must respect:

1. **Species-Level Coarseness and Database Coding Artefacts in FAO EcoCrop:** EcoCrop records one threshold envelope per taxonomic species rather than per modern hybrid or cultivar, and contains legacy categorical misclassifications. Experiment 4 exposed a concrete example: FAO EcoCrop codes common bean (*Phaseolus vulgaris*) as optimal salinity `low` ($\sim 2.0\text{ dS m}^{-1}$) rather than `none` ($1.0\text{ dS m}^{-1}$ in Maas & Hoffman, 1977), causing the generic class-anchored Maas–Hoffman curve to underestimate bean salt sensitivity between $1.0$ and $2.0\text{ dS m}^{-1}$ (RMSE $0.2994$ vs. $0.0444$ for rice). Curating explicit $(a, b)$ overrides from FAO-56 Table 23 for all 73 curated crops is a straightforward future refinement. Non-curated EcoCrop species are always flagged `needsLocalReview = true`.
2. **Assumed FAO-56 Water Parameters for Under-Studied Tropical Perennials:** Several economically vital Southeast Asian crops—including black pepper (*Piper nigrum*), durian (*Durio zibethinus*), cashew (*Anacardium occidentale*), mango (*Mangifera indica*), and tropical culinary herbs—are absent from FAO-56 Tables 11, 12, and 24. Their stage splits, $K_c$, and rooting depths are mapped from physiologically analogous functional groups and explicitly tagged `water-model-assumed` in `data/crops/CLEANING_LOG.md`.
3. **Absence of Multi-Year Plot-Level Harvested Yield Validation in Vietnam:** While US parcel suitability and crop-history alignment are cross-checked against parcel-level USDA Cropland Data Layer (2018–2025) and SSURGO soil surveys, and Vietnamese parcels use real ERA5, CHIRPS, MODIS, and SoilGrids retrievals plus FAOSTAT/provincial reference economics, we have **not** yet calibrated $Y_{\mathrm{frac}}$ against multi-year weighed farm harvest trials across Vietnamese smallholder plots. Furthermore, historical inter-annual `yieldFractions` over the 20-year ERA5 archive evaluate monthly growing-window climate scores rather than running 20 sequential daily water balances (since daily EO series are fetched only for the active 365-day window).
4. **Paddy Bunded Ponding vs. Saturation Surplus:** While $K_{\mathrm{aer}}$ accurately exempts hydrophytic rice from anaerobiosis penalties and captures upland crop waterlogging on poorly drained clay, puddled plough-pan percolation losses in bunded lowland rice paddies are represented macroscopically via EcoCrop's $1{,}000\text{–}1{,}500\text{ mm}$ seasonal water requirement rather than explicit ponded-water weir hydraulics.
5. **Biotic, Vernalization, and Socio-Institutional Factors Outside Scope:** Pest and disease outbreaks (e.g., *Phytophthora* foot rot in poorly drained black pepper beyond its abiotic drainage penalty, brown planthopper in triple-cropped rice), obligate winter vernalization chill-hour accumulation for winter wheat cultivars, foliar lodging from typhoons, and local forward-contract access lie outside the biophysical engine and are addressed qualitatively through the RAG crop-knowledge advisory layer.

---

## 8. Conclusion and Reproducibility

Astrovivu-AEZ v2 unifies classical FAO agro-ecological land evaluation, consistent Saaty AHP eigenvector weighting, continuous edaphic response laws, daily dynamic root-zone water-and-aeration physics, and scale-aware NASA multi-sensor anomaly assimilation inside a zero-dependency, sub-millisecond TypeScript module. Formal proofs and empirical benchmarks confirm that hybrid Liebig–Khiddir rank damping eliminates both the dangerous false positives of additive GIS-MCDA ($20\%$ FPR in WLC $\rightarrow 0\%$) and the artificial multi-factor collapse of Storie multiplication, while variance-based global sensitivity analysis demonstrates that non-additive biophysical interactions govern nearly one-third of crop suitability variance.

### Reproducing All Results and Figures

Every theorem check, ablation table, and sensitivity index in this paper can be reproduced deterministically from the project root on Node.js 24 without network calls:

```powershell
# 1. Run unit tests verifying AHP consistency, Theorems 1-4, edaphic curves, and daily physiology
npx.cmd vitest run src/core/scoring/literature.test.ts src/core/scoring/scoring.test.ts

# 2. Regenerate all 6 experimental datasets and tables in data/crops/scoring-paper-results.json
npx.cmd tsx scripts/crops/evaluate-scoring-paper.ts
```

---

## References

1. Akıncı, H., Özalp, A. Y., & Turgut, B. (2013). Agricultural land use suitability analysis using GIS and AHP technique. *Computers and Electronics in Agriculture*, 97, 71–82. https://doi.org/10.1016/j.compag.2013.07.006
2. Allen, R. G., Pereira, L. S., Raes, D., & Smith, M. (1998). *Crop Evapotranspiration: Guidelines for Computing Crop Water Requirements*. FAO Irrigation and Drainage Paper 56. Food and Agriculture Organization of the United Nations, Rome.
3. Anderson, M. C., Hain, C., Wardlow, B., Pimstein, A., Mecikalski, J. R., & Kustas, W. P. (2011). Evaluation of drought indices based on thermal remote sensing of evapotranspiration over the continental United States. *Journal of Climate*, 24(8), 2025–2044. https://doi.org/10.1175/2010JCLI3812.1
4. Becker-Reshef, I., Vermote, E., Lindeman, M., & Justice, C. (2010). A generalized regression-based model for forecasting winter wheat yields in Kansas and Ukraine using MODIS data. *Remote Sensing of Environment*, 114(6), 1312–1323. https://doi.org/10.1016/j.rse.2010.01.010
5. Belda, M., Holtanová, E., Halenka, T., & Kalvová, J. (2014). Climate classification revisited: from Köppen to Trewartha. *Climate Research*, 59(1), 1–13. https://doi.org/10.3354/cr01204
6. Borg, H., & Grimes, D. W. (1986). Depth development of roots with time: An empirical description. *Transactions of the ASAE*, 29(1), 194–197. https://doi.org/10.13031/2013.30125
7. Doorenbos, J., & Kassam, A. H. (1979). *Yield Response to Water*. FAO Irrigation and Drainage Paper 33. FAO, Rome.
8. FAO (1976). *A Framework for Land Evaluation*. FAO Soils Bulletin 32. Food and Agriculture Organization of the United Nations, Rome.
9. Feddes, R. A., Kowalik, P. J., & Zaradny, H. (1978). *Simulation of Field Water Use and Crop Yield*. Simulation Monographs, Pudoc, Wageningen.
10. Fischer, G., Nachtergaele, F. O., van Velthuizen, H., Chiozza, F., Franceschini, G., Henry, M., Muchoney, D., & Tramberend, S. (2021). *Global Agro-Ecological Zones v4 (GAEZ v4) – Model Documentation*. FAO & IIASA, Rome. https://doi.org/10.4060/cb4744en
11. Herzberg, R., Pham, T. G., Kappas, M., Wyss, D., & Tran, C. T. M. (2019). Multi-criteria decision analysis for the land evaluation of potential agricultural land use types in a hilly area of Central Vietnam. *Land*, 8(6), 90. https://doi.org/10.3390/land8060090
12. Ines, A. V. M., Das, N. N., Hansen, J. W., & Njoku, E. G. (2013). Assimilation of remotely sensed soil moisture and vegetation with a crop simulation model for maize yield prediction. *Remote Sensing of Environment*, 138, 149–164. https://doi.org/10.1016/j.rse.2013.07.018
13. Jansen, M. J. W. (1999). Analysis of variance designs for model output. *Computer Physics Communications*, 117(1–2), 35–43. https://doi.org/10.1016/S0010-4655(98)00154-4
14. Jensen, M. E. (1968). Water consumption by agricultural plants. In T. T. Kozlowski (Ed.), *Water Deficits and Plant Growth*, Vol. II (pp. 1–22). Academic Press, New York.
15. Khiddir, S. M. (1986). *A Statistical Approach in the Use of Parametric Systems Applied to the FAO Framework for Land Evaluation*. Ph.D. Thesis, State University of Ghent, Belgium.
16. Maas, E. V., & Hoffman, G. J. (1977). Crop salt tolerance—current assessment. *Journal of the Irrigation and Drainage Division, ASCE*, 103(IR2), 115–134. https://doi.org/10.1061/JRCEA4.0001137
17. Monteith, J. L. (1977). Climate and the efficiency of crop production in Britain. *Philosophical Transactions of the Royal Society of London B*, 281(980), 277–294. https://doi.org/10.1098/rstb.1977.0140
18. Morris, M. D. (1991). Factorial sampling plans for preliminary computational experiments. *Technometrics*, 33(2), 161–174. https://doi.org/10.1080/00401706.1991.10484804
19. Oldfield, E. E., Bradford, M. A., & Wood, S. A. (2019). Global meta-analysis of the relationship between soil organic matter and crop yields. *SOIL*, 5(1), 15–32. https://doi.org/10.5194/soil-5-15-2019
20. Pilevar, A. R., Matinfar, H. R., Sohrabi, A., & Sarmadian, F. (2020). Integrated fuzzy, AHP and GIS techniques for land suitability assessment in semi-arid regions for wheat and maize farming. *Ecological Indicators*, 110, 105887. https://doi.org/10.1016/j.ecolind.2019.105887
21. Pramanik, M. K. (2016). Site suitability analysis for agricultural land use of Darjeeling district using AHP and GIS techniques. *Modeling Earth Systems and Environment*, 2, 56. https://doi.org/10.1007/s40808-016-0116-8
22. Rabia, A. H., & Terribile, F. (2013). Introducing a new parametric concept for land suitability assessment. *International Journal of Environmental Science and Development*, 4(1), 15–19. https://doi.org/10.7763/IJESD.2013.V4.295
23. Raes, D., Steduto, P., Hsiao, T. C., & Fereres, E. (2009). AquaCrop—The FAO crop model to simulate yield response to water: II. Main algorithms and software description. *Agronomy Journal*, 101(3), 438–447. https://doi.org/10.2134/agronj2008.0140s
24. Ramirez-Villegas, J., Jarvis, A., & Läderach, P. (2013). Empirical approaches for assessing impacts of climate change on agriculture: The EcoCrop model and a case study with grain sorghum. *Agricultural and Forest Meteorology*, 170, 67–78. https://doi.org/10.1016/j.agrformet.2011.09.005
25. Reichle, R. H., Liu, Q., Koster, R. D., Crow, W. T., De Lannoy, G. J. M., Kimball, J. S., Ardizzone, J. V., Bosch, D., Colliander, A., Cosh, M., Kolassa, J., Mahanama, S. P., Prueger, J., Starks, P., & Walker, J. P. (2019). Version 4 of the SMAP Level-4 soil moisture algorithm and data product. *Journal of Advances in Modeling Earth Systems*, 11(10), 3106–3130. https://doi.org/10.1029/2019MS001729
26. Saaty, T. L. (1980). *The Analytic Hierarchy Process: Planning, Priority Setting, Resource Allocation*. McGraw-Hill, New York.
27. Saaty, T. L. (1987). The analytic hierarchy process—what it is and how it is used. *Mathematical Modelling*, 9(3–5), 161–176. https://doi.org/10.1016/0270-0255(87)90473-8
28. Saltelli, A., Aleksankina, K., Becker, W., Fennell, P., Ferretti, F., Holst, N., Li, S., & Wu, Q. (2019). Why so many published sensitivity analyses are false: A systematic review of sensitivity analysis practices. *Environmental Modelling & Software*, 114, 29–39. https://doi.org/10.1016/j.envsoft.2019.01.012
29. Sánchez, B., Rasmussen, A., & Porter, J. R. (2014). Temperatures and the growth and development of maize and rice: a review. *Global Change Biology*, 20(2), 408–417. https://doi.org/10.1111/gcb.12389
30. Sanchez, P. A., Palm, C. A., & Buol, S. W. (2003). Fertility capability soil classification: a tool to help assess soil quality in the tropics. *Geoderma*, 114(3–4), 157–185. https://doi.org/10.1016/S0016-7061(03)00040-5
31. Schlenker, W., & Roberts, M. J. (2009). Nonlinear temperature effects indicate severe damages to U.S. crop yields under climate change. *Proceedings of the National Academy of Sciences*, 106(37), 15594–15598. https://doi.org/10.1073/pnas.0906865106
32. Seyedmohammadi, J., Sarmadian, F., Jafarzadeh, A. A., Ghorbani, M. A., & Shahbazi, F. (2018). Application of SAW, TOPSIS and fuzzy TOPSIS models in cultivation priority planning for maize, rapeseed and soybean crops. *Geoderma*, 310, 178–190. https://doi.org/10.1016/j.geoderma.2017.09.012
33. Steduto, P., Hsiao, T. C., Fereres, E., & Raes, D. (2012). *Crop Yield Response to Water*. FAO Irrigation and Drainage Paper 66. FAO, Rome.
34. Storie, R. E. (1933). *An Index for Rating the Agricultural Value of Soils*. Bulletin 556, University of California Agricultural Experiment Station, Berkeley (revised 1978, Special Publication 3203).
35. Sys, C., Van Ranst, E., & Debaveye, J. (1991). *Land Evaluation, Parts I–III: Principles in Land Evaluation and Crop Production Calculations*. Agricultural Publications No. 7, General Administration for Development Cooperation (GADC), Brussels.
36. Tashayo, B., Honarbakhsh, A., Akbari, M., & Eftekhari, M. (2020). Land suitability assessment for maize farming using a GIS-AHP method for a semi-arid region, Iran. *Journal of the Saudi Society of Agricultural Sciences*, 19(5), 332–338. https://doi.org/10.1016/j.jssas.2020.03.003
