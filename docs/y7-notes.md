# Y7 R3 redirect blocker and follow-ups

Read the full R3 review (`/workspace/eng/reviews/youcam-r3-20261024.md`), its surviving offline probe harness, and `docs/y6-notes.md`. Contracts remain frozen. No installation, live provider calls, network requests, secrets, deployment, commits, branches, pushes or outside contact. Workers Free architecture is unchanged (no Queues, Durable Objects or Workflows).

- **B3 fixed:** `LiveAdapter.api()` sets `redirect: "error"` on every fixed-origin provider API request, covering file allocation, task creation, polling and task deletion. Upload/mask fetches already use this policy. A redirect rejects the provider call; ordinary cleanup records `failed` and retains its handle for retry. Analysis rejects through the existing error handling; optional masks remain optional.
- **Ceiling:** four rows, two cleanup snapshots each, at most **35 SQL statements and 8 external requests**, conservatively **43 combined operations**. Count each batch statement individually: 2 orphan updates + 1 selection + 4 × (2 local writes + 2 × (attempt update + final CAS + re-read)) = 35 SQL. Rejecting redirects means at most one external dispatch per fetch call, so hidden redirect hops cannot exceed this bound. Ordinary failed cleanup uses 19 SQL + 4 external = 23. Database errors stop the invocation. These are modeled invocation request bounds, not deployed quota/CPU/backlog certification.
- **Regressions:** a network-disabled Undici MockAgent offers a 20-hop HTTP 307 task-delete chain. Four-row sweeps exercise ordinary redirects (19 SQL/4 external), both-CAS-lost redirects (35 SQL/8 external), and the existing provider-failure race (35 SQL/8 fetch calls). Counters enforce SQL ≤ 50, external ≤ 50 and combined ≤ 50, checking each fetch dispatches at most once. Eight eligible rows prove only four are selected; both orphan ledgers are populated. Ordinary redirects leave all four rows `failed` with handles retained. When both final CAS writes lose to newer generations, the newer `pending` state and handle survive, as required by stale-write protection. Adapter tests additionally reject 307 responses for submit, poll and delete, and assert redirect rejection throughout the successful file/upload/create/poll flow.
- **Follow-up 1 fixed:** live adapter creation validates the same normalized suffix list used by storage URL checks. Missing, blank, separator-only, `'.'`, and `' , . '` configurations fail with `live_unavailable` and an allowlist message. The explicit smoke-only `SMOKE_LEARN_HOSTS=1` discovery path remains separate and unchanged; no suffixes were guessed and no smoke was run.
- **Follow-up 2 fixed:** service deployment and local harness prose now says migrations 0001 through 0004 in order; removed the stale claim that two unresolved tasks stop live work. Abandoned reservations retain uncertain units while freeing slots.
- **Follow-up 3 operational rule:** drain active jobs before switching mock/live; mode-switch behavior is unchanged.

## Verification

Commands used installed dependencies only. Results are quoted below; the sandbox prevents the requested all-exit-0 verification result.

- Root `npm run typecheck:contracts`: exit 0.
- Service `./node_modules/.bin/tsc --noEmit`: exit 0.
- Service `npm test`: exit 1, `Tests 1 failed | 103 passed (104)`. All changed regressions pass. The sole failure is the existing checkpoint wrapper: `Error: spawnSync /usr/bin/node EPERM`. Independently reproduced with `spawnSync(process.execPath, ['--version'])`: child output and status 0 are present, but the runtime also returns EPERM. No test was weakened or skipped in the required command.
- Supplemental service `npm test -- --exclude ../tests/service/checkpoint.test.ts`: exit 0, `Tests 103 passed (103)`; this isolates the sandbox-blocked wrapper and does not replace the required full-suite result.
- Service `npm run test:e2e`: exit 1, `Error: listen EPERM: operation not permitted 127.0.0.1`, followed by setup/disposal timeouts; five tests skipped because setup never completed. Loopback listening is prohibited in this sandbox; no external connection was attempted.
- Web `./node_modules/.bin/tsc --noEmit`, `npm test`, `npm run build`: all exit 0; `Tests 21 passed (21)` and `built in 210ms`.
- Service `IN=fixtures/run2-normalized.json OUT_DIR=/tmp/y7k npm run -s checkpoint:breakout`: exit 0:

```text
PASS live acne/redness/texture observations
PASS zoneLabels >= 1
PASS regions has 3 zones
PASS log-file excludes image data, URLs and provider IDs
PASS HTML contains scores
PASS HTML contains app-estimate label
PASS HTML contains cause unknown text
```

- Service `node --check scripts/smoke-breakout.mjs`: exit 0 (syntax only).
