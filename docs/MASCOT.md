# Mascot

Three characters: **Rice** (the crop), **Seed** (the soil) and **Satellite** (the weather). Owner: `thuyyen03052008`.

## Where they come from

The models are from the owner's "AstroVivu Triple Mascot Portable Kit 1.0" (shared folder, 15 November 2026). Three files were taken from it, unchanged:

| File | Bytes | SHA-256 |
|---|---|---|
| `public/mascot/Rice/Rice.glb` | 340 404 | `1b333727afe25b36fae5cce96cc3f8a174875e9905acc48e74718a027aebffb8` |
| `public/mascot/Seed/Seed.glb` | 299 540 | `da595cb8cf8f6f36f6f3bac8e1389128628148d58e3222df628114dd25e0adcc` |
| `public/mascot/Satellite/Satellite.glb` | 203 772 | `d08fccd63b8384ef688e0dc3f63678fea7794c4261d92142f554940a221c7104` |

The hashes match the kit's `manifest.json`. Each model is an animated node hierarchy (no skinned rig) with twelve clips: `Idle`, `Wave`, `Point`, `PointLeft`, `Jump`, `Celebrate`, `Run`, `Spin`, `Think`, `Talk`, `Hover`, and `LeafWiggle` (Rice, Seed) or `Scan` (Satellite). How the models were made is the owner's to state here (the kit names a generator script, `tools/generate_mascots.py`).

## How they are mounted

- `src/ui/mascot/stage.ts` is a TypeScript port of the kit's `src/mascot-stage.js`, kept to one character per canvas, its clips and the gaze. It draws at 30 frames a second at most and stops moving under `prefers-reduced-motion`.
- `src/ui/mascot/index.tsx` exports `<Mascot who clip beat look fallback />`. three.js and the model are fetched only when a character is first shown (a separate chunk); while it loads, or without WebGL, `fallback` is drawn.
- The kit's guided tour (`mascot-guide.js`) and its stylesheet are not used.
- `look` (-1..1 from the character's centre, x right, y down) points the eyes and turns the body by up to about 30 degrees (`MascotStage.aimAt`); while it is set, the pointer no longer moves the eyes.
- Used on the farm stage (`docs/FARM.md` §4): they hop in and wave, play a small clip now and then one at a time, answer the steps of the story (weather, harvest, sowing, dry ground, alerts, mood), and talk when their note is open while the other two turn to them. Satellite scans when playback starts; the one who proposed a trial jumps when it starts.
- `Point` and `PointLeft` are assumed to point to the viewer's right and left; Seed (left of the field) uses `Point`, Rice and Satellite `PointLeft`. To be checked against the kit by its owner.

## Not done

- The dependency `three` was added for this. The earlier note in `src/ui/mascot/README.md` ("no animation library, CSS only") was written before the kit existed and is the owner's to update.
- The characters are not yet on the landing, the empty states, the assistant or the urban tool.
