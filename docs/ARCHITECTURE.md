# Astrovivu — Architecture

> **Field Shift: Adapting Farms with NASA Data** · NASA Space Apps Challenge 2026 · team Astrovivu

## 1. The problem we solve

A farmer choosing next season's rotation needs to know five things about one piece of land: how wet the soil is, how the crop is doing, how hot and how dry it has been, what the ground is made of, and what is coming. NASA observes all of it, but every dataset arrives on a different grid and with a different delay: SMAP soil moisture is a 9 km pixel two to three days old, MODIS greenness is a 250 m pixel composited over sixteen days, IMERG rain is a 10 km pixel, SRTM terrain is 30 m and never changes. A two-hectare field is 140 m across.

Astrovivu puts all of it on **one parcel and one timeline**, says honestly how far each number can be trusted at field scale, lets the farmer overrule it with what they measured, and reduces the result to a handful of decisions: at least three rotation strategies compared side by side, an irrigation schedule, a pH plan and a sowing window.

Design rules every tier follows:

1. **One parcel, one timeline.** Every number on screen refers to the locked parcel at the cursor date.
2. **No number without provenance.** Source, native resolution, observation age and how it was produced travel with the value and surface as a Confidence Badge.
3. **Ground truth wins.** A farmer's measurement replaces the satellite estimate and the difference is shown, not hidden.
4. **Decisions, not dashboards.** Raw data is never dumped on the user; each state ends in something to do.
5. **Support, do not replace.** Information gaps and risks that need local review are first-class output, as the challenge asks.
6. **Works anywhere.** Any point on Earth resolves through live APIs. Four demo fields are pre-cached so the story plays instantly. US-only layers switch on automatically inside the United States.

## 2. Approved scope

| # | Feature | State |
|---|---|---|
| 1 | Rotating hero globe, then a continuous fly-in to the field (satellite imagery + 3D terrain, NASA layer toggles) | 1-2 |
| 2 | Parcel lock: demo field, quick four-corner draw, coordinates or GPS + area; drag vertices to adjust | 2 |
| 3 | Radial HUD: eight telemetry branches around a Center Productivity Hub (Telemetry Sparkline, Confidence Badge, Anomaly Marker) | 3 |
| 4 | Master Timeline Scrubber (one year) driving parcel overlay, all eight branches and the score in sync, with automatic commentary | 4 |
| 5 | Ground-Truth Override: pH, irrigation, crop/variety, sowing date; everything recalculates | 4 |
| 6 | Advisory engine: three or more rotation strategies including the current one, irrigation schedule, pH amendment, sowing-window shift | 5 |
| 7 | Long-term tracking: season journal, year-over-year comparison, annual financial plan (demo history is simulated and labelled) | 6 |
| 8 | Urban Grower Companion: location, microclimate, preferences, plant picks, care calendar | side mission |
| 9 | Crop-knowledge assistant (RAG) answering questions about crops and about the locked field | all |

Deliberately out of scope (OneSoil features we do not copy): variable-rate prescription maps, soil-sampling maps, machinery file upload, weather-station management, multi-user organisations, within-field productivity zones, automatic boundary detection.

## 3. Tiers

```
 NASA + partner APIs
        |
 [T1] Acquire & sync            src/data            adapters, fallbacks, caching, sample caches
        |
 [T2] Geo-processing &          src/data/harmonize  parcel sampling, unit normalisation, baselines,
      ground-truth calibration  src/core/scoring    confidence, farmer overrides
        |
 [T3] Scoring & economics       src/core            productivity score, yield, revenue, cost, margin
        |
 [T4] 3D globe & time-synced    src/globe, src/ui   globe, HUD, timeline (reads the mission store)
      visualisation
        |
 [T5] Advisory AI               src/core/advisory   rule-based advisories + insights,
                                src/rag, server/    crop-knowledge RAG, optional LLM narrative
```

Tiers talk through `src/contracts` (types) and `src/state/mission.ts` (runtime store). Lower tiers never import from higher ones. `src/core` is pure TypeScript: no fetch, no DOM, deterministic, unit-tested, usable from Node scripts.

