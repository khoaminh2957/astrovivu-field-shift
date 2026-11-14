# Data sources — what was tested and how it behaves

Everything in the "Verified" section was called for real on 2026-11-13/14 from the team's machine, mostly at the Đắk Lắk test point (12.80 N, 108.20 E, 602 m) and a few US points. Quirks listed here were observed, not assumed. Agent 2a extends this file as adapters land.

Names in **bold** are the names used on the challenge Resources page.

## 1. Verified, no key required

### NASA POWER — **NASA POWER**
- Daily: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=...&community=AG&longitude=..&latitude=..&start=YYYYMMDD&end=YYYYMMDD&format=JSON`
- Monthly: `.../temporal/monthly/point?...&start=YYYY&end=YYYY` (key `YYYY13` is the annual mean). Climatology: `.../temporal/climatology/point`.
- Parameters confirmed: `T2M`, `T2M_MAX`, `T2M_MIN`, `T2MDEW`, `T2MWET`, `TS`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `PRECTOTCORR`, `GWETTOP`, `GWETROOT`, `GWETPROF`, `EVPTRNS`, `EVLAND`, `FROST_DAYS`. `ALLSKY_SFC_PAR_TOT` (PAR, MJ/m²/day) verified 2026-11-14, ~2.5-month latency (see §1b).
- 1-2 s, `Access-Control-Allow-Origin: *`, fill value `-999`. Source grid MERRA-2 (~50 km), solar from CERES (~100 km). The response header gives the cell's mean elevation (398 m at the test point vs 602 m SRTM): apply a lapse-rate correction to temperatures.
- **Rainfall defect.** `PRECTOTCORR` annual totals jump between 2015 and 2016 at both Vietnamese test points while ERA5 stays level. Đắk Lắk: 250-650 mm/yr for 2005-2015, then 1,870-2,250 mm/yr for 2016-2024 (ERA5: 1,070-2,050 throughout). Cần Thơ: 960-1,380 then 1,780-2,920. Iowa shows no jump. Do not use POWER rainfall for baselines or trends that cross 2016 in SE Asia; the 2001-2025 POWER climatology mixes both regimes.
- `IMERG_PRECTOT` exists as a parameter but returned the fill value for every day and month tried at Đắk Lắk.
- Soil wetness (`GWET*`) is a model fraction of saturation (0-1), not a SMAP retrieval. Label it `modelled`.

### Open-Meteo — **ERA5: ECMWF Reanalysis**, forecast, elevation
- Archive: `https://archive-api.open-meteo.com/v1/archive?latitude=..&longitude=..&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean,et0_fao_evapotranspiration&hourly=soil_moisture_0_to_7cm&timezone=auto`. Twenty years of daily data returns in ~1.5 s (170 kB).
- Forecast: `https://api.open-meteo.com/v1/forecast?...&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration&forecast_days=16`.
- Elevation: `https://api.open-meteo.com/v1/elevation?latitude=..&longitude=..` (605 m at the test point).
- `Access-Control-Allow-Origin: *`. Free for non-commercial use, CC BY 4.0 attribution.

### ORNL DAAC subset API — **MODIS**, **VIIRS**, SMAP, ECOSTRESS
- `https://modis.ornl.gov/rst/api/v1/{product}/subset?latitude=..&longitude=..&startDate=A2025001&endDate=A2025065&kmAboveBelow=0&kmLeftRight=0&band=..` with header `Accept: application/json`. Also `/products`, `/{product}/bands`, `/{product}/dates?latitude=..&longitude=..`.
- At most 10 composite dates per request. Slow (13-60 s) and intermittently `502 Proxy Error`: retry with backoff, never call in a blocking path, always cache. CORS echoes the request origin.
- Confirmed with values: `MOD13Q1` band `250m_16_days_NDVI` (scale 0.0001; 0.817 on 2025-01-01), `MOD11A2` band `LST_Day_1km` (scale 0.02, Kelvin), `MOD16A2GF` band `ET_500m` (scale 0.1, kg/m²/8day).
- Listed but not yet exercised: `VNP13A1`, `MCD12Q1`, `MCD12Q2`, `MCD15A2H`, `MOD17A2H`, `SPL4CMDL`, `Daymet`, `GEDI04_B`.
- `SPL3SMP_E` (SMAP L3 enhanced, band `soil_moisture`): the 2025-02-01..05 request returned "No data available"; check `/dates` before relying on it.
- `ECO4ESIPTJPL`: "No data available" at the Đắk Lắk point.

