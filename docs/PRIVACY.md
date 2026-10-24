# Privacy

Before Another Bottle offers cosmetic shopping guidance, never diagnosis or treatment. Raw scores are provider numbers; direction is unconfirmed and no severity labels are inferred. Severe or painful symptoms are self-reported inputs for the shared decision engine.

Before any face upload, the app requests this exact consent:

> I have permission to upload this face to Perfect Corp. for cosmetic analysis. Our app deletes session images/results on exit or after 30 minutes; provider retention is unconfirmed. This is not medical advice.

Consent text version: `2026-10-24.v1` (`CONSENT_TEXT_VERSION`). Consent acceptance time and version accompany the JPEG and random session identifier. A judge code, if entered, is sent to the service only for budget routing. Keys stay server-side.

The browser orients, proportionally resizes, and re-encodes the image as JPEG, stripping original metadata. It does not persist photos/results to local storage. Images are processed locally until submission, then sent through the service to Perfect Corp. for the four cosmetic concerns. End session, page exit, or 30 minutes clears browser data. Refresh also discards the resume ID. DELETE removes worker observations and prevents subsequent GET access; pagehide delivery remains best-effort, with 30-minute expiry as a backstop.

The service must delete session images/results on exit or after 30 minutes and must not log images or image URLs, capture them in analytics, or back them up. Only task/quota accounting may persist. DELETE `/api/analyses/:id` returns 204 and records only a privacy tombstone alongside accounting. Unknown or already deleted IDs return uniform 404 errors. The browser uses fetch with keepalive on exit, expiry, or replacement; an in-flight creation is deleted when its response arrives after exit.

Provider result retention remains unconfirmed. Provider source-image retention is **UNCONFIRMED**. Do not interpret our session deletion as a promise about Perfect Corp.'s original-image storage. Confirm retention before live release.

The Sample (pre-analyzed) uses synthetic fixture numbers and a placeholder silhouette, never a real face photograph. Mock development results are labeled Mock. Any future persistent public demo face needs separate permission for public display and processing. No accounts, tracking, longitudinal profiles, or purchase integrations are included.
