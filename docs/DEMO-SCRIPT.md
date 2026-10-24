# Breakout Log (working title): 2-minute phone demo

Use only an authorized AI/CC0 demo face. Label Sample and Mock clearly; never present them as live success. Any live recording requires separate authorization and budget checks.

| Time | Screen and narration |
|---|---|
| 0:00–0:20 | “After a breakout, I want a record of what changed, what was observed, and what is still missing.” Show the working title and consent, including provider retention. |
| 0:20–0:45 | Show face frame, distance/light hints, select the permitted photo, describe areas and discomfort, and add dated product categories and active yes/no/unknown. |
| 0:45–1:10 | Submit; label waiting cuts. Show the actual source badge. Explain “YouCam score, higher = clearer” and provider zone labels. |
| 1:10–1:30 | Show region stats: “Estimated by this app from the YouCam mask, not a YouCam measurement.” Explain marker blobs can merge; this is not a lesion diagnosis. |
| 1:30–1:50 | Read Still missing: “This log cannot tell which product, if any, caused the change.” Show the severe-symptom referral only as a clearly labeled self-report demonstration. |
| 1:50–2:10 | Download JSON, clear and import it. Show side-by-side only for entries that confirm matching framing. Demonstrate refusal otherwise; no deltas or percentages. Delete my analysis, then Clear log. |

Capture four screenshots: consent/capture guide, self-report and product changes, observations with source/estimate labels, and Still missing with download/import. Final judge URL, video and phone/live rehearsal remain release work. No deployment or external contact is performed by this worktree.

## Local mock and checkpoint

From the worktree root, start `cd service && npm run dev` in one terminal and `cd web && npm run dev` in another. Open the Vite URL. The service defaults to mock; upload only a synthetic demo image and expect the Mock badge. Sample requires no image or request.

Kai only: after confirming live authorization and the units ledger, run `cd service` then `SMOKE_LIVE_CONFIRM=1 npm run smoke:breakout` with `YOUCAM_API_KEY` supplied securely in the environment. Do not put the key in shell history. The script uses the approved synthetic-face directory, an exclusive ledger lock, a two-paid-run cap, and a 460-unit reserve after the 9-unit charge. Unresolved earlier runs block further tasks. It deletes the provider task and writes `{observations, zoneLabels, masks}` to `/workspace/eng/spikes/youcam-breakout-20261025/live-smoke/result.json` by default (`OUT` overrides the path). This command makes live calls; checkpoint does not.

Run `cd service && npm run checkpoint:breakout` after the smoke result exists. Defaults read that `result.json` and write alongside it. For offline rehearsal, from `service/`:

```sh
IN=fixtures/run2-normalized.json OUT_DIR=/tmp/y3-checkpoint npm run checkpoint:breakout
```

Expect seven PASS lines and exit 0. Inspect `log-view.json`, `log-file.json` (the real Download serializer), and `log-card.html` (the real web renderer in jsdom). The fixture contains real provider run2 scores/masks from a synthetic AI face, so its observation source is `live`; the browser Sample remains labeled Sample. The example self-report and product change are explicitly labeled examples. The harness dates the entry today and the example change seven days earlier; it does not recover capture time from the smoke file. HTML is static and can be opened locally.
