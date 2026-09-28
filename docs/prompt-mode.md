# Prompt mode setup

Prompt mode uses the OpenAI Responses API to suggest shape, color, and texture parameters. The server validates that recipe and encodes a normal 32-byte Squiggle hash. It does not generate or execute JavaScript, and the original artwork algorithm remains unchanged.

## Local setup

Copy `.env.example` to `.env`, then set `NUXT_OPENAI_API_KEY` to a project API key. Restart the development server after editing it. The key is private Nuxt runtime configuration; `.env` is ignored by Git and excluded from Docker builds.

`NUXT_PROMPT_MODEL` defaults to `gpt-6-luna`. The request uses structured output, no reasoning tokens, a 1,000-token output limit, and a 20-second timeout. There are no automatic retries. A model override must support the same Responses API options and JSON schema.

All other editor features work without a key. Prompt requests return an unavailable message when no key is configured.

## Data and limits

Each generation sends the entered prompt and the current artwork's decoded shape, style, and color parameters to OpenAI. Requests use `store: false`; OpenAI's API data policies still apply. The app does not persist prompts or include them in links. It returns only a validated hash and a flag indicating an approximate palette, and does not expose provider error bodies to the browser.

The endpoint accepts same-origin JSON requests with prompts up to 600 characters and bodies up to 8 KiB. It permits two concurrent calls, four attempts per minute per network address, and 200 attempts per UTC day **per server process**, counting provider failures. These counters reset when the process restarts; they are abuse guards, not a persistent billing budget. Caller-supplied `X-Forwarded-For` is ignored, so visitors behind a reverse proxy share its address limit.

Before enabling this on a public deployment, configure project spending controls with the provider and choose appropriate persistent, shared rate limiting for the hosting setup. Multiple server processes each have their own counters. Supply the key at runtime, never in an image, public Nuxt configuration, or source control.

## Fidelity

The model chooses 13–21 uniformly spaced vertical controls, a height within the original range, one of the six styles, and a hue progression. The encoder rounds these to valid hash bytes and retains groups the model leaves unchanged. A request for one narrow color family can exceed the script's limits, especially for Fuzzy; the editor reports when it uses the closest attainable palette. Generated results remain approximations, and cannot create closed loops, literal lettering, or colors outside the original algorithm.
