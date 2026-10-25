# Prompt mode setup

Prompt mode uses the OpenAI Responses API to suggest shape, color, and texture parameters. The server validates that recipe and encodes a normal 32-byte Squiggle hash. It does not generate or execute JavaScript, and the original artwork algorithm remains unchanged.

## Local setup

Copy `.env.example` to `.env`, then set `NUXT_OPENAI_API_KEY` to a project API key. Restart the development server after editing it. The key is private Nuxt runtime configuration; `.env` is ignored by Git and excluded from Docker builds.

`NUXT_PROMPT_MODEL` defaults to `gpt-6-luna` with low reasoning effort. The request uses structured output, a 1,000-token output limit per attempt (including reasoning), and a 20-second total timeout. A valid result that encodes to the unchanged hash gets one correction attempt with that feedback. Provider errors, refusals, and malformed responses are never retried. A model override must support the same Responses API options and JSON schema.

Luna is the default for interactive speed and low cost. The prompt includes guidance on relative feature heights and attainable palettes, tested with rendered results and parameter preservation checks. `gpt-6-sol` is an optional override for more consistent complex edits, at higher cost and latency. Model outputs are variable, so schema validity and a changed hash alone do not establish that a request was followed.

All other editor features work without a key. Prompt requests return an unavailable message when no key is configured.

## Data and limits

Each generation sends the entered prompt and the current artwork's decoded shape, style, color, and texture parameters to OpenAI. Requests use `store: false`; OpenAI's API data policies still apply. The app does not persist prompts or include them in links. It returns only a validated hash and a flag indicating an approximate palette, and does not expose provider error bodies to the browser.

The endpoint accepts same-origin JSON requests with prompts up to 600 characters and bodies up to 8 KiB. Each server process permits two concurrent calls, at most one per client network, and four attempts per minute per network. Persistent counters cap each network at 20 provider attempts and the entire application at 200 attempts per UTC day, counting failures and corrections. IPv4 addresses are counted individually; IPv6 addresses share their /64 allowance. These limits preserve capacity for other networks. People sharing a NAT or IPv6 network also share an allowance.

Set `NUXT_PROMPT_TRUSTED_PROXIES` to a comma-separated list of the **exact immediate reverse-proxy IP addresses** seen by the application. Only those peers may supply `X-Forwarded-For`; the last hop is used, so client-supplied prefixes cannot change their quota. The proxy must overwrite or append the real client address, and direct access to the app must remain restricted. Do not trust an entire container subnet or a caller-controlled header. The setting accepts IP addresses only, not CIDRs or hostnames. With no trusted proxies configured, forwarding headers are ignored and callers through a proxy conservatively share its allowance. A trusted proxy without a valid appended address fails closed before spending tokens. Configure this before deploying behind a proxy and verify it after a proxy address change. Additional CDN/proxy hops require an explicitly reviewed topology; they are not automatically trusted.

Reservations contain no prompts or raw addresses. Network identifiers are HMAC digests using a fresh private salt for each UTC day; the salt and empty reservation files are retained for a week with private permissions. The salt is quota metadata, not an API credential, and must not be printed or exposed. The existing daily global reservation files remain compatible across rolling updates.

Prompt mode remains anonymous. Network limits mitigate one caller consuming the entire allowance, but a distributed caller with many networks can still use the shared budget. Origin checks are browser protections, not authentication. If verified membership or stronger bot resistance becomes a product requirement, add authenticated entitlements or a server-verified challenge before provider admission; do not relax these hard cost limits.

The counter defaults to `.data/prompt-budget`. Set `NUXT_PROMPT_BUDGET_DIRECTORY` to persistent storage shared by all app instances; exclusive file creation enforces the same cap during rolling deployments. If storage is unavailable, requests fail before calling OpenAI. Do not clear or replace this directory during deployment. The cap limits this app's attempts, not other uses of the key or the provider's bill; configure provider project spending alerts as an additional safeguard. Supply the key at runtime, never in an image, public Nuxt configuration, or source control.

## Fidelity

New subjects choose shape, palette, and style together, prioritizing a recognizable silhouette. Inferred colors and ordinary color adjectives allow nearby hues instead of forcing a texture change. Explicit constraints such as “only blue” may require a compatible style; an explicitly requested style takes precedence. Refinements preserve the groups they do not change. The model can choose 13–21 uniformly spaced vertical controls, a height within the original range, one of the six styles, starting hue, hue spread, Reverse, Hyper, and Ribbed spacing and grayscale. Background and playback speed remain manual controls. The encoder rounds these to valid hash bytes and retains groups the model leaves unchanged. A request for one narrow color family can exceed the script's limits, especially for Fuzzy; the editor reports when it uses the closest attainable palette. Generated results remain approximations, and cannot create closed loops, literal lettering, or colors outside the original algorithm.