## 4. The two hard problems

### 4.1 Spatial mismatch

| Source | Native pixel | Pixels per 2 ha parcel | What the value means at field scale |
|---|---|---|---|
| SRTM | 30 m | ~22 | Field-level; zonal statistics inside the polygon |
| MODIS NDVI | 250 m | 0.3 | Field-level only above ~6 ha; otherwise a mixed pixel |
| SoilGrids | 250 m | 0.3 | Modelled soil of the neighbourhood |
| MODIS LST | 1 km | 0.02 | Landscape signal |
| SMAP L4 | 9 km | 0.0002 | Regional signal |
| IMERG | 10 km | 0.0002 | Regional signal |
| NASA POWER | ~50 km | - | Regional climate |

Rules:

- **S1 Sample to the parcel, never resample the grid.** Coarse grids (>= 1 km) are read at the parcel centroid. 250-500 m grids use the pixel under the centroid, or the mean of pixels intersecting the polygon when the parcel is larger than one pixel. Sub-100 m grids use zonal statistics inside the polygon.
- **S2 Publish the footprint ratio.** `fit = min(1, sqrt(parcelAreaM2) / resolutionM)` is stored with every source and feeds the Confidence Badge.
- **S3 Coarse data is used as anomaly, not as absolute.** For regional sources the scorer uses departures from the same pixel's own multi-year baseline (z-score, percentile), which transfers to the field far better than the absolute value.
- **S4 Elevation mismatch is corrected.** Air temperature from a coarse cell is lapse-rate adjusted (-6.5 °C/km) from the cell's mean elevation to the parcel's SRTM elevation.

### 4.2 Temporal latency

- **T1 Native cadence is preserved.** Adapters store samples exactly as observed (`Series.samples`), never interpolated.
- **T2 One cursor.** `timeline.cursor` is a calendar date. Each series shows its most recent valid observation at or before the cursor (`sampleAt`).
- **T3 Hold windows.** An observation is carried forward only for a cadence-dependent hold window (daily 3 d, 8-day 12 d, weekly 10 d, 16-day 24 d, monthly 45 d). Beyond that the reading is flagged stale and its confidence drops.
- **T4 The latency gap is visible.** The last days of the timeline, where a source has not published yet, are drawn as pending, not as zero and not as a flat line.
- **T5 Forecast is a different kind of number.** The risk branch extends past today with forecast series (`provenance: forecast`), visually distinct from observations.
- **T6 Baselines.** Wherever a source offers history, adapters compute a day-of-year climatology (mean, p10, p90). Anomaly Markers and commentary come from departures from that band.

### 4.3 Confidence Badge

```
spatial   = 0.30 + 0.70 * sqrt(fit)                      fit from S2 (static layers: 1.0 when resolution <= parcel side)
fresh     = 1.0 if age <= cadence
            linear down to 0.3 at 3 x cadence, 0.3 beyond (static layers: 1.0)
source    = observed 1.00 | ground-truth 1.00 | modelled 0.75 | derived 0.70 | forecast 0.60 | simulated 0.30
quality   = good 1.00 | fair 0.85 | filled 0.70 | poor 0.50
score     = spatial * fresh * source * quality
level     = high (>= 0.70) | medium (0.45-0.70) | low (< 0.45)
```

`BranchTelemetry.confidence` carries the static part (spatial x source) with human-readable reasons; the UI multiplies in freshness for the cursor date. Ground-truth values always show `high`.

### 4.4 Ground-truth calibration

A `GroundTruth` field replaces its satellite or model counterpart for every downstream calculation, and a `CalibrationNote` records both values and the effect. Specific rules:

- **pH, EC, texture, drainage, soil depth**: replace SoilGrids / SSURGO values; the soil branch shows the measured value with the estimate struck through.
- **Irrigation**: `full` removes rainfall as a limiting factor and switches the water balance to demand-driven; `supplemental` caps the deficit.
- **Sowing date and crop**: anchor growth stages; the score becomes stage-aware from that date.
- **Measured soil moisture or rain**: a bias factor (ratio of means over overlapping dates) is applied to the satellite series and reported.
- **Yield, price, cost**: replace reference values in the economics.

