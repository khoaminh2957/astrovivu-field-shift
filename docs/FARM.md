# The living farm

The page behind the "Farm" entry of the left rail (it was "Rotation") opens with the field drawn as a small farm for the date shown. Three characters report on it and the grower can run trials; the comparison of rotation strategies follows on the same page. The field panel keeps its four tabs. Issue B21 (#101). Code: `src/core/farm/` (what to draw and say; pure, tested) and `src/ui/farm/` (the drawing).

The scene is an illustration of readings the app already has. It adds no data and no model. Where a reading is missing the scene is drawn in a neutral way and the character says there is no reading.

## 1. What each part is drawn from

`farmSceneAt(input, score, day, weatherDay?)` in `src/core/farm/index.ts` returns the state; `FarmSceneView` in `src/ui/farm/FarmScene.tsx` draws it.

| Part of the scene | Read from | When missing |
|---|---|---|
| Temperature, rain of the day | `t2m_max`, `t2m_min` (agromet branch); `rain` of that day, else `rain_era5` when the first has no value for the day | `--`, sky drawn as "no weather reading" |
| Rain of the last seven days | the same two series, summed | left out |
| Sky: clear, overcast, rain, heavy rain, hot, frost | the day's figures against the thresholds below | grey sky without sun or rain |
| A forecast day | `fc_tmax`, `fc_tmin`, `fc_rain` (risk branch), days after `window.today` | the day is left out of the strip |
| Plants: kind | `CropProfile.id`, `category`, `lifeSpan` (`cropLook`) | bare soil, "no crop is chosen" |
| Plants: height, ripeness | `ScoreSnapshot.stage` of the day (`id`, `progress`) | bare soil |
| Plants: colour | the latest `ndvi` that is not stale for its cadence | a neutral grey-green |
| Cut rows and the harvester | the days since the crop entered its `harvest` stage, over the 14 days that stage lasts in the scorer | no harvester |
| The seeder | stage `pre-sowing`, or the first 6 % of the cycle | no seeder |
| Soil colour, cracks, puddles, canal width | `sm_root` of the day against the 10th to 90th percentile of its baseline for the time of year; without a baseline, against the 20th to 80th percentile of the year shown | neutral soil colour |
| Paddy water | rice in the first part of its cycle; thinner when the root zone reads dry | none |
| Score | `ScoreSnapshot.productivity` of the day | not shown |

Thresholds of the sky are those of the risk events (`src/data/harmonize/risk.ts`): heavy rain from 30 mm in the day, a wet day from 1 mm, hot from a maximum of 35 °C, frost from a minimum of 2 °C or lower. Rain is drawn before heat or cloud.

**Overcast is a drawing rule, not a cloud reading.** No series of the app measures cloud. A day is drawn overcast when its solar radiation (`par`) is below 65 % of the 90th percentile of the 31 days around it. The character never says "cloud cover"; it says "an overcast day".

Plant height and ripeness are drawing rules on top of the scorer's stage: full height from mid-season, ripening over the last quarter of the cycle, a perennial always standing. They carry no number to the reader.

## 2. The three characters

| Character | Stands | Reports | Proposes |
|---|---|---|---|
| Space | in the sky | the weather of the day, the last seven days, the next warning of the forecast | nothing (the forecast strip is below) |
| Soil | at the front edge of the field | root-zone moisture against its usual range; soil pH against what the crop takes, and whether the pH is the grower's or the soil map's | pH, irrigation, drainage |
| Rice | among the rows | the stage of the crop, days to harvest, NDVI with the date of the image | another sowing date, another crop |

`farmLines` builds one sentence per character in English and Vietnamese, with the ids of the sources of its figures; the tab prints the source names under the sentence. The characters take turns every 8 seconds until the reader picks one (no turns under `prefers-reduced-motion`).

The figures in `src/ui/farm/Mascots.tsx` are stand-ins. The real characters belong to the mascot owner (`src/ui/mascot`, issues U2 and U3): replacing the body of `MascotFigure` (`who`, `mood`, `talking`) is the whole change.

## 3. Trials

A trial is the same year of telemetry with one thing changed: `runTrial` copies the model input, applies the change and computes a new score timeline. The scene, the characters and the score then show the trial, under a "Trial" label, with the score of the year as it is and in the trial on one chart.

- The proposals are the model's own: `whatIf(input)` (irrigation, pH, drainage, sowing date, the best other crop), kept when they raise the season outcome, plus up to two more crops from `rankCrops`, scored the same way. `WhatIfResult.apply` (added for this) says what a move changes.
- **A trial is not advice about what will happen.** It says "the same year of weather, with this one thing changed". A pH trial shows the year as if the soil already had that pH; lime acts over months and its dose needs a soil test, and the trial says so. Markets and seed are not in a crop trial.
- **Nothing the grower entered is changed.** The trial works on a copy; `groundTruth` in the store stays as it is (tested). Only "Choose this crop for the field" changes the field, through the same `setCrop` as elsewhere.

## 3.1 Where it sits, and the date

`FarmView` (`src/ui/farm/FarmView.tsx`) is the first element of the rotation page (`src/ui/advisory/index.tsx`). On a wide page the scene stands on the left and the speaking character beside it; the day's figures and the forecast follow in two columns. The date slider moves the same cursor as the strip under the map; that strip is not on this page, so the farm mounts `usePlayback` itself.

What stands behind the field (`Backdrop.tsx`: the range, the hills, trees, the farmstead, the wind pump, the fence) is decoration. Only the sky follows the day, and the wheel of the wind pump turns faster from a wind of 6 m/s.

## 4. Weather now and ahead

`forecastDays` returns today (from the record) and each forecast day that has figures. Picking a forecast day draws that day's sky over today's field and marks the figures "Forecast". Warnings are the `RiskEvent`s of the risk branch that have not ended.

## 5. Limits

- One field per scene; the storehouse, trees and canal are decoration and stand for nothing.
- The harvester and the seeder follow the scorer's calendar, not an observation of machines.
- The soil picture uses the root-zone moisture of a ~9 km reanalysis cell (ERA5-Land): it says how the season compares with other years, not where water stands in the field.
- A trial of a soil amendment cannot show the months the amendment needs; the model has no such dynamics.
- The reference for the look of the feature was a farm weather demo seen on video (15 November 2026). Only the genre was taken: the drawing, palette and text are this project's own.

## 6. Tests

`npx vitest run src/core/farm`: the sky against each threshold; a day without readings; the record against the forecast; all six kinds of sky occur on the demo fields; plant kinds; a year of the maize field (stages, full height at mid-season, the harvester only in the harvest stage, days to harvest counting down); a perennial; no crop; the characters' sentences with their sources; a field without data; the next warning; proposals sorted by gain; a trial leaves the grower's entries alone.
