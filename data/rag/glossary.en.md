# Astrovivu glossary (English)

Written for Astrovivu from docs/ARCHITECTURE.md and docs/DATA_SOURCES.md. Each entry has a stable id shared with the Vietnamese file. Licence: CC BY 4.0, Astrovivu team.

## ndvi
title: NDVI (Normalized Difference Vegetation Index)
aliases: ndvi, normalized difference vegetation index, greenness, vegetation index, vegetation vigour
tags: term, vegetation, modis, satellite

NDVI measures how green and dense the vegetation is. Healthy leaves absorb red light for photosynthesis and reflect near-infrared light strongly, so NDVI = (NIR − Red) / (NIR + Red). Values run from −1 to 1: bare soil is about 0.1-0.2, sparse or stressed crops 0.2-0.5, dense healthy canopy 0.6-0.9. Water and clouds give values near or below zero.

In Astrovivu NDVI comes from MODIS MOD13Q1: a 250 m pixel, composited over 16 days to remove clouds, published about one to two weeks after the period ends. A 250 m pixel covers 6.25 ha, so on a field smaller than about 6 ha the value mixes in neighbouring land (roads, trees, other crops). Use it as a trend for the area and compare against the same pixel's normal for the date rather than reading the absolute number as the field's own. A drop in NDVI can mean drought, pests, harvest, or simply a cloudy composite.

## evi
title: EVI (Enhanced Vegetation Index)
aliases: evi, enhanced vegetation index
tags: term, vegetation, modis, satellite

EVI is a vegetation index like NDVI that also uses the blue band to correct for haze and for soil showing through the canopy. It does not saturate as quickly over dense vegetation, so it separates a good canopy from an excellent one better than NDVI does. Astrovivu reads EVI from the same MODIS MOD13Q1 product as NDVI (250 m pixel, 16-day composite). Typical crop values are 0.2-0.6. The same field-scale caution applies: on small parcels the pixel mixes neighbouring land.

## lst
title: Land surface temperature (LST)
aliases: lst, land surface temperature, surface temperature, skin temperature, surface heat
tags: term, thermal, modis, satellite, temperature

Land surface temperature is the temperature of the ground or canopy surface as seen by a thermal sensor, not the air temperature 2 m above it. On a sunny afternoon a dry bare field can be 10-20 °C hotter than the air; a well-watered crop that transpires stays close to air temperature, because evaporation cools the leaves. That makes LST a stress signal: a canopy running much hotter than normal is usually short of water.

Astrovivu uses MODIS MOD11A2: a 1 km pixel, 8-day composite of daytime and night-time LST. At 1 km the value describes the landscape around the field, so the app reads it as an anomaly against the pixel's own normal. ECOSTRESS measures LST at 70 m but only on irregular overpasses and, for the app, only with an Earthdata token.

## evaporative-stress
title: Evaporative stress and the Evaporative Stress Index (ESI)
aliases: esi, evaporative stress index, evaporative stress, water stress, plant water stress
tags: term, thermal, water, satellite

Evaporative stress compares how much water the land is actually evaporating and transpiring with how much it could under the same weather if water were not limiting. The Evaporative Stress Index (ESI) expresses that ratio as a standardised anomaly (in standard deviations, σ) against normal for the week: negative values mean plants are using less water than usual, an early sign of drought stress that often appears before leaves visibly change colour. Astrovivu reads ESI (4-week composite, weekly values) from NASA SERVIR ClimateSERV when available. It is a regional signal at kilometre scale, best read as "the area around the field is drier or wetter than normal".

## evapotranspiration
title: Evapotranspiration (ET) and reference ET0
aliases: evapotranspiration, et, et0, reference evapotranspiration, water use, crop water demand, transpiration, evaporation
tags: term, water, agromet

Evapotranspiration is the water that leaves a field as vapour: evaporation from the soil plus transpiration through the plants. It is the crop's water use, usually given in mm per day (1 mm on 1 ha = 10 m³).

Reference evapotranspiration (ET0) is the water use of a standard short, well-watered grass under the day's weather, computed with the FAO-56 Penman-Monteith equation from radiation, temperature, humidity and wind. It describes the atmosphere's demand. A crop's own water need is ETc = Kc × ET0, where Kc is the crop coefficient. Astrovivu gets ET0 from ERA5 reanalysis through Open-Meteo (about 9-25 km cells) and actual ET from MODIS MOD16 (500 m, 8-day). Typical ET0 in a tropical dry season is 4-6 mm/day.

