---
name: Astrovivu
description: Mission-control instruments for one field. Dark, hairline, honest about every number.
colors:
  void: "#03050b"
  surface-0: "#060b14"
  surface-1: "#0b131e"
  surface-2: "#131c2a"
  surface-3: "#1c2737"
  inset: "#04070f"
  line-1: "#242e3d"
  line-2: "#3a4656"
  line-3: "#5d6a7d"
  ink-1: "#edebe4"
  ink-2: "#bdc5d0"
  ink-3: "#959faf"
  ink-4: "#6a7586"
  signal: "#fbfaf6"
  on-signal: "#060b14"
  nominal: "#58da98"
  watch: "#f8bd40"
  alert: "#ff5a50"
  stale: "#92a8b9"
  simulated: "#baaac7"
typography:
  body:
    fontFamily: "Archivo Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "Archivo Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
  value:
    fontFamily: "Chivo Mono Variable, Cascadia Mono, Consolas, monospace"
    fontWeight: 500
rounded:
  xs: "1px"
  sm: "2px"
  md: "3px"
  lg: "4px"
spacing:
  base: "4px"
  panel: "16px"
---

# Astrovivu design system

Source: `src/ui/design/`. Tokens: `tokens.css` (CSS variables + Tailwind v4 `@theme`), mirrored for canvas and map code in `tokens.ts`. Living specimen: `#/styleguide` (or `/src/ui/design/styleguide/standalone.html` on the dev server when the app shell is broken by work in progress elsewhere). Import primitives from `@/ui/design` only.

## Overview

Mission control is the metaphor for instruments a farmer can trust, not a costume. The screen is a night-side navy ground carrying hairline plates, one grotesque typeface in three widths and its monospaced sibling for measurements. Three rules decide every mark:

1. **Light is you.** The brightest solid marks are what the operator controls or measured: the primary action, the selected option, the timeline cursor, the parcel outline, a ground-truth value. There is no accent hue; the accent is light itself (`signal`, inverse video).
2. **Hue is a state or a channel.** Colour appears when the land needs attention (watch, alert), or to tie the branch in focus to the ramp painting the parcel. Traces are neutral ink at rest. A quiet screen means nothing is wrong (the "dark cockpit" rule of flight decks).
3. **Texture is honesty.** Solid = measured. Dashed = forecast. Dotted = simulated. Hatched = not received yet. Hollow = stale. Trust is readable before the number is.

The signature move is the Radial HUD drawn as an annotated technical diagram: callouts joined to the parcel by leader lines with a shelf and a terminal dot, the way spacecraft are labelled in a press kit.

### Deliberately avoided

- Purple or blue gradients, gradient text, glow, neon cyan on black, glassmorphism, backdrop blur (plates are 94 % opaque; the globe owns the GPU).
- Corner brackets, crosshair ornaments, scan lines, fake coordinates: any mark that carries no information.
- Rounded cards and pill buttons: nothing is rounder than 4 px except dots, switch thumbs and the hub.
- All-caps tracked micro-labels as a texture. Labels are sentence case (stacked Vietnamese diacritics stay legible); caps are for one- or two-word status words and the wordmark.
- Monospace for prose or labels. It is for numbers, units, dates, coordinates and source strings.
- A coloured stripe on one side of a plate. A flagged plate tints its whole 1 px border and carries a shape + word tag.
- Cards inside cards, a kicker above a heading, a hero-metric tile, a modal where a sheet or inline state would do.
- Tailwind's default palette, radii and shadows: they are removed from the theme, so `bg-purple-500` or `rounded-2xl` do not exist.

## Colors

All values in `tokens.css`. Tailwind classes follow the names: `bg-surface-1`, `text-ink-2`, `border-line-2`, `text-watch`, `bg-alert/14`.

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `void` `surface-0` `surface-1` `surface-2` `surface-3` `inset` | Page ground; app ground; plates; raised plates and hover; popovers, tooltips, pressed; wells (inputs, segmented tracks). One step lighter is one level closer. |
| Lines | `line-1` `line-2` `line-3` | Separators; frames; control boundaries. Only `line-3` reaches 3:1, so only it may define a control edge. |
| Ink | `ink-1` `ink-2` `ink-3` `ink-4` | Primary text; secondary; tertiary and placeholders; disabled and non-text marks only. |
| Signal | `signal` `on-signal` | Solid fill of what the operator controls or measured; text on that fill. |
| States | `nominal` `watch` `alert` `stale` `simulated` `truth` | Always with the matching shape and word (`StatusTag`). `truth` equals `signal`. |
| Branch ink | `branch-soil-moisture` `-vegetation` `-thermal` `-rainfall` `-agromet` `-terrain` `-soil` `-risk` | Okabe-Ito hues relit for dark. Used for the branch in focus (trace, icon, leader line) and where several branches share one plot. Never the only identifier: icon and title are always present. |

### Contrast (WCAG 2.x ratio of the row colour on each surface)

