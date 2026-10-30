# Screenshot capture and review

Release scope: `e897b5c`. No screenshots have been captured in this sandbox. Kai runs the script outside it, reviews the PNGs and adds the selected images to the submission. The script requires Node.js 22.13 or newer, the existing Chrome executable, outbound access to the chosen app's static files, and no package installation.

From the repository root:

```sh
node scripts/submission/capture-screenshots.mjs
```

To capture another deployment of the same release:

```sh
BASE_URL='https://before-another-bottle.ktwu1997.workers.dev/' node scripts/submission/capture-screenshots.mjs
```

The default is that same Worker URL. The script adds `?demo=synthetic` and rejects URL credentials or extra query parameters. Never supply a judge value or a private link.

## Four subjects, two sizes

The script writes fixed viewport PNGs at 390×844 and 1280×800 in `docs/submission/shots/`. It scrolls to the real UI target without changing app styles, inventing controls or substituting observations. Each viewport gets four primary subjects plus a capture-guide companion, ten PNGs total.

| Plan subject | Release screenshot and filename prefix | Suggested caption |
|---|---|---|
| Consent/capture | `01-consent` and companion `01b-capture` | Consent explains provider retention and best-effort cleanup. The capture guide precedes any photo selection. Demo faces are AI-generated and synthetic. |
| Observations | `02-observations` | Sample: pre-analyzed YouCam observations from an AI-generated synthetic face. No upload or API call. |
| Ownership-driven action | `03-product-changes` | Fictional self-report and a dated product change are recorded alongside Sample observations. The app does not identify a cause or recommend a purchase. |
| Expanded explanation | `04-explanation` | “Still missing” states the limits of the record, including the absence of a live baseline. Download/import keeps the record on the user's device. |

Each filename ends in `-390x844.png` or `-1280x800.png`. `manifest.json` records the fetched deployment URL, capture time, resource hashes, screenshot dimensions, state names and image hashes. The manifest contains no temporary profile paths.

## Plan conflicts resolved against code

The older plan describes shopping cards and an ownership toggle. They do not exist in this release. The replacement third shot is self-report and recent product changes, matching `docs/DEMO-SCRIPT.md`. There is also no expandable explanation control; the fourth shot shows the existing “Still missing” section. Do not label either screenshot as a feature the app lacks.

The first subject needs two views because consent hides after “Continue to photo”. The companion shows the existing guide, not an uploaded face. Ingredient-note editing is absent; notes are add/list only.

## Zero-unit capture method

The script uses Node's built-in HTTP server and WebSocket client, with no package dependencies. It serves the temporary mirror on an ephemeral port bound only to `127.0.0.1`, so module scripts load from an HTTP origin instead of failing CORS under `file://`. One isolated headless Chrome process runs for the whole capture, driven through the local Chrome DevTools Protocol (CDP). Chrome's one-shot `--dump-dom` and `--screenshot` flags were dropped because those invocations hang on the capture host, even for a minimal page. It fetches only the app HTML, JavaScript, CSS and same-origin fonts from `BASE_URL`, then captures a temporary local mirror of those exact assets. This is a capture of fetched release assets, not a browser session against the hosted API. The script rejects unexpected HTML resources, split module builds, unbundled CSS imports and unsupported CSS resources so a changed deployment requires review.

CSP permits scripts, styles, images and fonts only from the mirror itself (plus inline scripts/styles and data images/fonts); `connect-src` remains `'none'`. Host resolution rules reject every host except `127.0.0.1`. CDP request interception blocks any request outside the exact mirror origin, including other loopback ports, and fails the run if one is attempted. Fetch, XHR, beacon and socket constructors fail if invoked. The only result action is “Try Sample (pre-analyzed)”. No photo is selected, no judge value is entered and Analyze is never clicked. The script fails if Analyze becomes enabled, a job-resume control appears, a non-Sample source badge appears, processing begins, or a resource/network error occurs. All five states must pass at both sizes before new PNGs are published. If a run fails, old images from an earlier run may remain; do not use them as evidence of the failed run.

Each shot sets its viewport through CDP at device scale factor 1, with mobile emulation at 390 pixels. The script polls the harness readiness/failure attributes for up to 20 seconds, then captures the scrolled viewport with `Page.captureScreenshot`. Every CDP call has a 10-second timeout. Errors identify the shot and distinguish page guards, readiness timeouts and CDP failures. Chrome startup and target discovery also have time limits. The browser is killed and the loopback server is closed in `finally`; temporary HTML, assets and the isolated Chrome profile are removed after the run. Chrome uses `--no-sandbox` for the operator's headless environment; run only against this trusted app release. No persistent browser profile is used.

## Review before attaching

1. Confirm all ten PNGs and the manifest come from the successful run and the intended deployment. Check resource hashes against the intended build when available.
2. Confirm dimensions, readable text, loaded fonts and no clipping that hides the subject. These are viewport shots, not full-page images; the mobile consent will not fit in one frame. Add a manual companion if necessary to show the entire consent without altering it.
3. Confirm the observation shot shows “Sample (pre-analyzed)” and the explanation shot states that a live baseline is missing. If the app's estimate disclaimer falls below the viewport, add a separate manual view before describing region numbers. Do not crop a source label off an observation image.
4. Use captions above when the synthetic banner is outside the scrolled viewport. All self-report and product-change values entered by this script are fictional. Sample figures are the bundled sample, not a treatment outcome.
5. Review both sizes on a phone and desktop. No browser execution, screenshot appearance, hosted reachability or zero-unit runtime result was verified in the sandbox. Syntax checks cover the Node entry point and each generated inline browser script only.

Sources: `web/src/main.ts`, `web/src/sample.ts`, `web/src/results.ts`, `web/src/capture-guide.ts`, `docs/DEMO-SCRIPT.md`, `docs/PRIVACY.md`.
