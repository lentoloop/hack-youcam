# Y5 R1 review fixes

Read `/workspace/eng/reviews/youcam-r1-20261024.md` in full. Frozen contracts v3 were used without modification. No install, live provider requests, deployment, secrets access, commits, branches or pushes were performed.

## Implementation

- R1 #1 fixed: migration 0003 adds constrained cleanup status, attempts, last-attempt timestamp and submission-start marker. DELETE tombstones before provider work, returns 200 `{local, provider}`, retries existing tombstones, distinguishes never-existing ids, and retains failed cleanup handles. Browser keeps cleanup ids through response/failure, displays provider status and retention, and offers retry. Pagehide uses keepalive DELETE.
- R1 #2 fixed within requested reconciliation scope: Workers Free Cron `*/15 * * * *`, bounded 20-job batch, reconciles older-than-30-minute/tombstoned jobs and abandons reservations. Missing handles after ambiguous submission become unknown_task; these cannot be remotely deleted. Unknown rows already reconciled do not starve the retry batch. A later recorded handle returns the row to pending cleanup. Browser GET not_found still calls DELETE. Pending POST/page-close coverage and limits are disclosed. Direct scheduled tests inject fake fetch only, including failure/retry and restart-safe D1 state.
- R1 #3 fixed: abandoned reservations retain unit liability but leave concurrency; later confirmed success/failure can commit/release them. Both D1 and memory implementations tested. Two public jobs DELETEd followed by a judge reservation succeeds with the pre-reservation judge pool untouched at 450 units. Cleanup itself does not release units.
- R1 #4 fixed: UI renders frozen CONSENT_TEXT verbatim with v3 version. Privacy contains that exact string (regression test). Removed numbers-only claims. Downloads include typed reports/product history, labels, scores and estimates, excluding masks/photos/URLs/provider ids.
- R1 #5 partial: accurate disclosure of logical 30-minute access expiry and lazy physical eviction across isolates, rather than guaranteed physical erasure. No cross-isolate physical erasure mechanism was added.
- R1 #6 partial as requested: HTTPS, no credentials, default port, no IP literals, no local/internal hostnames, and redirect:error for upload and mask requests. Optional YOUCAM_STORAGE_HOST_SUFFIXES comma list checks exact host or dot-delimited suffix. Unset allows public hostnames; approved provider suffixes remain to be supplied by Kai. Smoke emits storage hostnames without paths/queries.
- R1 #7 fixed: shared PNG IHDR check enforces 600x800, 8-bit RGBA before adapter forwarding or browser decode. Invalid masks are individually omitted; an incomplete set displays region estimates as unavailable rather than zero. No contract shape change. All scores and labels remain usable. Exports with unavailable regions omit region estimates.
- R1 #8 fixed: category 80, note/areas/discomfort/labels 500, ids 64 characters; recognizable PNG/JPEG base64 prefixes and base64-looking runs of 200+ rejected at import and validated export. This is not a universal covert-encoding detector.
- R1 #9 fixed: download reads report/product form again and rerenders before serialization. Regression edits product and discomfort after results and removes severe flag; export and referral reflect changes.
- R1 #10 fixed: public jobs omit provider ids and confirmed cleanup NULLs server-only handles. D1 metadata/retention is disclosed.
- R1 #11 fixed: durable task-submit intent precedes provider POST; all intents count toward two-run cap, with legacy charged successes counted. Existing exclusive lock, balance reserve and approved-face realpath remain. Analysis/cleanup outcomes recorded separately, failed cleanup blocks another run. Only offline syntax validation; no live smoke.

## Verification

All requested checks exit 0; final recorded results are in the execution output (local transcript `/tmp/y5-verification.log`). Root contracts, service and web TypeScript checks pass. Service unit/shared tests: 85 passed; service Miniflare e2e: 5 passed; web tests: 21 passed; production build passes. Offline run2 checkpoint: seven PASS lines. `node --check scripts/smoke-breakout.mjs` passes from service.

An intermediate e2e run timed out in the two-capture test (and its dependent referral check); a full rerun passed all checks with exit 0, including all five e2e tests.

Apply migration 0003 when deploying through the normal deployment process; configure the D1 binding and approved storage suffixes there. No paid Cloudflare features were added. Cron is bounded and may need multiple runs for a backlog. Uploaded file retention remains separate from task cleanup; missing ambiguous task identifiers cannot be recovered by this app.