### SoilGrids v2.0 (ISRIC) — not on the Resources list, needed for soil outside the US
- `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=..&lat=..&property=phh2o&property=soc&property=clay&property=sand&property=silt&property=nitrogen&property=cec&property=bdod&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean&value=Q0.05&value=Q0.95`
- Units are scaled integers: `phh2o` pH x 10, `soc` dg/kg, `clay/sand/silt` g/kg, `nitrogen` cg/kg, `cec` mmol(c)/kg, `bdod` cg/cm³. Test point 0-5 cm: clay 339 g/kg, pH 5.6, SOC 349 dg/kg.
- 5-26 s. Returns `null` on masked pixels (urban; 12.67 N 108.04 E was null): retry at a neighbour ~300 m away and say so. `Access-Control-Allow-Origin: *`. The `/classification/query` endpoint timed out.
- WMS per property: `https://maps.isric.org/mapserv?map=/map/phh2o.map` (layers such as `phh2o_0-5cm_mean`).

### Elevation — **Shuttle Radar Topography Mission (SRTM)**
- OpenTopoData: `https://api.opentopodata.org/v1/srtm30m?locations=lat,lon|lat,lon` (up to 100 points per call, 1 call/s, 1,000 calls/day). **No CORS header**: server or scripts only.
- AWS Terrain Tiles (Terrarium PNG, includes SRTM): `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, CORS `*`. `elevation = R*256 + G + B/256 - 32768`. Works in the browser and as a MapLibre `raster-dem` source with `encoding: 'terrarium'`.

### NASA GIBS — map layers for **SMAP**, **GPM IMERG**, **MODIS**, **Landsat** (HLS), GRACE
- WMTS REST (Web Mercator): `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{y}/{x}.{png|jpeg}`. CORS `*`. Max zoom is the level in the TileMatrixSet name.
- Confirmed 200: `MODIS_Terra_L3_NDVI_16Day` (`GoogleMapsCompatible_Level9`, png), `BlueMarble_NextGeneration` (`GoogleMapsCompatible_Level8`, jpeg, date `2004-08-01`), `SMAP_L4_Analyzed_Root_Zone_Soil_Moisture` (`GoogleMapsCompatible_Level6`, png), `IMERG_Precipitation_Rate` (`GoogleMapsCompatible_Level6`, png).
- WMS: `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=..&CRS=EPSG:4326&BBOX=s,w,n,e&WIDTH=..&HEIGHT=..&FORMAT=image/png&TIME=YYYY-MM-DD`.
- Latest dates seen in GetCapabilities on 2026-11-13: `MODIS_Terra_CorrectedReflectance_TrueColor` (daily, same day), `HLS_L30_Nadir_BRDF_Adjusted_Reflectance` / `HLS_S30_...` (2026-11-05), `MODIS_Terra_L3_NDVI_16Day` (2026-10-16), `MODIS_Terra_NDVI_8Day` (2026-11-12), `MODIS_Terra_L3_EVI_16Day`, `MODIS_Combined_L4_LAI_8Day`, `IMERG_Precipitation_Rate` (2026-11-12), `SMAP_L4_Analyzed_Surface_Soil_Moisture` / `..._Root_Zone_...` / `SMAP_L4_Soil_Temperature_Layer_1` (2026-11-10), `SMAP_L3_Passive_Enhanced_Day_Soil_Moisture`, `MODIS_Terra_Land_Surface_Temp_Day` (daily), `MERRA2_Evaporation_Land_Monthly`, `MODIS_Combined_Flood_3-Day`, `OPERA_L3_Dynamic_Surface_Water_Extent-HLS`, `MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual` (2024), `SRTM_Color_Index`, `ASTER_GDEM_Color_Shaded_Relief`. `GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI` ends 2022-07.

### ClimateSERV (NASA SERVIR) — rainfall and evaporative stress time series
- Submit: `https://climateserv.servirglobal.net/api/submitDataRequest/?datatype=N&begintime=MM/DD/YYYY&endtime=MM/DD/YYYY&intervaltype=0&operationtype=5&dateType_Category=default&isZip_CurrentDataType=false&geometry=<url-encoded GeoJSON polygon>` returns `["<uuid>"]`; poll `getDataRequestProgress/?id=`; fetch `getDataFromRequest/?id=`. Finished in under 20 s. CORS `*`.
- `datatype=0` (CHIRPS daily rain) and `datatype=29` (Evaporative Stress Index, 4-week, weekly values) returned data at Đắk Lắk. `datatype=26` and `38` returned an empty series for June 2025: the dataset ids for IMERG and for SMAP-based soil moisture still need to be identified.

