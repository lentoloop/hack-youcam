# Y3 integration verification — 2026-10-24

Base: task/integrate merge f63aa1a. Read the Breakout Log architecture at `/workspace/eng/arch/youcam-breakoutlog-v1.md`, all frozen contracts, and `docs/PRIVACY.md`. No contract edits, dependency installs, commits, deployments, or live YouCam calls. Neither smoke command was run.

## Changes and coverage

The e2e suite uses the real bundled worker in Miniflare/workerd with ephemeral D1 and both migrations. The real web API client uploads two in-memory solid-color 600×800 JPEGs with v2 consent, polls each after the real ten-second interval, and verifies acne/redness/texture observations plus verbatim skin_type whole/T/U labels. Skin-type labels come from the provider output; they are not inferred from masks. Numeric region estimates come from decoding the four PNG data URLs returned by the worker and running the real shared heuristic (T/U/other marker counts: 7/21/2, nonzero redness statistics).

Those results become two real LogEntry objects in a BreakoutLog, with a product change, self-report, framing confirmations, timeline, Mock labels, missing-live-baseline/unknown-cause text, numeric side-by-side comparison and framing refusal. The real renderer and export/parser run against this log; export excludes masks, photos, URLs and provider task IDs. The severe-symptom referral remains covered. Service DELETE invalidates each result; GET and repeat DELETE reject access.

Two additional parameterized e2e cases seed a provider-backed job and intercept every outbound request inside Miniflare. They assert the exact POST `/s2s/v2.0/task/delete` URL/body and verify that both provider success and HTTP 503 leave local GET/DELETE returning uniform 404 errors. Seeding avoids submitting any paid task. These tests uncovered `TypeError: Illegal invocation` from calling Workers' native fetch as an adapter method. Binding the default fetch to globalThis fixes the actual runtime path while retaining injected fake fetches. No external request is forwarded.

Service Vitest now includes `tests/shared/**/*.test.ts` and resolves its bare Vitest imports to the existing service installation. The fixture PNG decoder also accepts byte buffers so e2e computes regions from returned masks rather than reading a separate fixture. Shared tests were already included by the web Vite config (confirmed by execution); the original report that no configured runner included them was inaccurate. They now run explicitly via the documented service command as well. Web's 9 tests comprise 4 web tests and these same 5 shared tests; they are not 9 additional unique tests.

## Removed tests and code

Replaced the v1 e2e expectations for three recommendation cards, `consider_category`, the fifth checkbox, `see_dermatologist` decision markup, and hidden product cards. These describe the removed purchase flow. The severe-symptom case was migrated, not dropped; DELETE coverage was retained and extended. No test is skipped in the final full runs.

No implementation files were removed: `shared/products.ts`, `shared/decide.ts`, and legacy decision tests are already absent from this merge. Repository searches found no remaining implementation imports of them or consumers of ProductCard/DecideFn outside contracts. `contracts/decision.ts` and its barrel export remain because the user explicitly froze exported contract types. No frozen files were changed.

## Final checks

Commands below run from the worktree root unless a directory is specified. All use existing local dependencies.

| Check | Command | Result | Exit |
| --- | --- | --- | --- |
| Contracts TypeScript | `./service/node_modules/.bin/tsc -p tsconfig.contracts.json` | 0 diagnostics | 0 |
| Service TypeScript | `cd service && ./node_modules/.bin/tsc -p tsconfig.json` | 0 diagnostics | 0 |
| Service + shared Vitest | `cd service && npm test` | 63 passed, 5 files (58 service + 5 shared), 0 skipped | 0 |
| Shared alone | `cd service && npm test -- ../tests/shared` | 5 passed, 2 files, 0 skipped | 0 |
| E2E | `cd service && npm run test:e2e` | 5 passed, 1 file, 0 skipped | 0 |
| Web TypeScript | `cd web && ./node_modules/.bin/tsc -p tsconfig.json` | 0 diagnostics | 0 |
| Web Vitest | `cd web && npm test` | 9 passed, 3 files (4 web + 5 shared), 0 skipped | 0 |
| Vite production build | `cd web && npm run build` | 20 modules transformed, build succeeded | 0 |
| Diff whitespace | `git diff --check` | clean | 0 |
| Key/secret scan | Python scan of added diff lines plus untracked notes | 0 non-synthetic credential candidates | 0 |
| Image inventory | Changed and untracked image filename scan, diff review | no image files added or changed | 0 |

Secret patterns checked: private-key headers, AWS access-key IDs, common API/GitHub token prefixes, and quoted key/secret/password/token assignments. The only credential-shaped test values are explicit synthetic placeholders. The upload JPEGs are generated in memory and never written; no face images were added. Existing synthetic-source mask PNG fixtures remain unchanged.

## Remaining scope

No required offline check is open. Live provider operation, phone rehearsal, and deployment remain outside this task and unverified here. The native-fetch fix is verified in workerd against an intercepted provider deletion request; it was not tested against the live provider. Frozen legacy contract removal belongs to Kai if later authorized. Changes remain uncommitted for Kai.
