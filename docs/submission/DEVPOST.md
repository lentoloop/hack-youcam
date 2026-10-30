# Devpost draft

Draft for wu to review and paste. The feature scope is release `e897b5c`. Delete the Fact check section before pasting.

## Name

Breakout Log

The Cloudflare Worker name is `before-another-bottle`.

## Tagline

Record product changes and cosmetic appearance observations, with a clear account of what remains unknown.

## Inspiration

After a breakout, the question is often which product caused it. I built Breakout Log around a narrower task: keeping a dated record of product changes and appearance observations that someone can bring to a professional. The log cannot establish which product, if any, caused a change.

## What it does

I combine self-reported areas and discomfort with dated product categories, whether they contain active ingredients, and YouCam observations. The log shows a timeline, an appearance baseline when a live entry exists, and missing information. Ingredient notes support adding notes and listing them newest first; they cannot be edited.

The YouCam Skin Analysis API v2.0 integration requests acne, redness, texture and skin type. The interface shows scores for the first three concerns and the provider's skin-type labels. It also shows zone estimates calculated in the browser from YouCam masks. Those estimates are app calculations, not YouCam measurements or verified lesion counts. Marker blobs can merge and undercount.

Users can download a JSON log and import it later. Eligible entries can be shown side by side after the user confirms matching framing; incompatible entries are refused. The app does not calculate improvement percentages or recommend stopping a product. Its consumer value is a record of recent skincare changes and unresolved questions; it does not recommend purchases or identify a culprit.

The demo face is AI-generated and synthetic, created with Grok. Sample uses pre-analyzed observations from that face and makes no upload or API call. Live, Sample and Mock have separate labels. The release configuration is mock mode, so an upload there is not a live YouCam analysis. The synthetic demo banner is a disclosure, not a switch to live mode.

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

Before submission, I need to complete the phone rehearsal and record the public demo video. Ingredient-note editing remains a backlog item that needs design work.

## Built with

TypeScript; Vite; vanilla DOM APIs; Cloudflare Workers; Cloudflare D1; YouCam Skin Analysis API v2.0; Wrangler; Vitest.

## Links

- Repository: <REPO_URL>
- Public demo video: <YOUTUBE_URL>
- Judge URL: https://before-another-bottle.ktwu1997.workers.dev/?demo=synthetic
- Judge instructions: `docs/submission/JUDGES.md`

## Fact check

Remove this section before pasting. These mappings cover the factual claims above; motivation and lessons express the documented product scope, not a claim of personal medical experience or user-study results.

| Claim | Repository source |
|---|---|
| Name, purpose, browser-memory log, synthetic face and provenance | `README.md`; `docs/DEMO-SCRIPT.md`; `web/src/main.ts` |
| Worker name and judge host | `service/wrangler.toml` (`name`); `docs/submission/JUDGES.md` (release URL supplied for this pack) |
| Release scope and mock configuration | `service/wrangler.toml`; `web/src/main.ts`; `docs/submission/JUDGES.md` |
| Timeline, live baseline, missing evidence, symptom referral, no causal claim | `shared/log.ts`; `web/src/results.ts`; `contracts/log.ts` |
| Product-change fields and ingredient add/list only | `web/src/main.ts`; `web/src/ingredient-notes.ts`; `docs/DEPLOY.md` (October 30 scope) |
| Four API actions, three scored concerns and provider labels | `contracts/analysis.ts`; `service/adapters.ts`; `web/src/results.ts` |
| Mask estimates, merging, undercounting, zone rule | `shared/regions.ts`; `web/src/results.ts`; `docs/ARCHITECTURE.md` |
| JSON contents, validation, download/import, comparison refusal and no percentages | `shared/log.ts`; `web/src/log-file.ts`; `web/src/results.ts`; `docs/ARCHITECTURE.md` |
| Sample makes no API call; disclosure does not change mode | `web/src/sample.ts`; `web/src/main.ts`; `service/wrangler.toml` |
| Exact consent and all privacy/retention/deletion limits | `docs/PRIVACY.md`; `contracts/analysis.ts`; `service/worker.ts` |
| Stack, dependencies, 600×800 JPEG, asynchronous jobs, polling and resume | `README.md`; `web/package.json`; `service/package.json`; `web/src/image.ts`; `web/src/api.ts`; `web/src/poll.ts`; `service/adapters.ts` |
| Persistent reservations, cleanup status and retries | `service/budget.ts`; `service/worker.ts`; `web/src/main.ts` |
| Phone/video release checks and editing backlog | `docs/DEMO-SCRIPT.md`; `docs/DEPLOY.md` |

Editorial check: the outward-writing workflow's humanizer and avoid-ai-writing audits were applied with a professional voice and technical context. Required field headings, exact consent, identifiers and intentional URL placeholders remain. The audit and preservation assessment were model-only: the bundled detector, marks normalizer and preservation validator were unavailable. No cleanup edit was needed after the final audit (zero avoid-ai-writing editing passes; two-pass limit). No further justified in-scope edit remained. wu must review and submit this draft personally.
