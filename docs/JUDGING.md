# Judging map

Where Astrovivu answers each part of the *Field Shift: Adapting Farms with NASA Data* challenge, and the evidence for each targeted award. Status reflects what is on disk on 2026-11-14: **done** = implemented and tested or exercised; **partial** = implemented in part, or with a stated limit; **not done** = absent.

## 1. Challenge objectives and considerations

| Challenge item | Where the product answers it | Status |
|---|---|---|
| Decision-support tool combining NASA Earth observations with local agricultural information | Whole app: eight metrics (`src/data`), Soil and practice tab (`src/ui/override`), advisory (`src/core/advisory`); `docs/ARCHITECTURE.md` | done |
| Use the named NASA datasets | Series: MODIS, VIIRS, NASA POWER, SRTM. Within-field & boundary: Sentinel-2 10-20 m NDVI/NDMI and parcel boundary, Landsat 30 m surface temperature, SRTM terrain. Overlays: SMAP, GPM IMERG, MODIS. (`docs/DATA_SOURCES.md`) | partial: no key-free SMAP or IMERG point series (overlays only); SMAP AppEEARS adapter never run; ECOSTRESS only as ClimateSERV ESI (stale since 2025-07); GRACE overlay ends 2022 |
| Temperature, heat stress, frost risk | Agromet and thermal cards, Landsat field picture, heat and frost insights against crop limits (`docs/ADVISORY.md` §1), kill-temperature and winter-survival gates (`docs/SCORING.md`) | done |
| Rainfall, extreme precipitation | Rainfall card (CHIRPS + ERA5, 30-day anomaly), dry-spell and heavy-rain insights, forecast events | done (not from an IMERG series) |
| Soil moisture, evaporation, water balance | Soil-moisture card (ERA5-Land, POWER wetness, labelled modelled), Sentinel-2 NDMI field picture, MODIS ET, FAO-56 balance in scoring and the irrigation schedule | done (modelled, not SMAP) |
| Vegetation stress | MODIS NDVI against day-of-year baseline, Sentinel-2 10 m NDVI, ESI where available, persistent-departure insights | done |
| Long-term water trends | 20-year ERA5 climate history, year-by-year reliability; GRACE map layer | partial: no groundwater trend series |
| Local soil information | SoilGrids, SSURGO in the US, the grower's own soil values (Soil and practice tab) with a ledger of what they changed | done |
| Crop characteristics | FAO EcoCrop, 2,062 scorable species, 73 curated (`docs/SCORING.md` §2) | done |
| Farmer priorities (water, forage, N-fixing, erosion, organic matter, market) | Priority ranking re-weights strategies (0.5 + 3/2/1); metrics for water, N credit, ground cover, soil health, margin (`docs/ADVISORY.md` §2) | partial: markets not modelled; N credits are indicative literature values |
| Bare-field periods, vulnerable seasons | Ground-cover months and explicit fallow seasons per strategy, 12-month season calendar over 20-year ERA5 rain and temperature (`src/ui/advisory/SeasonCalendar.tsx`, `SeasonBlock.tsx`, `ClimateStrip.tsx`), off-season marking, insights | done |
| Compare at least three rotation strategies including the existing one, with why, evidence, benefits, gaps, risks | Current + soil-health, water-saver, income, resilience (plus interactive `custom` season swaps); strategy cards, dumbbell trade-offs and five generated lists (`src/core/advisory`, `src/ui/advisory/StrategyCards.tsx`, `TradeOffs.tsx`, `StrategyStory.tsx`) | done |
| Supportive, does not replace farmer judgement | Every strategy's risks include local extension review; gates set "needs local review"; assistant rules (`docs/SYSTEM_INSTRUCTIONS.md`) | done |
| C1 Explain ET, soil-moisture anomaly, NDVI, frost risk, water balance; satellite vs ground | Assistant glossary EN/VI (`data/rag/glossary.en.md`, `data/rag/glossary.vi.md`), card details with sources and caveats | done |
| C1 Combining satellite and ground improves accuracy | Soil and practice tab, calibration ledger with each override's score effect, rain-gauge bias factor (`docs/ARCHITECTURE.md` §4.4) | done |
| C2 Compare modelling approaches | Product of factors chosen over weighted sum (`docs/SCORING.md` §3); RAG variants measured (`docs/RAG.md`); zones by fixed bands vs thirds (`src/core/zones/index.ts`); renderer choice (`docs/GLOBE.md` §1) | done |
| C2 Seasonal transitions and bare-field periods | FAO-56 growth stages, dormancy, off-season outlook, stage-change insights | done |
| C2 Uncertainty and where local expertise must validate | Confidence Badge, staleness with publication delay (`src/lib/series.ts`), low/high yield range, gaps and risks lists, "not verified" list (`docs/SCORING.md` §7) | done |
| C2 Harmonise resolutions and cadences into explainable features | Rules S1-S4, T1-T6 (`docs/ARCHITECTURE.md` §4); within-field rasters never interpolated (`docs/DATA_SOURCES.md`, "Field rasters") | done |
| C3 Nutrient cycling, erosion, organic matter, pest-cycle disruption, water use, forage, markets | N credit, ground cover, soil health, pest break by family and pest group, water use and fit, forage stands, erosion and organic-matter advisories | partial: markets and pest models absent; pest pressure is a weather index |
| C3 Explain N-fixing, cover, deep-rooting, drought-tolerant crops | Strategy "why" lists, curated rotation traits, assistant | partial: deep rooting not a separate metric |
| C4 Interactive map over time, overlays | MapLibre globe, time-synced GIBS overlays, within-field picture per date (`docs/GLOBE.md` §3b) | done |
| C4 Field-level vulnerabilities, timelines | Field pictures, relative NDVI zones (`src/core/zones`), timeline with insights, pending and forecast ranges | done |
| C4 Scenario sliders | Soil and practice inputs (irrigation, pH, sowing date, rotation, economics), priority ranking, and per-season crop swapping on the Rotation calendar (`src/core/advisory/customRotation.ts`), all recomputing live | done |
| C5 Interpretable for non-technical farmers | One plain sentence per chart, decisions first, English and Vietnamese | done (no user testing with farmers) |
| C5 Farmer inputs for priorities and constraints | Soil and practice tab, priorities, economics overrides | done |
| C5 Reminders that the tool supports local expertise | Risks lists, gates, assistant rules, closing statement in the UI and docs | done |

