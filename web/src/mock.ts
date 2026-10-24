import { type AnalysisJob } from "../../contracts";
import { SAMPLE } from "./sample";
export function mockFetch(): typeof fetch {
  let job: AnalysisJob | undefined;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      job = {
        id: crypto.randomUUID(),
        state: "running",
        mode: "mock",
        source: "mock",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return Response.json({ job, deduplicated: false }, { status: 202 });
    }
    if (!job)
      return Response.json(
        { error: { code: "not_found", retryable: false } },
        { status: 404 },
      );
    return Response.json({
      job: { ...job, state: "succeeded" },
      observations: SAMPLE.map((o) => ({ ...o, source: "mock" })),
    });
  }) as typeof fetch;
}
