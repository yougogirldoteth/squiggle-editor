# Deployment

[Back to README](../README.md)

## Build and run

```sh
npm ci
npm run build
node .output/server/index.mjs
```

The production server defaults to port 3000. `/health` returns `{"status":"ok","service":"squiggle-editor"}`. The editor needs no database or migrations. The browser holds drafts in memory and writes artwork settings to the URL.

Optional Prompt mode needs a private `NUXT_OPENAI_API_KEY` supplied at runtime and outbound HTTPS access to OpenAI. Set `NUXT_PROMPT_BUDGET_DIRECTORY` to a writable persistent directory, shared by every app instance, so the 200-attempt daily limit survives restarts and rolling deployments. In Docker, mount that directory as a volume writable by the image's `node` user (UID 1000). Without a key, the rest of the editor still works. See [Prompt mode setup and limits](prompt-mode.md).

The [Dockerfile](../Dockerfile) pins Node.js 24.22.1, installs locked dependencies, and copies only the Nuxt output into a non-root runtime image:

```sh
docker build -t squiggle-editor .
docker run --rm -p 3000:3000 squiggle-editor
```

## Hosting configuration

Point your reverse proxy at port 3000 and use `/health` for health checks.

Server addresses, SSH configuration, registry credentials, and instance-specific deployment files belong outside the public repository. The GitHub workflow runs checks only; it does not deploy the application.

## Preview capacity

Artwork source PNGs use an in-memory LRU cache capped at 64 entries and 16 MiB per worker, with a one-day lifetime. Changing hashes still share a limit of 20 cold renders per minute and two in flight. Concurrent requests for the same image share one render. GET and HEAD use the same bytes and headers; a cold HEAD renders once, and subsequent HEAD/GET requests use the cache. A full budget returns an uncached 429 with Retry-After; cached previews remain available. These per-worker bounds complement host/proxy CPU, memory, request-size and connection limits. Do not multiply workers without sizing their aggregate budgets.

## Rotate OG URL signing material

Use a fresh build and a private runtime override when replacing a signing key. A generated build key lives in the server artifact, so reusing an old image alone does not rotate it. Never print runtime configuration, signing keys, environment files or credential-bearing URLs into logs. Do not use the upstream `generate-secret` CLI in a recorded terminal because it prints the value.

Create a new environment file outside the checkout, in an existing private directory:

```sh
node scripts/create-og-signing-secret.mjs /secure/private/squiggle-og-next.env
```

The helper writes `NUXT_OG_IMAGE_SECRET` with 32 random bytes, mode 0600, no secret console output, and refuses overwrites or destinations inside the repository. Import that file into the deployment secret mechanism without displaying its contents. Supply the same new runtime value to all new replicas; never pass it as a Docker build argument or commit it. The OG module reads the runtime override for both SSR URL signing and image validation.

Prepare the release before changing production:

1. Record the previous image digest and preserve the prompt-budget volume. Review the feature-branch commits, run the checks below, and build a fresh image with no production secrets in the build environment.
2. Configure `NUXT_PROMPT_TRUSTED_PROXIES` with the immediate proxy's exact app-facing address and verify its forwarding behavior. Keep direct app ingress private. Confirm the persistent budget directory remains writable by UID 1000.
3. On the authorized deployment, inject the fresh OG runtime key and deploy all serving replicas consistently. Old signed image URLs will stop working; re-fetch page HTML to obtain new URLs. Coordinate a brief switch or cache purge so old HTML does not point to rejected signatures during rollout. Preserve the previous image for application rollback, but retain the **new** key on rollback: restoring the old key restores the exposure.
4. Verify `/health`, normal editor controls and mocked prompt generation in staging. Verify generated page metadata and image HEAD/GET return 200 PNG with the expected dimensions, while unsigned or modified image options and old-key URLs are rejected. Never paste the old or new key into a test command; use private environment injection or a separate synthetic key for staging tests.
5. Check errors, memory and normal previews after the switch. Keep the daily prompt counters across rollback; do not reset them to recover availability. If proxy attribution is incorrect, disable Prompt mode by withholding its provider key while fixing the topology; the manual editor remains available.

Local verification: `npm test -- --maxWorkers=2`, `npm run typecheck`, `npm run build`, then run the existing social-preview and prompt browser tests against the local server. Browser generation tests must mock the provider. Actual live generation and production deployment require separate authorization.