| Token | Hex | void | surface-0 | surface-1 | surface-2 | surface-3 | inset |
|---|---|---:|---:|---:|---:|---:|---:|
| `ink-1` | `#edebe4` | 17.1 | 16.5 | 15.6 | 14.3 | 12.6 | 16.9 |
| `ink-2` | `#bdc5d0` | 11.7 | 11.3 | 10.7 | 9.8 | 8.6 | 11.6 |
| `ink-3` | `#959faf` | 7.6 | 7.4 | 7.0 | 6.4 | 5.6 | 7.5 |
| `ink-4` | `#6a7586` | 4.4 | 4.2 | 4.0 | 3.7 | 3.2 | 4.3 |
| `signal` | `#fbfaf6` | 19.5 | 18.9 | 17.9 | 16.4 | 14.4 | 19.3 |
| `line-3` | `#5d6a7d` | 3.7 | 3.6 | 3.4 | 3.1 | 2.7 | 3.7 |
| `line-2` | `#3a4656` | 2.1 | 2.1 | 1.9 | 1.8 | 1.6 | 2.1 |
| `nominal` | `#58da98` | 11.5 | 11.2 | 10.6 | 9.7 | 8.5 | 11.4 |
| `watch` | `#f8bd40` | 12.0 | 11.6 | 11.0 | 10.1 | 8.9 | 11.8 |
| `alert` | `#ff5a50` | 6.6 | 6.4 | 6.1 | 5.6 | 4.9 | 6.6 |
| `stale` | `#92a8b9` | 8.3 | 8.0 | 7.6 | 6.9 | 6.1 | 8.2 |
| `simulated` | `#baaac7` | 9.4 | 9.1 | 8.6 | 7.9 | 6.9 | 9.3 |
| `branch-soil-moisture` | `#4dc3dd` | 9.9 | 9.5 | 9.0 | 8.3 | 7.3 | 9.8 |
| `branch-vegetation` | `#8add6c` | 12.3 | 11.9 | 11.2 | 10.3 | 9.1 | 12.1 |
| `branch-thermal` | `#ff8350` | 8.4 | 8.1 | 7.6 | 7.0 | 6.2 | 8.3 |
| `branch-rainfall` | `#87b1fd` | 9.5 | 9.1 | 8.6 | 7.9 | 7.0 | 9.3 |
| `branch-agromet` | `#f5db59` | 14.7 | 14.2 | 13.5 | 12.4 | 10.9 | 14.5 |
| `branch-terrain` | `#c8bca5` | 10.9 | 10.5 | 9.9 | 9.1 | 8.0 | 10.7 |
| `branch-soil` | `#d69459` | 8.0 | 7.7 | 7.3 | 6.7 | 5.9 | 7.9 |
| `branch-risk` | `#f180b5` | 8.2 | 8.0 | 7.5 | 6.9 | 6.1 | 8.1 |

`on-signal` on `signal` is 18.9; on `watch` 11.6, `nominal` 11.2, `alert` 6.4. `ink-4` fails 4.5:1 by design: never use it for text that must be read. On `surface-3` a control edge must use `ink-4`, not `line-3`. `tokens.test.ts` enforces these floors and the CSS / TS mirror.

### Map metric ramps

Low to high. CSS: `var(--ramp-*)` (a 90° gradient). Code: `RAMPS[metric][mode]`, `rampColor(metric, value, [min, max], mode)` (piecewise linear, identical to the legend). Moisture, rain and heat are ColorBrewer, colour-blind safe, nine stops. Vegetation follows the convention of field-monitoring apps and has two ramps, so the two scales of a field picture cannot be mistaken for each other:

| Ramp | Token, code | Stops | Used when |
|---|---|---|---|
| NDVI, fixed scale | `--ramp-vegetation`, `RAMPS.vegetation.sequential` | 12: `#300b05` `#812c14` `#b36127` `#e7bc4c` `#f3da60` `#f8ee64` `#f4f550` `#d1e54a` `#a3cf40` `#4d8f28` `#1e4816` `#123011` | The picture is on the index's own 0 to 1 range ("Fixed scale"; the reference calls it Standard) |
| NDVI, field range | `--ramp-vegetation-field`, `RAMP_VEGETATION_FIELD` | 9: `#881e4c` `#db3d25` `#f1b54f` `#f7e050` `#eff651` `#80db45` `#4aa069` `#3e8874` `#3d8575` | The picture is stretched to this field's 2nd to 98th percentile ("Field range"; the reference calls it Contrasted and labels the ends Min and Max) |
| Zones | `--ramp-zones`, `RAMP_ZONES` | 3 blues: `#d0e3fc`, `#8abbf7`, `#4392f1` | Low, medium, high zone in the Field report |

Both NDVI ramps are the reference product's own stops, read from the CSS gradient of its legend on 2026-11-14; the zone ramp keeps its two measured end stops with our middle one. `src/globe/fieldRaster.ts` picks the ramp (`rampStops(id, relative)`); the cards, tiles and legends in `src/ui/field` read the same function, so a picture in the panel and the field on the map always match.

