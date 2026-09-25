# Squiggle Editor

A single-screen Nuxt editor for exploring the Chromie Squiggle algorithm by Snowfro. Shape the curve, choose a texture, and change its colors; every artwork edit stays representable by its 32-byte hash. The responsive interface supports mouse, touch, and keyboard input. Type thumbnails render actual collection pieces from locally bundled canonical hashes.

This is an independent local project, with no backend, wallet connection, or deployment service. See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution and rendering provenance.

## Run locally

Use Node.js 22.19+ within the 22.x release line, or 24.11+ within 24.x, and npm.

```sh
npm install
npm run dev
```

Open [localhost:3021](http://localhost:3021). The development server binds to the local machine.

```sh
npm test
npm run typecheck
# With the local server running and Chrome installed:
npm run test:e2e
npm run build
npm run preview
```

The preview command serves the production build on the same port; stop the development server first. Tests cover hash validation and round trips, trait rules, constrained curve editing, deterministic rendering data, and history behavior. These commands are verification instructions, not a record of their latest results.

## Use the editor

- Choose **Normal, Bold, Slinky, Ribbed, Pipe, or Fuzzy**. Set the starting hue and color spread, reverse the colors, or enable Hyper on any type.
- Use the **Color, Shape, Texture, and View** tabs for the complete controls. Shape includes Length, Height, and a point selector with vertical position; Texture adds spacing and grayscale rib color when Ribbed is selected.
- Grab the curve and pull vertically. The guides show the fixed horizontal spacing and vertical editing direction. Focus the canvas to use **Left/Right** to select a point and **Up/Down** to move it; hold **Shift** for a larger step. **Escape** cancels an active gesture.
- Use Undo/Redo, or **Ctrl/Command Z** and **Ctrl/Command Shift Z**. A completed drag is one history step. Pointer events are fitted at most once per displayed frame from a stable gesture anchor; the final event is flushed on release, without animated interpolation or loss of hash precision.
- The centered hash bar sits above the artwork. Changed characters roll briefly as you edit; the effect stops when the field is focused and respects reduced-motion preferences. Copy the hash, or paste into its field and press **Enter** or **Load**. A valid hash is `0x` followed by 64 hexadecimal characters.
- **New squiggle** randomizes the hash. **Reset** restores the hash loaded when the page opened, including a valid hash supplied in the URL.
- Use Play/Pause, Speed, and Background to change the view. **Export** saves a 3000 × 2000 PNG in a fixed 3:2 frame, with the current background and animation phase and no editing guides. A fixed 5% outer margin keeps every original type and extreme valid curve inside the image, independently of the editor viewport.
- The address bar stays in sync with `?hash=…&bg=…&speed=…`; copy that URL to reopen the same artwork and view settings at animation phase zero. A localhost link requires this app running on the recipient's machine.

## Parameters

Byte indexes below are zero-based. Hash controls preserve integer values from 0 to 255; view controls do not change the hash.

| Control | Storage and range | Effect |
| --- | --- | --- |
| Type | Bytes 22, 23, 24, 31 | Chooses a valid flag combination for the six original styles. |
| Starting hue | Byte 29: 0–255 | Shows the visible starting color on the rainbow track; reversed color direction inverts the byte mapping. |
| Reverse | Byte 30: below 128 or at least 128 | Reverses or preserves the original hue sequence. |
| Color spread | Byte 28: 3–255 | Maps to approximately 5.53–50; smaller values produce more color cycles. |
| Hyper | Byte 28: 0, 1, or 2 | Sets spread to 0.5 in all six types; the three encodings render equivalently. |
| Length | Byte 26: 0–255 | Maps to the original fractional segment parameter, 12–20; controls point spacing and the active curve spans. |
| Height | Byte 27: 0–255 | Maps the height divisor from 3 to 4. Byte 0 is tallest; byte 255 is shortest. Stroke thickness stays fixed by type. |
| Point / vertical position | Active bytes 0 through `ceil(segments)`, inclusive | Edits each permitted Y value, including the first and last tangent controls. Higher values move downward. |
| Ribbed spacing | Byte 24: 0–29 | Values 0–13, 14–27, and 28–29 use marker intervals of 3, 4, and 5 samples. The full byte range remains available. |
| Rib color | Byte 25: 0–255 | Sets Ribbed markers from black to white; inactive for other visible types. |
| Background | View setting: 11 levels | Uses the original grayscale values: 255, 225, 200, 175, 150, 125, 100, 75, 50, 25, 0. |
| Speed / Play / Pause | View settings: speed 0.1–20 | Controls color animation. Speed is saved in the URL; opening a URL starts paused at phase zero. |

Some bytes are latent: inactive shape points remain in the hash and become relevant when Length reveals them; byte 21 is unused by the original renderer. Style flags can also be masked by higher-priority styles. Type selection resolves the visible style without inventing independent controls for masked traits. Bytes 0–6 also contribute to Fuzzy's random seed, so its texture follows shape edits rather than a separate texture seed.

Sampling counts, circle diameters, stroke width, horizontal scale, and amplitude are fixed or derived by the original algorithm. They have no independent sliders. The original background cycle repeats the same eleven shades on its return from black to white; the Background control exposes each distinct shade directly.

## What the hash preserves

The original algorithm uses evenly spaced horizontal control points and byte-derived vertical values. Dragging fits nearby control values, rounds them to whole bytes, and clamps them to the original range. A drag changes only vertical values; Length selects a different valid set of evenly spaced points. Neither control creates an arbitrary path. Editing early shape bytes can also change Fuzzy's seeded texture.

The hash contains the artwork's geometry and traits. Background, speed, animation state, animation phase, and viewport size are separate view settings. Importing the exported hash reconstructs the same artwork at the same viewport and view settings; opening a URL starts at phase zero. Resizing fits the original 3:2 drawing area inside the available canvas. Animation timing is normalized to elapsed time rather than depending on display refresh rate.

The renderer follows the original algorithm served by Art Blocks, including its sampling and random-number quirks. It uses native Canvas rather than the original p5 runtime. Browser rasterization, antialiasing, and device pixel ratios can differ, so this project does not claim pixel-identical output across renderers or devices. An edited hash is an algorithmic study, not a newly minted Chromie Squiggle token.
