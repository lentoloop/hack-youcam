# Before Another Bottle

A phone-first cosmetic shopping prototype: four YouCam observations, three generic product cards, and one explainable next step. Goal and ownership changes run locally through the shared decision engine without another API call. English UI; no diagnosis, invented score thresholds, or real face photos in this repository.

## Run

Requires Node.js 20.19+ (or 22.12+) and npm.

```sh
cd web
npm install
npm run dev
```

Development defaults to a clearly labeled Mock fetch stub and needs no service/key. Try Sample (pre-analyzed) for synthetic observations without an API call. For the separately owned local service at port 8787:

```sh
cd web
VITE_USE_SERVICE=true npm run dev
```

Configure server `YOUCAM_MODE=mock|live` and credentials using `.env.example` when S1 supplies it. Never put API keys in browser variables. Production uses same-origin `/api`. The web build does not provision or deploy a service.

## Verify

```sh
cd web
npm install
npx tsc --noEmit -p .
npx vitest run
npm run build
```

If the environment has a read-only npm cache, add `--cache /tmp/youcam-npm-cache` to npm install. Tests cover dimensions, all error codes, provenance, and an injected ownership decision with zero fetches. Build output is `web/dist`.

## Integration status and reused components

The frozen `contracts/`, S1-owned `shared/decide.ts`, and `shared/products.ts` are reused directly. The decision engine is currently a stub: the full ownership aha requires S1 implementation. Tests inject outcomes; production does not substitute its own rules. Vite, TypeScript, Vitest and jsdom are third-party development tools. UI and CSS silhouette are original; no stock faces, product packaging, or external fonts are included.

Read [architecture](docs/ARCHITECTURE.md), [privacy](docs/PRIVACY.md), and the [demo script](docs/DEMO-SCRIPT.md). Immediate server deletion on page exit requires a contract decision because no deletion route exists. Provider source-image retention is UNCONFIRMED; live readiness requires verification.

## Judge instructions (release placeholders)

- Judge URL: **TBD — not deployed**; maintain through 2026-11-21 13:00 Asia/Taipei.
- Access code, if needed: **TBD — distribute securely**, never commit secrets.
- Public video and four screenshots: **TBD**.
- Start with labeled Sample for a zero-unit walkthrough. For genuine analysis, consent and use a permitted selfie, then wait for Live observations. Select a concern, toggle Already own, and expand evidence. A timed-out job can be resumed within the same page session.
- Live service, decision engine, provider retention and hosting readiness: **pending S1/release verification**.

MIT, copyright 2026 wu. No accounts, push, or deployment are performed by this implementation.
