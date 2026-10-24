# Before Another Bottle architecture

The phone-first Vite app uses strict TypeScript and browser DOM APIs, with no runtime UI framework. Frozen types/constants come from `contracts/`; the pure decision engine and three generic cards come from `shared/`. S2 does not modify those modules. The renderer uses the real shared decision engine for ownership and severe-symptom escalation; local e2e tests verify its decisions.

## Flow

Consent (versioned, timestamped) → camera/upload → EXIF-oriented bitmap → proportional downsize (never upscale) → JPEG re-encode without original metadata → multipart POST `/api/analyses` → GET job every 10 seconds → raw provider observations → local goal/ownership/symptom inputs → `decide()` → one next step with expandable evidence. The short side must remain at least 480px, long side at most 2560px, JPEG at most 5 MiB. Face width over 60% is capture guidance; provider validation remains authoritative.

At two minutes the UI retains the job ID in memory and offers resume, without creating another task. End-session, page exit, or 30 minutes sends DELETE with keepalive and clears browser-held results and identifiers. Resume works within the current page session, not after closing/reloading. Changing ownership never calls the API. Failed and quota states remain explicit; a user must choose the labeled sample.

## Modes and integration

`YOUCAM_MODE=mock|live` is a server-only adapter setting. Live requires the server-side key described in `.env.example`; no key belongs in Vite variables. Default `npm run dev` proxies `/api` to `http://localhost:8787`. Run `npm run dev` in service for the local Miniflare mock worker and ephemeral D1. Production builds always use same-origin `/api`; service responses supply Live/Mock provenance. No silent fallback.

Sample is a separate built-in fixture: synthetic numbers, labeled Sample (pre-analyzed), with a CSS silhouette framing placeholder and no real face photograph. It makes zero API requests. It is not evidence of a successful provider integration.

## Budget and privacy boundaries

Four SD actions cost 9 units per successful run. Hard budget: 990/1000 units; 10 untouched. Reserve 450 units for 50 judge runs. Remaining allocations: integration 108, recording 72, public 180, repair 180. S1 service owns atomic reservations, concurrency two, two live runs/IP/day, deduplication, and retained provider task IDs; the browser cannot enforce budget controls.

Images/results are session-only and deleted on exit or after 30 minutes. Browser keeps no image URLs, localStorage, analytics, or result logs. The server must enforce matching 30-minute deletion, avoid image/URL logs and backups, and retain only allowed task/quota accounting. Provider retention is unconfirmed. Provider source-image retention: **UNCONFIRMED**. Live release requires confirmation; app deletion is not a provider deletion promise.

## Release checks

S1 engine integration, actual live success, service retention/budget checks, phone camera/EXIF rehearsal and free hosting remain release gates. No deployment is performed by S2. Judge URL must remain available through 2026-11-21 13:00 Asia/Taipei.