## crop-coefficient
title: FAO-56 crop coefficient (Kc)
aliases: kc, crop coefficient, fao-56, fao 56, kc ini, kc mid, kc end, etc
tags: term, water, fao56

The crop coefficient Kc converts reference evapotranspiration (ET0) into the water use of a specific crop: ETc = Kc × ET0. FAO Irrigation and Drainage Paper 56 gives Kc in three values over the season: Kc ini while the crop is small and most water evaporates from bare soil (often 0.3-0.5), Kc mid at full canopy (often 1.0-1.2 for field crops), and Kc end as the crop matures and dries. The season is split into initial, development, mid-season and late stages. Astrovivu's scoring uses these stage lengths and coefficients from the crop catalogue to turn weather into a daily crop water demand; local values depend on variety, sowing date and climate and should be checked with local guidance.

## soil-moisture
title: Soil moisture: surface and root zone
aliases: soil moisture, root zone moisture, root-zone moisture, surface soil moisture, volumetric water content, m3/m3, soil water, sm_root, sm_surface
tags: term, soil-moisture, smap, satellite, water

Soil moisture is the share of the soil volume filled with water, in m³/m³ (0.25 m³/m³ means a quarter of the soil volume is water). Surface soil moisture describes the top ~5 cm, which dries within days after rain. Root-zone soil moisture describes roughly the top metre, where most crop roots draw water; it changes more slowly and matters more for the crop.

NASA SMAP measures surface moisture from space with a microwave radiometer; the SMAP Level-4 product combines those measurements with a land model to estimate root-zone moisture on a 9 km grid, available two to three days after observation. Because a 9 km pixel is about 8,100 ha, the value is a regional signal: Astrovivu compares it with the same pixel's normal for the date (an anomaly) instead of treating it as the moisture under one field. Typical values: below ~0.15 m³/m³ dry, 0.20-0.35 moist, above ~0.40 very wet, depending on soil texture. A farmer's own measurement replaces the satellite value.

## soil-moisture-anomaly
title: Soil-moisture anomaly
aliases: soil moisture anomaly, anomaly, departure from normal, wetter than normal, drier than normal, percentile, z-score
tags: term, soil-moisture, anomaly, baseline

An anomaly is how far a reading departs from what is normal for that place and that time of year. Astrovivu builds, for each source that offers history, a day-of-year climatology of the same pixel: the mean and the 10th-90th percentile band. A soil-moisture anomaly then says, for example, "root-zone moisture is in the driest 10 % of years for mid-March" or "+0.04 m³/m³ above normal".

Coarse data (1 km pixels and larger) is used as an anomaly rather than an absolute value because the departure transfers to the field much better than the number itself: if the whole 9 km pixel is unusually dry, the field is very probably drier than usual too, even if its own absolute moisture differs because of its soil. Anomaly Markers on the timeline come from these departures.

## water-balance
title: Water balance
aliases: water balance, soil water balance, water deficit, deficit, surplus, rain minus evapotranspiration, p-et
tags: term, water, water-balance

A field's water balance is the bookkeeping of water in and out of the root zone: rain and irrigation in; crop evapotranspiration, runoff and deep drainage out. When water use exceeds supply for long enough, the soil store is drawn down and the crop enters a deficit; once more than a crop-specific fraction of the available water is used (FAO-56 calls it p, often 0.4-0.6), the crop starts to suffer.

The simplest version Astrovivu shows is rain minus crop water demand over a period (P − ETc), in mm. A season total of −150 mm means the crop needed 150 mm more than it received; irrigation or stored soil water must make up the difference. If the farmer sets irrigation to "full", rainfall stops being the limiting factor and the balance becomes demand-driven.

## growing-degree-days
title: Growing degree days (GDD)
aliases: growing degree days, gdd, degree days, heat units, thermal time
tags: term, temperature, gdd

Growing degree days measure accumulated warmth that drives crop development. For each day, GDD = max(0, (Tmax + Tmin)/2 − Tbase), where Tbase is the temperature below which the crop does not develop (about 10 °C for maize and soybean, 5 °C for wheat). Summing GDD from sowing predicts stages such as flowering or maturity better than counting calendar days, because a cool season slows the crop and a warm one speeds it up. Astrovivu's air temperatures come from NASA POWER (about 50 km cells, lapse-rate corrected to the parcel's SRTM elevation at −6.5 °C per km) and ERA5.

