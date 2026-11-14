# Demo script

Run on the dev server (`npm run dev`, http://localhost:5173) or a production build (`npm run build && npm run preview`). The four demo fields load their telemetry from `public/data/samples/<id>.json` and their within-field pictures from `public/data/samples/<id>.rasters.json`; satellite base imagery and NASA GIBS overlays still come from the network.

Motion is on by default, even on a machine with "reduce motion" switched on (`docs/GLOBE.md` §3). If the globe must stay still, add `?motion=reduced`.

## 30-second pitch

Farmers deciding next season's rotation face shifting heat, rain and water. NASA sees all of it, but on grids of 10 m to 50 km and with delays from hours to months. Astrovivu puts every reading on one field and one timeline, draws it inside the field where imagery allows, tells you how far each number can be trusted at field scale, lets the farmer overrule the satellite with what they measured, and ends in a decision: at least three rotation strategies, the current one included, each with why, evidence, benefits, gaps and risks that need local review. It works anywhere on Earth, in English or Vietnamese, with no account and no key.

## Walk-through (three to four minutes)

| Time | Click / link | Say | Award it serves |
|---|---|---|---|
| 0:00 | Open `/`. Let the globe turn for two seconds, then click to start. | "The whole planet. Any point resolves through live NASA and partner APIs; four fields are cached for this demo." | Art & Technology |
| 0:15 | In the field list, open "Add field": show both "Address and area" and "Select on the map" (Sentinel-2 boundary detection). Then open the map's layer menu and switch on SMAP root-zone moisture, then GPM IMERG rain. | "A farmer types a village and a size, or clicks inside a field on the map to trace its Sentinel-2 outline. These overlays are NASA GIBS, dated to the timeline. SMAP is a 9 km pixel, IMERG 10 km; a field is 150 m across." | Best Use of Data |
| 0:35 | Open the Đắk Lắk demo field (or `/?sample=daklak-coffee`). | "One continuous flight from orbit to a 2.0 ha robusta block on basalt soil." | Art & Technology |
| 0:50 | Status tab: point at the score, the three charts and "what changed". | "One sentence per chart, and dated events: dry spells, heat, a score swing, each saying how far the pixel is from the field." | Galactic Impact |
| 1:05 | Data tab: the eight cards, each showing the field coloured by its metric. Open Vegetation, then Soil moisture. | "Vegetation is Sentinel-2 at 10 m, real cloud-free frames, never filled. Soil moisture is ERA5-Land, modelled: no key-free SMAP point series exists, and the Confidence Badge says low at field scale, and why." | Best Use of Data, Best Mission Concept |
| 1:30 | Drag the timeline through the dry season (January to April). | "The field picture, the overlay, every card and the score move together. The last weeks show as pending where a source has not published yet: latency, shown, not hidden." | Best Use of Data, Art & Technology |
| 1:50 | Field report tab: relative NDVI zones and the frames used. | "Where the field does better or worse than its own average, from a year of real frames. Relative zones, not a yield map." | Best Use of Data |
| 2:05 | Ground truth tab: change irrigation from supplemental to rainfed, then back. Point at the ledger. | "The demo starts from an assumed farm profile. The farmer's input wins, and the ledger shows what each correction did to the score." | Best Mission Concept |
| 2:25 | Rail: Rotation (`/?sample=daklak-coffee&phase=advisory`, then `/?sample=cantho-rice&phase=advisory`). Change the first priority from profit to water; on the Mekong paddy, click the third rice block on the calendar and swap it to mung bean. | "Current practice pinned first against soil-health, water-saver, income and resilience cards, laid over the field's 20-year ERA5 rain and temperature. Swap any season on the calendar to test your own crop and re-score live: trade-offs, clickable evidence, information gaps and risks needing local review all update." | Galactic Impact, Best Mission Concept |
| 2:55 | Ask: "Is my soil too acid for soybean?" Then switch to Vietnamese (or `&lang=vi`) and ask "Đất của tôi có quá chua cho đậu nành không?" | "Answers come from the field's own data and FAO EcoCrop, with citations, in the browser, without a key. Same tool, in the farmer's language." | Galactic Impact |
| 3:15 | `/?sample=iowa-corn-soy`, then `/?sample=nevada-alfalfa`. | "Iowa: SSURGO soils and eight years of the Cropland Data Layer give the real corn-soy rotation. Nevada: every millimetre is pumped. At SSURGO pH 8.8 no annual break crop reaches 20/100 without a soil test, so the renewal strategies propose 4- and 3-year stands with fallow rest years and send pH to a local lab test." | Best Use of Data, Best Mission Concept |
| 3:35 | `/?sample=daklak-coffee&phase=tracking`, then `/?phase=urban`. | "Notes keeps past seasons and alerts; on demo fields that history is simulated and says so. Urban Grower brings the same climate and PAR data to a balcony, with illustrated light/space tiles, FAO EcoCrop plant photos and month-by-month sowing strips." | Galactic Impact |
| 3:50 | Close on the field. | "It supports the farmer's judgement. It does not replace it." | |

Narrow screens: below 1100 px the map is on top, the panel scrolls under it and the tabs move to a bottom bar; the same steps apply.

## Fallback if the network is slow

- Demo-field telemetry and within-field rasters are cached; the field panel, timeline, score, advisory and assistant work without live calls.
- Base imagery: if Esri fails six times in a row the map switches to Sentinel-2 cloudless. GIBS overlay tiles fill one by one (about 300 ms each); leave the overlay off on a very slow network.
- Open demo fields by deep link to skip the descent's tile load.
- The extractive assistant needs no server. Do not demo generative mode: it has not been exercised against a live model.
- As a last resort, `VITE_DATA_MODE=mock` gives labelled simulated telemetry.
