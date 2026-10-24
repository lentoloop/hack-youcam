import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "../../service/node_modules/vitest";
import { handle, type Env } from "../../service/worker";
import { CONSENT_TEXT_VERSION } from "../../contracts";
import { database, jpeg } from "./helpers";
function env(): Env {
  const { db } = database();
  return {
    YOUCAM_MODE: "mock",
    IP_HASH_SECRET: "test-only-synthetic-salt",
    DB: {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async all() {
                return { results: db.prepare(query).all(...args) };
              },
              async run() {
                return {
                  meta: { changes: db.prepare(query).run(...args).changes },
                };
              },
            };
          },
        };
      },
    } as any,
  };
}
function request(overrides: any = {}, bytes = jpeg(), type = "image/jpeg") {
  const form = new FormData();
  form.set("image", new File([bytes], "synthetic.jpg", { type }));
  form.set(
    "meta",
    JSON.stringify({
      sessionId: "random-session-000001",
      width: 480,
      height: 640,
      consent: {
        granted: true,
        textVersion: CONSENT_TEXT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
      ...overrides,
    }),
  );
  return new Request("https://local/api/analyses", {
    method: "POST",
    body: form,
    headers: { "CF-Connecting-IP": "192.0.2.1" },
  });
}
afterEach(() => vi.useRealTimers());
describe("Worker API using SQLite and synthetic SOF headers", () => {
  it("consent errors are uniform", async () => {
    const r = await handle(request({ consent: { granted: false } }), env());
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({
      error: { code: "consent_required", retryable: false },
    });
  });
  it("revalidates dimensions rather than trusting meta", async () => {
    const r = await handle(request({ width: 1000 }), env());
    expect(await r.json()).toMatchObject({ error: { code: "invalid_image" } });
  });
  it("rejects invalid JPEG bytes", async () => {
    expect(
      (await handle(request({}, new Uint8Array([1, 2, 3])), env())).status,
    ).toBe(400);
  });
  it("creates, dedupes, polls and expires results", async () => {
    vi.useFakeTimers();
    const e = env();
    const first: any = await (await handle(request(), e)).json();
    const second: any = await (await handle(request(), e)).json();
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    vi.advanceTimersByTime(10001);
    const get = () => new Request("https://local/api/analyses/" + first.job.id);
    const result: any = await (await handle(get(), e)).json();
    expect(result.job.state).toBe("succeeded");
    expect(result.observations).toHaveLength(4);
    vi.advanceTimersByTime(1800000);
    expect((await handle(get(), e)).status).toBe(404);
  });
  it.each(["error_no_face", "error_src_face_too_small"])(
    "releases failure %s",
    async (mockFixture) => {
      vi.useFakeTimers();
      const e = env();
      const first: any = await (
        await handle(request({ mockFixture }), e)
      ).json();
      vi.advanceTimersByTime(10001);
      const result: any = await (
        await handle(
          new Request("https://local/api/analyses/" + first.job.id),
          e,
        )
      ).json();
      expect(result.job.state).toBe("failed");
      expect(result.job.error.code).toBe(mockFixture);
    },
  );
  it("timeout retains the provider task and dedupe", async () => {
    vi.useFakeTimers();
    const e = env();
    const first: any = await (
      await handle(request({ mockFixture: "timeout" }), e)
    ).json();
    vi.advanceTimersByTime(120001);
    const result: any = await (
      await handle(new Request("https://local/api/analyses/" + first.job.id), e)
    ).json();
    expect(result.job.error.code).toBe("timeout");
    expect(result.job.providerTaskId).toBe(first.job.providerTaskId);
    const retry: any = await (await handle(request(), e)).json();
    expect(retry.deduplicated).toBe(true);
  });
  it("live without key never mocks", async () => {
    const e = env();
    e.YOUCAM_MODE = "live";
    const r = await handle(request(), e);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({
      error: { code: "live_unavailable" },
    });
  });
  it("unknown route returns uniform JSON", async () =>
    expect(
      await (await handle(new Request("https://local/missing"), env())).json(),
    ).toMatchObject({ error: { code: "not_found" } }));
});
it("mock runs consume only the mock ledger", async () => {
  const { db } = database();
  const e = env();
  e.DB = {
    prepare(query: string) {
      return {
        bind(...args: any[]) {
          return {
            async all() {
              return { results: db.prepare(query).all(...args) };
            },
            async run() {
              return {
                meta: { changes: db.prepare(query).run(...args).changes },
              };
            },
          };
        },
      };
    },
  } as any;
  await handle(request(), e);
  expect(
    db
      .prepare(
        "SELECT SUM(units) units FROM mock_reservations WHERE status='reserved'",
      )
      .get(),
  ).toEqual({ units: 9 });
  expect(db.prepare("SELECT COUNT(*) count FROM reservations").get()).toEqual({
    count: 0,
  });
});
it.each([false, true])('deletes completed=%s jobs and preserves accounting', async (completed) => {
  vi.useFakeTimers();
  const e = env();
  const created: any = await (await handle(request(), e)).json();
  const url = 'https://local/api/analyses/' + created.job.id;
  if (completed) { vi.advanceTimersByTime(10001); await handle(new Request(url), e); }
  const query = () => e.DB.prepare('SELECT * FROM mock_reservations').bind().all();
  const before = await query();
  expect((await handle(new Request(url, { method: 'DELETE' }), e)).status).toBe(204);
  expect(await query()).toEqual(before);
  for (const method of ['GET', 'DELETE']) {
    const response = await handle(new Request(url, { method }), e);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found', message: expect.any(String), retryable: false } });
  }
  expect((await handle(new Request('https://local/api/analyses/unknown', { method: 'DELETE' }), e)).status).toBe(404);
});
it('does not restore observations when a poll finishes after DELETE', async () => {
  vi.useFakeTimers();
  const { MockAdapter } = await import('../../service/adapters');
  let resolve!: (value: any) => void;
  const poll = vi.spyOn(MockAdapter.prototype, 'poll').mockImplementation(() => new Promise(r => { resolve = r; }));
  try {
    const e = env();
    const created: any = await (await handle(request(), e)).json();
    const url = 'https://local/api/analyses/' + created.job.id;
    vi.advanceTimersByTime(10001);
    const pending = handle(new Request(url), e);
    await vi.waitFor(() => expect(poll).toHaveBeenCalled());
    expect((await handle(new Request(url, { method: 'DELETE' }), e)).status).toBe(204);
    resolve({ state: 'succeeded', observations: [{ concern: 'moisture', rawScore: 40, source: 'mock' }] });
    expect((await pending).status).toBe(404);
    expect((await handle(new Request(url), e)).status).toBe(404);
  } finally { poll.mockRestore(); }
});
