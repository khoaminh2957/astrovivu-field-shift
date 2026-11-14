# Demo script

Run on the dev server (`npm run dev`, http://localhost:5173) or a production build (`npm run build && npm run preview`). The four demo fields load from `public/data/samples/` and need no live API calls for their telemetry; satellite base imagery and NASA GIBS overlays still come from the network.

If the machine has "reduce motion" switched on, the globe does not turn and flights become cuts. Add `?motion=full` to any link below to see the rotation and the fly-in (`docs/GLOBE.md` §3).

## 30-second pitch

Farmers deciding next season's rotation face shifting heat, rain and water. NASA sees all of it, but on grids of 30 m to 50 km and with delays from hours to months. Astrovivu puts every reading on one field and one timeline, tells you how far each number can be trusted at field scale, lets the farmer overrule the satellite with what they measured, and ends in a decision: at least three rotation strategies, the current one included, with why, evidence, benefits, gaps and risks that need local review. It works anywhere on Earth, in English or Vietnamese, with no account and no key.

## Walk-through (three to four minutes)

| Time | Click / link | Say | Award it serves |
|---|---|---|---|
| 0:00 | Open `/?motion=full`. Let the hero globe turn for two seconds, then click. | "This is the whole planet. Any point resolves through live NASA and partner APIs; four fields are cached for this demo." | Art & Technology |
| 0:15 | In explore, switch the NASA layer to SMAP root-zone moisture, then GPM IMERG rain. | "These are NASA GIBS layers, dated to the timeline. SMAP is a 9 km pixel, IMERG 10 km: a field is 150 m across." | Best Use of Data |
| 0:30 | Click the Đắk Lắk beacon, or open `/?sample=daklak-coffee&motion=full`. | "One continuous flight from orbit to a 2.5 ha robusta block on basalt soil." | Art & Technology |
| 0:45 | Point at the Radial HUD: eight branches around the productivity hub. Hover the soil-moisture Confidence Badge. | "Every number carries its source, pixel size and age. Soil moisture here is ERA5-Land, modelled, because no key-free SMAP point series exists; the badge says low at field scale, and explains why." | Best Use of Data, Best Mission Concept |
| 1:05 | Drag the timeline scrubber through the dry season (January to April). | "The parcel colour, the map overlay, all eight branches and the score move together. The last weeks show as pending where a source has not published yet: that is latency, shown, not hidden." | Best Use of Data, Art & Technology |
| 1:30 | Open Ground-Truth Override. Set irrigation to full. | "Water was the limiting factor: compatibility is about 72 rainfed. With irrigation it rises above 95. The farmer's input wins and the difference is recorded." | Best Mission Concept |
| 1:50 | Open the advisory (or `/?sample=daklak-coffee&phase=advisory&crop=glycine-max`). Change the priority sliders. | "The current rotation against alternatives, re-ranked by the farmer's priorities: margin, water, soil health, risk. Each strategy says why, what evidence, what is missing and what a local expert must check." | Galactic Impact, Best Mission Concept |
| 2:20 | Ask panel: "Is my soil too acid for soybean?" | "Answers are grounded in the field's own data and FAO EcoCrop, with citations. Without a key it runs entirely in the browser." | Best Use of Data |
| 2:40 | Switch language to Vietnamese (or add `&lang=vi`). Ask "Đất của tôi có quá chua cho đậu nành không?" | "Same tool, in the farmer's language." | Galactic Impact |
| 2:55 | Open `/?sample=iowa-corn-soy&motion=full`. | "Inside the United States, SSURGO soils and the Cropland Data Layer switch on automatically: eight years of the real corn-soy rotation." | Best Use of Data |
| 3:10 | Open `/?sample=nevada-alfalfa&motion=full`, then `/?sample=cantho-rice&motion=full`. | "Nevada: every millimetre is pumped groundwater. Cần Thơ: should the third rice crop become a legume season? Same method, different limits." | Galactic Impact |
| 3:30 | `/?sample=daklak-coffee&phase=tracking`, then `/?phase=urban`. | "Tracking keeps the season journal and year-over-year history; on demo fields that history is simulated and says so. The Urban Grower Companion brings the same data to a balcony." | Best Mission Concept |
| 3:45 | Close on the HUD. | "It supports the farmer's judgement. It does not replace it." | |

**Check before presenting.** At the time of writing the advisory, tracking and urban engines (`src/core/advisory`, `src/core/tracking`, `src/core/urban`) were placeholders that return empty results. If they have not landed, skip the 1:50 and 3:30 steps or present them on the dev server with `&fixture=1`, saying clearly that the content is a layout fixture (the screen labels it).

## Fallback if the network is slow

- Demo-field telemetry is cached in `public/data/samples/*.json`; the HUD, timeline, score and assistant work without live calls.
- Base imagery: if Esri fails six times in a row, the globe switches to Sentinel-2 cloudless. GIBS overlay tiles fill tile by tile (about 300 ms each); leave the overlay off if the network is very slow.
- Open the demo fields by deep link rather than flying from explore, to skip the tile load of the descent.
- The extractive assistant needs no server. Do not demo generative mode: it has not been exercised against a live model.
- As a last resort, `VITE_DATA_MODE=mock` gives labelled simulated telemetry.
