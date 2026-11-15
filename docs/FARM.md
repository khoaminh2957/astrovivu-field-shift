# The living farm

The "Farm" tab of the rotation page is a stage: the field drawn as a farm that fills the screen, three characters who each report their part, a time bar that steps through the year by month or by quarter, and the rotation being shown. The last tab of the page, "Dossier", lays out on one sheet how the answer for the field was reached. Code: `src/core/farm/` (what to draw and say; pure, tested) and `src/ui/farm/` (the drawing), the characters in `src/ui/mascot/`.

The scene is an illustration of readings the app already has. It adds no data and no model. Where a reading is missing the scene is drawn in a neutral way and the character says there is no reading.

## 1. What each part is drawn from

`farmSceneAt(input, score, day)` in `src/core/farm/index.ts` returns the state of a day; `FarmSceneView` in `src/ui/farm/FarmScene.tsx` draws it.

| Part of the scene | Read from | When missing |
|---|---|---|
| Temperature, rain | `t2m_max`, `t2m_min` (agromet branch); `rain`, else `rain_era5` | `--`, sky drawn as "no weather reading" |
| Sky: clear, overcast, rain, heavy rain, hot, frost | the day's figures against the thresholds below | grey sky without sun or rain |
| Plants: kind | `cropLook(CropProfile)`: thirteen silhouettes, section 5 | bare soil |
| Plants: height, ripeness | `ScoreSnapshot.stage` of the day (`id`, `progress`) | bare soil |
| Plants: colour | the latest `ndvi` that is not stale for its cadence | a neutral grey-green |
| Cut rows and the harvester | days since the crop entered its `harvest` stage, over the 14 days that stage lasts in the scorer | no harvester |
| The seeder | stage `pre-sowing`, or the first 6 % of the cycle | no seeder |
| Soil colour, cracks, puddles, canal width | `sm_root` against the 10th to 90th percentile of its baseline for the time of year; without a baseline, the 20th to 80th percentile of the year shown | neutral soil colour |
| Paddy water | rice in the first part of its cycle; thinner when the root zone reads dry | none |
| Score | `ScoreSnapshot.productivity` | not shown |

Thresholds of the sky are those of the risk events (`src/data/harmonize/risk.ts`): heavy rain from 30 mm in the day, a wet day from 1 mm, hot from a maximum of 35 °C, frost from a minimum of 2 °C or lower. Rain is drawn before heat or cloud.

**Overcast is a drawing rule, not a cloud reading.** A day is drawn overcast when its solar radiation (`par`) is below 65 % of the 90th percentile of the 31 days around it.

The land around the field (the ranges, the hills, the farmstead, the trees, the wind pump) is decoration and stands for nothing. Only the sky follows the readings, and the wheel of the wind pump turns faster from a wind of 6 m/s.

## 2. Time: today, then months or quarters

The stage opens on **today**. Play rewinds a year and steps forward; a step can also be pressed directly.

- `farmPeriods(window, step)` gives the twelve calendar months ending with today's (clipped to the telemetry window, the last one partial), or the same months three at a time, the last quarter ending today.
- `periodWeather` sums a period from its days: total rain, wet days, days of heavy rain, hot days, frost nights, mean daily high and low. Nothing is added to the record.
- `farmSceneOfPeriod` draws the field of the **last day** of the period (crop stage, soil) under the sky of the **whole** period.
- **The sky of a period is a drawing rule** (`periodSky`), on the share of the days read: heavy rain when at least two days and 7 % of the days had it; rain from 40 % wet days; frost from 15 %; hot from 30 %; overcast from 50 %; clear otherwise. Rain first, as for a day.

Playback holds 2.4 s on a month and 3.4 s on a quarter. Plants rise into each new stage (a CSS animation keyed on the step); under `prefers-reduced-motion` the steps still change, without motion.

## 3. The rotation on the stage

The picker at the top is one line (name, plants, score) that opens into the strategy cards of the page. Until the grower picks one, the stage shows the current practice: the field as it is.

A strategy other than the current practice is played with its own crops: `seasonRuns(input, strategy)` scores the year once per season of the strategy's first year, with that season's crop sown in its start month; `runOn(runs, day)` gives the season standing in the month shown; a month the strategy leaves empty is bare ground. **This is a simulation and is labelled "Simulation"**: the weather is the record of the year, the crop is the strategy's. The soil plan of the report (worked out for the field's own crop) is not quoted over a simulated crop. Crops grown between the rows or beside another (`slotRole` `inter-row`, `companion`) are not drawn. Nothing the grower entered is changed (tested).