### Base maps
- Esri World Imagery: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (CORS `*`; attribution required).
- EOX Sentinel-2 cloudless (**Copernicus Sentinel-2**): `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg` (CC BY-NC-SA 4.0, attribution "Sentinel-2 cloudless by EOX IT Services GmbH, contains modified Copernicus Sentinel data 2020").

### United States only
- **USDA NRCS SSURGO** via Soil Data Access: `POST https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`, JSON body `{ "format": "JSON+COLUMNNAME", "query": "<SQL>" }`. Map unit from a point: `SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(lon lat)')`. Columns confirmed: `muname`, `compname`, `comppct_r`, `drainagecl`, `hydgrp`, `hzdept_r`, `hzdepb_r`, `om_r`, `ph1to1h2o_r`, `claytotal_r`, `sandtotal_r`, `awc_r`, `kwfact`. ~2 s. WMS: `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms` (`mapunitpoly`).
- **Cropland Data Layer (CDL): CropScape**: `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=2023&x=..&y=..` with x/y in EPSG:5070 (CONUS Albers); returns XML wrapping `{x, y, value, category, color}`. WMS `https://nassgeodata.gmu.edu/CropScapeService/wms_cdlall.cgi` (layers `cdl_2025`, `cdl_latest`, earlier years).
- Daymet single pixel: `https://daymet.ornl.gov/single-pixel/api/data?lat=..&lon=..&vars=prcp,tmax,tmin&start=..&end=..` (CSV, 1 km).
- US Drought Monitor: `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=<FIPS>&startdate=M/D/YYYY&enddate=M/D/YYYY&statisticsType=1`.
- **USGS NWIS** site service: `https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=w,s,e,n&siteType=GW&hasDataTypeCd=gw`.
- **USGS NLCD** WMS: `https://www.mrlc.gov/geoserver/mrlc_display/wms`.
- Crop-CASMA (SMAP-derived soil moisture for US cropland): `https://nassgeo.csiss.gmu.edu/CropCASMA/` loads; its data API has not been explored.

## 1b. Findings from building the adapters (2026-11-14)

