# Prompt mode setup

Prompt mode uses the OpenAI Responses API to suggest shape, color, and texture parameters. The server validates that recipe and encodes a normal 32-byte Squiggle hash. It does not generate or execute JavaScript, and the original artwork algorithm remains unchanged.

## Local setup

Copy `.env.example` to `.env`, then set `NUXT_OPENAI_API_KEY` to a project API key. Restart the development server after editing it. The key is private Nuxt runtime configuration; `.env` is ignored by Git and excluded from Docker builds.

`NUXT_PROMPT_MODEL` defaults to `gpt-6-luna` with low reasoning effort. The request uses structured output, a 1,000-token output limit per attempt (including reasoning), and a 20-second total timeout. A valid result that encodes to the unchanged hash gets one correction attempt with that feedback. Provider errors, refusals, and malformed responses are never retried. A model override must support the same Responses API options and JSON schema.

Luna is the default for interactive speed and low cost. The prompt includes guidance on relative feature heights and attainable palettes, tested with rendered results and parameter preservation checks. `gpt-6-sol` is an optional override for more consistent complex edits, at higher cost and latency. Model outputs are variable, so schema validity and a changed hash alone do not establish that a request was followed.

All other editor features work without a key. Prompt requests return an unavailable message when no key is configured.

## Data and limits

Each generation sends the entered prompt and the current artwork's decoded shape, style, color, and texture parameters to OpenAI. Requests use `store: false`; OpenAI's API data policies still apply. The app does not persist prompts or include them in links. It returns only a validated hash and a flag indicating an approximate palette, and does not expose provider error bodies to the browser.

The endpoint accepts same-origin JSON requests with prompts up to 600 characters and bodies up to 8 KiB. Each server process permits two concurrent calls and four attempts per minute per network address. A persistent counter caps provider attempts at 200 per UTC day, counting failures and corrections. It stores empty reservation files only, with no prompts, addresses, or credentials, and retains a week of counters. Caller-supplied `X-Forwarded-For` is ignored, so visitors behind a reverse proxy share its address limit.

The counter defaults to `.data/prompt-budget`. Set `NUXT_PROMPT_BUDGET_DIRECTORY` to persistent storage shared by all app instances; exclusive file creation enforces the same cap during rolling deployments. If storage is unavailable, requests fail before calling OpenAI. Do not clear or replace this directory during deployment. The cap limits this app's attempts, not other uses of the key or the provider's bill; configure provider project spending alerts as an additional safeguard. Supply the key at runtime, never in an image, public Nuxt configuration, or source control.

## Fidelity

New subjects choose shape, palette, and style together, prioritizing a recognizable silhouette. Inferred colors and ordinary color adjectives allow nearby hues instead of forcing a texture change. Explicit constraints such as “only blue” may require a compatible style; an explicitly requested style takes precedence. Refinements preserve the groups they do not change. The model can choose 13–21 uniformly spaced vertical controls, a height within the original range, one of the six styles, starting hue, hue spread, Reverse, Hyper, and Ribbed spacing and grayscale. Background and playback speed remain manual controls. The encoder rounds these to valid hash bytes and retains groups the model leaves unchanged. A request for one narrow color family can exceed the script's limits, especially for Fuzzy; the editor reports when it uses the closest attainable palette. Generated results remain approximations, and cannot create closed loops, literal lettering, or colors outside the original algorithm.
