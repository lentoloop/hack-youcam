# Y4 checkpoint — 2026-10-24

Added `service/scripts/checkpoint-breakout.mjs` and service `checkpoint:breakout`. No live calls were made. Contracts and e2e are unchanged. No dependencies installed, commits, branches, pushes, deployments, secrets or photographs added.

The harness reads the exact `{ observations, zoneLabels, masks }` shape written by `smoke-breakout.mjs`. It decodes PNG data URLs with the already-installed sharp, uses real shared `deriveRegions` and `buildLog`, renders real `web/src/results.ts` in jsdom, and exports via the same `serializeLog` used by Download. Esbuild bundles those TypeScript modules in memory. Defaults match the requested live-smoke directory; IN and OUT_DIR override input and artifact directory. Failures print FAIL and exit nonzero. No service or provider client is imported.

`run2-normalized.json` combines the existing real run2 synthetic-AI-face masks from `run2-masks.ts` with the scores and verbatim labels in `live-sample-result.json`. The source is live because these are recorded provider outputs; browser Sample still uses sample. There are no face photographs. Expected marker counts are T=7, U=21, other=2; scored display values texture=70, redness=60, acne=66. The regression test executes the standalone harness in a temporary directory, checks seven PASS lines and inspects all three artifacts. The harness supplies example self-report/change text, current UTC entry time, and a start date seven UTC calendar days earlier; the normalized file does not include original capture time.

Six additional web cases cover malformed JSON, invalid schema/version and embedded data rejection in the actual import UI while preserving an existing sample log, clearing report/log/download state, and real renderer comparisons refused/allowed according to same-framing confirmation. Confirmed rows show side-by-side numbers without percentages or deltas and respond to selection changes. Sample badges are asserted. Existing upload/download/deletion/expiry tests remain.

Removed obsolete commercial-flow terms from README and architecture/history docs. README and DEMO-SCRIPT document mock startup, Kai-only smoke with its existing units guards, and offline/live-result checkpoint commands. Historical Y3 references to frozen legacy contracts describe that earlier snapshot; this task leaves current contracts untouched.

## Verification

All commands exited 0 using existing node_modules:

| Directory | Command | Result |
| --- | --- | --- |
| root | `npx tsc -p tsconfig.contracts.json` | 0 diagnostics |
| service | `npx tsc --noEmit -p .` | 0 diagnostics |
| service | `npx vitest run` | 64 passed, 6 files |
| service | `npx vitest run --config ../tests/e2e/vitest.config.ts` | 5 passed, 1 file, unchanged suite |
| web | `npx tsc --noEmit -p .` | 0 diagnostics |
| web | `npx vitest run` | 15 passed, 3 files (10 web + 5 shared) |
| web | `npx vite build` | 19 modules transformed; built in 171ms |
| service | `IN=fixtures/run2-normalized.json OUT_DIR=/tmp/y3-checkpoint node scripts/checkpoint-breakout.mjs` | 7 PASS, artifacts written |
| root | `git diff --check` | clean |

Checkpoint output:

```text
PASS live acne/redness/texture observations
PASS zoneLabels >= 1
PASS regions has 3 zones
PASS log-file excludes image data, URLs and provider IDs
PASS HTML contains scores
PASS HTML contains app-estimate label
PASS HTML contains cause unknown text
```

Wording scan of web/, docs/ and README for the requested obsolete terms is clear apart from random dependency integrity hashes (excluded); package names are retained as allowed. Offline artifacts are in `/tmp/y3-checkpoint`. Kai's live-result run and phone rehearsal remain unperformed.
