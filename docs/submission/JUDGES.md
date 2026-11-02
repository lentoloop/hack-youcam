# Judge access draft

Release candidate: `e897b5c`, deployed October 30, 2026. App: Breakout Log. Worker: `before-another-bottle`.

Judge URL: https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic

Availability target: keep this free judge URL working through November 21, 2026 at 13:00 Taipei (UTC+8). This is an operator commitment to confirm before submission, not a verified uptime guarantee.

## Free sample walkthrough

1. Open the judge URL. The banner discloses AI-generated synthetic faces created with Grok. The query parameter adds that disclosure; it does not select the service mode or grant judge access.
2. Press “Try Sample (pre-analyzed)”. No photo, consent acceptance, credentials, upload or API request is required for this action.
3. Inspect the source badge, scores, zone labels and app-estimated region statistics. Sample does not create a live baseline.
4. To include fictional self-report and product changes, accept the displayed consent and press “Continue to photo”. Enter areas, discomfort and dated product changes. Press Sample again to incorporate those fields. Do not select or upload a photo for the free walkthrough.
5. Read “Still missing”, download the JSON record, clear the log and import the downloaded record. Ingredient notes can be added and listed newest first; editing is not available.

## Judge analysis access

The deployed release configuration is **mock**, so photo submissions return Mock test data and do not call YouCam. A synthetic banner alone never enables live analysis. Sample is the recommended judge walkthrough in this configuration. Live API operation and phone recording still require the operator's separate release checks; do not describe a Mock or Sample result as live.

If the operator enables live mode, judge access works as follows:

1. Accept consent and press “Continue to photo”. Read provider retention and best-effort deletion limits before selecting a permitted face image.
2. Enter `<JUDGE_CODE; wu fills in>` in “Judge access code (optional)”. wu obtains the value from his private environment records and supplies it through the submission's private credential field. Do not put it in this file or a URL.
3. Select the permitted image, complete self-report and press “Analyze and add entry”. Confirm the result badge says Live before treating it as a live result. For a public demo, use only the disclosed AI-generated synthetic face.
4. If processing times out, use “Resume existing job”. Do not re-upload blindly. “Delete my analysis” revokes local access and shows provider cleanup status; retry cleanup if offered. See `docs/PRIVACY.md` for retention limits.

The browser sends the entered value as `judgeCode` in the analysis request metadata. The service checks it against its configured judge secret. Only a matching configured value selects the judge pool; missing or incorrect values use the public pool (unless a separate developer value matches). There is no judge login or judge query parameter.

## Allowances and exhausted quota

The configured live budget is 990 units, with 10 of the nominal 1,000 units left unused. Each four-action SD run reserves 9 units. The public cap is 180 units (up to 20 successful runs); the separate judge reserve is 450 units (up to 50). These are configured ceilings, not a statement of remaining provider credit. Existing spending, held reservations and provider availability can reduce usable runs.

Public/developer requests share the two-runs-per-IP-per-UTC-day restriction. Judge requests bypass that daily IP cap. Concurrency is two for judge reservations and separately two for non-judge reservations. Same-session duplicate image requests within the deduplication window reuse an existing job. Uncertain tasks can retain their unit reservation after releasing concurrency.

When allowance or rate limits deny a request, the service returns HTTP 429 (`quota_exhausted` or `rate_limited`). The UI shows the error; “Try Sample (pre-analyzed)” remains an explicit choice. There is no automatic sample fallback. Public exhaustion does not consume the separate judge allocation. Sample remains usable without provider units even when live allowance is unavailable.

Sources: `contracts/budget.ts`, `service/budget.ts`, `service/worker.ts`, `service/wrangler.toml`, `web/src/main.ts`, `web/src/sample.ts`, `web/src/api.ts`, `docs/PRIVACY.md`.

Release URL and availability target are supplied operator release requirements. Confirm reachability, mode, remaining allowance and the private judge value outside the sandbox before pasting these instructions.