| Question | Finding |
|---|---|
| POWER `ALLSKY_SFC_PAR_TOT` | Works, unit **MJ/m²/day** (from the response `parameters` block). Latency ~2.5 months: at Đắk Lắk the last value was 2026-08-30 on 2026-11-14, while `ALLSKY_SFC_SW_DWN` (FLASHFlux) reached 2026-11-03. PAR/SW ratio 0.45-0.49. The adapter fills later days with SW × the ratio observed at that point, flagged `q: 'filled'` and noted. |
| Open-Meteo daily soil moisture | `daily=soil_moisture_0_to_7cm_mean,soil_moisture_7_to_28cm_mean,soil_moisture_28_to_100cm_mean` works on the archive API (m³/m³) up to yesterday. Root zone 0-100 cm = (7·L1 + 21·L2 + 72·L3)/100. |
| ORNL `SPL3SMP_E`, `SPL4CMDL` | `/dates` answers "No … data available for <lat> <lon> location" at Đắk Lắk and at Iowa. ORNL serves SMAP only at a few sites. The adapter checks `/dates` and writes a note. |
| ORNL `VNP13A1` bands | `500_m_16_days_NDVI`, `500_m_16_days_EVI` (fill −15000, scale 0.0001). `MOD16A2` band `ET_500m` (fill 32767). A one-pixel MOD13Q1 request took 18 s. |
| ClimateSERV ids | `0` CHIRPS: data to 2026-09-30 (~45 d latency). `29` ESI 4-week and `33` ESI 12-week: last values July 2025. `26` IMERG late / `91` IMERG early / `90` CHIRP: empty for 2025-2026 (26 returned one stray value in June 2024). `31`/`32`: values that look like CHIRPS-GEFS forecast anomaly / mean (not used). `37-41` USDA SMAP: documented to end August 2022, empty here. `35`, `36`: HTTP 500. Five or more simultaneous submissions return 503; the adapter keeps two in flight. |
| GPM IMERG | No key-free point route found (ClimateSERV empty, POWER `IMERG_PRECTOT` fill, AppEEARS does not offer it). Rainfall uses CHIRPS, with ERA5 to fill the latency gap and for the anomaly. |
| SoilGrids | On 2026-11-14 three consecutive 100 s attempts timed out for southern France while Kenya answered in ~90 s: the soil branch can end `unavailable` live. The WMS `GetFeatureInfo` route (maps.isric.org, CORS *, 1 s) answers but returns an empty feature for point queries, so it is not a usable fallback. Up to 78 s for one point; adapter timeout 100 s, 2 retries. Uses `d_factor` from the response. Q0.05/Q0.95 are depth-weighted like the mean (an approximation: quantiles do not add). |
| CORS | Send `Access-Control-Allow-Origin: *`: Soil Data Access (also on the OPTIONS preflight), Nominatim, Photon, BigDataCloud reverse-geocode-client, Open-Meteo geocoding, Terrarium tiles, SoilGrids, POWER, ClimateSERV. **No CORS**: CropScape `GetCDLValue` and OpenTopoData, so CDL crop history and SRTM-by-point are cache-script only. |
| Geocoding | Forward: Nominatim (1 req/s, limiter = 1), Photon fallback. Open-Meteo geocoding was rejected: "Dak Lak" returns nothing. Reverse: BigDataCloud client endpoint in the browser (Vietnamese names), Nominatim in Node and as fallback. |

### Branch implementation (src/data/live)

| Branch | Delivered by (in order) | Notes written |
|---|---|---|
| soilMoisture | ERA5-Land volumetric (`sm_surface`, `sm_root`, 20-year DOY baseline) + POWER GWETTOP/GWETROOT as `gwet_top`/`gwet_root` (% sat). SMAP L4 via AppEEARS (Node + `EARTHDATA_TOKEN`) or ORNL SPL3 take over the canonical keys when present; ERA5 then moves to `*_era5`. | regional model, SMAP availability |
| vegetation | MOD13Q1 NDVI/EVI (chunks of ≤10 composites, 2 in flight), fallback VNP13A1. Parcel larger than a pixel → mean of pixels whose centre is inside (S1). Cache script adds a 5-year DOY baseline. | mixed pixel, failed chunks |
| thermal | MOD11A2 `LST_Day_1km` (×0.02 K → °C); ESI ClimateSERV 29. Cache script adds `lst_night`, MOD16A2 `et` (mm/day) and a 5-year LST baseline. | ESI stalled since 2025-07 |
| rainfall | ERA5 first (fast), then CHIRPS replaces `rain`; ERA5 stays as `rain_era5`. `rain_anom` = trailing 30-day ERA5 total as % of ERA5's own 2006-2025 normal for that day of year (±3 days pooled; null where the normal is < 5 mm). | IMERG unavailable, CHIRPS latency |
| agromet | POWER T2M/T2M_MAX/T2M_MIN (lapse-adjusted from the POWER cell elevation to the parcel), RH2M, WS2M, PAR; ERA5 ET0. Second report adds 10-year POWER DOY baselines. ERA5 temperatures if POWER fails. | PAR fill, lapse correction |
| terrain | Terrarium tiles at zoom ≤ 13 (≤ 4 tiles), zonal Horn slope, mean-gradient aspect, D8 mode, relief. Cache script prefers OpenTopoData SRTM 30 m grid. Fallback Open-Meteo Copernicus DEM elevation only. Resolves `parcel.elevationM`. | < 4 cells |
| soil | US: SSURGO dominant component (0-30 cm weighted) first, SoilGrids merged after (SSURGO wins, SoilGrids value in `detail`). Elsewhere SoilGrids 0-30 cm, neighbours 300 m N/E/S/W when masked. `texture_class` + `usda_texture`. | masked pixel, CDL browser limit |
| risk | Open-Meteo 16-day forecast, lapse-adjusted; threshold events (below). | generic thresholds only |