| Metric | Sequential | Diverging (departure from normal) |
|---|---|---|
| `vegetation` | see above | BrBG `--ramp-anomaly-wet` (browner to greener) |
| `moisture` | YlGnBu `--ramp-moisture` | BrBG `--ramp-anomaly-wet` (drier to wetter) |
| `rain` | Blues `--ramp-rain` | BrBG `--ramp-anomaly-wet` |
| `heat` | YlOrRd `--ramp-heat` | RdBu reversed `--ramp-anomaly-heat` (cooler to hotter) |

`BRANCH_RAMP` maps a branch to its metric (`soilMoisture → moisture`, `vegetation`, `thermal → heat`, `rainfall → rain`; others have no map paint). Paint the parcel at about 0.8 opacity, outline it in `signal` (2 px) over a `void` casing (5 px, 0.65). Colour on the map never appears without a `RampLegend`.

### Textures

`hatch-pending` (latency gap), `hatch-simulated` (anything simulated), `skeleton` (loading). Line styles in charts: solid observed / modelled / derived, dashed `3 3` forecast, dotted `0.1 3.2` simulated, dotted grey bridge across a gap.

## Typography

| Family | Token | Carries |
|---|---|---|
| Archivo Variable (wght 100-900, wdth 62-125) | `--font-sans`, `--font-display` | Everything read as language. Widths: `--stretch-condensed` 80 %, `--stretch-semi` 90 %, `--stretch-normal` 100 %, `--stretch-expanded` 125 %. |
| Chivo Mono Variable (wght 100-900) | `--font-mono` | Numbers, units, dates, coordinates, source strings. |

Self-hosted through `@fontsource-variable/archivo` (`wdth.css`) and `@fontsource-variable/chivo-mono`, subsets latin, latin-ext, vietnamese; 270 kB of woff2 in total, loaded per subset. Vietnamese: all 134 accented letters are drawn by both fonts at every weight (verified in-browser at 100, 400, 500, 600, 700, 900; the style guide repeats the check live). Not covered, falls back to the system font: Greek (`σ`), arrows (`→`), `≥ ≤`, `‰`, Cyrillic. Avoid them in UI copy; `−`, `×`, `·`, `°`, `²`, `³`, `µ`, `±`, `₫` are covered.

Scale (fixed rem, ratio about 1.2; `text-*` utilities):

| Class | Size / line | Use |
|---|---|---|
| `text-2xs` | 11 / 14 | Status words, source strings |
| `text-xs` | 12 / 16 | Labels, captions, units |
| `text-sm` | 13 / 18 | Dense controls |
| `text-base` | 14 / 20 | Product default |
| `text-md` | 16 / 24 | Reading text, phone body |
| `text-lg` | 18 / 24 | Titles |
| `text-xl` | 22 / 28 | Compact readings |
| `text-2xl` | 28 / 32 | Section titles, readings |
| `text-3xl` `text-4xl` | 36 / 40, 48 / 48 | Headline numbers, page title |

Roles (utilities; use these instead of composing by hand):

| Utility | Spec | Use |
|---|---|---|
| `t-display` | wide cut, 600, tracking 0.22em, caps | Wordmark and hero only |
| `t-title` | 18 / 24, 600 | Screen and panel titles |
| `t-heading` | 14 / 20, 600 | Headings inside a panel |
| `t-body` | 14 / 20, 400 | Default text |
| `t-reading` | 16 / 24, 400 | Advisory explanations, assistant, phones; cap at 68ch |
| `t-label` | 12 / 16, 500, width 90 %, `ink-2` | Field and instrument labels, sentence case |
| `t-caption` | 12 / 16, 400, `ink-3` | Line under a value or control |
| `t-status` | 11 / 14, 600, width 90 %, caps, tracking 0.08em | NOMINAL, WATCH, SIM |
| `t-value` | mono, 500, tabular | Any measurement; set size with `text-*` |
| `t-unit` | mono 12, `ink-3` | Unit after a value |
| `t-meta` | mono 11 / 14, `ink-3` | `SMAP L4 · 9 km · 2 d` |

Numbers always carry a unit, a thin space before `%`, and `--` when missing (never 0). Dates are day-month-year in both languages.

## Layout

4 px base (`--spacing`). Related items 4-8 px apart, groups 12-16 px, regions 24 px or more. Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1440. Density variants match `useHudDensity()`:

| Density | When | Variant | `--hud-callout-w` | `--hud-gutter` | `--hud-hub` | `--timeline-h` | `--topbar-h` |
|---|---|---|---|---|---|---|---|
| regular | ≥ 1440 wide and > 800 tall | (none) | 264 px | 24 px | 148 px | 132 px | 48 px |
| compact | below that (1280 × 720) | `compact:` | 232 px | 16 px | 128 px | 112 px | 48 px |
| stacked | < 1024 wide | `stacked:` | 100 % | 12 px | 112 px | 96 px | 52 px |

