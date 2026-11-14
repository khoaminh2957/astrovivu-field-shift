# Judging map

Where Astrovivu answers each part of the *Field Shift: Adapting Farms with NASA Data* challenge, and the evidence for each targeted award. Status reflects what was on disk on 2026-11-14: **done** = implemented and exercised; **partial** = implemented in part, or built but not exercised; **not done** = absent.

At the time of writing the advisory, tracking and urban engines (`src/core/advisory/index.ts`, `src/core/tracking/index.ts`, `src/core/urban/index.ts`) return empty results; their screens are built and can be viewed with dev-only labelled fixtures (`?fixture=1`). Every row that depends on them is marked partial.

## 1. Challenge objectives and considerations

| Challenge item | Where the product answers it | Status |
|---|---|---|
| Decision-support tool combining NASA Earth observations with local agricultural information | Whole app; eight branches (`src/data`), farmer overrides (`src/ui/override`), `docs/ARCHITECTURE.md` | done |
| Use the named NASA datasets | MODIS, VIIRS, NASA POWER, SRTM as series; SMAP, GPM IMERG, MODIS, HLS, GRACE as GIBS overlays (`docs/DATA_SOURCES.md`) | partial: no SMAP or IMERG point series key-free; SMAP AppEEARS adapter never run; ECOSTRESS only via ClimateSERV ESI (stale since 2025-07); GRACE overlay ends 2022 |
| Temperature, heat stress, frost risk | Agromet and thermal branches, risk thresholds (`docs/DATA_SOURCES.md` §1b), kill-temperature gate and thermal condition (`docs/SCORING.md`) | done |
| Rainfall, extreme precipitation | Rainfall branch (CHIRPS + ERA5, anomaly), heavy-rain events in risk branch | done (not from IMERG series) |
| Soil moisture, evaporation, water balance | Soil-moisture branch (ERA5-Land, POWER wetness, modelled), MODIS ET, FAO-56 root-zone balance (`src/core/scoring`) | done (modelled, not SMAP) |
| Vegetation stress | MODIS NDVI against day-of-year baseline, ESI where available | done |
| Long-term water trends | 20-year ERA5 climate history, reliability over years; GRACE map layer | partial: no groundwater trend series |
| Local soil information | SoilGrids, SSURGO in the US, ground-truth pH/texture/drainage override | done |
| Crop characteristics | FAO EcoCrop, 2,062 scorable species, 73 curated (`docs/SCORING.md` §2) | done |
| Farmer priorities (water, forage, N-fixing, erosion, organic matter, market) | Priority sliders in advisory (`src/ui/advisory`), `RotationStrategy.metrics` in `src/contracts/advisory.ts` | partial: UI and contract built, engine landing |
| Bare-field periods, vulnerable seasons | Ground-cover metric in contract, rotation calendar (`src/ui/advisory/RotationCalendar.tsx`), score timeline | partial: engine landing |
| Compare at least three rotation strategies including the existing one, with why, evidence, benefits, gaps, risks | `RotationCompare.tsx`, `RotationStrategy` (`why`, `evidence`, `benefits`, gaps, risks) | partial: screens built, engine returns none yet |
| Supportive, does not replace farmer judgement | Design rule 5 (`docs/ARCHITECTURE.md` §1), gates set "needs local review", assistant instructions (`docs/SYSTEM_INSTRUCTIONS.md`) | done |
| C1 Explain ET, soil-moisture anomaly, NDVI, frost risk, water balance; satellite vs ground | Assistant glossary EN/VI (`data/rag/glossary.en.md`, `data/rag/glossary.vi.md`), Ask panel | done |
| C1 Combining satellite and ground improves accuracy | Ground-Truth Override with calibration notes and rain-gauge bias factor (`docs/ARCHITECTURE.md` §4.4) | done |
| C2 Compare modelling approaches | Weighted sum rejected for product of factors, documented (`docs/SCORING.md` §3); renderer comparison (`docs/GLOBE.md` §1); RAG variants (`docs/RAG.md`) | done |
| C2 Seasonal transitions and bare-field periods | FAO-56 growth stages, timeline commentary (insights) | partial: insights module not wired |
| C2 Uncertainty and where local expertise must validate | Confidence Badge formula, gates, low/high yield range, "not verified" list (`docs/SCORING.md` §7) | done |
| C2 Harmonise resolutions and cadences into explainable features | Rules S1-S4 and T1-T6 (`docs/ARCHITECTURE.md` §4) | done |
| C3 Nutrient cycling, erosion, organic matter, pest-cycle disruption, water use, forage, markets | Contract metrics (`nitrogenKgHaYr`, `groundCoverPct`, `pestBreak`, `waterUseMm`, margin); curated rotation traits | partial: engine landing; pest and market models absent |
| C3 Explain N-fixing, cover, deep-rooting, drought-tolerant crops | Curated rotation traits, assistant answers | partial |
| C4 Interactive map over time, overlays | MapLibre globe, time-synced GIBS overlays, parcel colour by date (`src/globe`) | done |
| C4 Field-level vulnerabilities, timelines | Radial HUD anomaly markers, Master Timeline Scrubber, risk events | done |
| C4 Scenario sliders | Override panel (irrigation, pH, sowing date), priority sliders | partial: what-if recompute done; priority re-ranking needs engine |
| C5 Interpretable for non-technical farmers | Decisions-first screens, plain-language assistant, English and Vietnamese | done |
| C5 Farmer inputs for priorities and constraints | Ground-Truth Override, economics overrides, priorities | done (priorities effect pending engine) |
| C5 Reminders that the tool supports local expertise | Gates, assistant rules, advisory gaps and risks | done |

## 2. Targeted awards

| Award | Evidence in the product |
|---|---|
| Best Use of Data | Eight branches fused on one parcel and one timeline; explicit spatial (footprint ratio, anomaly use, lapse correction) and temporal (hold windows, pending latency gap) handling; per-reading Confidence Badge; live tests of every source with quirks documented, including the NASA POWER 2015/2016 rainfall discontinuity and the absence of key-free SMAP and IMERG series (`docs/DATA_SOURCES.md`); retrieval measured at recall@5 1.00, MRR 0.98 on 56 questions (`docs/RAG.md`) |
| Galactic Impact | Works for any point on Earth without an account or key; English and Vietnamese; four demo fields spanning Vietnamese smallholders and US commercial farms; rotation, water and soil decisions rather than raw data |
| Best Mission Concept | Layered tiers with typed contracts (`src/contracts`); live APIs with ordered fallbacks and visible notes; ground-truth calibration; transparent scoring a judge can reproduce by hand (`README.md` worked example, `docs/SCORING.md` §5); limits stated (`README.md` "Limits and honest notes") |
| Art & Technology | Globe-to-field continuous fly-in in one camera, custom atmosphere and star layers, radial telemetry HUD, synchronised timeline; measured 60 fps while scrubbing with SMAP overlay and terrain on, one machine (`docs/GLOBE.md` §5); design system (`docs/DESIGN.md`, `#/styleguide`) |

## 3. Known gaps a judge may probe

- Advisory, tracking and urban engines: placeholders on disk at the time of writing.
- Generative assistant mode: not exercised against a live model.
- SMAP and IMERG: map overlays only; SMAP AppEEARS adapter never run.
- Scoring weights and gates: documented judgement, not calibrated against yields.
- Economics: partial coverage; Vietnamese costs are press figures.
- Demo-field boundaries: provisional shapes; demo tracking history simulated.