Texture → EcoCrop class: organic if SOC ≥ 120 g/kg; heavy if clay ≥ 35 %; light if sand ≥ 52 % and clay < 20 %; otherwise medium. Generic risk thresholds: heat Tmax ≥ 35 °C on ≥ 2 consecutive days (warning ≥ 38, severe ≥ 41); frost Tmin ≤ 2 / 0 / −3 °C; heavy rain ≥ 30 / 50 / 100 mm/day; dry spell ≥ 10 / 14 days < 1 mm; wind ≥ 50 / 70 km/h.

`climateHistory`: ERA5 monthly rain, ET0, mean/min/max temperature for the 20 complete years before the current one, lapse-adjusted from Open-Meteo's DEM elevation to the parcel. `cropHistory`: CDL for the 8 years before the current one (Node only).

Open-Meteo quota: the 20-year archive request weighs a few hundred "calls" of the 10,000/day free allowance; it is cached for a day (IndexedDB / `.cache/`) keyed to ~110 m.

## 2. Needs a credential

- **NASA AppEEARS** (`https://appeears.earthdatacloud.nasa.gov/api/`): product list is public; sampling needs an Earthdata Login bearer token (`EARTHDATA_TOKEN`) and runs as an asynchronous task. Products relevant here: `SPL4SMGP.008` and `SPL3SMP_E.006` (**SMAP**, 9 km daily), `ECO_L2T_LSTE.002`, `ECO_L3T_JET.002`, `ECO_L4T_ESI.002` (**ECOSTRESS**, 70 m), `MOD13Q1.061`, `MOD11A2.061`, `VNP13A1.002`, `HLSS30.020` / `HLSL30.020` and their `_VI` products (**Landsat** + Sentinel-2, 30 m), `SRTMGL1_NC.003`, `DAYMET.004`. GPM IMERG is not offered by AppEEARS. `src/data/adapters/appeears.ts` implements the SPL4SMGP point task (layers `Geophysical_Data_sm_surface`, `Geophysical_Data_sm_rootzone`, 3-hourly → daily means) for the cache script; it has **not been run end-to-end** because no token was available.
- **USDA NASS QuickStats**, **USDA AMS Market News**, **OpenET**: free keys; not tested.

## 3. Not usable

- GES DISC Hydrology Data Rods (**NLDAS/GLDAS** point time series): discontinued; the endpoint redirects to the discontinuation notice.
- NASA POWER `IMERG_PRECTOT`: empty (see above).

## 4. Resources-page datasets we do not ingest, and why

