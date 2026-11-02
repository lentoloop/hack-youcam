# Devpost final

Paste-ready public copy for Breakout Log. The deployed code is `b538d82` on `task/y19-ingredient-notes`.

## Name

Breakout Log

The Cloudflare Worker name is `before-another-bottle`.

## Tagline

Record product changes and cosmetic appearance observations, with a clear account of what remains unknown.

## Inspiration

After a breakout, the question is often which product caused it. I built Breakout Log around a narrower task: keeping a dated record of product changes and appearance observations that someone can bring to a professional. The log cannot establish which product, if any, caused a change.

## What it does

I combine self-reported areas and discomfort with dated product categories, whether they contain active ingredients, and YouCam observations. The log shows a timeline, an appearance baseline when a live entry exists, and missing information. Ingredient notes support adding notes and listing them newest first; they cannot be edited.

The YouCam Skin Analysis API integration uses S2S v2.0 `task/skin-analysis` with actions `acne`, `redness`, `texture`, and `skin_type`. The interface shows scores for the first three concerns and the provider's skin-type labels. It also shows zone estimates calculated in the browser from YouCam masks. Those estimates are app calculations, not YouCam measurements or verified lesion counts. Marker blobs can merge and undercount.

Users can download a JSON log and import it later. Eligible entries can be shown side by side after the user confirms matching framing; incompatible entries are refused. The app does not calculate improvement percentages or recommend stopping a product. Its consumer value is a record of recent skincare changes and unresolved questions; it does not recommend purchases or identify a culprit.

The judging site is live and uses the YouCam Skin Analysis API. It is scheduled to remain available through November 21, 2026 at 00:45 Taipei (UTC+8), subject to finite live allowance and provider availability. Sample uses pre-analyzed observations from an AI-generated synthetic face created with Grok and makes no upload or API call. Live, Sample and Mock have separate labels. The synthetic demo banner is a disclosure; it does not grant judge access.

The final 2:24 demo shows three real YouCam analyses of AI-generated synthetic faces created with Grok. Day 0, 7, and 14 are a staged scenario, with calendar dates adjusted for the demonstration. They are not a two-week study or evidence of treatment efficacy. The video shows Perfect Corp. confirming deletion of the analysis and its input files. This is a provider confirmation, not an independent storage audit.

This is a cosmetic-only prototype, not medical advice. A referral appears for user-reported painful, swollen or spreading breakouts; it is not inferred from an AI score.

### Privacy and consent

The app displays this consent before photo capture:

> I have permission to upload this face to Perfect Corp. for cosmetic analysis. Perfect Corp. keeps uploaded files for up to 30 days; result and mask links expire after 2 hours. This app makes the scores and the YouCam masks available for at most 30 minutes to estimate zone counts in my browser; leftover copies in server memory are cleared later, not instantly. This app tries to delete the analysis (here and at Perfect Corp.) when I press Delete or leave the page; deletion is best effort and the app shows if it failed. A downloaded log contains scores, skin-type labels, the app's zone estimates, and the dates, product categories, notes and symptoms I type, but no photo, masks or links. This is not medical advice.

The browser and service strip image metadata. The service does not retain the photo after submission. Browser logs stay in memory until cleared, page exit or the 30-minute session limit. Downloaded logs remain on the user's device unless shared. They exclude photos, masks, provider task IDs and URLs.

D1 retains accounting and cleanup records, including identifiers and server-only task handles; it does not store results, labels or masks. Local access revocation does not guarantee immediate removal from server memory. Page-exit deletion is best effort. Cleanup runs every 15 minutes for up to four eligible jobs, so a backlog can delay it. When an upload has no recorded task ID, the app cannot delete it through the API and the 30-day provider retention applies. I do not promise provider-side deletion.

## How we built it

I used TypeScript with Vite and vanilla DOM APIs for the browser, and Cloudflare Workers with D1 for the service. The browser prepares a 600×800 JPEG. The service submits asynchronous YouCam jobs and the browser polls for results. A timed-out view can resume the existing job without creating another task.

The log and mask calculations use deterministic functions. D1 provides persistent quota reservations and cleanup accounting. The build uses existing packages rather than a custom framework: Vite, Wrangler, Vitest and the libraries declared in the package manifests. The sample observations are bundled fixtures; the synthetic face is disclosed separately.

## Challenges

