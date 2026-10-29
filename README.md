# Breakout Log

A phone-first cosmetic appearance log. Record recent product changes, self-reported areas and discomfort, YouCam observations, and what remains unknown. Breakout Log does not diagnose a condition, identify which product caused a change, recommend stopping a product, or report improvement percentages.

The TypeScript frontend uses Vite and vanilla DOM APIs. The service runs on Cloudflare Workers with D1. Sample uses pre-analyzed observations from a synthetic AI face. Mock uses synthetic fixtures and never contacts the provider.

## Run locally

Use Node.js 22.13 or newer and npm. Install dependencies in each package:

```sh
npm ci
(cd service && npm ci)
(cd web && npm ci)
```

Run `npm run dev` in `service/` and `web/` in separate terminals. Open the Vite URL. Its development proxy forwards `/api` to the local service on port 8787. Local service startup creates ephemeral D1, applies all five migrations, and blocks outbound provider requests.

## Verify offline

```sh
bash scripts/verify-release.sh
```

This runs contracts, service and web typechecks, service/shared tests, Miniflare/workerd end-to-end tests, web/shared tests, the web build, and fresh SQLite migration checks. It never submits a paid provider task.

The offline checkpoint decodes bundled PNG masks and renders the web results card:

```sh
cd service
IN=fixtures/run2-normalized.json OUT_DIR=/tmp/breakout-checkpoint npm run checkpoint:breakout
```

## Privacy and deployment

Logs stay in browser memory until cleared, page exit, or the 30-minute session limit. Download/import JSON lets users keep observations, labels, self-report text and derived numbers on their own device. Exports contain no photos, masks, provider URLs or task IDs. Start dates must be valid before downloading.

Demo faces and sample observations are AI-generated, not real-person photographs. Open `?demo=synthetic` to display the disclosure. Keep original image provenance when publishing demo materials.

See [deployment](docs/DEPLOY.md), [privacy](docs/PRIVACY.md), and [architecture](docs/ARCHITECTURE.md). Deployment starts in mock mode. Live uploads require separate authorization and consume provider units.
