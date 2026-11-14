# Globe (Tier 4, map side)

`src/globe` is the map canvas: hero globe, explore, parcel drawing, lock fly-in, time-synced parcel colour and NASA overlays. Buttons, panels and the HUD belong to the UI; they talk to the map through the mission store only.

## 1. Architecture decision

**One renderer: MapLibre GL JS 6.18 with the `globe` projection, `raster-dem` terrain and two small custom WebGL layers.** The architect's leaning is confirmed.

| Family | Why not |
|---|---|
| CesiumJS | Best built-in atmosphere and time-dynamic imagery, but key-free terrain needs a third-party Terrarium mesh provider, the bundle is three times larger, and polygon editing has to be written by hand. |
| 3DTilesRendererJS + three.js / R3F + takram atmosphere | The showcase path uses Google Photorealistic Tiles or Cesium ion terrain: both need a key. Without them there is no field-scale terrain. |
| iTowns, openglobus | Capable globes with thin documentation and no native Terrarium terrain; too much risk for the gain. |
| globe.gl / plain three.js | Good hero, no field-scale imagery or terrain. It would need a second renderer and a hand-off; a seam between two cameras is what the brief forbids. |
| deck.gl interleaved, PMTiles | Not needed: four beacons, one polygon, raster base maps. |

What MapLibre gives for free: the `globe` projection turns into mercator between zoom 11 and 12 inside one camera, so the flight from orbit to a two-hectare field is one `flyTo`; AWS Terrarium tiles are a native terrain source; GIBS WMTS is a plain raster source.

Checked against the installed 6.18 typings and source, not older examples:

- ESM only, no default export, worker in a separate file. Under a bundler the worker URL must be set: `setWorkerUrl(workerUrl)` with Vite's `?url` import (`engine.ts`).
- `Map` composes a `Camera`; `map.transform` is gone. Only public API is used.
- The sky is drawn in globe view since 6.10 and fades with altitude; the scattering atmosphere fades out below about 1,000 km.
- Layers draped on terrain are cached in textures. Any `setPaintProperty` releases the whole cache and a running paint transition does not refresh it. Two consequences below (parcel as SVG, frame-driven fades).

**Where MapLibre's sky was not enough.** Its atmosphere either veils the whole disc in white (sun behind the camera) or cuts it with a hard terminator (sun to the side), over imagery that is evenly lit. It is kept at a blend of 0.24 for the thin blue line; `halo.ts` adds the glow outside the limb, the haze inside it and the shading that makes the disc read as a sphere (one full-screen triangle, a ray per pixel against the unit sphere, using the globe matrix MapLibre hands to custom layers). `stars.ts` draws 2,600 points on a celestial sphere that turns with the camera. Both fade out by zoom 6.4.

## 2. Layer stack

Bottom to top. Ids are in `style.ts`.

| Layer | Source | Notes |
|---|---|---|
| `stars` | custom WebGL | Canvas is transparent outside the planet; CSS gradient behind it. |
| `ocean` | background | Dark space/ocean from orbit, fading to light grey once zoomed in so missing imagery never leaves dark navy holes under the light shell. |
| `blue-marble` | GIBS `BlueMarble_ShadedRelief_Bathymetry`, level 8 | The view from orbit. Subdued in the hero (backdrop for the title), full contrast from explore on. Greyed and darkened when satellite is switched off. |
| `sat-fallback` | EOX Sentinel-2 cloudless, level 14 | Added only if Esri fails six times in a row. |
| `sat` | Esri World Imagery, level 19 | Not requested below zoom 4; fades in between zoom 4.2 and 6.2. |
| `relief` | hillshade, second DEM source | Only with satellite off. |
| `overlay-a`, `overlay-b` | GIBS, date in the URL | Front and back buffer of the NASA overlay. |
| `parcel-dim` | GeoJSON, world polygon with the parcel cut out | Faint dimming of the surroundings from zoom 9.5 (14 % at zoom 13). |
| `halo` | custom WebGL | Atmosphere from orbit. |
| labels | OpenFreeMap vector tiles, Esri reference raster as fallback | Loaded on first use, in the interface language. |
| Field raster | DOM canvas, `fieldRaster.ts` | Within-field picture of the selected metric, clipped to the parcel, fitted by a least-squares `matrix3d` homography to the projected parcel outline so corner terrain cannot shift it. |
| SVG overlay | DOM, inside the canvas container | Locked parcel (single-colour fill when there is no raster, honesty texture, faint casing, thin light outline), reticle during the descent, draft outline, measure tool. |
| Markers | DOM | Demo-field beacons (buttons), draft handles. |