## 4. The three characters

The figures are the mascot owner's 3D models (Rice, Seed, Satellite; `docs/MASCOT.md`). Each carries a three-dot bubble; the bubble is amber with a mark when the character has something to look at. Nobody speaks until pressed.

| Character | Stands | Note (`farmNotes`) | Proposes |
|---|---|---|---|
| Satellite | in the sky | the weather of the day or of the period; the next warning | nothing |
| Seed | at the left edge of the field | the ground drier, wetter or as usual; soil acidity against the crop; the first remedy of the soil plan, when it has one | pH, irrigation, drainage |
| Rice | at the right edge | the crop greener or less green than other years; stage; days to harvest | another sowing date, another crop |

A note is one verdict and at most two points, in a grower's words: no "NDVI", no "m³/m³" (tested). The "Look deeper" line under it (the "!") opens the detail sheet (`DeepSheet.tsx`), where the measurements behind the verdict are laid out with their sources: the year month by month, the reading against its usual range, the factors of the score, the forecast, the soil plan.

"The ground is dry: watch for wilting" is said when the root zone reads drier than usual under a standing crop. It is a thing to go and look at; no reading of the app measures wilting.

### Trials

A trial is the same year of telemetry with one thing changed (`runTrial`). The proposals are the model's own `whatIf` moves that raise the season outcome, plus up to two more crops from `rankCrops`. **A trial is not advice about what will happen**; its caveat is printed with it. Nothing the grower entered is changed; only "Choose this crop" changes the field, through `setCrop`. Trials are offered on the field as it is, not over a simulated rotation.

## 5. The plants

`cropLook` picks one of thirteen silhouettes from the genus, the category and the life span; `src/ui/farm/plants.tsx` draws each from the growth and the ripeness, so a seedling, a young plant, a full one and a ripe one are different drawings.

| Look | Crops | Drawn as |
|---|---|---|
| `paddy` | rice | a fan of blades; ripe heads bow |
| `cereal` | wheat, barley, millet | a fan of blades; ears stand |
| `tall-cereal` | maize, sorghum, sugarcane | a stalk, arching leaves, tassel, cob |
| `legume` | pulses | three-part leaves, pods that dry to tan |
| `oilseed` | annual oilseeds | paired leaves, a yellow head that sets seed |
| `root` | root and tuber crops | a tuft over the shoulder of the root |
| `leafy` | vegetables, herbs | a rosette closing into a head |
| `vine` | pepper, grape, passion fruit, hop, vanilla, kiwi | a stake and a climbing vine, clusters |
| `bush` | coffee, tea, berries | a rounded shrub, red cherries |
| `tree` | perennial fruit, industrial, spice, oilseed | a trunk and a layered crown, fruit |
| `palm` | coconut, oil palm, banana, areca, date, pineapple, papaya | a leaning trunk and fronds |
| `grass` | forage, cover crops | a low tuft |
| `row` | anything else | a small bush with fruit |

## 6. The dossier

`Dossier.tsx` is the last tab. It computes nothing new; it orders what the page already knows as six steps: the sources read (per branch, with provenance), the year in months, the score and its factors, the ranking of other crops, the comparison of the rotations (score and four criteria, the bar under each figure longer when better for the grower), then the soil and the first actions. It prints alone ("Print or save as PDF").

## 7. Limits

- One field per scene. A multi-year rotation is shown for its first year only.
- A period shows the crop of its last day: a crop sown and cut inside one quarter is seen only in the monthly steps.
- The harvester and the seeder follow the scorer's calendar, not an observation of machines.
- The soil picture uses the root-zone moisture of a ~9 km reanalysis cell (ERA5-Land): it says how the season compares with other years, not where water stands in the field.
- A trial of a soil amendment cannot show the months the amendment needs.
- The characters need WebGL; without it, or if a model fails to load, a flat stand-in figure is drawn and everything else works.

## 8. Tests

`npx vitest run src/core/farm`: the sky against each threshold; the record against the forecast; plant kinds; a year of the maize field; trials leave the grower's entries alone (`farm.test.ts`); the twelve months and four quarters, a period summed from its days, the sky rule of a period, the field of the last day under the sky of the period, a rotation's crop in its months, bare ground, the notes in two languages without jargon, no reading instead of a guess (`stage.test.ts`).
