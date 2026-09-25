# Squiggle Editor

A single-screen Nuxt editor for exploring the Chromie Squiggle algorithm by Snowfro. Shape the curve, choose a texture, and change its colors; every artwork edit stays representable by its 32-byte hash. The responsive interface supports mouse, touch, and keyboard input.

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
- Grab the curve and pull vertically. The guides show the fixed horizontal spacing and vertical editing direction. Focus the canvas to use **Left/Right** to select a point and **Up/Down** to move it; hold **Shift** for a larger step. **Escape** cancels an active gesture.
- Use Undo/Redo, or **Ctrl/Command Z** and **Ctrl/Command Shift Z**. A completed drag is one history step.
- Copy the hash, or paste a hash into its field and press **Enter** or **Load**. A valid hash is `0x` followed by 64 hexadecimal characters.
- **New squiggle** randomizes the hash. **Reset** restores the hash loaded when the page opened, including a valid hash supplied in the URL.
- Use Play/Pause and the background swatches to change the view. **Export** saves a PNG with the current background and animation phase, without editing guides.
- **Share** copies a URL containing `?hash=…&bg=…`. It pauses the animation and resets its phase to zero so opening that URL reproduces the canonical starting colors. The link uses the current host; a localhost link requires this app running on the recipient's machine.

## What the hash preserves

The original algorithm uses evenly spaced horizontal control points and byte-derived vertical values. Dragging fits nearby control values, rounds them to whole bytes, and clamps them to the original range. It cannot add points, change their horizontal spacing, or create an arbitrary path. Editing early shape bytes can also change Fuzzy's seeded texture.

The hash contains the artwork's geometry and traits. Background, animation state, animation phase, and viewport size are separate view settings. Importing the exported hash reconstructs the same artwork at the same viewport and view settings; Share deliberately uses phase zero. Resizing fits the original 3:2 drawing area inside the available canvas.

The renderer follows the original algorithm served by Art Blocks, including its sampling and random-number quirks. It uses native Canvas rather than the original p5 runtime. Browser rasterization, antialiasing, and device pixel ratios can differ, so this project does not claim pixel-identical output across renderers or devices. An edited hash is an algorithmic study, not a newly minted Chromie Squiggle token.