## 2. Targeted awards

| Award | Evidence in the product |
|---|---|
| Best Use of Data | Eight metrics fused on one parcel and one timeline; within-field Sentinel-2 (10 m) and Landsat (30 m) frames checked against MODIS (within about 0.1 NDVI on most dates); explicit spatial and temporal handling and a per-reading Confidence Badge; every source tested live with its quirks documented, including the NASA POWER 2015/2016 rainfall discontinuity and the absence of key-free SMAP and IMERG series (`docs/DATA_SOURCES.md`); retrieval recall@5 1.00, MRR 0.98 on 56 self-written questions (`docs/RAG.md`) |
| Galactic Impact | Any point on Earth, no account or key, English and Vietnamese; demo fields from Vietnamese smallholdings to US commercial farms; ends in rotation, water, pH and sowing decisions with gaps and risks |
| Best Mission Concept | Layered tiers with typed contracts (`src/contracts`); live APIs with ordered fallbacks and visible notes; ground-truth calibration ledger; scoring a judge can reproduce by hand (`README.md` worked example, `docs/SCORING.md` §5); limits stated (`README.md`, "Limits and honest notes") |
| Art & Technology | Continuous globe-to-field flight in one camera, custom atmosphere and stars, field drawn as its own metric picture, synchronised timeline; frame rates measured with their conditions (`docs/GLOBE.md` §5); design system (`docs/DESIGN.md`, `#/styleguide`) |

**Interface model, stated plainly.** The working shell's structure and proportions (icon rail, field list, map with tool column, tabbed field panel) follow OneSoil's web app, measured from its public interface (`docs/DESIGN.md`, "Shell"), at the user's request and with the organisers' agreement that teams may build on an existing interface. The name, mark, icons, code and wording are our own; no OneSoil code, asset or data service is used. The originality claim for Art & Technology rests on the globe, the field pictures and the data design, not on the shell layout.

## 3. Known gaps a judge may probe

- SMAP and IMERG are map overlays only; the SMAP AppEEARS adapter has never run.
- Generative assistant mode has not been exercised against a live model.
- Scoring weights, gates and advisory thresholds are documented judgement, not calibrated against yields or field data.
- Reference economics cover part of the curated crops; Vietnamese costs are press figures; reference prices drive the income strategy.
- Đắk Lắk (2.0 ha) and An Giang (`cantho-rice`, 1.4 ha) outlines are real parcels detected from Sentinel-2 NDVI (`detectFieldBoundary`), though the crops grown on them are assumed rather than verified on the ground; Iowa and Nevada were traced on Esri imagery.
- Demo tracking history is simulated and labelled; demo fields start from an assumed farm profile.
- No testing with farmers.
