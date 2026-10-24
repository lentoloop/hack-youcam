import { describe, it, expect } from "../../service/node_modules/vitest";
import {
  LiveAdapter,
  MockAdapter,
  createAdapter,
} from "../../service/adapters";
import { jpegDimensions, normalizeImage } from "../../service/image";
import { jpeg } from "./helpers";
const image = {
  bytes: jpeg(),
  width: 480,
  height: 640,
  contentType: "image/jpeg" as const,
  sha256: "synthetic",
};
describe("adapters and image validation", () => {
  it("never silently falls back", () =>
    expect(() => createAdapter({ YOUCAM_MODE: "live" })).toThrow(
      "Live analysis is unavailable",
    ));
  it.each([
    "success",
    "error_no_face",
    "error_src_face_too_small",
    "timeout",
  ] as const)("synthetic fixture %s", async (fixture) => {
    const a = new MockAdapter(fixture);
    const t = await a.submit(image);
    const r = await a.poll(t.providerTaskId);
    expect(r.state).toBe(
      fixture === "success"
        ? "succeeded"
        : fixture === "timeout"
          ? "running"
          : "failed",
    );
    if (r.state === "succeeded")
      expect(r.observations.every((o) => o.source === "mock")).toBe(true);
  });
  it("runs live flow using fake fetch only", async () => {
    const calls: { url: string; init: any }[] = [];
    const responses = [
      {
        status: 200,
        data: {
          files: [
            {
              content_type: "image/jpeg",
              file_name: "capture.jpg",
              file_id: "file",
              requests: [
                {
                  url: "https://upload.example/image",
                  method: "PUT",
                  headers: { "Content-Length": String(image.bytes.length), "Content-Type": "image/jpeg" },
                },
              ],
            },
          ],
        },
      },
      {},
      { data: { task_id: "task" } },
      { data: { task_status: "running" } },
      {
        data: {
          task_status: "success",
          results: { output: [{ type: "moisture", raw_score: 75, ui_score: 70, url: null }, { score: 84.5 }, { type: "unknown", raw_score: 50 }] },
        },
      },
    ];
    const fake = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return Response.json(responses.shift());
    }) as typeof fetch;
    const a = new LiveAdapter("fake-key", fake);
    expect(await a.submit(image)).toEqual({ providerTaskId: "task" });
    expect(await a.poll("task")).toEqual({ state: "running" });
    expect(await a.poll("task")).toMatchObject({
      state: "succeeded",
      observations: [{ rawScore: 75, source: "live" }],
    });
    expect(calls[1].init.method).toBe("PUT");
    expect(calls[1].init.headers).toEqual({ "Content-Length": String(image.bytes.length), "Content-Type": "image/jpeg" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ files: [{ content_type: "image/jpeg", file_name: "capture.jpg", file_size: image.bytes.length }] });
    expect(JSON.parse(calls[2].init.body).format).toBe("json");
    expect(calls[1].init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[2].init.body).dst_actions).toEqual([
      "moisture",
      "oiliness",
      "redness",
      "texture",
    ]);
    expect(calls[0].init.headers.Authorization).toBe(["Bearer", "fake-key"].join(" "));
  });
  it("maps no-face provider failure", async () => {
    const a = new LiveAdapter("fake", async () =>
      Response.json({
        data: { task_status: "error", error: "error_no_face" },
      }),
    );
    expect(await a.poll("t")).toMatchObject({
      state: "failed",
      code: "error_no_face",
    });
  });
  it("rejects unknown provider schema", async () => {
    const a = new LiveAdapter("fake", async () =>
      Response.json({ data: { unknown: true } }),
    );
    await expect(a.poll("t")).rejects.toThrow("Unsupported provider result");
  });
  it("reads SOF dimensions", () =>
    expect(jpegDimensions(jpeg())).toEqual({ width: 480, height: 640 }));
  it.each([
    [479, 640],
    [480, 2561],
    [0, 0],
  ])("rejects dimensions %s %s", (w, h) =>
    expect(() => jpegDimensions(jpeg(w, h))).toThrow(),
  );
  it("rejects truncated JPEG", () =>
    expect(() => jpegDimensions(jpeg().slice(0, 10))).toThrow());
  it("rejects MIME spoof", async () => {
    await expect(
      normalizeImage(new File([jpeg()], "x.png", { type: "image/png" })),
    ).rejects.toThrow();
  });
});
it("holds the reservation when task creation returns an unknown shape", async () => {
  const responses = [
    {
      data: {
        files: [
          { file_id: "f", requests: [{ url: "https://upload.example/x" }] },
        ],
      },
    },
    {},
    { data: { unknown: "possibly-created-task" } },
  ];
  const a = new LiveAdapter("fake", async () =>
    Response.json(responses.shift()),
  );
  await expect(a.submit(image)).rejects.toMatchObject({ safeToRelease: false });
});
it("marks upload failure safe to release", async () => {
  const a = new LiveAdapter("fake", async () => {
    throw new Error("synthetic upload failure");
  });
  await expect(a.submit(image)).rejects.toMatchObject({ safeToRelease: true });
});

it.each(["error_src_face_too_small", "error_lighting_dark"])("maps error string %s", async (error) => {
  const a = new LiveAdapter("fake", async () => Response.json({ data: { task_status: "error", error } }));
  expect(await a.poll("t")).toMatchObject({ state: "failed", code: error === "error_src_face_too_small" ? error : "provider_error" });
});
it("rejects unauthorized responses", async () => {
  const a = new LiveAdapter("fake", async () => new Response(null, { status: 401 }));
  await expect(a.poll("t")).rejects.toMatchObject({ code: "provider_error", status: 502 });
  await expect(a.submit(image)).rejects.toMatchObject({ safeToRelease: true });
});
it("deletes a provider task", async () => {
  const calls: any[] = [];
  const a = new LiveAdapter("fake", (async (url, init) => { calls.push({ url, init }); return Response.json({ status: 200, data: {} }); }) as typeof fetch);
  await a.deleteTask("t");
  expect(calls[0].url).toBe("https://yce-api-01.makeupar.com/s2s/v2.0/task/delete");
  expect(JSON.parse(calls[0].init.body)).toEqual({ task_id: "t" });
});
