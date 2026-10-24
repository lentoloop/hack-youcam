import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "../../service/node_modules/vitest";
import { handle, scheduled, type Env } from "../../service/worker";
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
    expect(result.observations).toHaveLength(3);
    expect(result.zoneLabels).toHaveLength(3);
    expect(Object.keys(result.masks).sort()).toEqual(["acne", "redness", "t_zone", "u_zone"]);
    const held: any = await (await handle(get(), e)).json();
    expect(held.zoneLabels).toEqual(result.zoneLabels);
    expect(held.masks).toEqual(result.masks);
    const rows = await e.DB.prepare("SELECT * FROM jobs").bind().all();
    expect(JSON.stringify(rows)).not.toMatch(/data:image|Combination|Sensitive|zoneLabels|masks/);
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
    expect(result.job).not.toHaveProperty("providerTaskId");
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
  expect((await handle(new Request(url, { method: 'DELETE' }), e)).status).toBe(200);
  if (completed) expect(await query()).toEqual(before);
  else expect(JSON.stringify(await query())).toContain('abandoned');
  for (const method of ['GET']) {
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
    expect((await handle(new Request(url, { method: 'DELETE' }), e)).status).toBe(200);
    resolve({ state: 'succeeded', observations: [{ concern: 'acne', rawScore: 40, source: 'mock' }], zoneLabels: [], masks: {} });
    expect((await pending).status).toBe(404);
    expect((await handle(new Request(url), e)).status).toBe(404);
  } finally { poll.mockRestore(); }
});
it.each([false, true])("locally deletes live jobs when provider cleanup fails=%s", async (fails) => {
  const { LiveAdapter } = await import("../../service/adapters");
  const submit = vi.spyOn(LiveAdapter.prototype, "submit").mockResolvedValue({ providerTaskId: "synthetic-task" });
  const cleanup = vi.spyOn(LiveAdapter.prototype, "deleteTask").mockImplementation(async () => {
    if (fails) throw new Error("synthetic provider failure");
  });
  try {
    const e = env();
    e.YOUCAM_MODE = "live";
    e.YOUCAM_API_KEY = "synthetic-key";
    const response = await handle(request(), e);
    expect(response.status).toBe(202);
    const created: any = await response.json();
    const url = "https://local/api/analyses/" + created.job.id;
    expect((await handle(new Request(url, { method: "DELETE" }), e)).status).toBe(200);
    expect(cleanup).toHaveBeenCalledWith("synthetic-task");
    cleanup.mockResolvedValue(undefined);
    const retry = await handle(new Request(url, {method:'DELETE'}), e);
    expect(await retry.json()).toEqual({local:'deleted', provider:'deleted'});
    expect(cleanup).toHaveBeenCalledTimes(fails ? 2 : 1);
    expect((await e.DB.prepare('SELECT provider_task_id FROM jobs WHERE id=?').bind(created.job.id).all()).results).toEqual([{provider_task_id:null}]);
    expect((await handle(new Request(url), e)).status).toBe(404);
  } finally { submit.mockRestore(); cleanup.mockRestore(); }
});

it('sweep retries cleanup with fake fetch, nulls handles, abandons slots and marks ambiguous creation', async () => {
  const e = env(); e.YOUCAM_MODE = 'live'; e.YOUCAM_API_KEY = 'synthetic';
  const now = new Date(Date.now()-1900000).toISOString();
  for (const id of ['a','b','unknown']) {
    await e.DB.prepare("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id,submit_started) VALUES(?,'running','live',?,?,?, ?,1)").bind(id,now,now,id,id === 'unknown' ? null : id).run();
    await e.DB.prepare("INSERT INTO reservations(id,pool,ip_hash,session_id,image_sha,day,units,created_at) VALUES(?,'public',?,?,?,'2026-10-24',9,0)").bind(id,id,id,id).run();
  }
  const bad = vi.fn(async () => new Response('{}', {status:503}));
  await scheduled({},e,{},bad as typeof fetch);
  expect(bad).toHaveBeenCalledTimes(2);
  const good = vi.fn(async () => Response.json({data:{}}));
  await scheduled({},e,{},good as typeof fetch);
  expect(good).toHaveBeenCalledTimes(2);
  const rows = await e.DB.prepare('SELECT provider_task_id,cleanup_status,cleanup_attempts FROM jobs ORDER BY id').bind().all();
  expect(rows.results).toEqual([
    {provider_task_id:null,cleanup_status:'deleted',cleanup_attempts:2},
    {provider_task_id:null,cleanup_status:'deleted',cleanup_attempts:2},
    {provider_task_id:null,cleanup_status:'unknown_task',cleanup_attempts:0},
  ]);
  const { D1BudgetGuard, D1Executor } = await import('../../service/budget');
  const g = new D1BudgetGuard(new D1Executor(e.DB));
  expect((await g.status()).remainingByPool.judge).toBe(450);
  expect((await g.reserve({pool:'judge',ipHash:'judge',sessionId:'judge',imageSha256:'judge',units:9})).ok).toBe(true);
});
it('privacy document contains exact frozen consent', async () => {
  const { readFileSync } = await import('node:fs');
  const { CONSENT_TEXT } = await import('../../contracts');
  expect(readFileSync(new URL('../../docs/PRIVACY.md',import.meta.url),'utf8')).toContain(CONSENT_TEXT);
});
it('two public DELETEs free judge concurrency without returning held units', async () => {
  const e = env();
  const ids: string[] = [];
  for (const sessionId of ['public-session-0001', 'public-session-0002']) {
    const created: any = await (await handle(request({sessionId}),e)).json();
    ids.push(created.job.id);
  }
  for (const id of ids) expect((await handle(new Request('https://local/api/analyses/'+id,{method:'DELETE'}),e)).status).toBe(200);
  const { D1BudgetGuard, D1Executor } = await import('../../service/budget');
  const sql = new D1Executor(e.DB);
  const g = new D1BudgetGuard({all:(q,a)=>sql.all(q.replaceAll('reservations','mock_reservations'),a),run:(q,a)=>sql.run(q.replaceAll('reservations','mock_reservations'),a)});
  expect((await g.status()).reservedUnits).toBe(18);
  expect((await g.status()).remainingByPool.judge).toBe(450);
  expect((await g.reserve({pool:'judge',ipHash:'judge',sessionId:'judge',imageSha256:'judge',units:9})).ok).toBe(true);
});