## 5. Branch to source matrix

Primary source first, then fallbacks in order. The adapter that actually delivered is recorded in `BranchTelemetry.sources`; any fallback produces a visible note. Names in bold are the names used on the challenge Resources page.

| Branch | Primary | Fallbacks | Map overlay (GIBS) |
|---|---|---|---|
| 1 soilMoisture | **SMAP** L4 root zone + surface, 9 km (AppEEARS with token, or sample cache) | SMAP L3 via ORNL subset; NASA POWER GWETTOP/GWETROOT (MERRA-2, modelled); ERA5-Land. US: Crop-CASMA | `SMAP_L4_Analyzed_Root_Zone_Soil_Moisture` |
| 2 vegetation | **MODIS** MOD13Q1 NDVI/EVI, 250 m, 16-day (ORNL subset) | **VIIRS** VNP13A1 | `MODIS_Terra_L3_NDVI_16Day` |
| 3 thermal | **MODIS** MOD11A2 land surface temperature, 1 km, 8-day | **ECOSTRESS** LST/ESI 70 m (AppEEARS with token); Evaporative Stress Index (ClimateSERV); MOD16 ET | `MODIS_Terra_Land_Surface_Temp_Day` |
| 4 rainfall | **GPM IMERG** daily | CHIRPS (ClimateSERV); **ERA5** (Open-Meteo). Not NASA POWER rain before 2016 in SE Asia (see DATA_SOURCES.md) | `IMERG_Precipitation_Rate` |
| 5 agromet | **NASA POWER** PAR, air temperature, humidity, wind | ERA5 (Open-Meteo), incl. FAO-56 reference ET | - |
| 6 terrain | **SRTM** elevation, slope, aspect, flow direction (terrain tiles / OpenTopoData) | Copernicus DEM (Open-Meteo elevation) | terrain mesh |
| 7 soil | SoilGrids 250 m (pH, organic carbon, texture, CEC, N) | US: **SSURGO** via Soil Data Access | - |
| 8 risk | 16-day forecast (Open-Meteo) + threshold events | crop-stage pest and disease pressure rules | - |

## 6. Data contract

`src/contracts/` is the single source of truth:

| File | Defines |
|---|---|
| `common.ts` | `Lang`, `I18nText`, `ISODate`, `Quad` |
| `geo.ts` | `Parcel`, `ParcelDraft`, `SampleParcel`, `PlaceHit` |
| `telemetry.ts` | `BRANCHES`, `METRICS` (canonical keys), `SourceRef`, `Series`, `StaticFact`, `RiskEvent`, `ConfidenceBadge`, `BranchTelemetry`, `FieldTelemetry` |
| `crop.ts` | `CropProfile` and its requirement, water, economics, rotation and urban facets |
| `model.ts` | `GroundTruth`, `ModelInput`, `FactorScore`, `ScoreSnapshot`, `ScoreTimeline`, `SowingWindow`, `WhatIfResult`, `CropSuiteSummary` (second suitability method, docs/SCORING.md section 9) |
| `advisory.ts` | economics (`SeasonEconomics`, `AnnualPlan`), `Advisory`, `RotationStrategy`, `IrrigationPlan`, `PhPlan`, `AdvisoryReport`, `Insight` |
| `experience.ts` | map layers, `ScreenAnchor`, tracking, urban companion, RAG (`AskRequest`, `AskResult`) |

Invariants:

- Dates are `YYYY-MM-DD` strings, compared lexicographically.
- Adapters emit the canonical metric keys in `METRICS`; `Series.unit` is authoritative.
- Missing information is `null` and is never scored as zero.
- Every string a human reads exists in English and Vietnamese (`I18nText`, or the UI dictionaries).
- Anything simulated carries `provenance: 'simulated'` or `simulated: true`.

Changes to contracts are additive only (new optional fields, new types). Renames and removals go through the architect.

## 7. Mission store and state machine

```
hero --click--> explore --lock parcel--> locked <--> advisory
                    ^                      |  ^----> tracking
                    +----- change field ---+
urban  (side mission, reachable from any state)
```