Terrain: AWS Terrarium, level 12, exaggeration 1.25, switched on at zoom 9.5 and off below 8.6. From orbit relief is sub-pixel and would cost the terrain texture cache.

**Why the parcel is SVG.** A fill draped on terrain lives in the texture cache; recolouring it would redraw the cache for the whole view on every timeline step. The outline, fill and anchor are instead computed from one projected ring inside MapLibre's `render` event (`map.project` follows the terrain; edges are split every 30 m so the outline hugs relief). Recolouring is one style write. Fill textures follow the design system: dotted for simulated data, hatched when the reading is missing or held past its hold window.

**Network (`net.ts`).** Every tile goes through one `astro://` protocol: four requests per host, 15 s timeout, two retries on network or 5xx errors, failure streaks per host. It rejects Esri's 2,521-byte "Map data not yet available" placeholder (returned with HTTP 200 wherever a zoom has no imagery), so MapLibre keeps the level below instead of painting the label.

## 3. Behaviour

| State | What happens |
|---|---|
| Hero | Globe radius about a third of the viewport height, turning 2.8°/s by elapsed time. Rotation pauses on pointer, wheel or key and resumes 3.5 s later; rAF stops with a hidden tab. |
| Explore | Camera steps in, bottom padding lifts the centre for the dock, Blue Marble comes up to full contrast, beacons appear (hidden while drawing). |
| Draw | `quad`: four taps, ordered into a simple ring. A tap from above zoom 12.5 flies to field scale instead of placing a corner. `coords` / `gps`: the UI writes a square draft (`squareDraft`), the map frames it. All modes: drag corners, drag a midpoint to add a corner, double-click or Delete removes one, centre handle moves the shape, arrow keys nudge. Every change goes back through `makeDraft`; `areaHa` is `null` while the ring is open or crosses itself, and that is the "can lock" test (`isLockable`). |
| Locked | One `flyTo`. A camera-update hook holds pitch and bearing back until the second half of a descent. Padding comes from `--topbar-h`, `--timeline-h`, `--hud-gutter`, `--hud-callout-w`, so the parcel lands in the free area, a little above centre; the long axis is laid across the screen; pitch 54°. |
| Time | Fill = design-system ramp (`RAMPS`) of the series at the cursor via `sampleAt`. `focusBranch` wins over `layers.parcelMetric` when its headline series has a ramp. Overlay date = newest date at or before the cursor from GIBS DescribeDomains (fallback: cadence and usual delay); hidden when older than 10 / 24 / 48 days (daily / 8-day / 16-day). A new date loads in the hidden buffer, then cross-fades (320 ms, opacity written per frame). |

`anchor` is `{x, y}` = **centre** of the parcel's screen bounding box, `{w, h}` its size, CSS pixels, published at most once per rendered frame and only when it changes by half a pixel. `visible` is false when the parcel is off screen or behind the planet.

Motion is on by default. The system `prefers-reduced-motion` setting is deliberately not followed: the user reported the cuts it produced as not smooth and asked for smooth globe movement. `?motion=reduced` or `setMotion('reduced')` give the old behaviour (no rotation, flights become cuts under a 120 ms fade, toolbar eases become jumps).

## 3b. Field picture (changed 2026-11-14)

The parcel is drawn the way field-monitoring apps draw a field: the picture of the selected metric inside the polygon over the satellite image, a 1.5 px light outline over a faint 3 px dark casing, no glow, faint dimming outside, no gauge.