## frost-risk
title: Frost risk
aliases: frost, frost risk, freezing, cold damage, killing temperature, chilling
tags: term, risk, temperature, frost

Frost forms when the surface cools to 0 °C or below, usually on clear, calm nights. Plant tissue can be damaged even when the air at 2 m stays slightly above zero, because leaves radiate heat and cool below the air. Low-lying spots collect cold air and freeze first. EcoCrop gives each crop a killing temperature during early growth; Astrovivu flags frost risk when forecast minimum temperatures (Open-Meteo, 16-day) approach that threshold, and counts frost days from NASA POWER history. Forecasts are forecasts: frost on one field depends on its position in the landscape, which a 10-50 km weather cell cannot see.

## imerg-rainfall
title: Rainfall from GPM IMERG
aliases: imerg, gpm, global precipitation measurement, satellite rainfall, rain, precipitation, rainfall
tags: term, rain, imerg, satellite

GPM IMERG merges microwave and infrared observations from a constellation of satellites into a global rainfall estimate every half hour on a 0.1° grid (about 10 km). Astrovivu uses daily totals. Satellite rainfall is an estimate of the average over the whole cell: a thunderstorm can drench one field and miss the next, and light rain or rain over mountains is often under- or over-estimated. Use IMERG for the timing and the regional amount, compare the last 30 or 90 days with normal, and trust a farm rain gauge more for the field itself. Fallbacks are CHIRPS (ClimateSERV) and ERA5 reanalysis.

## nasa-power
title: NASA POWER agro-climate data
aliases: nasa power, power, merra-2, agromet, air temperature, humidity, solar radiation, par, wind
tags: term, agromet, power

NASA POWER (Prediction Of Worldwide Energy Resources) serves daily weather for agriculture from the MERRA-2 reanalysis (about 50 km) and CERES solar data (about 100 km): air temperature at 2 m, humidity, wind, solar radiation and modelled soil wetness. It is modelled, not measured at the field, so Astrovivu corrects temperatures for the difference between the cell's mean elevation and the parcel's SRTM elevation. Known defect: in South-East Asia POWER's rainfall jumps between 2015 and 2016, so Astrovivu does not use POWER rain for baselines that cross 2016 there.

## par
title: Photosynthetically active radiation (PAR)
aliases: par, photosynthetically active radiation, sunlight, solar radiation, light
tags: term, agromet, light

PAR is the part of sunlight (400-700 nm) that plants use for photosynthesis, given in MJ/m²/day. It is roughly 45-50 % of total incoming solar radiation. Long cloudy spells lower PAR and slow growth and grain filling even when water is plentiful. Astrovivu reads PAR from NASA POWER (CERES, about 100 km cell), a regional value.

## srtm-terrain
title: Terrain from SRTM: elevation, slope, aspect, drainage
aliases: srtm, terrain, elevation, slope, aspect, flow direction, topography, dem
tags: term, terrain, srtm

The Shuttle Radar Topography Mission mapped the land surface by radar in February 2000; Astrovivu uses its 30 m elevation model. At 30 m a 2 ha field holds about 22 pixels, so elevation, slope and aspect are genuinely field-level. Slope matters for erosion and machinery, aspect for sun and heat, and the flow direction shows where water runs to and where it collects (waterlogging risk at the bottom of a slope). Elevation also drives the temperature correction of coarse weather data (−6.5 °C per km).

## soilgrids
title: SoilGrids soil properties
aliases: soilgrids, soil data, soil ph estimate, clay, sand, silt, organic carbon, cec, soil map
tags: term, soil, soilgrids

SoilGrids (ISRIC) is a global map of soil properties at 250 m produced by machine learning from about 240,000 soil profiles and environmental covariates. Astrovivu reads pH, organic carbon, clay, sand, silt, nitrogen, cation exchange capacity and bulk density for 0-30 cm, with the 5th-95th percentile range. It is a modelled estimate of the neighbourhood's soil, not a measurement of the field: local management, liming and erosion are invisible to it. A soil test from the field always replaces it. In the United States Astrovivu uses SSURGO survey data instead.

## soil-ph
title: Soil pH and acidity
aliases: ph, soil ph, acidity, acid soil, alkaline soil, sour soil, lime, liming
tags: term, ph, soil

