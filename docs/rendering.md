# Hash and rendering reference

[Back to README](../README.md) · [Using the editor](editor.md)

This reference describes the standard renderer and hash-based controls. Custom JavaScript can change the algorithm and is not encoded into the hash.

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
| Ribbed spacing | Byte 24: 0–29 | Values 0–13, 14–27, and 28–29 use marker intervals of 3, 4, and 5 samples. All 30 values in the Ribbed range remain available. |
| Rib color | Byte 25: 0–255 | Sets Ribbed markers from black to white; inactive for other visible types. |
| Background | View setting: 11 levels | Uses the original grayscale values: 255, 225, 200, 175, 150, 125, 100, 75, 50, 25, 0. |
| Speed / Play / Pause | View settings: speed 0.1–20 | Controls color animation. Speed is saved in the URL; opening a URL starts paused at phase zero. |

Some bytes are latent: inactive shape points remain in the hash and become relevant when Length reveals them; byte 21 is unused by the original renderer. Style flags can also be masked by higher-priority styles. Type selection resolves the visible style without inventing independent controls for masked traits. Bytes 0–6 also contribute to Fuzzy's random seed, so its texture follows shape edits rather than a separate texture seed.

Sampling counts, circle diameters, stroke width, horizontal scale, and amplitude are fixed or derived by the original algorithm. They have no independent sliders. The original background cycle repeats the same eleven shades on its return from black to white; the Background control exposes each distinct shade directly.

## Hash-based editing

The original algorithm uses evenly spaced horizontal control points and byte-derived vertical values. Dragging fits nearby control values, rounds them to whole bytes, and clamps them to the original range. A drag changes only vertical values; Length selects a different valid set of evenly spaced points. Neither control creates an arbitrary path. Editing early shape bytes can also change Fuzzy's seeded texture.

The hash contains the artwork's geometry and traits. Background, speed, animation state, animation phase, and viewport size are separate view settings. Importing the exported hash reconstructs the same artwork at the same viewport and view settings; opening a URL starts at phase zero. Resizing fits the original 3:2 drawing area inside the available canvas. Animation timing is normalized to elapsed time rather than depending on display refresh rate.

## Rendering fidelity

The standard renderer follows the original algorithm served by Art Blocks, including its sampling and random-number quirks. It uses native Canvas rather than the original p5 runtime. Browser rasterization, antialiasing, and device pixel ratios can differ, so this project does not claim pixel-identical output across renderers or devices. An edited hash is an algorithmic study, not a newly minted Chromie Squiggle token.

Code mode displays the verified original script, formatted for readability. Custom code runs with the bundled p5.js runtime. The native renderer and custom preview are separate execution paths; see [code mode](editor.md#code-mode) for their behavior and [third-party notices](../THIRD_PARTY_NOTICES.md) for source provenance.
