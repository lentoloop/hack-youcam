# Privacy

Breakout Log records cosmetic appearance and self-reported product changes. It does not determine causes or provide medical advice. Scores range from 1–100; higher means healthier skin. Skin-type labels pass through verbatim. Zone counts are estimates computed by this app in your browser from YouCam masks, not provider counts.

Before any face upload, use this exact consent sentence:

```text
I have permission to upload this face to Perfect Corp. for cosmetic analysis; the provider retains uploaded files for up to 30 days, and result/mask URLs expire after 2 hours; our app keeps results only in memory for no more than 30 minutes and deletes them on exit; masks are used in your browser to estimate zone counts and are never stored; the downloaded log holds numbers only (no photo, no masks, no URLs); this is not medical advice.
```

Consent text version: `2026-10-24.v2` (`CONSENT_TEXT_VERSION`). Consent acceptance time and version accompany the JPEG and random session identifier. Optional access codes route budget reservations; API keys stay server-side.

The browser resizes and re-encodes the JPEG to strip metadata before upload. The service forwards the photo to Perfect Corp. and does not retain it after submission. Results, labels, and masks are held only in memory for at most 30 minutes. Masks travel to the same session as PNG data URLs; provider mask URLs never leave the service. Masks and labels are never written to D1 or logs. Only task/quota accounting and deletion tombstones persist.

DELETE `/api/analyses/:id` clears the in-memory result, including labels and masks, and prevents subsequent GET access. Exit deletion delivery is best-effort, with expiry as a backstop. The live path also attempts provider task deletion; provider failure does not block local deletion and immediate provider removal is not guaranteed.

Perfect Corp. retains uploaded files for up to 30 days. Result and mask URLs expire after 2 hours. These provider periods differ from our app's 30-minute memory limit.

The downloaded appearance log contains numbers and text, including self-reports and skin-type labels, but no photo, masks, URLs, or provider task IDs. It stays on the user's device unless the user chooses to share it. Mock masks come from a synthetic AI face (Kai spike run2) and are labeled Mock; sample results must be labeled Sample. No face photograph is bundled.
