# Squiggle Editor

A little room for color. Explore the Chromie Squiggle algorithm by Snowfro: pull the curve, change its colors and texture, or open the original script and experiment with the code.

**[Open the editor →](https://squiggle.worldcomputer.art)**

- Six styles: Normal, Bold, Slinky, Ribbed, Pipe, and Fuzzy.
- Mouse, touch, and keyboard editing, with undo and redo.
- Hash-based artwork editing, shareable URLs, and PNG export.
- Editable code mode with syntax highlighting and live navigation to affected expressions.

An independent project by **ygg**, built with Nuxt, Vue, and Canvas. No account, wallet, or database required. Not affiliated with or endorsed by Snowfro or Art Blocks.

## Run locally

Use Node.js **24.14.0** (see [`.nvmrc`](.nvmrc)) and npm. No environment variables or credentials are needed.

```sh
npm ci
npm run dev
```

Open [localhost:3021](http://localhost:3021). If you use nvm, run `nvm use` first.

## Two ways to explore

**Controls and dragging** edit a 32-byte hash using the original algorithm's rules. Copy the hash or the page URL to return to the artwork. The standard renderer exports a 3000 × 2000 PNG.

**Code mode** shows a formatting-only copy of the verified on-chain script. Changing a control highlights the relevant expressions without rewriting that source. Edit the script and press **Run** or **⌘/Ctrl Enter** to preview custom code with p5.js 1.0.0. **Reset original code** returns to the standard renderer.

Custom code is separate from the hash: it is not saved in the URL or across page reloads. Copy your code before leaving. A custom PNG export captures the running p5 canvas at its current size. Run code you trust; see the [sandbox and export boundaries](docs/editor.md#custom-code-boundaries).

## Development

```sh
npm test -- --maxWorkers=2
npm run typecheck
npm run build
```

For browser tests, install Chrome with `npx playwright install chrome`, keep the development server running in another terminal, then run `npm run test:e2e`. To try the production build, stop the development server and run `npm run preview`.

## Documentation

- [Using the editor](docs/editor.md) — controls, keyboard shortcuts, code mode, and sharing.
- [Hash and rendering reference](docs/rendering.md) — byte mappings, fidelity, and implementation boundaries.
- [Contributing](CONTRIBUTING.md) — setup, checks, and where the code lives.
- [Deployment](docs/deployment.md) — Docker and the hosted instance's Kamal configuration.
- [Third-party notices](THIRD_PARTY_NOTICES.md) — original source verification, attribution, and dependency licenses.

## Credits and license

Chromie Squiggle and its original algorithm are by **[Snowfro](https://www.snowfro.com/projects/chromie-squiggle)**. The original on-chain source and its verification record are included in [`app/data`](app/data).

This project's original contributions are [MIT licensed](LICENSE). That grant excludes Snowfro's source and derived algorithm, artwork, and bundled third-party dependencies; their rights and terms remain separate. No general software redistribution license for Snowfro's script has been established by this project. See the [license scope and notices](THIRD_PARTY_NOTICES.md#license-scope) before redistributing it.
