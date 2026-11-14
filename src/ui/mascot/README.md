# Mascot

Owner: @thuyyen03052008. Everything about the mascot lives here and in `public/mascot/`.

## Where things go

| What | Where |
|---|---|
| Artwork (SVG preferred; PNG or WebP at 2x when it must be raster) | `public/mascot/` |
| React component(s) | `src/ui/mascot/` |
| Texts the mascot says | `src/ui/mascot/strings.ts`, registered with `registerStrings('mascot', en, vi)`: every line in English and Vietnamese |
| Design notes (character, poses, colours, when it appears) | `docs/MASCOT.md` |

## How it plugs into the app

Export one component from `src/ui/mascot/index.tsx`:

```tsx
export function Mascot(props: { mood?: 'idle' | 'happy' | 'thinking' | 'warning'; size?: number; className?: string }): JSX.Element
```

The UI lead mounts it where it belongs (the hero screen, empty states, the assistant, the urban tool).
Do not edit files outside this folder and `public/mascot/` to place it: open a pull request with the
component and say in it where you would like it to appear.

## Rules

- Original artwork only: nothing traced or copied from another product's mascot, and nothing generated
  from one. Say in `docs/MASCOT.md` how each asset was made.
- Keep each file small (aim for under 100 KB; an SVG is usually under 20 KB). No animation library:
  CSS animation, and it must stop under `prefers-reduced-motion`.
- The mascot is decoration with a voice, never the only carrier of information: give the image an empty
  `alt` when a text beside it says the same thing, a real `alt` otherwise.
- Colours from the design tokens (`src/ui/design/tokens.css`) so it sits in the interface.