The masks contain information that needs careful labeling. I count connected marker blobs and summarize redness by zone, but those numbers do not establish a diagnosis or product causality. Matching framing is another limit: capture guidance and user confirmation cannot verify that lighting and framing truly match.

Cleanup also has several outcomes. The interface separates local deletion from provider cleanup and allows retries when cleanup is pending or fails. An ambiguous task creation can leave an uploaded file without an API deletion path.

## Accomplishments

I have a phone-first prototype that puts product changes beside source-labeled appearance observations and explicitly lists missing evidence. It supports portable JSON records without embedding photos or masks. The same release includes consent, cleanup status and quota controls, rather than leaving those concerns outside the user flow.

## What we learned

I learned to keep provider observations separate from the app's estimates and the user's own report. A synthetic sample can demonstrate the interface without a paid API request, but it cannot stand in for a live baseline or evidence that a treatment worked.

## What's next

Ingredient-note editing remains a backlog item that needs design work. Further work includes testing capture consistency across lighting conditions without presenting cosmetic scores as treatment outcomes.

## Live access and limits

Each four-action analysis reserves 9 units. The judge pool has a 450-unit ceiling and the public pool has a separate 180-unit ceiling. These are total caps, not remaining balances or guaranteed run counts. Public and developer requests share a limit of two attempts per IP per UTC day, including failed attempts. A valid judge code bypasses that daily IP limit but still draws on the judge pool. Judge requests have two concurrent slots; public and developer requests share two separate slots, allowing at most four across both groups.

Accept consent, press "Continue to photo", and enter the private code in "Judge access code (optional)" before "Analyze and add entry". Missing or incorrect codes use public access. No login is required. The code must be supplied only in the private testing-instructions field: <JUDGE_CODE: in the private testing-instructions field only>.

If a pool or provider headroom is exhausted, the app shows "Live allowance is used up. Try Sample (pre-analyzed)." If the daily or concurrent limit is reached, it shows "Daily or concurrent limit reached. Wait, resume an existing job, or use the sample." Both are HTTP 429 responses. Sample remains an explicit choice and never silently replaces a live result. Public pool exhaustion does not spend the judge pool. A timeout can resume the existing job without another upload. Uncertain tasks keep their reserved units even after releasing concurrency.

## Built with

TypeScript; Vite; vanilla DOM APIs; Cloudflare Workers; Cloudflare D1; YouCam Skin Analysis API v2.0; Wrangler; Vitest.

## Links

- Repository: <REPO_URL>
- Public demo video: <YOUTUBE_URL>
- Judge URL: https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic
- Judge instructions: `docs/submission/JUDGES-final.md`

## Devpost field map

Use the text below for each field. Paste the narrative sections above into the project story, from "Inspiration" through "What's next", and include "Live access and limits". Do not paste this field map into the public story. Replace only the two URL placeholders after upload and repository review. These are paste targets, not a claim that the contest has no other required fields.

| Devpost field | Paste text |
| --- | --- |
| Project name | Breakout Log |
| Elevator pitch / tagline | Record product changes and cosmetic appearance observations, with a clear account of what remains unknown. |
| Inspiration | Paste the "Inspiration" section above. |
| What it does | Paste "What it does", including "Privacy and consent", and "Live access and limits" above. |
| How we built it | Paste the "How we built it" section above. |
| Challenges we ran into | Paste "Challenges" above. |
| Accomplishments that we're proud of | Paste "Accomplishments" above. |
| What we learned | Paste "What we learned" above. |
| What's next | Paste "What's next" above. |
| Built with tags | TypeScript, Vite, Cloudflare Workers, Cloudflare D1, YouCam Skin Analysis API, Wrangler, Vitest |
| Try it out / website | https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic |
| Source code / repository | <REPO_URL> |
| Video demo | <YOUTUBE_URL> |
| Private testing instructions | Paste the private testing instructions below. Replace the judge-code placeholder only in that private field. |
| Image gallery | Upload the six PNGs listed below, with the matching captions. |

### Private testing instructions

Open https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic. The judging deployment is Live and is scheduled to stay available through November 21, 2026 at 00:45 Taipei (UTC+8), subject to finite allowance and provider availability. No account is needed.

