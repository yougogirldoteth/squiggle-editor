# Using the editor

[Open Squiggle Editor](https://squiggle.worldcomputer.art) · [Back to README](../README.md)

## Controls

Choose **Normal, Bold, Slinky, Ribbed, Pipe, or Fuzzy**, then use the four tabs:

| Tab | Controls |
| --- | --- |
| Color | Starting hue, color spread, Reverse, and Hyper. |
| Shape | Length, Height, and a point selector with vertical position. |
| Texture | Spacing and grayscale rib color, available for Ribbed. |
| View | Animation speed and eleven grayscale backgrounds. |

Grab the curve and pull vertically, or select a visible point and drag it. Points keep the horizontal spacing required by the original script. Clicking outside the canvas dismisses the handles. Custom code previews do not have these drag handles.

**New squiggle** randomizes the hash. **Reset squiggle** restores the hash loaded when the page opened, including a valid hash from the URL. It does not reset a custom script; use **Reset original code** for that.

## Keyboard and history

| Action | Shortcut |
| --- | --- |
| Select a point with the canvas focused | Left / Right |
| Move the selected point vertically | Up / Down |
| Move in larger steps | Shift + Up / Down |
| Cancel an active drag | Escape |
| Undo an artwork edit | ⌘/Ctrl Z |
| Redo an artwork edit | ⌘/Ctrl Shift Z |
| Run the code editor's draft | ⌘/Ctrl Enter |

A completed drag or drawing is one undo step. Inside the code editor, undo and redo apply to the text instead. Play/Pause, background, and speed are view settings rather than hash-history entries.

## Draw mode

Choose **Draw** in the canvas toolbar, then draw one continuous line with a mouse, finger, or pen. Release to fit it to a valid hash. The drawing briefly appears as a dotted guide over the result. Draw another line to replace it, or turn Draw off to resume pulling individual points.

The fitter searches the original script's control-point counts and height range. It scales and centers your line into the artwork area, preserving its proportions until it reaches the script's height limit. The original curve has evenly spaced horizontal controls and cannot double back: loops, vertical sections, and fine details are approximated. There is no guarantee of an exact match or a globally optimal hash.

Color and type settings are retained. Changing the length can change how far the color sequence progresses, and changing the geometry also changes Fuzzy's random seed. The fit only changes geometry bytes; it does not modify the original script or mint a token. Drawing and fitting happen locally, without uploading your stroke.

Draw pauses animation. **Escape** cancels an unfinished stroke; press it again to leave Draw. Undo during a stroke cancels just that stroke. Taps, browser-interrupted touches, resizing, and changes to the hash discard unfinished drawings. Completed results work with the existing hash links, controls, code highlighting, export, and undo/redo. Raw strokes are not saved in links or included in exports.

Draw is available with the original renderer, including when the code pane is open. When custom code is running, use **Reset original code** before drawing.

## Hashes and links

The hash bar accepts `0x` followed by 64 hexadecimal characters. Paste a hash and press **Enter** or the load button; the copy button copies the current hash. With code mode open in compact phone or short landscape layouts, the bar is hidden to make room for the editor. The current hash remains available in the page URL.

The address bar follows these settings:

| Query parameter | Meaning |
| --- | --- |
| `hash` | Artwork geometry and traits. |
| `bg` | One of the supported grayscale backgrounds, as six hex digits. |
| `speed` | Animation speed from 0.1 to 20. |
| `code=1` | Open the code pane. |

A link reopens the artwork paused at animation phase zero. Custom source, undo history, selected points, and animation phase are not stored in the URL. A localhost link only works on a machine running the app.

Editing a hash explores the algorithm; it does not mint a Chromie Squiggle token.

## Code mode

The **Code** button opens `squiggle.js` beside the artwork on wide screens and below it on phones. The filename is an editor label. The document contains only a formatted copy of Snowfro's verified source, with no generated comments, token data, or wrapper.

Control changes and point edits briefly highlight the affected original expressions and bring them into view. They update the hash or view settings, not the script text. Manual scrolling lets you inspect another part of the script; interacting with the controls resumes following.

Edit the source, then choose **Run** or press **⌘/Ctrl Enter**. Edits remain a draft until you run them. Closing the code pane preserves that draft within the current page, but refreshing or navigating away discards it. **Copy** copies the displayed source, including any unapplied edits.

Custom source runs in a separate, sandboxed iframe with the bundled p5.js runtime. The preview supplies `tokenData.hashes` and the view context separately. The copied script still needs p5.js and token data if you run it elsewhere.

Hash edits and canvas-size changes restart a custom sketch so its initial declarations can use the new input. Background, speed, and play/pause update in place when those inputs remain managed by the editor. Explicit custom declarations or writes take precedence. Custom code can change drawing behavior beyond what a hash can represent.

### Custom-code boundaries

Custom code runs only in your browser after you choose **Run**. It is never evaluated on the server or loaded from a shared URL. The iframe has an opaque origin: it cannot read the editor document, cookies, or local storage. Its sandbox blocks popups, top-level navigation, forms, and direct downloads. A policy on the editor page also blocks the preview from navigating itself to an external document. The preview's own policy restricts scripts to the bundled p5 file and inline code, and blocks fetch, remote images, external frames, and workers.

This is not a hardened service for executing arbitrary hostile JavaScript. Run code you trust: a script can still consume CPU or memory and freeze its tab, and content-security policies are not a complete network firewall for every browser API (including WebRTC). The sandbox does not provide a CPU quota or protect against browser vulnerabilities.

The **Export** button accepts only a response from the current preview for an outstanding export request. The editor checks image structure and dimensions, decodes it, and creates a fresh PNG from the pixels before downloading `squiggle-custom-<hash>.png`. Metadata and arbitrary returned bytes are not passed through. Restarting or resetting the preview cancels pending exports.

## Export

| Mode | PNG output |
| --- | --- |
| Standard renderer | 3000 × 2000, fixed 3:2 frame and 5% outer margin. |
| Custom code | The running p5 canvas at its current pixel dimensions. |

Downloads are named `squiggle-<hash>.png`, or `squiggle-custom-<hash>.png` for custom code, using the full hash captured when Export is clicked.

Exports use the current background and animation phase and omit the editing guides. Custom export captures the last applied code, not an unapplied draft. Browser rendering and device pixel ratio can affect the pixels; see [rendering fidelity](rendering.md#rendering-fidelity).

Custom exports are limited to 8192 pixels per side and 16,777,216 total pixels, with a 32 MiB limit on the encoded response. Invalid images and animated PNGs are rejected.

## Link previews

Shared links show the hash and background encoded in their URL as a 1200 × 630 social image, without added text. The image uses the standard PNG export composition, fitted without cropping, at animation phase zero. A link without a hash uses the editor's default artwork. Custom code and the current animation phase are browser-only and are not included in shared links. Server and browser rasterization can differ slightly.
