# Privacy

Before Another Bottle offers cosmetic shopping guidance, never diagnosis or treatment. Raw and UI scores run from 1–100; higher means healthier skin. Prefer raw scores for logic; UI scores are calibrated provider display scores. No severity labels are inferred. Severe or painful symptoms are self-reported inputs for the shared decision engine.

Before any face upload, the app requests this exact consent:

> I have permission to upload this face to Perfect Corp. for cosmetic analysis. Our app deletes session images/results on exit or after 30 minutes; provider retention is unconfirmed. This is not medical advice.

Consent text version: `2026-10-24.v1` (`CONSENT_TEXT_VERSION`). Consent acceptance time and version accompany the JPEG and random session identifier. A judge code, if entered, is sent to the service only for budget routing. Keys stay server-side.

The browser orients, proportionally resizes, and re-encodes the image as JPEG, stripping original metadata. It does not persist photos/results to local storage. Images are processed locally until submission, then sent through the service to Perfect Corp. for the four cosmetic concerns. End session, page exit, or 30 minutes clears browser data. Refresh also discards the resume ID. DELETE removes worker observations and prevents subsequent GET access; pagehide delivery remains best-effort, with 30-minute expiry as a backstop.

The service must delete session images/results on exit or after 30 minutes and must not log images or image URLs, capture them in analytics, or back them up. Only task/quota accounting may persist. DELETE `/api/analyses/:id` returns 204 and records only a privacy tombstone alongside accounting. Unknown or already deleted IDs return uniform 404 errors. The browser uses fetch with keepalive on exit, expiry, or replacement; an in-flight creation is deleted when its response arrives after exit.

Perfect Corp.'s [file retention documentation](https://docs.perfectcorp.com/develop/file_retention_period) specifies 30 days for uploaded files and associated file IDs, with automatic removal of uploaded/generated images and videos after 30 days. Download/result and mask URLs are valid for 2 hours. The [skin-analysis guide](https://docs.perfectcorp.com/reference/ai_skin_analysis) separately specifies processed-result retention of 24 hours after completion. The [API Privacy Policy §5](https://www.makeupar.com/perfectbeauty/youcam/privacy-policy-api) generally specifies data retention for 30 days after each service session.

The [task deletion API](https://docs.perfectcorp.com/reference/task_management) accepts POST /s2s/v2.0/task/delete with a task_id and deletes a finished task, including associated input files and generated outputs. In live mode, our DELETE path attempts that cleanup for a stored provider task ID; provider failure never blocks local deletion. Cleanup of unfinished tasks and provider availability remain best-effort, so local deletion does not guarantee immediate provider removal. The versioned consent quotation above is the existing literal UI text; its retention wording predates this confirmation and needs a coordinated consent-version update before release.

The Sample (pre-analyzed) uses synthetic fixture numbers and a placeholder silhouette, never a real face photograph. Mock development results are labeled Mock. Any future persistent public demo face needs separate permission for public display and processing. No accounts, tracking, longitudinal profiles, or purchase integrations are included.
