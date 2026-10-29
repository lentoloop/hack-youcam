import { describe, it, expect } from "../../service/node_modules/vitest";
import {
  LiveAdapter,
  outboundFetch,
  MockAdapter,
  createAdapter,
  validStorageUrl,
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
          results: { output: [{ type: "acne", raw_score: 75, ui_score: 70, url: null }, { score: 84.5 }, { type: "unknown", raw_score: 50 }] },
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
    expect(calls.every(call => call.init.redirect === "manual")).toBe(true);
    expect(calls[1].init.headers).toEqual({ "Content-Length": String(image.bytes.length), "Content-Type": "image/jpeg" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ files: [{ content_type: "image/jpeg", file_name: "capture.jpg", file_size: image.bytes.length }] });
    expect(JSON.parse(calls[2].init.body).format).toBe("json");
    expect(calls[1].init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[2].init.body).dst_actions).toEqual([
      "acne",
      "redness",
      "texture",
      "skin_type",
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

import run2 from "../../service/fixtures/live-sample-result.json";
import { run2Masks } from "../../service/fixtures/run2-masks";
const pngs: Record<string, string> = { URL_4: run2Masks.acne!, URL_3: run2Masks.redness!, URL_6: run2Masks.t_zone!, URL_7: run2Masks.u_zone! };
function sample() {
  const data = structuredClone(run2.json.data);
  for (const row of data.results.output)
    if (row.mask_urls) row.mask_urls = row.mask_urls.map(v => `https://mask.example/${v}`);
  return { data };
}
function png(token: string) {
  return Uint8Array.from(atob(pngs[token].split(",")[1]), c => c.charCodeAt(0));
}
it("normalizes run2 evidence, fetching exactly four real PNGs without leaking URLs", async () => {
  const calls: string[] = [];
  const a = new LiveAdapter("fake", (async (url: any, init: any) => {
    calls.push(String(url));
    if (String(url).includes("/skin-analysis/")) return Response.json(sample());
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("manual");
    return new Response(png(String(url).split("/").pop()!));
  }) as typeof fetch);
  const result = await a.poll("t");
  expect(result).toMatchObject({ state: "succeeded", masks: run2Masks });
  if (result.state !== "succeeded") throw Error("Expected success");
  expect(result.observations).toHaveLength(3);
  expect(result.zoneLabels).toEqual([
    { region: "whole", label: "Combination & Sensitive", source: "live" },
    { region: "t_zone", label: "Oily", source: "live" },
    { region: "u_zone", label: "Dry & Sensitive", source: "live" },
  ]);
  expect(calls.slice(1).sort()).toEqual(Object.keys(pngs).map(k => "https://mask.example/" + k).sort());
  expect(JSON.stringify(result)).not.toMatch(/https?:|URL_\d|mask_urls/);
});
it.each(["oversize", "header-oversize", "not-png", "http", "failure"])("drops only invalid acne mask: %s", async kind => {
  const body = sample();
  if (kind === "http") body.data.results.output.find(r => r.type === "acne")!.mask_urls = ["http://mask.example/URL_4"];
  const calls: string[] = [];
  const a = new LiveAdapter("fake", (async (url: any) => {
    calls.push(String(url));
    if (String(url).includes("/skin-analysis/")) return Response.json(body);
    const token = String(url).split("/").pop()!;
    if (token === "URL_4") {
      if (kind === "failure") throw Error("Private provider URL");
      if (kind === "oversize") return new Response(new Uint8Array(512 * 1024 + 1));
      if (kind === "header-oversize") return new Response(png(token), { headers: { "content-length": String(512 * 1024 + 1) } });
      return new Response("not a PNG");
    }
    return new Response(png(token));
  }) as typeof fetch);
  const result = await a.poll("t");
  if (result.state !== "succeeded") throw Error("Expected success");
  expect(Object.keys(result.masks).sort()).toEqual(["redness", "t_zone", "u_zone"]);
  expect(result.observations).toHaveLength(3);
  expect(JSON.stringify(result)).not.toMatch(/https?:|Private provider/);
  if (kind === "http") expect(calls.some(c => c.startsWith("http:"))).toBe(false);
});
it("ignores invalid scores, unknown regions, and scored skin_type", async () => {
  const body = { data: { task_status: "success", results: { output: [
    { type: "acne", raw_score: 0 }, { type: "redness", raw_score: 101 },
    { type: "texture", raw_score: 1, ui_score: 101 },
    { type: "acne", raw_score: 100, ui_score: 1 },
    { type: "skin_type", raw_score: 50, region: "unknown", skin_type: "Oily" },
  ] } } };
  const result = await new LiveAdapter("fake", async () => Response.json(body)).poll("t");
  expect(result).toEqual({ state: "succeeded", observations: [
    { concern: "texture", rawScore: 1, source: "live" },
    { concern: "acne", rawScore: 100, uiScore: 1, source: "live" },
  ], zoneLabels: [], masks: {} });
});

it.each(['http://cdn.example/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://user:pass@cdn.example/x', 'https://cdn.example:444/x', 'https://localhost/x', 'https://a.internal/x'])('rejects unsafe storage destination %s', url => {
  expect(validStorageUrl(new URL(url))).toBe(false);
});
it('bounds suffix matches to host labels', () => {
  expect(validStorageUrl(new URL('https://cdn.example/x'), 'example')).toBe(true);
  expect(validStorageUrl(new URL('https://badexample/x'), 'example')).toBe(false);
  expect(validStorageUrl(new URL('https://other.example/x'), 'approved.example')).toBe(false);
});
it.each(['truncated', 'huge', 'rgb'])('omits a bad IHDR before returning mask: %s', async kind => {
  const a = new LiveAdapter('fake', (async url => {
    if (String(url).includes('/skin-analysis/')) return Response.json(sample());
    const token = String(url).split('/').pop()!;
    const bytes = png(token);
    if (token === 'URL_4') {
      if (kind === 'truncated') return new Response(bytes.slice(0,8));
      if (kind === 'huge') bytes[16] = 127;
      if (kind === 'rgb') bytes[25] = 2;
    }
    return new Response(bytes);
  }) as typeof fetch);
  const result = await a.poll('t');
  expect(result).toMatchObject({state:'succeeded', masks:{redness:run2Masks.redness}});
  if (result.state === 'succeeded') expect(result.masks.acne).toBeUndefined();
});

it.each(['submit', 'poll', 'deleteTask'] as const)('rejects provider API redirects during %s', async operation => {
  const adapter = new LiveAdapter('synthetic', async (_url, init) => {
    expect(init?.redirect).toBe('manual');
    return new Response(null, { status: 307, headers: { location: '/redirect' } });
  });
  const result = operation === 'submit' ? adapter.submit(image) : adapter[operation]('private');
  await expect(result).rejects.toMatchObject({ code: 'provider_error', status: 502 });
});

it.each([301, 302, 303, 304, 307, 308, 399, 0, 'opaque'] as const)('rejects redirect-like response %s with one dispatch', async status => {
  let calls = 0;
  const response = status === 0 ? Response.error() : status === 'opaque'
    ? { status: 200, type: 'opaqueredirect' } as Response
    : new Response(null, { status, headers: { location: 'https://never.example/' } });
  await expect(outboundFetch(async (_url, init) => {
    calls++;
    expect(init?.redirect).toBe('manual');
    return response;
  }, 'https://provider.example')).rejects.toMatchObject({ code: 'provider_error', status: 502, message: 'Outbound redirect response rejected.' });
  expect(calls).toBe(1);
});
it('rejects an upload redirect before task submission', async () => {
  const calls: string[] = [];
  const adapter = new LiveAdapter('synthetic', async (url, init) => {
    calls.push(String(url));
    expect(init?.redirect).toBe('manual');
    return calls.length === 1 ? Response.json({ data: { files: [{ file_id: 'f', requests: [{ url: 'https://upload.example/x' }] }] } })
      : new Response(null, { status: 307, headers: { location: 'https://never.example/' } });
  });
  await expect(adapter.submit(image)).rejects.toMatchObject({ code: 'provider_error', safeToRelease: true, message: 'Outbound redirect response rejected.' });
  expect(calls).toHaveLength(2);
});
it('omits redirected masks without following or losing scores', async () => {
  const calls: string[] = [];
  const adapter = new LiveAdapter('synthetic', async (url, init) => {
    calls.push(String(url));
    expect(init?.redirect).toBe('manual');
    return calls.length === 1 ? Response.json(sample()) : new Response(null, { status: 302, headers: { location: 'https://never.example/' } });
  });
  const result = await adapter.poll('t');
  expect(result).toMatchObject({ state: 'succeeded', masks: {} });
  if (result.state === 'succeeded') expect(result.observations).toHaveLength(3);
  expect(calls).toHaveLength(5);
  expect(calls.some(url => url.includes('never.example'))).toBe(false);
});
it.each(['', ' ', '.', ' , . , ', '*', '*.example.com', 'example.com,*', '..', 'https://example.com'])('rejects malformed live allowlist %s', suffixes => {
  expect(() => createAdapter({ YOUCAM_MODE: 'live', YOUCAM_API_KEY: 'synthetic', YOUCAM_STORAGE_HOST_SUFFIXES: suffixes } as any)).toThrow('allowlist');
});

it.each([
  { results: [{ amount_dec: '980' }, { amount_dec: 6 }] },
  { data: { results: [{ amount_dec: '986' }] } },
])('parses provider credit without exposing or following another host', async body => {
  let calls=0;
  const adapter=new LiveAdapter('synthetic',async (url,init)=>{
    calls++;
    expect(url).toBe('https://yce-api-01.makeupar.com/s2s/v1.0/client/credit');
    expect(init?.redirect).toBe('manual');
    expect(init?.method).toBeUndefined();
    return Response.json(body);
  });
  expect(await adapter.creditBalance()).toBe(986);
  expect(calls).toBe(1);
});
it.each([null, {}, {results:[]}, {results:[null]}, {results:[{amount_dec:''}]}, {results:[{amount_dec:null}]}, {results:[{amount_dec:-1}]}, {results:[{amount_dec:'NaN'}]}])('fails closed for malformed credit %j', async body => {
  const adapter=new LiveAdapter('synthetic',async()=>Response.json(body));
  await expect(adapter.creditBalance()).rejects.toMatchObject({code:'live_unavailable',status:503});
});
it.each([503,307])('fails closed for credit HTTP %s without another request',async status=>{
  let calls=0;
  const adapter=new LiveAdapter('synthetic',async()=>{calls++;return new Response(null,{status});});
  await expect(adapter.creditBalance()).rejects.toMatchObject({code:'live_unavailable',status:503});
  expect(calls).toBe(1);
});
it('tracks an allocated provider file even when its upload response is lost',async()=>{
  const adapter=new LiveAdapter('synthetic',async url=>{
    if(String(url).endsWith('/file'))return Response.json({data:{files:[{file_id:'synthetic-file',requests:[{url:'https://storage.example.com/upload'}]}]}});
    throw Error('Synthetic upload connection failure');
  },'storage.example.com');
  await expect(adapter.submit(image)).rejects.toMatchObject({safeToRelease:true,fileCreated:true});
});