- If `rasters` holds a raster whose `key === layers.parcelMetric` (with frames), it is drawn: painted at its own size with `paintRaster` (blending between frames), upscaled with smoothing into a canvas of about 384 px on its long side, clipped there to the parcel ring, at 88 % opacity. The repaint is coalesced to one per displayed frame and skipped when the cursor day has not changed; following the camera is one `transform` write per frame. The raster wins over `focusBranch` (rule as briefed). A raster whose source is `simulated` (or a mock telemetry) gets the dotted texture.
- Otherwise the single-colour fill from the series (`paintForSeries`) as before, at 62 % opacity.
- `useParcelPaint()` gives the legend: source (`raster` / `series`), key, label, unit, `rampCss`, range, date of the frame shown and the frame it is blending toward. It changes only when one of those changes. `rasterRampCss(rampId)` is exported; ramps the design system lacks (terrain, soil, light, risk) have local stops in `fieldRaster.ts`.
- Limit: the picture is fitted by a projective transform to the projected parcel outline (`fieldRaster.ts`), so corner relief outside the parcel cannot offset it, though strong relief curvature inside a steep parcel is still approximated by one projective plane; the outline itself follows terrain every 30 m. The grid is assumed north-up (as the contract says).

## 3c. Map tools, touchpad gestures and insets

`tools.ts` implements the toolbar contract on the active engine: `zoomBy`, `rotateBy`, `resetNorth`, `setTilt` (pitch 54 / 0), `fitParcel` (parcel, else the draft), `locateMe` (browser geolocation, 10 s timeout; flies to zoom 15.5, or 12 when the fix is coarser than 500 m; resolves null on refusal), `setMotion`, `startMeasure` / `stopMeasure` (`measure.ts`: click points; a click on the first point closes an area; haversine metres, `polygonAreaHa` hectares; double-click zoom is off while measuring), `onMapClick` (delivers unhandled map clicks to the UI: clicking a demo field selects it, and "Select on the map" runs `detectFieldBoundary`), `useMapView` (rAF-coalesced, rounded, written only on change) and `useMeasure`.

Touchpad and wheel handling (`engine.ts`):
- Container `resize` re-frames the camera only when the container's CSS width or height actually changes, so `setPixelRatio` no longer triggers a snap-back 160 ms after wheel zoom; pixel-ratio reduction while moving runs only above DPR 1.5, avoiding canvas resize hitches on standard screens.
- Horizontal two-finger touchpad swipe (or `Shift` + wheel) locks axis at gesture start: from orbit it spins the globe left/right, and at field/regional zoom it pans horizontally.
- `Alt` + two-finger swipe (or `Alt` + wheel) and the turn-left / turn-right toolbar buttons beside the compass rotate map bearing on Windows touchpads, which do not report two-finger twist events to the browser.

`insets` from the store are the camera padding (plus 12 px) for the fly-in, `fitParcel`, `refocusParcel`, `flyToPlace` and draft framing; the padding is shrunk so at least 120 px of map stay free each way. With insets the parcel fills 62 % of the free area. A change of insets eases (360 ms): the whole framing when the camera is still near the parcel view, only the padding when the user has wandered off. Without insets the old design-token estimate is used. Hero and explore poses do not use insets yet.

## 4. Exports of `@/globe`

`GlobeCanvas`, `GlobeLab`, `OVERLAYS` (+ `getOverlay`, `overlayLegendCss`), `draftToParcel`, `squareDraft`, `makeDraft`, `isLockable`, `draftAreaHa`, `paintForSeries`, `colorForValue`, `rampCss`, `parcelReadingAt`, `useParcelPaint`, `rasterRampCss`, the tools above, `useGlobeStatus` (imagery in use, real overlay date and state, terrain, flying, reduced motion, credits text, notice key), `flyToPlace(lngLat, zoom?)`, `refocusParcel()`, `MIN_DRAW_ZOOM`.

Overlay choices that differ from the brief: land surface temperature uses `MODIS_Terra_L3_Land_Surface_Temp_8Day_Day` (the product the thermal branch samples, without the cloud gaps of the daily swath); GIBS tiles are declared 512 px so a date change needs a quarter of the requests.