Soil pH measures acidity on a logarithmic scale: pH 7 is neutral, below 5.5 is acid, above 7.5 alkaline; each unit is a tenfold change. pH controls which nutrients roots can take up. In acid soils (below about 5.5) aluminium and manganese can become toxic and phosphorus, calcium and molybdenum scarce, which hurts legumes such as soybean and groundnut in particular. Each crop has an optimal range (EcoCrop lists, for example, soybean 5.5-6.5). Agricultural lime raises pH slowly over months; the amount depends on soil texture and buffer capacity and must come from a soil test and local guidance.

## soil-texture
title: Soil texture and drainage
aliases: texture, soil texture, clay soil, sandy soil, loam, heavy soil, light soil, drainage, waterlogging
tags: term, soil, texture, drainage

Texture is the mix of sand, silt and clay. EcoCrop groups it as heavy (clay-rich), medium (loams) and light (sandy), plus organic soils. Heavy soils hold more water and nutrients but drain slowly and can waterlog; light soils drain fast, warm early and need more frequent water. Drainage class (poor, well, excessive) describes how fast excess water leaves the root zone; many crops, including most pulses and coffee, fail in waterlogged soil. Texture cannot be changed in practice; drainage can be improved with beds, ridges or drains.

## satellite-vs-ground
title: Satellite data versus ground measurements
aliases: satellite vs ground, ground truth, ground measurement, field measurement, pixel, resolution, mixed pixel, why satellite differs, accuracy
tags: term, satellite, ground-truth, resolution

A satellite does not measure a field: it measures a pixel. SMAP soil moisture is one value for a 9 km square, IMERG rain for 10 km, NASA POWER weather for about 50 km, MODIS NDVI for 250 m, SRTM elevation for 30 m. A 2 ha field is about 140 m across, so for most sources the field is a tiny part of the pixel and the reading is an average over roads, forest, villages and other farms. Satellites also measure indirectly (microwave brightness for moisture, reflected light for greenness), at a given time of day, and with a delay.

Ground measurements (a soil test, a rain gauge, a moisture probe) are local and direct but cover one point and one moment. The two complement each other: satellites give continuous coverage, history and the comparison with normal; ground data gives the field's true level. Astrovivu's rule is that ground truth wins: a value the farmer enters replaces the satellite estimate and the difference is shown.

## footprint-fit
title: Pixel footprint and field fit
aliases: footprint, fit, pixel size, spatial resolution, field scale, pixels per parcel
tags: term, resolution, confidence

Astrovivu publishes how well each source's pixel fits the parcel: fit = min(1, √(parcel area) / pixel size). A 2 ha parcel (√20,000 m² ≈ 141 m) gets fit 1.0 from SRTM (30 m), 0.56 from MODIS NDVI (250 m), 0.14 from MODIS LST (1 km) and 0.016 from SMAP (9 km). Grids of 1 km or coarser are read at the parcel centroid and treated as regional signals; 250-500 m grids use the pixel under the centroid or the mean of pixels touching a larger parcel; sub-100 m grids use statistics inside the polygon. The fit feeds the Confidence Badge.

## latency-revisit
title: Revisit, latency and stale readings
aliases: latency, revisit, cadence, composite, delay, stale, old reading, observation age, data age, pending
tags: term, latency, confidence

Each source has a cadence (how often it delivers a value: daily, 8-day, 16-day, monthly) and a latency (how long after the observation it is published: SMAP L4 two to three days, MODIS NDVI one to two weeks after the 16-day period). At any date on the timeline Astrovivu shows each source's latest valid observation at or before that date and carries it forward only for a hold window (daily 3 days, 8-day 12, weekly 10, 16-day 24, monthly 45). Beyond that the reading is marked stale and its confidence drops. The last days of the timeline, where a source has not published yet, are drawn as pending, not as zero.

## confidence-badge
title: The Confidence Badge
aliases: confidence badge, confidence, trust, high medium low, reliability of a reading
tags: term, confidence

Every reading in Astrovivu carries a Confidence Badge saying how far it can be trusted at field scale. The score multiplies four parts: spatial = 0.30 + 0.70 × √fit (how well the pixel fits the parcel); freshness = 1.0 while the reading is within its cadence, falling linearly to 0.3 at three times the cadence; source = 1.00 for observations and ground truth, 0.75 modelled, 0.70 derived, 0.60 forecast, 0.30 simulated; quality = 1.00 good, 0.85 fair, 0.70 gap-filled, 0.50 poor. The level is high at 0.70 or more, medium from 0.45, low below. A farmer's measurement always shows high. The assistant matches its wording to the level: high "shows", medium "suggests", low "may indicate, worth checking on the ground".