| Dataset | Reason |
|---|---|
| **Landsat** (EarthExplorer) | Login + raster processing; represented by the HLS map layer and, with a token, HLS via AppEEARS |
| **USDA Ag Data Commons** | Catalogue of downloadable study datasets; no location query |
| **Web Soil Survey (WSS)** | Interactive front end of the SSURGO data we already query |
| **PRISM Climate Data** | US only, file distribution; POWER + ERA5 + Daymet cover the need |
| **NAIP** | 1 m aerial imagery, US only, every few years; a satellite base map is enough to draw a field |
| **NLDAS/GLDAS** | Point service discontinued; POWER provides the equivalent variables |
| **FAO GAEZ** | Pre-computed suitability for a few dozen crops; we score 2,000+ species ourselves from EcoCrop and can explain each factor |
| **CoCoRaHS** | Station rain for validation in North America; not needed for scoring |
| **USDA AMS Market News**, **USDA NASS QuickStats** | Economics layer; reference tables first, keyed APIs later |
| **OpenET** | Key required, western US only; MODIS ET is global |
| **USFS LANDFIRE** | Wildland vegetation and fuels, not cropland |
| **GEDI** | Canopy structure of tall vegetation; weak signal over crops |
| GRACE / GRACE-FO | ~300 km and the GIBS layer ends in 2022; map layer for long-term context only |

## 5. Crop requirements

`data/ecocrop/ecocrop_2568_plants.csv`: FAO EcoCrop, 2,568 species, 70 columns (column guide in `ecocrop_2568_plants_headers.html`). 2,048 species have temperature, rainfall, pH, texture and drainage requirements. Known defects: temperature values > 60 and latitude values > 90 in a handful of rows (wrong scale), `cult_cycle_min/max = 0` means missing (685 species), `eco_altitude_opt_*` is empty, aluminium toxicity is filled for 62 species only, some species have several rows with different thresholds.

## Field rasters (within-field pictures, 10-30 m)

`loadFieldRasters(parcel)` (`src/data/rasters/`) returns small north-up lng/lat grids over the parcel bounding box plus one cell of margin, at most 96 cells on the long side, one frame per real acquisition date. Demo parcels read `public/data/samples/<id>.rasters.json` (written by `npx tsx scripts/data/cache-rasters.ts`, up to 24 frames); other parcels load live from the Microsoft Planetary Computer (key-free, CORS `*`): one STAC search per collection, then one data-API request per scene (`/api/data/v1/item/bbox/{bbox}/{w}x{h}.npy`, nearest resampling), which returns the requested assets plus a last band that is the validity mask (255 inside the scene, 0 outside). Responses are cached in `.cache/` (Node) or IndexedDB (browser); scenes for a year, searches for a day.

| key | branch | source | cell | value | mask | encoding (`offset + scale*byte`) | display range |
|---|---|---|---|---|---|---|---|
| `ndvi` | vegetation | Copernicus Sentinel-2 L2A B04, B08 | 10 m | (NIR-Red)/(NIR+Red) | SCL kept 4, 5, 6, 7 | -1 + 2/254 | 0..1 |
| `ndmi` | soilMoisture | Sentinel-2 L2A B8A, B11 | 20 m | (B8A-B11)/(B8A+B11), a canopy and surface moisture index, not soil moisture | SCL as above | -1 + 2/254 | -0.4..0.6 |
| `lst` | thermal | Landsat 8/9 C2 L2 `lwir11` (ST_B10) | 30 m | DN x 0.00341802 + 149.0 K, shown in °C | QA_PIXEL bits 0-5 (fill, dilated cloud, cirrus, cloud, shadow, snow) all clear | -40 + 0.4 | 2nd-98th percentile of the cells seen, rounded to 5 °C |
| `elevation` | terrain | AWS Terrarium tiles (SRTM and others) | ~14-19 m (zoom 13) | metres | none | min + (max-min)/254 | min..max |
| `slope` | terrain | derived from `elevation` | same | central differences, degrees | none | 0 + max/254 | 0..max |

**Reflectance offset.** Sentinel-2 processing baseline 04.00 and later (all scenes since 2022-01-25) store `DN = 10000 x reflectance + 1000`. The offset is read from `s2:processing_baseline` per scene and subtracted before any index; without it NDVI over bare soil is biased low by roughly a factor of two.

