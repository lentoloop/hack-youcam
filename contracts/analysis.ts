/**
 * FROZEN CONTRACT (Kai, 2026-10-24). Sessions must not edit files under contracts/.
 * Changes go through Kai. Source: /workspace/eng/arch/youcam.md v0 (approved by wu 10/24 11:27).
 */

/** The four SD skin-analysis actions we request (4 SD actions = 9 units per success). */
export const CONCERNS = ["moisture", "oiliness", "redness", "texture"] as const;
export type Concern = (typeof CONCERNS)[number];

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

export const CONSENT_TEXT_VERSION = "2026-10-24.v1" as const;

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
  /** Provider task id, kept after timeout so polling can resume. */
  providerTaskId?: string;
  error?: ApiError["error"];
}

export interface CreateAnalysisResponse {
  job: AnalysisJob;
  /** true when the same image hash in this session matched an existing job (no new units). */
  deduplicated: boolean;
}

/** Normalized provider output for one concern. Scores pass through unchanged (1-100); direction unconfirmed, no severity thresholds invented. */
export interface Observation {
  concern: Concern;
  rawScore: number;
  uiScore?: number;
  source: ObservationSource;
}

/** GET /api/analyses/:id — 200: GetAnalysisResponse (observations empty until succeeded). */
export interface GetAnalysisResponse {
  job: AnalysisJob;
  observations: Observation[];
}

export const API_ROUTES = {
  createAnalysis: "/api/analyses",
  getAnalysis: (id: string) => `/api/analyses/${encodeURIComponent(id)}`,
} as const;

/** Suggested client poll interval and UI timeout. */
export const POLLING = { intervalMs: 10_000, uiTimeoutMs: 120_000 } as const;
