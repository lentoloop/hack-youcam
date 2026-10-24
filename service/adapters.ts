import { run2Masks } from "./fixtures/run2-masks";
import {
  CONCERNS,
  SCORED_CONCERNS,
  type MaskSet,
  type MaskKind,
  type ZoneLabel,
  type AdapterEnv,
  type AnalysisErrorCode,
  type NormalizedImage,
  type Observation,
  type ProviderPoll,
  type SkinAnalysisAdapter,
} from "../contracts";
export class ServiceError extends Error {
  constructor(
    public code: AnalysisErrorCode,
    message: string,
    public status = 400,
    public safeToRelease = false,
  ) {
    super(message);
  }
}
export type MockFixture =
  "success" | "error_no_face" | "error_src_face_too_small" | "timeout";
export class MockAdapter implements SkinAnalysisAdapter {
  readonly mode = "mock" as const;
  constructor(private fixture: MockFixture = "success") {}
  async submit(_image: NormalizedImage) {
    return { providerTaskId: `mock:${this.fixture}` };
  }
  async poll(id: string): Promise<ProviderPoll> {
    const fixture = id.split(":")[1];
    if (fixture === "timeout") return { state: "running" };
    if (fixture === "error_no_face" || fixture === "error_src_face_too_small")
      return {
        state: "failed",
        code: fixture,
        message: "Synthetic mock fixture: retake the photo.",
      };
    return {
      state: "succeeded",
      observations: SCORED_CONCERNS.map((concern, i) => ({
        concern,
        rawScore: 40 + i * 10,
        source: "mock",
      })),
      zoneLabels: [
        { region: "whole", label: "Combination & Sensitive", source: "mock" },
        { region: "t_zone", label: "Oily", source: "mock" },
        { region: "u_zone", label: "Dry & Sensitive", source: "mock" },
      ],
      masks: { ...run2Masks },
    };
  }
}
const HOST = "https://yce-api-01.makeupar.com";
export class LiveAdapter implements SkinAnalysisAdapter {
  readonly mode = "live" as const;
  constructor(
    private key: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async api(path: string, body?: unknown): Promise<any> {
    const res = await this.fetcher(HOST + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: ["Bearer", this.key].join(" "),
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok)
      throw new ServiceError(
        "provider_error",
        "The analysis provider could not complete the request.",
        502,
      );
    return ((await res.json()) as any).data;
  }
  async submit(image: NormalizedImage) {
    let taskSubmissionStarted = false;
    try {
      const data = await this.api("/s2s/v2.0/file", {
        files: [
          {
            content_type: "image/jpeg",
            file_name: "capture.jpg",
            file_size: image.bytes.length,
          },
        ],
      });
      const file = data?.files?.[0],
        instruction = file?.requests?.[0];
      if (!file?.file_id || !instruction?.url)
        throw new ServiceError(
          "provider_error",
          "Unsupported provider upload instructions.",
          502,
        );
      const url = new URL(instruction.url);
      if (url.protocol !== "https:")
        throw new ServiceError(
          "provider_error",
          "Invalid upload destination.",
          502,
        );
      const upload = await this.fetcher(url, {
        method: instruction.method ?? "PUT",
        headers: instruction.headers ?? { "Content-Type": "image/jpeg" },
        body: image.bytes as BodyInit,
        signal: AbortSignal.timeout(20000),
      });
      if (!upload.ok)
        throw new ServiceError("provider_error", "Image upload failed.", 502);
      taskSubmissionStarted = true;
      const task = await this.api("/s2s/v2.0/task/skin-analysis", {
        src_file_id: file.file_id,
        dst_actions: [...CONCERNS],
        format: "json",
      });
      if (typeof task?.task_id !== "string")
        throw new ServiceError(
          "provider_error",
          "Missing provider task identifier.",
          502,
        );
      return { providerTaskId: task.task_id };
    } catch (error) {
      // A failure before task creation cannot consume analysis units. Once task
      // creation starts, even an unreadable response is ambiguous: keep the hold.
      if (!taskSubmissionStarted)
        throw new ServiceError(
          "provider_error",
          "Image upload could not be completed.",
          502,
          true,
        );
      throw error;
    }
  }
  async deleteTask(taskId: string): Promise<void> {
    await this.api("/s2s/v2.0/task/delete", { task_id: taskId });
  }
  private async downloadMask(value: unknown): Promise<string | undefined> {
    try {
      if (typeof value !== "string" || new URL(value).protocol !== "https:") return;
      const response = await this.fetcher(value, {
        signal: AbortSignal.timeout(10000), redirect: "error",
      });
      if (!response.ok) return;
      if (Number(response.headers.get("content-length")) > 512 * 1024) {
        await response.body?.cancel();
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 512 * 1024) { await reader.cancel(); return; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return;
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return "data:image/png;base64," + btoa(binary);
    } catch { return; } // Masks are optional; never expose provider URLs or errors.
  }
  async poll(id: string): Promise<ProviderPoll> {
    const data = await this.api(
      `/s2s/v2.0/task/skin-analysis/${encodeURIComponent(id)}`,
    );
    if (data?.task_status === "running")
      return { state: "running" };
    if (data?.task_status === "error") {
      const code = data.error;
      return {
        state: "failed",
        code:
          code === "error_no_face" || code === "error_src_face_too_small"
            ? code
            : "provider_error",
        message: "The provider could not analyze this capture.",
      };
    }
    if (data?.task_status !== "success" || !Array.isArray(data.results?.output))
      throw new ServiceError(
        "provider_error",
        "Unsupported provider result.",
        502,
      );
    const observations: Observation[] = data.results.output
      .filter(
        (r: any) =>
          SCORED_CONCERNS.includes(r.type) &&
          Number.isFinite(r.raw_score) &&
          r.raw_score >= 1 &&
          r.raw_score <= 100,
      )
      .map((r: any) => ({
        concern: r.type,
        rawScore: r.raw_score,
        source: "live",
        ...(Number.isFinite(r.ui_score) && r.ui_score >= 1 && r.ui_score <= 100
          ? { uiScore: r.ui_score }
          : {}),
      }));
    const zoneLabels: ZoneLabel[] = data.results.output
      .filter((r: any) => r.type === "skin_type" &&
        ["whole", "t_zone", "u_zone"].includes(r.region) && typeof r.skin_type === "string")
      .map((r: any) => ({ region: r.region, label: r.skin_type, source: "live" }));
    const masks: MaskSet = {};
    await Promise.all((["acne", "redness", "t_zone", "u_zone"] as MaskKind[]).map(async key => {
      const row = data.results.output.find((r: any) =>
        key === "acne" || key === "redness" ? r.type === key :
          r.type === "skin_type" && r.region === key);
      const mask = await this.downloadMask(row?.mask_urls?.[0]);
      if (mask) masks[key] = mask;
    }));
    return { state: "succeeded", observations, zoneLabels, masks };
  }
}
export function createAdapter(
  env: AdapterEnv,
  fetcher: typeof fetch = fetch,
): SkinAnalysisAdapter {
  if (env.YOUCAM_MODE === "mock") return new MockAdapter();
  if (env.YOUCAM_MODE !== "live" || !env.YOUCAM_API_KEY)
    throw new ServiceError(
      "live_unavailable",
      "Live analysis is unavailable.",
      503,
    );
  return new LiveAdapter(env.YOUCAM_API_KEY, fetcher);
}
