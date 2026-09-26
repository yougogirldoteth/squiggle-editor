# Third-party notices

## Chromie Squiggle

Chromie Squiggle and its original algorithm are by **Snowfro**, released as Art Blocks Project #0 in 2020. Squiggle Editor is an independent local editor and is not affiliated with or endorsed by Snowfro or Art Blocks.

The rendering implementation is a TypeScript/Canvas adaptation informed by these first-party sources, inspected on September 25, 2026:

- [Original Art Blocks generator for token #0](https://generator.artblocks.io/0): serves the original p5 script with the `p5@1.0.0` dependency.
- [Art Blocks token #0 metadata](https://token.artblocks.io/0): identifies the artist, project, token hash, script version, and artwork license.
- [Snowfro's current Canvas renderer](https://snowfro.com/squiggle-render/sketch.js): an optimized native Canvas port used as a secondary reference.
- [Snowfro's Chromie Squiggle project page](https://www.snowfro.com/projects/chromie-squiggle): artist attribution and project context.

On September 26, 2026, the script was independently retrieved from Ethereum mainnet contract [`0x059edd72cd353df5106d2b9cc5ab83a52287ac3a`](https://etherscan.io/address/0x059edd72cd353df5106d2b9cc5ab83a52287ac3a#code), project 0, at finalized [block 26,062,124](https://etherscan.io/block/26062124). `projectScriptInfo(0)` identified one script, a locked project, and the `p5js` dependency at version `1.0.0`. `projectScriptByIndex(0, 0)` returned exactly the same 5,519 UTF-8 bytes as the Art Blocks generator, with SHA-256:

```text
d6e475f342854bcc8424867a97965e1bca31b79971c71a21456d8c1a9b230390
```

The unmodified source is retained in `app/data/snowfro-script.js`. `app/data/snowfro-provenance.json` records the contract, chain, block number and hash, read calls, source digest, and comparison with the generator. The digest covers only Snowfro's project script, excluding the HTML template, token data, and p5 library.

### Code mode

Code mode displays `app/data/snowfro-script.formatted.js`, a formatting-only copy of the verified source produced with Prettier 3.8.1 for readability. The exact source remains available separately. The displayed and copied document contains only that formatted source, with no added comments, declarations, or wrapper. Token data and view settings are provided separately by the preview host, outside the editable script. Form controls highlight the affected original expressions without rewriting the source. Custom code runs with the bundled p5 runtime rather than the editor's native Canvas adaptation.

### Collection examples

The six type thumbnails depict existing collection tokens, using hashes and type labels verified against first-party Art Blocks metadata on September 25, 2026:

| Type | Token and source |
| --- | --- |
| Normal | [Chromie Squiggle #0](https://token.artblocks.io/0) |
| Bold | [Chromie Squiggle #20](https://token.artblocks.io/20) |
| Slinky | [Chromie Squiggle #5](https://token.artblocks.io/5) |
| Ribbed | [Chromie Squiggle #10](https://token.artblocks.io/10) |
| Pipe | [Chromie Squiggle #74](https://token.artblocks.io/74) |
| Fuzzy | [Chromie Squiggle #7](https://token.artblocks.io/7) |

The hashes are bundled in `app/utils/examples.ts` and decoded with the editor's original trait rules. Thumbnails are rendered locally with the same renderer as the artwork, at animation phase zero, then cropped to their visible bounds and uniformly scaled to fit. Their curve shapes, colors, and textures are not replaced by illustrative paths. No external image request is needed at runtime. Selecting a type changes the current artwork's style; it does not import the example token's hash.

### Algorithm and rendering scope

The adaptation preserves hash decoding, type precedence, fractional segment counts, Catmull–Rom geometry, inclusive sample loops, endpoint conditions, hue calculations, and the original seeded Fuzzy distribution. Fuzzy uses the original JavaScript seed conversion and signed bitwise shifts, restarts the random sequence per segment, and makes its third random draw only when the distance test passes.

The original p5 renderer and Snowfro's newer Canvas port are distinct implementations. This editor uses the original fuzzy opacity of `20/255`; the newer port rounds its CSS opacity to `0.078`. Circle paths reproduce p5 1.0.0's four cubic Bézier segments, and hue conversion preserves its color rounding. Native Canvas replaces p5 drawing calls, and responsive layout and interaction are editor features. Algorithm fidelity does not imply pixel identity across browser engines, rendering libraries, or display densities.

### License information

Art Blocks' token metadata labels the artwork license **“NFT License.”** Its collection metadata supplies no license URL. Neither inspected renderer included an explicit permissive software license. Snowfro's project page describes its downloadable token images as free to integrate; this does not supply an explicit software license for the algorithm.

These notices preserve attribution and record the available license information. This project does not grant or relicense rights to Snowfro's algorithm, artworks, or third-party names. No blanket open-source license is asserted for that material.

## Dependencies

### p5.js

Code mode uses the p5.js dependency distributed as version **1.0.0**, matching the version specified by the on-chain project. The runtime, corresponding unminified source, and GNU Lesser General Public License version 2.1 text are bundled without modification:

| Local file | Upstream source |
| --- | --- |
| `public/vendor/p5-1.0.0.min.js` | [cdnjs p5.js 1.0.0](https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.0.0/p5.min.js), also verified against [the npm package](https://unpkg.com/p5@1.0.0/lib/p5.min.js) |
| `public/vendor/p5-1.0.0.js` | [Unminified p5.js source](https://unpkg.com/p5@1.0.0/lib/p5.js) |
| `public/vendor/p5-LICENSE.txt` | [Upstream LGPL 2.1 license](https://unpkg.com/p5@1.0.0/license.txt) |

The minified runtime has SHA-256 `3e0d5d8be7c1179dd16e1f68651fc5783d71b05cd32c2f7ade571a7350f489ab`. Both upstream JavaScript files carry a `p5.js v0.10.2 February 29, 2020` banner despite their 1.0.0 distribution URLs; that banner is preserved verbatim. The bundled unminified source includes upstream third-party notices.

### CodeMirror and Lezer

[CodeMirror 6](https://codemirror.net/) supplies the code editor and JavaScript language support; [Lezer](https://lezer.codemirror.net/) supplies syntax highlighting. The installed `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-javascript`, and `@lezer/highlight` packages are MIT-licensed. Exact package versions are recorded in `package-lock.json`.

CodeMirror copyright (C) 2018–2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others. Lezer highlight copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others.

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

### Other dependencies

Nuxt, Vue, and the development tools retain their respective licenses. Their resolved versions are recorded in `package-lock.json`; license texts are supplied by the installed packages.
