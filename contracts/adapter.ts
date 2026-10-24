/** FROZEN CONTRACT (Kai, 2026-10-24). Mode switch: YOUCAM_MODE=mock|live picks the adapter; same interface. */
import type { AnalysisErrorCode, MaskSet, Observation, YoucamMode, ZoneLabel } from "./analysis";

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
  | { state: "succeeded"; observations: Observation[]; zoneLabels: ZoneLabel[]; masks: MaskSet }
  | { state: "failed"; code: AnalysisErrorCode; message: string };

/**
 * Live flow: POST /s2s/v2.0/file -> upload bytes -> POST /s2s/v2.0/task/skin-analysis
 * (dst_actions = CONCERNS, format json) -> GET /s2s/v2.0/task/skin-analysis/{task_id}.
 * On success the adapter downloads the acne, redness and skin_type t_zone/u_zone mask PNGs itself and returns them as
 * data URLs (MaskSet); provider URLs are never returned, logged or stored.
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