## provenance
title: Observed, modelled, forecast, derived and simulated values
aliases: provenance, observed, modelled, modeled, reanalysis, forecast, derived, simulated, estimate
tags: term, confidence, provenance

Astrovivu labels every number with how it was produced. Observed: a satellite retrieval (MODIS NDVI, IMERG rain). Modelled: a reanalysis or model output (ERA5, NASA POWER, SMAP Level-4 root zone, SoilGrids). Forecast: a prediction of the future (Open-Meteo 16-day forecast). Derived: computed by Astrovivu from other values (water balance, anomalies). Simulated: demo values invented for the story, always labelled as such. Ground truth: entered by the farmer, which overrides the rest.

## productivity-score
title: Productivity score and limiting factor
aliases: productivity score, score, productivity, compatibility, condition, limiting factor, why did the score drop, score drop, suitability
tags: term, score

The Center Productivity Hub shows a 0-100 productivity score for the parcel at the cursor date. With a crop chosen it combines compatibility (static crop-site suitability from climate, pH, texture, drainage and other EcoCrop requirements) with condition (the dynamic growing state: water, heat, vigour, evaporative stress, light). Each factor is scored 0-1 against the crop's optimal and tolerated range; missing information is left out, never scored as zero. The limiting factor is the factor holding the score down most at that date. A score drop usually means one factor moved out of its optimal window, for example root-zone moisture falling below normal in the dry season; the factor list for that date shows which one.

## ground-truth-override
title: Ground-Truth Override
aliases: ground truth override, override, my measurement, soil test, enter my ph, irrigation setting, calibration
tags: term, ground-truth

The Ground-Truth Override lets the farmer enter what they know better than any satellite: soil pH, EC, texture, drainage, depth, irrigation, water source, crop and variety, sowing date, measured soil moisture or rain, last yield, price and cost. Each entry replaces its satellite or model counterpart in every calculation, and a calibration note records both values and the effect. Measured soil moisture or rain also produces a bias factor that is applied to the satellite series. Full irrigation removes rainfall as a limiting factor.

## crop-rotation-basics
title: Crop rotation principles
aliases: rotation, crop rotation, what to plant next, rotation partner, follow crop, break crop, sequence
tags: rotation

Rotating crops breaks pest and disease cycles, balances nutrient use and improves soil structure. Common rules: do not follow a crop with another of the same family or pest group (for example tomato after potato or eggplant); follow a heavy nitrogen user (maize, rice) with a legume (soybean, groundnut, mung bean, cowpea) that fixes nitrogen with root bacteria; alternate deep and shallow rooting crops; and keep the soil covered between cash crops with a cover crop. Rotation choices must also fit water availability and the market. Astrovivu's advisory compares at least three rotation strategies, including the current one, with their evidence, benefits, missing information and risks.

## cover-crop-basics
title: Cover crops and green manure
aliases: cover crop, green manure, living mulch, soil cover, cover cropping, catch crop
tags: rotation, cover-crop

A cover crop is grown to protect and improve the soil rather than for sale. Legume covers (hairy vetch, clovers, sunn hemp, velvet bean, lablab, stylo) add nitrogen; grasses and cereals (cereal rye, oats, sorghum) produce a lot of residue and scavenge leftover nitrogen; brassicas such as tillage radish break up compacted layers. Cover crops reduce erosion and weeds and add organic matter, but they use water, so in a dry season they can compete with the next crop. In perennial plantings such as coffee, low legume covers or living mulches between rows play the same role.

## nasa-sources-summary
title: Which NASA and partner sources Astrovivu uses
aliases: data sources, which satellites, sources, nasa data, datasets, smap, modis, viirs, ecostress, gibs
tags: term, satellite, sources

Astrovivu fuses eight telemetry branches on one parcel: soil moisture from SMAP Level-4 (9 km, daily, 2-3 days latency; fallback NASA POWER modelled soil wetness); vegetation from MODIS MOD13Q1 NDVI/EVI (250 m, 16-day; fallback VIIRS VNP13A1); surface heat from MODIS MOD11A2 land surface temperature (1 km, 8-day) and evaporative stress; rainfall from GPM IMERG (about 10 km, daily; fallbacks CHIRPS and ERA5); agro-weather from NASA POWER (about 50 km); terrain from SRTM (30 m); soil from SoilGrids (250 m; SSURGO in the US); and weather risk from a 16-day Open-Meteo forecast. Map overlays come from NASA GIBS. When a primary source fails the app uses the next one and says so.
