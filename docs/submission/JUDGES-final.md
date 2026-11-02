# Test Breakout Log during live judging

Judge URL: https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic

The judging deployment is Live. The latest supplied deployment report confirms version `bd514cd0-6078-43e0-b49c-fad651073105` on November 2, 2026. The deployed code is `b538d82` on `task/y19-ingredient-notes`. Live mode is set in the operator's ignored deployment configuration; the tracked default configuration does not describe the active deployment mode.

The site is scheduled to remain available through November 21, 2026 at 00:45 Taipei (UTC+8). This is an availability commitment, not a guarantee of uninterrupted service or unlimited API allowance.

## Try the sample without an upload

1. Open the judge URL. The banner discloses AI-generated synthetic faces created with Grok. The query parameter adds that disclosure, not judge authorization.
2. Press "Try Sample (pre-analyzed)". This action needs no photo, credentials, consent acceptance, upload, or API call.
3. Inspect the Sample badge, scores, provider skin-type labels, app-estimated region statistics, and "Still missing". Sample does not create a live baseline.
4. To include fictional self-report and product changes, accept consent and press "Continue to photo". Enter the fields, then press Sample again. You do not need to select a photo.
5. Add ingredient notes, which appear newest first. Notes cannot be edited. Download the JSON log, clear the log, and import the downloaded file.

## Run a live analysis with judge access

1. Read and accept the displayed consent. Press "Continue to photo".
2. Enter <JUDGE_CODE: in the private testing-instructions field only> in "Judge access code (optional)". Obtain the actual value from the submission's private testing instructions. Never put it in a public description, repository file, screenshot, or URL.
3. Select a face photo you have permission to send to Perfect Corp. For a public demonstration, use disclosed AI-generated synthetic faces created with Grok.
4. Follow the capture guide. Confirm matching framing only if the distance, framing, and lighting match your previous entry. The app cannot verify that confirmation.
5. Enter self-reported areas, discomfort, and dated product changes as needed. Press "Analyze and add entry".
6. Check that the result badge says Live. The API is the YouCam Skin Analysis API, S2S v2.0 `task/skin-analysis`, with `acne`, `redness`, `texture`, and `skin_type`. The first three have scores; skin type returns provider labels. Region statistics are app estimates from YouCam masks, not provider measurements or verified lesion counts. Marker blobs can merge and undercount.
7. If processing times out, press "Resume existing job". Do not upload the same image repeatedly to start new tasks.
8. Read "Still missing". Add another eligible entry to inspect side-by-side observations. Comparison requires matching-framing confirmation and compatible entries. The app does not calculate improvement percentages or establish product causation.
9. Download the log if you want to retain the observations. Press "Delete my analysis" and inspect the cleanup status.

The browser sends the entered code in request metadata. A match with the configured judge secret selects the judge pool. An absent or incorrect code uses the public pool unless it matches a separate developer credential. There is no judge login or judge query parameter. A synthetic banner does not select Live mode.

## Understand the finite allowance

Each four-action run reserves 9 units. The total configured budget is 990 units, split into judge 450, public 180, and developer 360. The judge ceiling corresponds to at most 50 successful runs and the public ceiling to at most 20 before prior usage and held reservations. These are total ceilings, not current remaining balances. Provider availability can also prevent analysis.

Public and developer requests share two attempts per IP per UTC day. Failed attempts count. Valid judge access bypasses that daily IP restriction but still consumes the judge pool. Up to two judge requests can run concurrently. Public and developer requests share a separate two concurrent slots. The combined maximum is four, not two for the whole site and not two per IP.

The same image in the same session within 30 minutes reuses an existing job. Uncertain tasks retain their unit reservations after releasing concurrency. Confirmed provider failures release units. Public exhaustion does not use the separate judge allocation. Non-judge requests also check provider headroom to protect the remaining judge reserve.

For exhausted allowance or provider headroom, HTTP 429 `quota_exhausted` appears as:

> Live allowance is used up. Try Sample (pre-analyzed).

For daily or concurrent limits, HTTP 429 `rate_limited` appears as:

> Daily or concurrent limit reached. Wait, resume an existing job, or use the sample.

Wait for a concurrent slot, wait for the next UTC day for a public daily cap, or select "Try Sample (pre-analyzed)". Sample is an explicit choice. The app never silently substitutes sample data for a live response. A judge code does not replenish an exhausted judge pool.

## Delete the analysis and clear the record

"Delete my analysis" revokes local access and reports provider cleanup separately. A successful response says:

> Deleted here. Perfect Corp. confirmed deletion of the analysis and its input files.

Pending or failed cleanup offers "Retry cleanup". If the provider supplied no task ID, cleanup cannot be retried through the API and the UI explains that uploaded files expire after 30 days. Do not treat local deletion alone as provider confirmation. Even provider confirmation is not an independent audit of physical storage.

"Clear log" removes the record from browser memory. Downloaded JSON files remain on your device and can be imported later. They contain observations, estimates, dates, notes, product categories, and self-report, but no photos, masks, provider task IDs, or URLs.

Perfect Corp. keeps uploads for up to 30 days; provider result and mask links expire after two hours. App observations and masks are accessible for at most 30 minutes. Residual server-memory copies are cleared later, not instantly. Browser logs are held in memory until cleared, page exit, or the 30-minute session limit. Page-exit deletion is best effort. The cleanup schedule is every 15 minutes and processes at most four eligible jobs per run, so a backlog can delay cleanup. D1 keeps accounting and cleanup records, including server-only task handles, but no results, labels, or masks. See `docs/PRIVACY.md` for the full retention limits.

## Watch the final demo

The final video is `/workspace/eng/arch/evidence/youcam-demo-video-live-20261102/breakout-log-demo-live.mp4`, lasting 2:24. It shows three real API analyses and provider deletion confirmation. Its faces are AI-generated synthetic faces created with Grok. Day 0, 7, and 14 are a staged scenario with adjusted dates, not a two-week study or treatment evidence. The recording report's temporary return to Mock predates the later Live judging deployment.

This is a cosmetic-only prototype, not medical advice. Referral text follows user-reported painful, swollen, or spreading symptoms, not an AI diagnosis.