Other layout tokens: `--hud-callout-gap` 12 / 8, `--hud-shelf` 28 / 20, `--panel-pad` 16 / 12 / 16, `--touch` 44 px. `HUD_METRICS[density]` gives the values that are props (sparkline height 32 / 24 / 40, shelf, hub).

Layers (`z-(--z-*)`): globe 0, map-ui 10, leader 20, hud 30, panel 40, dock 50, chrome 60, assistant 70, overlay 80, popover 90, toast 100.

### Shell (light, OneSoil-like structure)

Measured on OneSoil's web app at 1440 x 900 (2026-11-14) and matched in tokens, not copied: grey icon rail 56 px (#e5e5ea), white list panel 280 px with an 8 px left radius, field panel ~790 px with 24 px padding, body text #1c1c1e at 14 px (Graphik, proprietary; we use Inter, the closest open neo-grotesque with full Vietnamese), section titles 18 / 500, tabs 36 px tall, primary button green #27ae60 pill (radius 18 px, padding 0 8 px, shadow 0 4 8 -2 rgba(16,24,40,.1) + 0 2 4 -2 rgba(16,24,40,.06)).

From their public stylesheet (values only): 12 px and 14 px dominate (line heights 16 and 18 px), weight 500 for every emphasis (600 almost never), radii 8 / 4 / 12 px, borders 1 px #e5e5ea, gaps 8 / 4 / 16 px, controls 32 and 40 px tall, text greys #1c1c1e / #48484a / #636366 / #8e8e93. Charts: grid and axis #e5e5ea, ticks 12 px #8e8e93, line 2 px. We follow all of these. Numbers use the sans with tabular figures, not the mono.

Our values: surfaces white / #f2f2f7 / #e5e5ea, lines #e5e5ea / #d1d1d6 / #7c7c80, ink #1c1c1e / #48484a / #636366 / #8e8e93 (`ink-4`: tick labels and non-text marks only), radii 4 (`xs`) / 8 (`sm`) / 12 (`lg`) px, soft shadows. The hero keeps the dark palette through the `.theme-dark` scope.

Green: `signal` is the reference green #27ae60, used for fills and selection (primary pill, "Demo" tag, check marks, chart line, timeline knob, focus ring), with the reference's own label on it: white, weight 500, 12 px. That is 2.9:1, so it is kept to short labels and is never the only cue. A green fill under the pointer is `signal-hover` #2a9456 (theirs). Green on a dark tile or control is `signal-bright` #37d279 (theirs). Green used as text or as an icon on a light surface is our darker `signal-strong` #1a7f45 (5.0:1 on white, 4.5:1 on #f2f2f7); the reference uses #27ae60 there too. A chosen chip (priorities, urban options) is a green rim with a 12 % green tint and `signal-strong` text, not a filled chip.

Controls: buttons are 32 px (`md`, 12 px text) or 40 px (`lg`, 14 px; 44 px on narrow screens). Only the primary is a pill (the green one, radius 18, with the shadow above); secondary buttons are white 8 px rectangles with a 1 px #d1d1d6 border that darkens to #b9b9bd under the pointer. Icon buttons are 8 px rounded squares; a pressed one is a grey tile with a green icon. Rows, cards and menu items turn #f2f2f7 under the pointer; rail tiles and the Sort button turn #d1d1d6 and #e5e5ea.

Map controls are dark, as in the reference: #1c1c1e pills with white 20 px icons, 40 px, fully rounded, shadow `--shadow-map` (0 2px 8px rgb(34 34 34 / 0.35)), black at 90 % under the pointer. The tool stack sits on the map's right edge, 15 px in, centred vertically, 10 px between groups, related buttons joined into one pill (zoom in and out). Top-left: the layer pill (what the field is coloured by, as a selector, over the frame date). Top-right: the place search, a dark pill with white text. Bottom-left: the legend (dark card: ramp, range, scale switch) over a white "Hide legend / Show legend" text button; beside it the weather as plain white text; the credits bottom-right. Menus and popovers are white, 8 px radius, shadow `--shadow-lg` (0 16px 32px rgb(0 0 0 / 0.15)), items 32 px. Inputs and selects are white with a 1 px #d1d1d6 border, 8 px radius, 32 or 40 px tall, green border on focus. A segmented control is a #e5e5ea track with the chosen segment as a white tile. Tabs are 36 px tall, 16 / 22, all in #1c1c1e, no side padding, 28 px apart, the active one in weight 500 over a 2 px ink rule. Tooltips are dark chips (#1c1c1e, white 12 px); popovers are white cards.

