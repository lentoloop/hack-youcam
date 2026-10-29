/**
 * FROZEN CONTRACT (Kai, 2026-10-24). Sessions must not edit files under contracts/.
 * Changes go through Kai. v2 source: /workspace/eng/arch/youcam-breakoutlog-v1.md (approved by wu 10/24 16:53 Taipei).
 */

/** The four SD skin-analysis actions we request as dst_actions (4 SD actions = 9 units per success; confirmed live 10/24). */
export const CONCERNS = ["acne", "redness", "texture", "skin_type"] as const;
export type Concern = (typeof CONCERNS)[number];
/** Concerns the provider scores (ui_score/raw_score). skin_type returns zone labels + masks only, no score. */
export const SCORED_CONCERNS = ["acne", "redness", "texture"] as const;
export type ScoredConcern = (typeof SCORED_CONCERNS)[number];

/** Which adapter served the request. Switched server-side by YOUCAM_MODE. */
export type YoucamMode = "mock" | "live";

/**
 * Provenance of observations shown to the user. "sample" = pre-analyzed judge/demo
 * fixture (must be labeled in the UI). Never silently swap live for sample.
 */
export type ObservationSource = "live" | "sample" | "mock";

export type JobState = "queued" | "running" | "succeeded" | "failed";

export const ANALYSIS_ERROR_CODES = [
  "consent_required",
  "invalid_image", // dimensions/format outside SD limits after server re-validation
  "error_no_face", // provider
  "error_src_face_too_small", // provider
  "provider_error",
  "timeout", // UI/server poll timeout; task id is kept, never re-created blindly
  "quota_exhausted", // budget guard denied; UI offers labeled sample
  "rate_limited", // per-IP daily cap or concurrency cap
  "not_found",
  "live_unavailable", // YOUCAM_MODE=live but no key configured
] as const;
export type AnalysisErrorCode = (typeof ANALYSIS_ERROR_CODES)[number];

/** Uniform JSON error body for every non-2xx response. */
export interface ApiError {
  error: { code: AnalysisErrorCode; message: string; retryable: boolean };
}

/** SD image limits (checked in browser after resize, re-checked by service). */
export const IMAGE_LIMITS = {
  maxLongSide: 2560,
  minShortSide: 480,
  minFaceWidthRatio: 0.6, // guidance only; provider enforces face size
  contentTypes: ["image/jpeg"] as const,
  maxBytes: 5 * 1024 * 1024,
} as const;

/** Shared consent text for the UI and docs/PRIVACY.md. UI must render CONSENT_TEXT verbatim. */
export const CONSENT_TEXT_VERSION = "2026-10-29.v5" as const;
export const CONSENT_TEXT =
  "I have permission to upload this face to Perfect Corp. for cosmetic analysis. " +
  "Perfect Corp. keeps uploaded files for up to 30 days; result and mask links expire after 2 hours. " +
  "This app makes the scores and the YouCam masks available for at most 30 minutes to estimate zone counts in my browser; leftover copies in server memory are cleared later, not instantly. " +
  "This app tries to delete the analysis (here and at Perfect Corp.) when I press Delete or leave the page; deletion is best effort and the app shows if it failed. " +
  "A downloaded log contains scores, skin-type labels, the app's zone estimates, and the dates, product categories, notes and symptoms I type, but no photo, masks or links. " +
  "This is not medical advice.";

export interface ConsentRecord {
  granted: true;
  textVersion: typeof CONSENT_TEXT_VERSION;
  /** ISO-8601 timestamp from the client. */
  acceptedAt: string;
}

/**
 * POST /api/analyses — multipart/form-data:
 *   field "image": JPEG bytes (already resized/re-encoded in browser)
 *   field "meta":  JSON string of CreateAnalysisMeta
 * Response 202: CreateAnalysisResponse. Errors: ApiError.
 */
export interface CreateAnalysisMeta {
  consent: ConsentRecord;
  width: number;
  height: number;
  /** Client session id (random, no PII); used for session-scoped dedupe and deletion. */
  sessionId: string;
  /** Optional judge access code; routes reservation to the judge pool. */
  judgeCode?: string;
}

export interface AnalysisJob {
  id: string;
  state: JobState;
  mode: YoucamMode;
  source: ObservationSource;
  createdAt: string;
  updatedAt: string;
  /** v3: provider task ids are server-only (R1 finding 10); never serialized to the browser. */
  error?: ApiError["error"];
}

export interface CreateAnalysisResponse {
  job: AnalysisJob;
  /** true when the same image hash in this session matched an existing job (no new units). */
  deduplicated: boolean;
}

/** Normalized provider output for one concern. Scores pass through unchanged (1-100); higher is healthier. Prefer rawScore for logic; uiScore is the calibrated provider display score. No severity thresholds invented. */
export interface Observation {
  concern: ScoredConcern;
  rawScore: number;
  uiScore?: number;
  source: ObservationSource;
}

/** skin_type output: one label per provider region, verbatim (e.g. t_zone "Oily", u_zone "Dry & Sensitive"). */
export type ProviderRegion = "whole" | "t_zone" | "u_zone";
export interface ZoneLabel {
  region: ProviderRegion;
  label: string;
  source: ObservationSource;
}

/** Masks forwarded to the same session for in-browser region maths. Provider mask URLs (2 h validity) never leave the
 * service; masks are sent as `data:image/png;base64,...`, held only in the 30-min in-memory result, never written to D1,
 * logs or the downloaded log file. 600x800 RGBA PNG in the provider's image pixel space. */
export type MaskKind = "acne" | "redness" | "t_zone" | "u_zone";
export type MaskSet = Partial<Record<MaskKind, string>>;

/** GET /api/analyses/:id — 200: GetAnalysisResponse (observations empty until succeeded). */
export interface GetAnalysisResponse {
  job: AnalysisJob;
  observations: Observation[];
  /** skin_type labels; empty until succeeded or when not returned. */
  zoneLabels: ZoneLabel[];
  /** Present only for succeeded live/mock jobs while the result is held; absent after expiry/delete. */
  masks?: MaskSet;
}

export const API_ROUTES = {
  createAnalysis: "/api/analyses",
  getAnalysis: (id: string) => `/api/analyses/${encodeURIComponent(id)}`,
} as const;

/** Suggested client poll interval and UI timeout. */
export const POLLING = { intervalMs: 10_000, uiTimeoutMs: 120_000 } as const;

/** Provider-side cleanup status, reported separately from local deletion (R1 blocker 1). */
export type ProviderCleanup =
  | "deleted" // provider task/delete returned success
  | "pending" // not yet attempted or will be retried (scheduled sweep or next DELETE)
  | "failed" // last attempt failed; retry possible via DELETE again or the scheduled sweep
  | "not_applicable" // mock mode or no provider task was ever created
  | "unknown_task"; // task creation outcome was ambiguous; no task id to delete (provider 30-day retention applies)

/**
 * DELETE /api/analyses/:id — 200 DeleteAnalysisResponse. Local access is revoked immediately (later GET -> 404).
 * Idempotent: repeating DELETE on an already-deleted job returns 200 with the current cleanup status and retries
 * provider cleanup when it is "pending" or "failed". Never-existing id: ApiError 404.
 */
export interface DeleteAnalysisResponse {
  local: "deleted";
  provider: ProviderCleanup;
}
export const DELETE_ANALYSIS_ROUTE = API_ROUTES.getAnalysis;
