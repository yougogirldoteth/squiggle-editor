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

The [Dockerfile](../Dockerfile) uses Node.js 24.14.0, installs locked dependencies, and copies only the Nuxt output into a non-root runtime image:

```sh
docker build -t squiggle-editor .
docker run --rm -p 3000:3000 squiggle-editor
```

## Hosting configuration

Point your reverse proxy at port 3000 and use `/health` for health checks.

Server addresses, SSH configuration, registry credentials, and instance-specific deployment files belong outside the public repository. The GitHub workflow runs checks only; it does not deploy the application.
