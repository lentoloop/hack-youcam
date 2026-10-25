# Breakout Log (working title)

A phone-first cosmetic appearance log: record recent product changes, self-reported areas and discomfort, YouCam observations, and what is still unknown. It cannot identify which product caused a change and provides no diagnosis, stop order, or improvement percentages.

The strict TypeScript Vite frontend uses vanilla DOM APIs. Logs stay in memory until cleared, page exit, or the 30-minute session limit. Download/import JSON lets users keep a record on their own device. Files contain observations, labels, self-report text and derived numbers; no photos, masks, provider URLs or task IDs. Start dates must be valid before downloading.

With existing dependencies, run `cd web && npm run dev`; the `/api` proxy expects the local service on port 8787. Run `npm run dev` in service for its mock worker. Sample is explicitly labeled and uses run2 pre-analyzed observations without uploading or making an API call. Mock is test data; neither is a live baseline.

Verification:

```sh
./service/node_modules/.bin/tsc -p tsconfig.contracts.json
cd service
./node_modules/.bin/tsc -p tsconfig.json
npm test                         # 59 service + 5 shared tests
npm test -- ../tests/shared       # shared suite alone
npm run test:e2e                  # offline Miniflare integration
cd ../web
./node_modules/.bin/tsc -p tsconfig.json
npm test                         # web and shared tests
npm run build
```

Tests cover strict log import, framing comparison refusals, the real run2 mask fixture, a mocked browser upload, numbers-only download and deletion. No live API call is required.

## Demo images

Demo images in `/workspace/eng/youcam-demo-face/` are AI-generated synthetic faces, not a real person. Created with Grok. No real-person photo was used. Keep C2PA provenance on published originals: browser upload re-encoding strips metadata, so publish only the unmodified originals. Open the demo with `?demo=synthetic` to show the on-screen disclosure. Sample scores also came from an AI-generated synthetic face.

Perfect Corp. documents that task deletion removes its input files; anything not deleted expires after 30 days. Result links expire after 2 hours. See [privacy](docs/PRIVACY.md), [architecture](docs/ARCHITECTURE.md), and [demo script](docs/DEMO-SCRIPT.md). No deployment is performed here. Judge URL, access instructions, video and screenshots remain release deliverables. Live service and phone rehearsal require separate verification.

Offline checkpoint (from `service/`):

```sh
IN=fixtures/run2-normalized.json OUT_DIR=/tmp/y3-checkpoint npm run checkpoint:breakout
```

This decodes run2 PNG masks, derives regions, builds an example log, and renders the actual web card in jsdom. Seven PASS checks validate live observations, labels, regions, export privacy, scores and explanatory text. Outputs are `log-view.json`, `log-file.json`, and `log-card.html`. With no overrides it reads `/workspace/eng/spikes/youcam-breakout-20261025/live-smoke/result.json` and writes to that directory.

Kai alone runs `SMOKE_LIVE_CONFIRM=1 npm run smoke:breakout` from `service/`, with the key securely supplied through `YOUCAM_API_KEY`, after live authorization and checking the units ledger. Its guard enforces the two-run cap, exclusive lock, unresolved-run block and 460-unit reserve after a 9-unit task. It writes the normalized input consumed by `checkpoint:breakout`. See the [demo instructions](docs/DEMO-SCRIPT.md) for local mock startup and the live/checkpoint handoff.
