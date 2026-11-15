# Demo script

Run on the dev server (`npm run dev`, http://localhost:5173) or a production build (`npm run build && npm run preview`). The four demo fields load their telemetry from `public/data/samples/<id>.json` and their within-field pictures from `public/data/samples/<id>.rasters.json`; satellite base imagery and NASA GIBS overlays still come from the network.

Motion is on by default, even on a machine with "reduce motion" switched on (`docs/GLOBE.md` §3). If the globe must stay still, add `?motion=reduced`.

## 30-second pitch

Farmers deciding next season's rotation face shifting heat, rain and water. NASA sees all of it, but on grids of 10 m to 50 km and with delays from hours to months. Astrovivu puts every reading on one field and one timeline, draws it inside the field where imagery allows, tells you how far each number can be trusted at field scale, lets the farmer overrule the satellite with what they measured, and ends in a decision: at least three rotation strategies, the current one included, each with why, evidence, benefits, gaps and risks that need local review. It works anywhere on Earth, in English or Vietnamese, with no account and no key.

## Walk-through (about three minutes)

The rail is the path: **(1) Field**, the field as it is; **(2) Rotation**, with three tabs (Farm, Compare, Plan); **(3) Dossier**. Urban and Ask stand apart under a rule. Every step has its own address (`?sample=<id>&phase=locked|advisory&view=farm|compare|plan|dossier`), so a step can be opened directly and the browser's Back button walks back through them.

| Time | Click / link | Say | Award it serves |
|---|---|---|---|
| 0:00 | Open `/`. Let the globe turn for two seconds, then open the Mekong demo field (`/?sample=cantho-rice&lang=vi`). | "The whole planet, any point through live NASA and partner APIs. One continuous flight from orbit to a 1.4 ha paddy." | Art & Technology |
| 0:20 | (1) Field, Overview: the outlook, the three numbers, the weather today and the forecast warnings, then drag the timeline under the map through the dry season. | "One sentence, three numbers, today's weather and what the forecast warns of. The field picture, the overlay and the score move with the timeline; weeks a source has not published yet show as pending." | Best Use of Data |
| 0:50 | (1) Field, Data: open Vegetation, then Soil moisture. | "Vegetation is Sentinel-2 at 10 m, real cloud-free frames. Soil moisture is ERA5-Land, modelled: the Confidence Badge says low at field scale, and why." | Best Use of Data, Best Mission Concept |
| 1:10 | (1) Field, Soil and practice: change the pH or the irrigation, point at the ledger. | "The farmer's own value wins over the satellite, and the ledger shows what each correction did." | Best Mission Concept |
| 1:25 | Press "(2) Compare rotations" at the foot of the panel. The Farm tab: press a character's bubble, then play the year by month. | "The field as a farm, today by default. Satellite, Seed and Rice each sum up the weather, the soil and the crop in a sentence; the ! opens the readings behind it. Play rewinds a year and steps forward by month." | Galactic Impact, Art & Technology |
| 1:55 | Open the rotation picker on the stage and pick the income rotation. | "Its crops grow through the same year of weather, labelled Simulation." | Best Mission Concept |
| 2:05 | Compare tab: the current practice against four strategies; change the first priority to water; swap a season on the calendar; open an evidence chip, then close it. | "Current practice first. Why, evidence, benefits, information gaps and risks for local review, for the strategy chosen. Swap a season to test your own crop. Evidence opens the reading it rests on, without leaving the page." | Galactic Impact, Best Mission Concept |
| 2:35 | Ask, in Vietnamese: "Đất của tôi có quá chua cho đậu nành không?" | "Answers from the field's own data and FAO EcoCrop, with citations, in the farmer's language." | Galactic Impact |
| 2:50 | (3) Dossier. | "How the answer was reached, in six steps, on one sheet that prints." | Best Mission Concept |
| 3:00 | Close: "It supports the farmer's judgement. It does not replace it." | | |

If there is time: `/?sample=iowa-corn-soy` (SSURGO and the Cropland Data Layer give the real corn-soy rotation) and `/?phase=urban` (the same climate and light data on a balcony).

Narrow screens: below 1100 px the map is on top, the panel scrolls under it and the rail becomes a bottom bar with the same steps.

## Fallback if the network is slow

- Demo-field telemetry and within-field rasters are cached; the field panel, timeline, score, advisory and assistant work without live calls.
- Base imagery: if Esri fails six times in a row the map switches to Sentinel-2 cloudless. GIBS overlay tiles fill one by one (about 300 ms each); leave the overlay off on a very slow network.
- Open demo fields by deep link to skip the descent's tile load.
- The extractive assistant needs no server. Do not demo generative mode: it has not been exercised against a live model.
- As a last resort, `VITE_DATA_MODE=mock` gives labelled simulated telemetry.