| Width | Layout |
|---|---|
| 1100 px and up | Rail 56 (`--rail-w`, #e5e5ea, 24 px icons in 40 px tiles 48 px apart, the page in view on a #d1d1d6 tile, names as tooltips) · list panel 280 (`--left-w`, white, 8 px left radius) · map with its dark controls (above) and a floating timeline strip 72 px (`--strip-h`) · field panel 580 (`--right-w`, 520 at 1280 x 720; 12 px radius, 24 px padding) floating over the right of the map once a field is locked. Advisory (Rotation), Tracking (Notes) and Urban fill everything right of the rail. |
| below 1100 px (`narrow:`) | Map in the top 45 % (`--map-h`) with zoom, fit and layers; one scrolling sheet under it with a drag handle; timeline pinned above a 60 px tab bar (`--tabbar-h`); nothing under 12 px; touch controls 44 px. |

Screens, and the one green button each has:

| Screen | What it holds | Primary |
|---|---|---|
| List panel | Title 16 / 500 with the count and total area, a borderless search row with Sort, edge-to-edge rows 56 px (48 px dark thumbnail with 7 px radius, name 14 / 500, "Demo" tag 10 / 13 / 500, area and region; the open field is a grey row and shows its vegetation picture), the grey "Add your fields" card that fills the rest (title 16, text 14 in ink), the assistant card (12 px radius, 2 px green rim) | Add field, which opens a menu of the ways to add one |
| Add a field | Back row, a two-way segmented control (address and area, or select on the map via Sentinel-2 `detectFieldBoundary`), draggable corner handles, the detected or entered area, the name ("Field in <region>" by default) and Start over | Show on the map, then Lock field |
| Field panel header | Name 20 / 34 / 700, area and crop 14 / 18 with the score as a link to the report ("Growing conditions" when no crop is chosen), next steps as icon-over-label actions (24 px icon, 12 / 500 grey label), close | none |
| Status | Three 62 px cards 16 px apart (label 12 grey, value 12 / 500; the weather card 24 px), "Satellite data" 18 / 500 with the dark date pill (40 px, 18 / 500), two #2c2c2e 8:7 tiles (the field picture with its metric chip, expand button and in-tile vertical legend; the satellite image), the period, three chart cards (plot with value and month axes on the left; name, one value, one sentence on the right) | none |
| Field report | The score as four small cards and one line, the zones tile as tall as the two dark figure cards and the distribution table beside it, the frames used as grey tiles with a check, three dark field maps | none |
| Data | Grey cards (date, name, the field picture, ramp, value); a card opens its detail | none |
| Rotation (`src/ui/advisory`) | Priority chips (up to three); a strip of strategy tiles that stays at the top while the page scrolls (`StrategyCards`: current practice first as baseline, crop-group bar, crops, score and delta; green rim on the selection); then two columns on a wide screen, the calendar and trade-offs on the left and the five lists on the right: 12-month `SeasonCalendar` (`--group-*` tokens) aligned above the field's 20-year ERA5 rain and temperature `ClimateStrip` (hover/tap `SeasonBlock` for fit, water need vs rain, yield and margin; click any block on the selected strategy to filter and swap its crop into a live-scored `Custom` strategy), `TradeOffs` dumbbell chart against current (full table behind a disclosure), `StrategyStory` five lists with clickable branch-evidence tiles; `AnnualPlanView` on the same month grid and `ActionPlans`, each one line until opened (`Fold`) | Choose a field (only when empty) |
| Urban Grower (`src/ui/urban`) | Location picker, illustrated `ChoiceTiles` for growing space and sun hours, 12-month temperature, rain and PAR `ClimateStrip` with source labels, `PlantGrid` of `PlantCard` tiles with linked FAO EcoCrop photographs (`CropPhoto`, group-icon tile fallback), score ring, difficulty, 12-month sowing strip and harvest days, opening `PlantDetail` sheet | Use my location / Pick on map |

What differs from OneSoil on purpose: the name, the mark and all wording are ours (English and Vietnamese); icons are lucide; the typeface is Inter where theirs is Graphik; their field panel covers the whole map (8 px inset on every side, 808 px wide at 1440) where ours is 580 px on the right, because the map with the field picture and the timeline strip must stay visible; their second green pill (in the question card) is an outlined button in ours, so each panel has one primary; their rows carry status icons and a checkbox and their list has a seasons column, which we have no use for; their app has no narrow layout at all (`body` has a 1000 px minimum width), so ours below 1100 px is our own; the rail has five destinations and a two-way language switch; the timeline strip, the score cards, the "Field range / Fixed scale" switch and the ground-truth tab have no counterpart in the model.

Field panel tabs, one per question a grower asks (`docs/UX_PLAN.md` U5, U6): Overview (three opening questions until closed, the model's one-sentence reading, three numbers, the field picture beside the satellite image, the NDVI and rainfall charts), Soil and practice (what the grower enters in four groups: soil, water, seasons and crops, money; then the ledger of what the entries changed), Rotation (the top strategy against the current one, and the way into the full comparison), Data (eight field-shaped metric cards, each opening a detail with legend, frame date and age, a filmstrip of real frames, series, facts, sources and caveats; the heat-sum chart; the within-field zones, folded until opened). Field pictures are canvases drawn from a store subscription, so playback never re-renders React. The radial HUD, leader lines and hub on the parcel are retired; their primitives stay in the style guide only.

### Radial HUD (retired from the app)

- **Stage.** The HUD area is the viewport minus the top bar and the timeline dock: 720 px tall at 1440 × 900, 560 px at 1280 × 720.
- **Callouts.** Four per side in `BRANCHES` order (left: soil moisture, vegetation, thermal, rainfall; right: agromet, terrain, soil, risk). Each column is absolutely positioned `--hud-gutter` from its edge, 8 px from top and bottom, vertically centred, `gap: --hud-callout-gap`. A callout is 150-164 px tall regular and 124-126 px compact; four fit with no scrolling. Heights must not change while scrubbing: always pass `delta`, or never.
- **Parcel framing (globe).** Frame the parcel so its footprint sits in the free centre: about 430 × 290 px regular, 340 × 230 px compact, never smaller than twice the hub on its short side. Camera padding: left and right = callout width + gutter + shelf + 48 px; top = top bar + 32 px; bottom = timeline + 32 px.
- **Hub.** `HubGauge` centred on the footprint centre (`ScreenAnchor.x, y`), `instant` while the timeline plays or scrubs.
- **Leader lines.** From the callout anchor (the 5 px square on the inner edge, level with the title) a horizontal shelf of `--hud-shelf`, then one straight run to a point on the ellipse inscribed in the footprint. `footprintTargets(anchor, side, 4)` fans the four targets ±38° around the horizontal, top to bottom, so lines never cross. 1 px `ink-3` over a 3.5 px `void` casing, 2.5 px terminal dot. The branch in focus: 1.5 px in its branch hue. Loading or unavailable: dashed, no dot. Draw on once at lock (420 ms, 40 ms stagger). While the camera moves, call `updateLeader(ref, from, to)` from `requestAnimationFrame`; do not re-render. Re-measure anchors (`anchorPoint`) when callout heights change (ResizeObserver on the columns), not on a timer.
- **Focus.** One branch at a time (`focusBranch`). Its callout lifts to `surface-2`, its trace, icon and leader take the branch hue, and the parcel is painted with that branch's ramp. Everything else stays neutral.
- **Time axes.** Every sparkline shares the timeline window so the cursor lines up down the column. Risk is the one exception: today − 45 d to the forecast end.
- **Stacked (< 1024 px).** No radial layout. Map and hub on top (about 300 px), callouts become a one- or two-column list under it (`--hud-callout-w: 100%`), leader lines and anchors are not drawn, the focus hue alone links a callout to the parcel paint. Touch targets are 44 px (`size="lg"`).

### Timeline

One row inside `--strip-h` (72 px): a round green play / pause button, the cursor date (14 / 500) with its distance from today under it, the `Slider` (a grey track with a round green knob) with one month label per quarter, at most one Anomaly Marker per month above the track, a `pending` range for the latency gap and a `forecast` range past today, then one speed button that steps 1x, 2x, 4x. The strip sits in the gap between the list panel and the field panel, so it carries nothing else.

Camera framing: the shell publishes what its panels cover (`setInsets`: the search row on top, rail and list on the left, tool stack and field panel on the right, legend and strip at the bottom). The globe in explore, a place the camera flies to, a draft and the locked field are all centred in what is left.

## Elevation & Depth

Depth is surface lightness plus a hairline; shadows only lift plates off imagery. `shadow-sm` (controls on plates), `shadow-md` (`plate`), `shadow-lg` (`plate-raised`, popovers, dialogs). Shadows always have an offset and blur; nothing glows. `plate` = `surface-1` at 94 % + `line-1` + `shadow-md`; `plate-raised` = `surface-2` at 96 % + `line-2` + `shadow-lg`. No `backdrop-filter`.

## Shapes

Radii: `rounded-none` 0, `-xs` 1, `-sm` 2 (controls, plates), `-md` 3, `-lg` 4, `-full` (dots, switch thumbs, hub). Borders are 1 px. Icons: `lucide-react`, 1.5 px stroke, 16 px in dense rows, 20 px on touch targets; one icon per branch (`BRANCH_ICON`). State shapes: nominal dot, watch triangle, alert diamond, stale broken ring, simulated hatched square, ground-truth solid square, note hollow ring.

## Components

All from `@/ui/design`. Text props take already translated nodes; the fixed vocabulary (status, provenance, confidence, severity words) is translated inside the primitive from the mission store language.

| Component | Props (`?` optional) | Notes |
|---|---|---|
| `Panel` | `title? meta? actions? footer? tone?: 'plate' \| 'raised' \| 'flat' pad?: 'none' \| 'sm' \| 'md' as?` | The one container. Never nest a plate in a plate; use `tone="flat"`. |
| `Button` | `variant?: 'primary' \| 'secondary' \| 'ghost' \| 'danger' size?: 'sm' \| 'md' \| 'lg' icon? iconRight? loading? block?` + button attrs | One primary per view. `lg` = 44 px. |
| `IconButton` | `label icon variant? size? pressed? loading? tooltipSide?` | `label` is required (name + tooltip). |
| `Segmented<V>` | `options: {value,label,icon?,disabled?,ariaLabel?}[] value onValueChange ariaLabel size? block? disabled?` | 2-5 visible choices; chosen = inverse video. |
| `Toggle` | `checked onCheckedChange label? hint? ariaLabel? disabled? size? trailing?` | Immediate on/off (map layers). |
| `Slider` | `value onValueChange onValueCommit? min max step? ariaLabel formatValue? ticks? ranges? markers? thumbLabel? fill? size? disabled?` | `ticks: {value,label?,major?}`, `ranges: {from,to,kind:'pending' \| 'forecast' \| 'mark'}`, `markers: {value,severity,label?}`. Base of the Timeline Scrubber. |
| `Field` | `label htmlFor hint? error? required? aside? children` | Wraps one control; error replaces hint and is announced. |
| `Input` | `size?: 'md' \| 'lg' prefix? unit? invalid? numeric?` + input attrs | `unit` sits inside the well. |
| `Textarea` | `invalid?` + textarea attrs | |
| `Select<V>` | `options: {value,label,hint?,disabled?}[] value onValueChange id? placeholder? ariaLabel? size? invalid? disabled?` | More options than a Segmented can show. |
| `Tabs<V>` / `TabPanel` | `tabs: {value,label,icon?,badge?,disabled?}[] value onValueChange ariaLabel size? block?` / `value keepMounted?` | Views of the same parcel. |
| `Tooltip` | `content children side? align? delay? disabled?` | Hint only; self-contained (no provider). |
| `Popover` | `trigger children side? align? open? onOpenChange? label?` | Anything that must be readable on touch. |
| `Dialog` | `open? onOpenChange? trigger? title description? footer? size?: 'sm' \| 'md' \| 'lg'` | Interrupting decisions only. |
| `Sheet` | same + `side?: 'right' \| 'left' \| 'bottom' modal? width?` | Non-modal by default: the map stays usable. Ground-Truth Override, assistant. |
| `Stat` | `label value unit? delta? deltaLabel? trend? tone? hint? aside? size? align?` | Rows separated by hairlines, never its own card. |
| `Meter` | `value min? max? reference? target? label? valueLabel? tone? ariaLabel?` | Comparing strategies and factors; `reference` tick = current rotation. |
| `KeyValue` | `label children numeric?` | Row of a `<dl>`. |
| `Tag` | `tone?: 'neutral' \| Status variant?: 'outline' \| 'soft' \| 'solid' size? icon?` | Non-interactive. |
| `StatusTag` / `StatusGlyph` | `status label? compact?` / `status size? color?` | Shape + word; `Status` = nominal, watch, alert, stale, simulated, ground-truth. |
| `ProvenanceTag` | `provenance source? detail? compact?` | Under every reading: how produced, dataset, resolution, age. |
| `ConfidenceBadge` | `badge? level? score? reasons? variant?: 'glyph' \| 'compact' \| 'full' footnote?` | Three bars; press for reasons. `confidenceLevel(score)` applies the 0.70 / 0.45 thresholds. Neutral on purpose. |
| `AnomalyMarker` / `AnomalyGlyph` | `severity label? size? onSelect?` / `severity x y size? halo?` | HTML / inside an SVG. `severityFromRisk(0-3)` maps `RiskEvent.severity`. |
| `Sparkline` | `samples forecast? domain? range? cadence? baseline? cursor? today? anomalies? tone?: 'ink' \| 'signal' \| BranchId variant?: 'line' \| 'bars' provenance? points? width? height? label? unit?` | See below. |
| `HubGauge` | `value label secondary? secondaryLabel? limiting? status?: HubStatus \| 'auto' size? instant? simulated? loading? onSelect?` | 270° gauge; `hubStatus(value)` bands at 65 / 40. Healthy = plain light. |
| `Callout` / `CalloutFacts` | `side title branch? icon? value? unit? delta? status? estimate? badge? meta? children? active? loading? unavailable? onSelect? anchorRef?` / `items: {label,value,unit?}[]` | Slots: `badge` = ConfidenceBadge glyph, `children` = Sparkline or facts, `meta` = ProvenanceTag. |
| `LeaderLayer` / `LeaderLine` | SVG attrs / `from to side shelf? active? branch? muted? drawOn? delay? ref?` | Helpers: `leaderPath`, `footprintTargets`, `anchorPoint`, `updateLeader`. |
| `BranchIcon` | `branch size? colored?` | |
| `RampLegend` | `metric mode? min? max? unit? label? value?` | |
| `Skeleton` / `SkeletonText` / `EmptyState` | `className` / `lines?` / `icon? title body? action? layout?: 'inline' \| 'block'` | Skeletons, never spinners in content. Empty states name the next step. |
| `ScrollArea`, `Wordmark` | `className viewportClassName?` / `size?: 'sm' \| 'md' \| 'hero'` | |
| Hooks and tokens | `useHudDensity()`, `usePrefersReducedMotion()`, `HUD_METRICS`, `COLOR`, `BRANCH_HEX`, `BRANCH_VAR`, `STATUS_VAR`, `RAMPS`, `rampColor`, `MOTION`, `Z`, `BREAKPOINT`, `contrastRatio`, `cn` | Map and canvas code uses the hex mirrors; DOM and SVG use the CSS variables. |

### Sparkline reading guide

Pass samples at native cadence (never interpolated) and the timeline window as `domain`. With `cadence`, an observation older than its hold window breaks the trace; gaps are bridged only by a grey dotted line. `baseline` draws the p10-p90 band and mean. `cursor` draws a signal hairline, a dot on the reading in force and a bar from that observation to the cursor (its age); past the hold window the dot goes hollow and the bar dashed. `today` marks today and hatches the latency gap after the last observation. `forecast` continues dashed. Dots appear on real observations when the series has 40 points or fewer. Rainfall uses `variant="bars"`.

### Callout states

Rest (neutral), in focus (`active`), `watch` / `alert` (tinted border + tag; alert also colours the value), `stale` (dimmed value), `ground-truth` (value in inverse video, `estimate` struck through), `simulated` (hatched tag, dotted trace), `loading` (skeleton), `unavailable` (reason text). `nominal` draws nothing.

## Motion

| Token | ms | For |
|---|---:|---|
| `--dur-instant` | 80 | Press and hover feedback |
| `--dur-fast` | 140 | Toggles, tabs, tooltips, focus change |
| `--dur-base` | 220 | Popovers, state and value changes |
| `--dur-slow` | 420 | Sheets, leader lines drawing on, hub sweep |
| `--dur-camera` | 1600 | Globe fly-in |
| `--dur-fade` | 120 | Opacity only; survives reduced motion |

Curves: `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` for arrivals and responses (default), `--ease-in` for exits, `--ease-in-out` for the camera. `MOTION` holds the same numbers in seconds for the `motion` library.

Rules: motion states a change, nothing else. Values follow the cursor with no easing while scrubbing or playing (`instant`); easing is for things that arrive or change state. One authored moment per phase: at lock, leader lines draw on and callouts fill in as branches resolve. No entrance choreography on panels, no looping or ambient animation except the skeleton sweep. Under `prefers-reduced-motion` all durations collapse to 0, nothing travels or draws on, the camera cuts instead of flying; timeline playback still runs because the user started it.

## Accessibility

- Text inks pass 4.5:1 on every surface; state colours pass 4.5:1; control edges use `line-3` (3:1). Enforced by `tokens.test.ts`.
- Colour is never the only signal: states have shapes and words, provenance has line styles and words, branches have icons and titles, ramps are colour-blind safe and always have a legend.
- Focus: 2 px `signal` outline, 2 px offset, on every interactive element (`:focus-visible`). Selection, caret and scrollbars are themed.
- Keyboard: Radix primitives give arrow-key movement in Segmented, Tabs, Slider (arrows step, Page keys ×10, Home / End) and Select; Escape closes overlays and returns focus. Callout titles are buttons (`aria-pressed`).
- Names: `IconButton` requires `label`; `Segmented`, `Tabs`, `Slider` require `ariaLabel`; `Field` ties label, hint and error to the control; sparklines expose a text summary (`role="img"`); `Meter` uses `role="meter"`; commentary is `aria-live="polite"`.
- Touch: `size="lg"` is 44 px; the 3 px slider cursor has a 44 px hit area.
- Language: `document.documentElement.lang` follows the store; both languages are checked at 1440 × 900, 1280 × 720 and 375 × 812.

## Do's and Don'ts

- Do import from `@/ui/design` and style with system utilities; do not write hex values in screens (map and canvas code uses `COLOR`, `BRANCH_HEX`, `RAMPS`).
- Do keep traces neutral and let one branch at a time take its hue. Do not colour a healthy reading green.
- Do show `--` for missing values and a `ProvenanceTag` under every reading. Do not present simulated data without `StatusTag status="simulated"` or the hatch.
- Do use `Sheet` (non-modal) for side tasks. Do not open a `Dialog` unless the decision must interrupt.
- Do not add blur, glow, gradients, extra radii or decorative lines.

## Known limits

- `anchorPoint` uses `getBoundingClientRect`, so a CSS transform on an ancestor of the HUD scales leader coordinates; do not transform the HUD container.
- `footprintTargets` uses the footprint's bounding ellipse; on very irregular parcels a terminal dot can sit slightly inside or outside the boundary.
- The style guide's imagery, baseline bands and productivity score are specimens built from `mockTelemetry`; they are labelled simulated and are not model output.
- Fonts load with `font-display: swap`: the first paint may use the fallback stack for a moment.
- The fidelity pass of 2026-11-14 measured the reference live at 1440 x 900 through computed styles and its stylesheet's hover rules: rail, list, field panel (Status, Field report), map controls, layer menu, legend, add-fields menu. Not seen: the reference's field fill and outline at full resolution (only one small screenshot: a semi-opaque crop-colour fill with a thin light outline and the field name at its centre), its Data and other tabs in detail, and its draw and upload flows, which were not entered.
- White on the fill green is 2.9:1, as in the reference. It is used only for short labels and icons; `tokens.test.ts` holds the floor at 2.8 and requires 4.5:1 of `signal-strong`.
