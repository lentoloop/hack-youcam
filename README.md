# Breakout Log (working title)

A phone-first cosmetic appearance log: record recent product changes, self-reported areas and discomfort, YouCam observations, and what is still unknown. It cannot identify which product caused a change and provides no diagnosis, product recommendations, stop order, or improvement percentages.

The strict TypeScript Vite frontend uses vanilla DOM APIs. Logs stay in memory until cleared, page exit, or the 30-minute session limit. Download/import JSON lets users keep a record on their own device. Files contain observations, labels, self-report text and derived numbers; no photos, masks, provider URLs or task IDs. Start dates must be valid before downloading.

With existing dependencies, run `cd web && npm run dev`; the `/api` proxy expects the local service on port 8787. Run `npm run dev` in service for its mock worker. Sample is explicitly labeled and uses run2 pre-analyzed observations without uploading or making an API call. Mock is test data; neither is a live baseline.

Verification:

```sh
./service/node_modules/.bin/tsc -p tsconfig.contracts.json
cd service
./node_modules/.bin/tsc -p tsconfig.json
npm test                         # 58 service + 5 shared tests
npm test -- ../tests/shared       # shared suite alone
npm run test:e2e                  # offline Miniflare integration
cd ../web
./node_modules/.bin/tsc -p tsconfig.json
npm test                         # 4 web + 5 shared tests
npm run build
```

Tests cover strict log import, framing comparison refusals, the real run2 mask fixture, a mocked browser upload, numbers-only download and deletion. No live API call is required.

Perfect Corp. keeps uploaded files for up to 30 days; result links expire after 2 hours. See [privacy](docs/PRIVACY.md), [architecture](docs/ARCHITECTURE.md), and [demo script](docs/DEMO-SCRIPT.md). No deployment is performed here. Judge URL, access instructions, video and screenshots remain release deliverables. Live service and phone rehearsal require separate verification.