## 5. Measured performance

Bench: `#/globe-lab`, or `src/globe/lab.html` on the dev server (same bench without the app shell). `window.__globeLab.flyIn(id)`, `.scrub()`, `.hero()`, `.play()`, `.idle()` return frame-interval statistics.

One machine, 2026-11-14: AMD Radeon integrated graphics, 1440 x 900 CSS px at DPR 1.25 (1800 x 1125 canvas), Chromium 156, dev server, tiles warm in the HTTP cache.

| Run | fps | p50 / p95 / max (ms) | Frames over 25 ms |
|---|---|---|---|
| Locked, at rest, 2 s | 60.0 | 16.7 / 17.1 / 17.2 | 0 |
| Scrub the year, one cursor write per frame, 4 s | 60.1 | 16.7 / 17.0 / 17.2 | 0 |
| Same with the SMAP overlay and terrain on, 6 s | 60.0 | 16.7 / 17.0 / 17.1 | 0 |
| Fly-in, explore to Đắk Lắk, 6.4 s | 59.7 | 16.7 / 17.0 / 49.9 | 1 |
| 2.5 s after arrival | 60.0 | 16.6 / 17.0 / 17.2 | 0 |

The one long frame in the fly-in is consistent with terrain being switched on mid-descent; it was not isolated. Not measured: the hero rotation (the run was cut by a dev-server reload), a cold tile cache, a production build, other GPUs, phones, displays above 1440 x 900. Pixel ratio is capped at 2 and at 5.2 M canvas pixels.

### Smoothness pass (2026-11-14)

Changes: motion on by default; while a flight or a user gesture moves the camera the canvas renders at 0.75 of its resting pixel ratio (never below 1) and gets it back 260 ms after the camera rests (`setPixelRatio` plus an immediate redraw where MapLibre allows it, so no blank frame); the anchor is published at most every 120 ms during a scripted flight and exactly on arrival; per-frame code no longer reads `clientWidth` / `clientHeight` (cached on resize), which could force a layout each frame; when a fly-in starts, the destination's Esri tiles (3 x 3 at the final zoom and one level above) and DEM tiles are prefetched into memory through the same per-host queue; the toolbar view state is rAF-coalesced.

Measured in the bench (`/src/globe/lab.html?motion=full`), dev server, in the desktop app's browser pane. The pane did not hold an emulated 1440 x 900 viewport during the runs; the second set ran at the pane's own 426 x 295 CSS px at DPR 1.25 and is labelled so. Drag and wheel are synthetic mouse events dispatched on the canvas (`__globeLab.gesture()`).

| Run | Viewport | fps | p95 / max (ms) |
|---|---|---|---|
| Hero rotation, 5 s | 426 x 690, DPR 2 (emulated) | 59.6 | 17.0 / 49.8 |
| Drag 1.5 s, explore | 426 x 690, DPR 2 | 60.1 | 17.1 / 17.2 |
| Wheel zoom in and out | 426 x 690, DPR 2 | 60.1 | 17.0 / 17.2 |
| Fly-in with the lighter ratio disabled (before) | 426 x 690, DPR 2 | 56.4 | 17.0 / 83.3, plus four 50-67 ms frames at zoom 9.7-11.8 (terrain switching on) |
| Fly-in with the lighter ratio (after) | 426 x 690, DPR 2 | 59.0 | 17.0 / 116.6, no long frame in the descent |
| Scrub the year, 4 s | 426 x 690, DPR 2 | 58.1 | 17.0 / 66.6 |
| Hero rotation, 4 s | 426 x 295, DPR 1.25 | 60.0 | 16.9 / 17.3 |
| Drag / wheel | 426 x 295, DPR 1.25 | 60.0 | 16.7-16.8 / 16.8-17.0 |
| Fly-in to Iowa, first visit | 426 x 295, DPR 1.25 | 59.2 | 17.0 / 99.8 |
| Fly-in, warm | 426 x 295, DPR 1.25 | 59.2 | 17.0 / 100 |
| Scrub with a 36 x 18 synthetic raster drawn | 426 x 295, DPR 1.25 | 60.0 | 17.0 / 17.2 |

