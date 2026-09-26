# Contributing

## Setup

Use the Node version in [`.nvmrc`](.nvmrc), then install the locked dependencies:

```sh
npm ci
npm run dev
```

The app runs at [localhost:3021](http://localhost:3021). Local development needs no environment file, wallet, RPC endpoint, database, or production access.

## Checks

```sh
npm test -- --maxWorkers=2
npm run typecheck
npm run build
```

The unit suite includes exhaustive byte mappings and comparisons against the original script and vendored p5 drawing primitives. Limiting workers avoids unnecessary CPU contention in those VM-based tests.

For browser coverage:

```sh
npx playwright install chrome
# Keep npm run dev running in another terminal.
npm run test:e2e
```

Playwright uses Google Chrome, including desktop and mobile viewport tests and touch emulation. These are not Safari or real iOS device tests. GitHub's checks workflow runs the unit, type, build, and browser checks without deployment credentials.

The production preview uses port 3021 too. Stop the development server before running `npm run preview` after a build.

## Code map

| Path | Responsibility |
| --- | --- |
| `app/app.vue` | Editor state, controls, hash history, and URL state. |
| `app/components/SquiggleCanvas.vue` | Native canvas lifecycle, pointer and keyboard editing, and standard PNG export. |
| `app/utils/squiggle.ts` | Hash decoding, constrained edits, and the native rendering adaptation. |
| `app/components/CodePanel.vue` | CodeMirror editing, highlighting, and navigation. |
| `app/utils/liveSketch.ts` | Original source display and mapping edits to relevant expressions. |
| `app/components/ScriptPreview.vue` | Isolated p5 execution and custom PNG export. |
| `app/utils/pngExport.ts` | Bounded image validation and fresh PNG encoding for custom exports. |
| `app/utils/previewContext.ts` | Which view inputs custom code owns. |
| `app/data` | Original source, formatting-only copy, and provenance record. |
| `public/vendor` | Unmodified p5 runtime, matching source, and license. |
| `tests` | Unit, fidelity, and browser regressions. |

## Changes to the renderer or original source

Keep the source in `app/data/snowfro-script.js` unchanged. The formatted copy must preserve its syntax and original comments; tests verify the digest and syntax tree. Changes to the editor belong in the host code, not in a rewritten version of the original script.

Hash controls must remain representable by the original algorithm. Preserve unrelated bytes, style precedence, fractional lengths, and Fuzzy's seeded behavior. Consult the [rendering reference](docs/rendering.md) and run the relevant fidelity tests when changing these paths.

For interface changes, check narrow phones, landscape, keyboard input, reduced motion, and code mode. Reuse existing regression coverage and add a focused test when fixing a behavioral bug.

## Licenses and repository hygiene

Original contributions use the [MIT license](LICENSE), subject to the [third-party scope](THIRD_PARTY_NOTICES.md#license-scope). Preserve upstream notices and do not label Snowfro's script or its derived algorithm as MIT licensed.

Keep credentials, `.env` files, dependencies, build output, test artifacts, and local work files out of commits. Deployment access is not needed to contribute. Describe what changed and how you verified it; use concise commit subjects in plain English.
