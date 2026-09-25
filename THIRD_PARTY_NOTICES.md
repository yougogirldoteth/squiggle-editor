# Third-party notices

## Chromie Squiggle

Chromie Squiggle and its original algorithm are by **Snowfro**, released as Art Blocks Project #0 in 2020. Squiggle Editor is an independent local editor and is not affiliated with or endorsed by Snowfro or Art Blocks.

The rendering implementation is a TypeScript/Canvas adaptation informed by these first-party sources, inspected on September 25, 2026:

- [Original Art Blocks generator for token #0](https://generator.artblocks.io/0): serves the original p5 script with the `p5@1.0.0` dependency.
- [Art Blocks token #0 metadata](https://token.artblocks.io/0): identifies the artist, project, token hash, script version, and artwork license.
- [Snowfro's current Canvas renderer](https://snowfro.com/squiggle-render/sketch.js): an optimized native Canvas port used as a secondary reference.
- [Snowfro's Chromie Squiggle project page](https://www.snowfro.com/projects/chromie-squiggle): artist attribution and project context.

The 5,519-byte project script embedded in the Art Blocks generator had SHA-256:

```text
d6e475f342854bcc8424867a97965e1bca31b79971c71a21456d8c1a9b230390
```

This identifies the retrieved script, excluding its HTML template, token data, and p5 library. The reference was fetched from Art Blocks' generator; it was not independently recovered from an Ethereum node for this project.

### Algorithm and rendering scope

The adaptation preserves hash decoding, type precedence, fractional segment counts, Catmull–Rom geometry, inclusive sample loops, endpoint conditions, hue calculations, and the original seeded Fuzzy distribution. Fuzzy uses the original JavaScript seed conversion and signed bitwise shifts, restarts the random sequence per segment, and makes its third random draw only when the distance test passes.

The original p5 renderer and Snowfro's newer Canvas port are distinct implementations. This editor uses the original fuzzy opacity of `20/255`; the newer port rounds its CSS opacity to `0.078`. Native Canvas replaces p5 drawing calls, and responsive layout and interaction are editor features. Algorithm fidelity does not imply pixel identity across browser engines, rendering libraries, or display densities.

### License information

Art Blocks' token metadata labels the artwork license **“NFT License.”** Its collection metadata supplies no license URL. Neither inspected renderer included an explicit permissive software license. Snowfro's project page describes its downloadable token images as free to integrate; this does not supply an explicit software license for the algorithm.

These notices preserve attribution and record the available license information. This project does not grant or relicense rights to Snowfro's algorithm, artworks, or third-party names. No blanket open-source license is asserted for that material.

## Dependencies

Nuxt, Vue, and the development tools retain their respective licenses. Their resolved versions are recorded in `package-lock.json`; license texts are supplied by the installed packages. The original p5 runtime is a reference dependency of the Art Blocks generator, not a runtime dependency of this editor.
