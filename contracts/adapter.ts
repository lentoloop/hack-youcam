/** FROZEN CONTRACT (Kai, 2026-10-24). Mode switch: YOUCAM_MODE=mock|live picks the adapter; same interface. */
import type { AnalysisErrorCode, Observation, YoucamMode } from "./analysis";

export interface NormalizedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg";
  width: number;
  height: number;
  /** SHA-256 hex of bytes; session-scoped dedupe only. */
  sha256: string;
}

export type ProviderPoll =
  | { state: "running" }
  | { state: "succeeded"; observations: Observation[] }
  | { state: "failed"; code: AnalysisErrorCode; message: string };

/**
 * Live flow: POST /s2s/v2.0/file -> upload bytes -> POST /s2s/v2.0/task/skin-analysis
 * (dst_actions = CONCERNS, format json) -> GET /s2s/v2.0/task/skin-analysis/{task_id}.
 * Mock flow: deterministic fixtures (success, no_face, small_face, timeout).
 */
export interface SkinAnalysisAdapter {
  readonly mode: YoucamMode;
  /** Upload + create task. Returns provider task id. Must not log image bytes or URLs. */
  submit(image: NormalizedImage): Promise<{ providerTaskId: string }>;
  poll(providerTaskId: string): Promise<ProviderPoll>;
}

export interface AdapterEnv {
  YOUCAM_MODE: YoucamMode;
  /** Server-side only. Empty/missing in live mode -> "live_unavailable", no silent fallback. */
  YOUCAM_API_KEY?: string;
}

export type AdapterFactory = (env: AdapterEnv) => SkinAnalysisAdapter;