**Scene selection.** The 365-day window ending today is cut into bins of `max(15, 365 / maxFrames)` days counted back from today. Within a bin, scenes (scene cloud cover below 60 %) are tried clearest first, up to three; a scene is used when at least 70 % of the parcel cells are valid. Newest bins first; at most `maxFrames` (12 live, 24 for the demo caches). Cloudy bins are simply absent: frames are never interpolated or filled. Where two MGRS tiles overlap, both are candidates and the mask decides.

**Checks (2026-11-14).** Sentinel-2 NDVI parcel means follow the MODIS MOD13Q1 series of the demo fields within about 0.1 on most dates (Iowa July 0.88 vs 0.91, Nevada June 0.62 vs 0.69, Dak Lak October 0.88 vs 0.81); MODIS 16-day maximum-value composites run slightly higher, as expected. Flooded rice in Can Tho reads near 0 at transplanting.

**Limits.** Terrain is one frame dated today (static). Tropical fields get few clear frames in the wet season (An Giang 6-12, Dak Lak 9-13 over the year). Landsat thermal is 100 m native, resampled by USGS to 30 m. HLS (`hls2-s30`/`hls2-l30`) is not wired; it is the planned fallback if Sentinel-2 L2A on the Planetary Computer fails. A data-API failure for one scene is logged and that bin moves to its next candidate; a whole collection failing yields no raster for that key (an empty list is a valid answer).

## Field boundary detection (`src/data/boundary/`)

`detectFieldBoundary(point)`, `detectFieldCandidates(point)` and `openFieldSession(point)` segment the parcel under a clicked map point from multi-spectral Sentinel-2 L2A stacks (`B03`, `B04`, `B08`, `B11`, `SCL` via the Planetary Computer; granule cloud cover ≤ 45 %, up to two clearest scenes tried per 60-day bin over the past year, kept when local window SCL validity ≥ 82 % and seed-patch validity ≥ 80 %, selecting up to four seasonally diverse dates):

- **Multi-spectral edge & 1-click growing** (`pure.ts`): combines `NDVI = (B08 - B04)/(B08 + B04)`, `NDMI = (B08 - B11)/(B08 + B11)` (harvest/residue/flood contrast) and visible brightness `(B03 + B04)/2` (gravel roads, canal bunds, farmsteads, used strictly for step/ridge barriers so intra-field bare-soil drainage catenas do not split a field). Directional 1-pixel and 2-pixel ridge detectors catch 10–20 m roads and dikes that 3×3 Sobel misses; `NaN` cloud specks on one date are ignored rather than turned into false edges. `growRegion` shifts the seed off small obstacles within 40 m, grows a 4-connected region bounded by running-mean and 3×3-median anchor drift, cuts thin cross-road necks via morphological opening before recovering the 1-cell spectral margin, fairs pixel staircases, simplifies with minor-axis-capped Douglas-Peucker + collinearity pruning (or fits a circle when Polsby-Popper compactness > 0.8 and radial CV < 0.07), and filters shapes by convex solidity (`area / hullArea ≥ 0.66`) so 6:1 strip paddies pass while leaky cross-road blobs are rejected.
- **Two-scale candidates** (`index.ts`): evaluates a 1.61 km window at 10 m (`161 × 161`) first and returns up to 3 distinct candidates (IoU ≤ 0.72, e.g. single strip vs management block); falls back to a 3.62 km window at 20 m (`181 × 181`) when the 10 m window hits the border without a solid closed parcel (> 65 ha quarter- and half-sections).
- **Interactive multi-point refinement & edge regularisation** (`openFieldSession`, `segmentPrompts`, `regularizeRing`): retains the winning multi-spectral stack and precomputed gradient in memory so follow-up clicks inside the window solve in 20–70 ms (measured in Node) with zero network requests. Positive (`+`) clicks grow and weld adjacent strips or soil zones across internal waterways and headlands up to 3 cells wide, and the result is kept as one connected polygon (a `+` that cannot join restarts the selection on that farm); negative (`−` or `Alt + click`) clicks carve away neighbour/pond/farmstead spills via simultaneous binary-heap Dijkstra geodesic competition (`Float64` distances) along internal bunds and tillage lines; each click of **Regularise** (`regularizeSteps = 1, 2, ...`) snaps near-orthogonal agricultural edges to the dominant `4θ` parcel orientation and prunes short staircase kinks while preserving area.
- **Limits**: Sentinel-2 is 10 m per pixel (`B11` is 20 m), so sub-5 m bunds under uniform year-round canopy can require one `−` click or corner drag; persistently overcast regions with zero ≥ 82 % clear windows over 365 days return `null` and fall back to manual 4-corner tap or radius entry.

