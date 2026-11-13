# Data sources — what was tested and how it behaves

Everything in the "Verified" section was called for real on 2026-11-13/14 from the team's machine, mostly at the Đắk Lắk test point (12.80 N, 108.20 E, 602 m) and a few US points. Quirks listed here were observed, not assumed. Agent 2a extends this file as adapters land.

Names in **bold** are the names used on the challenge Resources page.

## 1. Verified, no key required

### NASA POWER — **NASA POWER**
- Daily: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=...&community=AG&longitude=..&latitude=..&start=YYYYMMDD&end=YYYYMMDD&format=JSON`
- Monthly: `.../temporal/monthly/point?...&start=YYYY&end=YYYY` (key `YYYY13` is the annual mean). Climatology: `.../temporal/climatology/point`.
- Parameters confirmed: `T2M`, `T2M_MAX`, `T2M_MIN`, `T2MDEW`, `T2MWET`, `TS`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `PRECTOTCORR`, `GWETTOP`, `GWETROOT`, `GWETPROF`, `EVPTRNS`, `EVLAND`, `FROST_DAYS`. Not yet tested: `ALLSKY_SFC_PAR_TOT` (PAR).
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

## 2. Needs a credential

- **NASA AppEEARS** (`https://appeears.earthdatacloud.nasa.gov/api/`): product list is public; sampling needs an Earthdata Login bearer token (`EARTHDATA_TOKEN`) and runs as an asynchronous task. Products relevant here: `SPL4SMGP.008` and `SPL3SMP_E.006` (**SMAP**, 9 km daily), `ECO_L2T_LSTE.002`, `ECO_L3T_JET.002`, `ECO_L4T_ESI.002` (**ECOSTRESS**, 70 m), `MOD13Q1.061`, `MOD11A2.061`, `VNP13A1.002`, `HLSS30.020` / `HLSL30.020` and their `_VI` products (**Landsat** + Sentinel-2, 30 m), `SRTMGL1_NC.003`, `DAYMET.004`. GPM IMERG is not offered by AppEEARS.
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
