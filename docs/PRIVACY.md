# Privacy

Breakout Log records cosmetic appearance and self-reported product changes, without determining causes or providing medical advice.

The UI renders this exact consent (version `2026-10-24.v4`):

```text
I have permission to upload this face to Perfect Corp. for cosmetic analysis. Perfect Corp. keeps uploaded files for up to 30 days; result and mask links expire after 2 hours. This app makes the scores and the YouCam masks available for at most 30 minutes to estimate zone counts in my browser; leftover copies in server memory are cleared later, not instantly. and tries to delete the analysis (here and at Perfect Corp.) when I press Delete or leave the page; deletion is best effort and the app shows if it failed. A downloaded log contains scores, skin-type labels, the app's zone estimates, and the dates, product categories, notes and symptoms I type, but no photo, masks or links. This is not medical advice.
```

The browser re-encodes the JPEG to strip metadata; the service forwards it without retaining the photo after submission. Scores, labels and masks have an in-memory logical access expiry of 30 minutes. Physical eviction may be lazy in idle isolates; deletion on one isolate revokes access globally via a D1 tombstone but other isolates may retain inaccessible memory until later eviction. Browser masks are transient inputs for zone estimates.

DELETE revokes local access immediately and returns visible provider cleanup status. Failed or pending cleanup can be retried with the same job id. Page close uses a keepalive DELETE; delivery is best effort. A Workers Free Cron Trigger runs every 15 minutes, reconciling up to 4 expired (older than 30 minutes) or tombstoned jobs per run. This covers page close during a pending POST once the job expires; backlog can delay cleanup. Ambiguous task creation without a recorded task id cannot be deleted by us and is marked unknown_task. Perfect Corp. documents that task deletion removes its input files; anything not deleted expires after 30 days. If upload succeeds but task creation fails or times out without a task ID, the uploaded file has no API delete path and expires after 30 days. Result/mask links expire after 2 hours.

D1 stores job/session identifiers, salted IP hashes, image digests, timestamps, quota accounting and tombstones, plus server-only provider task handles and cleanup status/attempts. Handles are nulled after confirmed cleanup. Numeric accounting and tombstones remain; uncertain units stay held without occupying concurrency. Results, labels and masks are not written to D1. The approved synthetic smoke workflow writes masks to a local restricted result artifact, distinct from the user log.

Downloaded logs contain scores, skin-type labels, zone estimates, dates, product categories, notes, areas, discomfort and the severe-symptom flag. They exclude photos, masks, provider task ids and URLs. Import/export validation limits text lengths and rejects recognizable image payloads, but cannot detect every covert encoding in arbitrary prose. The downloaded file remains on your device unless you share it.