## Crop photographs (FAO EcoCrop)

The Urban Grower shows one photograph per plant. They are FAO's, and they are linked, not copied.

| | |
|---|---|
| Source | FAO EcoCrop. Species page `https://ecocrop.apps.fao.org/ecocrop/srv/en/cropView?id=<code>`, photograph `https://ecocrop.apps.fao.org/ecocrop/ec_images/<code>.jpg`, where `<code>` is `CropProfile.ecocropId` |
| Terms | https://www.fao.org/contact-us/terms/en/ : copying and use are allowed "in non-commercial products or services, provided that appropriate acknowledgement of FAO as the source and copyright holder is given" and that FAO's endorsement is not implied |
| Accessed | 2026-11-14 |
| Credit shown | "Photo: © FAO, EcoCrop" under the photograph in the care guide, and once under the grid of cards with the sentence that FAO does not endorse the tool and a link to the terms. Every `<img>` has alt text naming the crop; the care guide links to the species page |
| Storage | None. No image file is in the repository or in the build. The browser loads each photograph from FAO in an `<img>` with `loading="lazy"`, `decoding="async"`, `referrerpolicy="no-referrer"` and fixed width and height. Hotlinking from `http://localhost:5173` was checked in the browser on 2026-11-14 (images load; a code without a photograph fails cleanly) |
| Manifest | `public/data/crops/images.json`: `{ generatedAt, source, terms, credit, images: { "<code>": { w, h } } }`, written by `npx tsx scripts/crops/crop-images.ts`. Only crops listed there get an `<img>` |

**The script** requests each curated crop's photograph once (15 s timeout, at most 3 retries with 1, 2, 4 s backoff on a network error, 429 or 5xx, 4 requests at a time), reads the width and height from the JPEG frame header, and keeps only that outcome in `.cache/crop-images/<code>.json`; the image bytes are not written anywhere. A second run makes no request (`--refresh` asks again). A crop that FAO could not be reached for is left out of the manifest and not cached, and the script exits with code 1.

**Coverage (2026-11-14).** 72 of the 73 curated crops have an EcoCrop code (marigold, `tagetes-erecta`, is not in EcoCrop). 59 of the 72 have a photograph; the other 13 answer HTTP 404: mung bean, chickpea, robusta coffee, avocado, sunn hemp, daikon radish, sesbania, lettuce, water spinach, mustard greens, cabbage, yardlong bean, squash (`cucurbita-moschata`). Of the 32 crops the Urban Grower can recommend, 25 have a photograph. The originals are small, 92 to 200 px wide and 152 to 220 px tall, so the cards draw them at 64 x 96 or 80 x 120 px and the care guide at no more than 136 x 204 px.

**When there is no photograph.** A crop without one, a manifest that fails to load, or an image that fails at run time (`onError`) shows a tile instead: the tint and icon of the crop's group with the crop's initial. The tile is also what is visible while a photograph loads. Nothing else on the screen depends on FAO's server.

**Limits.** The photographs are EcoCrop's choice for the species, not for the variety grown in a given country (the "Lettuce" entry is a head lettuce; "Mint" is `Mentha spicata`). Some are botanical drawings rather than photographs. The terms cover non-commercial use only: a commercial deployment would need FAO's permission or other pictures.