The one long frame left in each fly-in (80-117 ms, at zoom about 1.7, right after the lock) was attributed with the Long Animation Frame API to a `Response.text().then` callback in `src/lib/http.ts`: the field data parsed on the main thread as the flight starts. It is outside the globe. There are no "before" frame rates for the old default: under the user's system setting flights were cuts. Not measured: 1440 x 900 in this pass, a production build, a normal desktop browser, a truly cold HTTP cache.

## 6. Known limits

- **Demo polygons** (`src/data/samples.ts`): Nevada is the single pivot circle under the verified point (centre -115.96894, 39.71961, radius 395 m, 48.9 ha) and Iowa the field block between the section roads minus the farmstead (29.3 ha), both traced on Esri imagery at zoom 14 (about 4 m per pixel, so edges are good to roughly 5-10 m; the Iowa south edge is a faint line). Đắk Lắk (2.0 ha, confidence 0.87) and An Giang (`cantho-rice`, 1.4 ha Mekong paddy, confidence 0.82) are real field polygons detected from Sentinel-2 NDVI (`detectFieldBoundary`, `scripts/data/boundary-demo.ts`); the crop grown on those two Vietnamese fields is assumed rather than verified on the ground.
- Seen working in the browser: hero, explore (`/?phase=explore`), beacons, click-to-select demo fields and Sentinel-2 boundary detection on live farmland (including > 65 ha US Midwest fields via the 20 m fallback), address + area draft, corner drag, lock fly-in from explore and from a deep link, wheel zoom without snap-back, synthetic horizontal touchpad swipe, parcel raster fitted to the outline, NDVI / SMAP / IMERG / LST overlays, terrain toggle. Written and synthetic-tested, not exercised on physical multi-touch hardware: real touchscreen two-finger twist and physical laptop touchpad inertia. Written, not exercised: midpoint insert, corner delete, keyboard nudging, GPS with a real fix, labels, satellite off, the Sentinel-2 cloudless fallback, the no-WebGL message.
- No unit tests yet for the pure modules (`overlays`, `draft`, `ramps`, `camera`).
- With the camera at rest after a deep link, MapLibre once left the raster layers out of the last frame; the engine now repaints once after loading settles. The cause was not found.
- A product switch at globe scale fills tile by tile (GIBS answers in about 300 ms per tile, four at a time).
- The newest 16-day NDVI composite on GIBS is 28 days old today, so NDVI shows as stale at the right end of the timeline. That is the latency gap, shown on purpose.
- The credits line sits bottom-left (above `--timeline-h` when locked). If the UI covers it, render `useGlobeStatus().credits` in the chrome and set `--globe-credits-display: none`.
- Terrain exaggeration is 1.25: slopes look a quarter steeper than they are.
- The lighter pixel ratio while moving shows as a slight softening on DPR 2 screens during a drag; at DPR 1.25 the moving ratio is 1.
- Measure tool: no undo of the last point and no editing; the UI should offer Escape or a stop button.
- **Interactive field picking** (`setPickMode`, `setPickTarget`, `setPromptMarkers`): in "Chọn trên bản đồ" the map shows a crosshair cursor, a pulsing reticle while Sentinel-2 loads, and green `+` / red `−` prompt pins for the multi-point refinement in `src/ui/field/SelectOnMap.tsx`. `onMapClick` listeners receive `{ altKey, shiftKey }` so `Alt + click` adds a negative prompt. A positive click that cannot join the current polygon (separate farm across a road) restarts the selection on that farm; pins that end up outside the polygon are dropped. Checked in the browser on Story County farmland (1 click, 2nd `+`, `−`, Regularise ×2, Undo); not checked on a touchscreen, where there is no Alt key and the `+ / −` toggle is the only way to switch.
- `locateMe` was not exercised with a real fix. GIBS overlays and labels are not held back during a flight.