`src/state/mission.ts` (Zustand) is the only runtime coupling between layers:

- **Globe** reads `phase`, `parcel`, `draft`, `drawMode`, `layers`, `timeline.cursor`, `telemetry`, `focusBranch`; writes `anchor`, `draft`, and calls `lockParcel`.
- **HUD and panels** read `telemetry`, `branchStatus`, `score`, `insights`, `advisory`, `tracking`, `anchor`, `timeline`; call the actions.
- **Model tiers** are invoked only by the store (`recompute`).

Sequence after a parcel is locked:

1. `lockParcel(parcel)` sets `phase = 'locked'`, marks all branches `loading`, aborts any previous load.
2. `data.loadTelemetry` reports each branch through `onProgress`; the store publishes the partial telemetry and calls `recompute()` so the HUD fills in progressively.
3. `recompute()` runs `core/scoring` then `core/advisory` and publishes `score`, `insights`, `advisory`.
4. `setCursor` / `play` move `timeline.cursor`; views re-read values with `sampleAt` and `scoreAt` (no recompute needed).
5. `setCrop`, `setGroundTruth`, `setPriorities` trigger `recompute()`.

Mount points (each folder exports the component from its `index.tsx`; `src/App.tsx` composes them):

| Component | Folder | Phase |
|---|---|---|
| `GlobeCanvas`, `GlobeLab` | `src/globe` | always / `#/globe-lab` |
| `TopBar` | `src/ui/chrome` | all but hero |
| `HeroOverlay` | `src/ui/hero` | hero |
| `LayerPanel`, `ActionDock` | `src/ui/dock` | explore |
| `RadialHud` | `src/ui/hud` | locked |
| `TimelineScrubber` | `src/ui/timeline` | locked |
| `GroundTruthPanel` | `src/ui/override` | locked |
| `AdvisoryPanel` | `src/ui/advisory` | advisory |
| `TrackingView` | `src/ui/tracking` | tracking |
| `UrbanCompanion` | `src/ui/urban` | urban |
| `AskPanel` | `src/ui/ask` | all but hero |
| `StyleGuide` | `src/ui/design` | `#/styleguide` |

Deep links for demos and testing: `?sample=daklak-coffee&phase=advisory&crop=glycine-max&lang=vi`, `?phase=explore`, `?phase=urban`.

## 8. Runtime modes

| Mode | When | Behaviour |
|---|---|---|
| `cached` | demo fields | loads `public/data/samples/<id>.json` built by `npm run data:samples` |
| `live` | any other parcel | browser calls the CORS-enabled APIs directly, fastest first, cached in IndexedDB |
| `mock` | all sources unreachable, or `VITE_DATA_MODE=mock` | simulated telemetry, labelled as such |

The API server (`npm run server`, port 8787, proxied at `/api`) is optional: it adds generative answers (needs `ANTHROPIC_API_KEY`) and token-protected NASA sources (needs `EARTHDATA_TOKEN`). Without it the app is a static site.

## 9. Quality budgets

- 60 fps during the fly-in and while scrubbing: no React re-render per map frame (refs + `requestAnimationFrame`), parcel colouring from in-memory values, GIBS tiles swapped with debounce and cross-fade.
- First telemetry within 2 s of locking (NASA POWER, forecast, terrain); slow sources stream in.
- English by default, Vietnamese one toggle away; numbers with units; keyboard reachable controls; `prefers-reduced-motion` respected.
- `npm run typecheck`, `npm test` and `npm run build` pass on `main`.

## 10. How this maps to the awards

| Award | What earns it here |
|---|---|
| Best Use of Data | Eight NASA-anchored branches fused on one parcel and one timeline, with explicit handling of resolution and latency and a per-reading Confidence Badge |
| Galactic Impact | Rotation, water and soil decisions for smallholders anywhere on Earth, in their language, without an account or a key |
| Best Mission Concept | A plausible layered design: live APIs with fallbacks, ground-truth calibration, transparent scoring, clear limits |
| Art & Technology | Mission-control interface: globe-to-field continuity, radial telemetry, synchronised timeline |