Accept consent and press "Continue to photo". Enter <JUDGE_CODE: in the private testing-instructions field only> in "Judge access code (optional)". Select a face photo you have permission to upload, confirm matching framing only when accurate, and press "Analyze and add entry". Check that the result says Live. The code bypasses the public daily IP limit but uses the finite judge pool. Each run reserves 9 units. The judge pool ceiling is 450 units with two concurrent judge requests. Public access has a separate 180-unit ceiling, two attempts per IP per UTC day, and two concurrent slots shared with developer access. Missing or incorrect codes use public access.

If the app reports a daily or concurrent limit, wait or resume an existing job. If live allowance is used up, select "Try Sample (pre-analyzed)". Sample makes no upload or API call and does not create a live baseline. There is no automatic fallback. For a timeout, press "Resume existing job" rather than uploading again.

Inspect the scores, provider skin-type labels, app-estimated region statistics, and "Still missing". Add product changes and ingredient notes. Download the JSON log and import it later. To compare eligible entries, confirm matching framing during capture. Guidance and confirmation cannot verify actual framing or light. The video demonstrates a staged Day 0/7/14 synthetic scenario, not treatment efficacy.

Press "Delete my analysis" and check the local and provider cleanup messages. Use "Retry cleanup" for pending or failed cleanup. "Clear log" removes the browser record; downloaded files remain on your device. Provider deletion is best effort. Read the full consent before uploading. See JUDGES-final.md for detailed steps and retention limits.

### Screenshots to upload

All paths below refer to existing PNGs. The first two are 390×844 phone screenshots. The remaining images are 1920×1080 frames from the final live video. They retain the synthetic-face and staged-scenario context. The capture screenshot comes from the earlier submission pack and shows guidance, not an analysis result.

| Order | Absolute path | Gallery caption |
| --- | --- | --- |
| 1 | /workspace/eng/arch/evidence/youcam-judging-live-20261102/live2/consent-390x844.png | Consent and the Live judging-mode badge. |
| 2 | /workspace/repos/hack-youcam/docs/submission/shots/01b-capture-390x844.png | Capture guidance and matching-framing confirmation. |
| 3 | /workspace/eng/arch/evidence/youcam-demo-video-live-20261102/frames/result-9.png | Real YouCam result on a Grok AI-generated synthetic face. Region stats are app estimates from the YouCam mask. |
| 4 | /workspace/eng/arch/evidence/youcam-demo-video-live-20261102/frames/frame-060.png | Still missing: the log cannot identify which product, if any, caused a change. |
| 5 | /workspace/eng/arch/evidence/youcam-demo-video-live-20261102/frames/frame-105.png | Side-by-side live observations in a staged Day 0/7/14 synthetic scenario, not evidence of treatment efficacy. |
| 6 | /workspace/eng/arch/evidence/youcam-demo-video-live-20261102/frames/deletion.png | Perfect Corp. confirmed deletion of the analysis and its input files. |

### Final video and YouTube copy

Final file: `/workspace/eng/arch/evidence/youcam-demo-video-live-20261102/breakout-log-demo-live.mp4`.

This is the final 2:24 video, with burned-in English subtitles, three real YouCam analyses, and provider deletion confirmation. It is 1920×1080, 30 fps, H.264, with no audio track. Upload this file and put its public or accessible unlisted YouTube link in <YOUTUBE_URL>.

Suggested YouTube title:

Breakout Log | YouCam Skin Analysis API | Live demo

Suggested YouTube description:

Breakout Log records product changes, cosmetic appearance observations, and what remains unknown. This 2:24 demo uses the YouCam Skin Analysis API, S2S v2.0 task/skin-analysis, with acne, redness, texture, and skin_type.

All faces are AI-generated synthetic faces created with Grok, not real people. Three real API analyses are shown. Day 0, 7, and 14 are a staged synthetic scenario with adjusted calendar dates, not a longitudinal study or evidence of treatment efficacy. Waiting time is shortened.

Region statistics are app estimates calculated from the YouCam mask, not YouCam measurements or verified lesion counts. Marker blobs can merge and undercount. The app does not establish which product caused a change. This is a cosmetic-only prototype, not medical advice.

The demo includes consent, capture guidance, live results, side-by-side observations, missing evidence, JSON export and import, and Perfect Corp. deletion confirmation. Provider deletion is best effort; the confirmation is not an independent storage audit.

Try it: https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic
Source: <REPO_URL>
