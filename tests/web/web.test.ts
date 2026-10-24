import { describe, it, expect, vi } from "../../web/node_modules/vitest";
import { ANALYSIS_ERROR_CODES, type DecideFn } from "../../contracts";
import { resizedDimensions } from "../../web/src/image";
import { ERROR_MESSAGES, createApi, AnalysisError } from "../../web/src/api";
import { renderResults } from "../../web/src/results";
import { SAMPLE } from "../../web/src/sample";
describe("image dimensions", () => {
  it("never upscales", () => {
    expect(resizedDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    expect(resizedDimensions(4000, 3000)).toEqual({
      width: 2560,
      height: 1920,
    });
  });
  it("rejects short sides below 480 and extreme aspect ratios", () => {
    expect(() => resizedDimensions(479, 800)).toThrow();
    expect(() => resizedDimensions(8000, 480)).toThrow();
  });
});
it("covers every error code", () => {
  expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(
    [...ANALYSIS_ERROR_CODES].sort(),
  );
  for (const message of Object.values(ERROR_MESSAGES))
    expect(message.length).toBeGreaterThan(20);
});
it("ownership recomputes locally without fetch", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const decide: DecideFn = vi.fn<DecideFn>((_o, _g, owned) => ({
    action: owned.includes("moisture")
      ? "use_existing_first"
      : "consider_category",
    nextStep: "Use one next step.",
    reasons: [],
  }));
  const root = document.createElement("div");
  renderResults(root, SAMPLE, decide);
  document.body.append(root);
  const input = root.querySelector<HTMLInputElement>(
    '[aria-label="Already own moisture"]',
  )!;
  input.click();
  expect(decide).toHaveBeenCalledTimes(2);
  expect(root.textContent).toContain("Use your existing product first");
  expect(fetcher).not.toHaveBeenCalled();
  root.remove();
  vi.unstubAllGlobals();
});
it.each(["live", "sample", "mock"] as const)("renders %s source", (source) => {
  const root = document.createElement("div");
  renderResults(
    root,
    SAMPLE.map((o) => ({ ...o, source })),
  );
  expect(root.textContent).toContain(
    { live: "Live", sample: "Sample (pre-analyzed)", mock: "Mock" }[source],
  );
});
it("sends multipart contract and maps API errors", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ error: { code: "quota_exhausted" } }, { status: 429 }),
    );
  const api = createApi(fetcher);
  await expect(api.get("a/b")).rejects.toBeInstanceOf(AnalysisError);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/analyses/a%2Fb");
});

import { pollJob } from "../../web/src/poll";
import { POLLING, type GetAnalysisResponse } from "../../contracts";
it("polls at the contract interval and stops on completion", async () => {
  vi.useFakeTimers();
  const result: GetAnalysisResponse = {
    job: {
      id: "kept-id",
      state: "succeeded",
      mode: "mock",
      source: "mock",
      createdAt: "now",
      updatedAt: "now",
    },
    observations: SAMPLE,
  };
  const get = vi.fn().mockResolvedValue(result);
  const done = vi.fn();
  pollJob(get, done, vi.fn(), vi.fn());
  expect(get).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(POLLING.intervalMs);
  expect(done).toHaveBeenCalledWith(result);
  await vi.advanceTimersByTimeAsync(POLLING.uiTimeoutMs);
  expect(get).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
it("shows timeout even if a poll hangs and ignores late results", async () => {
  vi.useFakeTimers();
  let resolve!: (value: GetAnalysisResponse) => void;
  const pending = new Promise<GetAnalysisResponse>((r) => {
    resolve = r;
  });
  const get = vi.fn(() => pending);
  const done = vi.fn();
  const timeout = vi.fn();
  pollJob(get, done, vi.fn(), timeout);
  await vi.advanceTimersByTimeAsync(POLLING.uiTimeoutMs);
  expect(timeout).toHaveBeenCalledTimes(1);
  resolve({
    job: {
      id: "same-id",
      state: "succeeded",
      mode: "mock",
      source: "mock",
      createdAt: "now",
      updatedAt: "now",
    },
    observations: SAMPLE,
  });
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

it("orients and re-encodes a JPEG without upscaling, then releases the bitmap", async () => {
  const close = vi.fn();
  const drawImage = vi.fn();
  const bitmap = { width: 800, height: 600, close };
  const decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal("createImageBitmap", decode);
  const context = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) =>
      callback(new Blob(["jpeg"], { type: "image/jpeg" })),
    );
  try {
    const { prepareImage } = await import("../../web/src/image");
    const file = new File(["source"], "photo.jpg");
    const result = await prepareImage(file);
    expect(decode).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 800, 600);
    expect(result.blob.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalledOnce();
  } finally {
    context.mockRestore();
    encode.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("runs sample without fetch and clears session data at 30 minutes", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  document.body.innerHTML = '<div id="app"></div>';
  try {
    await import("../../web/src/main");
    const agree = document.querySelector<HTMLInputElement>("#agree")!;
    const next = document.querySelector<HTMLButtonElement>("#continue")!;
    expect(next.disabled).toBe(true);
    agree.click();
    expect(next.disabled).toBe(false);
    next.click();
    expect(document.querySelector<HTMLElement>("#capture")!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("#sample")!.click();
    expect(document.querySelector("#results")!.textContent).toContain(
      "Sample (pre-analyzed)",
    );
    expect(
      document.querySelector(
        '[aria-label="Placeholder silhouette, not a real face"]',
      ),
    ).not.toBeNull();
    expect(network).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(document.querySelector("#results")!.textContent).toBe("");
    expect(document.querySelector<HTMLElement>("#capture")!.hidden).toBe(true);
    expect(agree.checked).toBe(false);
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
