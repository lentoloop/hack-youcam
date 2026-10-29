import { createRequire } from "node:module";
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from "../../service/node_modules/vitest";
import { D1Executor } from "../../service/budget";
import { LiveAdapter, MockAdapter } from "../../service/adapters";
import { handle, scheduled, type Env } from "../../service/worker";
import { CONSENT_TEXT_VERSION } from "../../contracts";
import { database, jpeg } from "./helpers";
function env(): Env {
  const { db } = database();
  return {
    YOUCAM_STORAGE_HOST_SUFFIXES: "example.com",
    YOUCAM_MODE: "mock",
    IP_HASH_SECRET: "test-only-synthetic-salt",
    DB: {
      async batch(statements: any[]) { return db.transaction(() => statements.map(s => s.execute()))(); },
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              execute() { return { meta: { changes: db.prepare(query).run(...args).changes } }; },
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
beforeEach(() => {
  vi.spyOn(LiveAdapter.prototype, "creditBalance").mockResolvedValue(986);
  vi.spyOn(LiveAdapter.prototype, "poll").mockResolvedValue({ state: "running" });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
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
    async batch(statements: any[]) { return db.transaction(() => statements.map(s => s.execute()))(); },
    prepare(query: string) {
      return {
        bind(...args: any[]) {
          return {
            execute() { return { meta: { changes: db.prepare(query).run(...args).changes } }; },
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
    count: 1,
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
  expect((await query()).results).toEqual(before.results.map((row: any) => ({ ...row, image_sha: "", status: "spent" })));
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
    poll.mockResolvedValueOnce({ state: 'running' });
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
    await e.DB.prepare("INSERT INTO reservations(id,pool,ip_hash,session_id,image_sha,day,units,created_at) VALUES(?,'public',?,?,?,'2026-07-30',9,0)").bind(id,id,id,id).run();
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
it('two public DELETEs settle completed provider units and preserve judge capacity', async () => {
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
  expect((await g.status()).spentUnits).toBe(18);
  expect((await g.status()).remainingByPool.judge).toBe(450);
  expect((await g.reserve({pool:'judge',ipHash:'judge',sessionId:'judge',imageSha256:'judge',units:9})).ok).toBe(true);
});

it('retains a handle recorded between cleanup snapshot and final write', async () => {
  const { cleanup } = await import('../../service/worker');
  const { D1Executor } = await import('../../service/budget');
  const e = env(); e.YOUCAM_MODE='live'; e.YOUCAM_API_KEY='synthetic';
  const sql = new D1Executor(e.DB), stamp = new Date().toISOString();
  await sql.run("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id) VALUES('race','queued','live',?,?,'race')", [stamp,stamp]);
  const row: any = (await sql.all('SELECT * FROM jobs'))[0];
  const run = sql.run.bind(sql); let injected = false;
  sql.run = async (q,a) => {
    if (!injected && q.startsWith('UPDATE jobs SET cleanup_status=')) {
      injected=true;
      await run("UPDATE jobs SET submit_started=1,submission_generation=1,provider_task_id='late',cleanup_status='pending' WHERE id='race'");
    }
    return run(q,a);
  };
  expect(await cleanup(row,e,sql,async () => new Response('{}',{status:503}))).toBe('failed');
  expect(await sql.all('SELECT provider_task_id,cleanup_status FROM jobs')).toEqual([{provider_task_id:'late',cleanup_status:'failed'}]);
});
it('concurrent cleanup failure cannot downgrade confirmed deletion', async () => {
  const { cleanup } = await import('../../service/worker');
  const { D1Executor } = await import('../../service/budget');
  const e = env(); e.YOUCAM_API_KEY='synthetic'; const sql=new D1Executor(e.DB);
  await sql.run("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id,submit_started) VALUES('race','running','live','','','race','handle',1)");
  const row:any=(await sql.all('SELECT * FROM jobs'))[0];
  let reject!: (e: Error)=>void;
  const failure=cleanup(row,e,sql,()=>new Promise((_r,j)=>{reject=j;}));
  await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));
  expect(await cleanup(row,e,sql,async()=>Response.json({data:{}}))).toBe('deleted');
  reject(Error('provider failure'));
  expect(await failure).toBe('deleted');
  expect(await sql.all('SELECT cleanup_status,provider_task_id FROM jobs')).toEqual([{cleanup_status:'deleted',provider_task_id:null}]);
});
it('submission observes cancellation after recording its late handle', async () => {
  const { LiveAdapter } = await import('../../service/adapters');
  let finish!: (v:any)=>void;
  const submit=vi.spyOn(LiveAdapter.prototype,'submit').mockImplementation(()=>new Promise(r=>{finish=r;}));
  const remove=vi.spyOn(LiveAdapter.prototype,'deleteTask').mockResolvedValue(undefined);
  try {
    const e=env(); e.YOUCAM_MODE='live'; e.YOUCAM_API_KEY='synthetic';
    const pending=handle(request(),e);
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const duplicate:any=await (await handle(request(),e)).json();
    await handle(new Request('https://local/api/analyses/'+duplicate.job.id,{method:'DELETE'}),e);
    finish({providerTaskId:'late-task'});
    expect((await pending).status).toBe(202);
    expect(remove).toHaveBeenCalledWith('late-task');
    expect((await e.DB.prepare('SELECT cleanup_status,provider_task_id FROM jobs').bind().all()).results).toEqual([{cleanup_status:'deleted',provider_task_id:null}]);
  } finally {submit.mockRestore();remove.mockRestore();}
});
it.each(['reservations','mock_reservations'])('sweep abandons interrupted %s while retaining held units',async table=>{
  const e=env();
  for(const id of ['orphan-a','orphan-b']) await e.DB.prepare(`INSERT INTO ${table}(id,pool,ip_hash,session_id,image_sha,day,units,created_at) VALUES(?,'public',?,?,?,'2026-07-30',9,0)`).bind(id,id,id,id).run();
  await scheduled({},e,{},async()=>{throw Error('No provider call expected');});
  const {D1BudgetGuard,D1Executor}=await import('../../service/budget'); const sql=new D1Executor(e.DB);
  const guard=new D1BudgetGuard({all:(q,a)=>sql.all(q.replaceAll('reservations',table),a),run:(q,a)=>sql.run(q.replaceAll('reservations',table),a)});
  expect(await guard.status()).toMatchObject({reservedUnits:18,remainingByPool:{judge:450,public:162}});
  expect((await guard.reserve({pool:'judge',ipHash:'judge',sessionId:'judge',imageSha256:'judge',units:9})).ok).toBe(true);
});
it.each(['failure', 'redirect', 'redirect-race'])('enforces sweep SQL and external caps with %s',async scenario=>{
  const e=env(); e.YOUCAM_API_KEY='synthetic';
  for(let i=0;i<8;i++) await e.DB.prepare("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id,submit_started) VALUES(?,'running','live','','',?,'handle',1)").bind(String(i),String(i)).run();
  for(const table of ['reservations','mock_reservations']) await e.DB.prepare(`INSERT INTO ${table}(id,pool,ip_hash,session_id,image_sha,day,units,created_at) VALUES('orphan','public','ip','session','sha','day',9,0)`).bind().run();
  const original=e.DB.prepare.bind(e.DB); let queries=0,subrequests=0,calls=0;
  e.DB.prepare=((q:string)=>({bind(...a:any[]){
    const statement=original(q).bind(...a);
    const count=()=>{expect(++queries).toBeLessThanOrEqual(50);expect(++subrequests).toBeLessThanOrEqual(50);};
    return {execute(){count();return (statement as any).execute();},async all(){count();return statement.all();},async run(){count();
      // Every final CAS loses to a newer submission generation.
      if(scenario !== 'redirect' && q.startsWith('UPDATE jobs SET cleanup_status=')) await original('UPDATE jobs SET submission_generation=submission_generation+1 WHERE id=?').bind(a[2]).run();
      return statement.run();}};
  }})) as any;
  let external=0;
  const { MockAgent, fetch: offlineFetch } = createRequire(new URL('../../service/package.json', import.meta.url))('undici');
  const agent = new MockAgent(); agent.disableNetConnect();
  const pool = agent.get('https://yce-api-01.makeupar.com');
  // A default-follow fetch would dispatch 21 requests for each call.
  for(let hop=0;hop<=20;hop++) pool.intercept({method:'POST',path:hop===0?'/s2s/v2.0/task/delete':'/redirect/'+hop}).reply(()=>{
    expect(++external).toBeLessThanOrEqual(50);
    expect(++subrequests).toBeLessThanOrEqual(50);
    return hop===20 ? {statusCode:200,data:'{"data":{}}'} :
      {statusCode:307,data:'',responseOptions:{headers:{location:'/redirect/'+(hop+1)}}};
  }).persist();
  try {
    await scheduled({},e,{},async(url,init)=>{
      calls++;
      if(scenario==='failure') {expect(++subrequests).toBeLessThanOrEqual(50);throw Error('offline provider failure');}
      const before=external;
      try {return await offlineFetch(url,{...init,dispatcher:agent});}
      finally {expect(external-before).toBeLessThanOrEqual(1);}
    });
  } finally {await agent.close();}
  const raced=scenario!=='redirect';
  expect(queries).toBe(raced?38:22); expect(calls).toBe(raced?8:4);
  expect(subrequests).toBe(raced?46:26);
  if(scenario!=='failure') expect(external).toBe(calls);
  const rows=(await original("SELECT cleanup_status,provider_task_id FROM jobs WHERE id IN (SELECT id FROM deleted_jobs)").bind().all()).results;
  expect(rows).toHaveLength(4);
  expect(rows.every((row:any)=>row.cleanup_status===(raced?'pending':'failed') && row.provider_task_id==='handle')).toBe(true);
});
it.each([undefined,'', ' , ', '.', ' , . '])('live fails closed for allowlist %s',async suffixes=>{
 const e=env(); e.YOUCAM_MODE='live';e.YOUCAM_API_KEY='synthetic';e.YOUCAM_STORAGE_HOST_SUFFIXES=suffixes;
 expect(await (await handle(request(),e)).json()).toMatchObject({error:{code:'live_unavailable',message:expect.stringContaining('allowlist')}});
});

it.each(['GET','DELETE'])('malformed URL escape returns 404 for %s', async method => {
  const response = await handle(new Request('https://local/api/analyses/%ZZ', { method }), env());
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
});
it.each([
  { balance: 458, judgeUnits: 0, status: 429 },
  { balance: 459, judgeUnits: 0, status: 202 },
  { balance: 449, judgeUnits: 9, status: 429 },
  { balance: 450, judgeUnits: 9, status: 202 },
])('protects provider judge reserve at balance $balance with judge liability $judgeUnits', async ({ balance, judgeUnits, status }) => {
  const e = env(); e.YOUCAM_MODE='live'; e.YOUCAM_API_KEY='synthetic';
  if (judgeUnits) await e.DB.prepare("INSERT INTO reservations(id,pool,ip_hash,session_id,image_sha,day,units,status,created_at) VALUES('judge-held','judge','','','','',9,'spent',0)").bind().run();
  const credit = vi.spyOn(LiveAdapter.prototype, 'creditBalance').mockResolvedValue(balance);
  const submit = vi.spyOn(LiveAdapter.prototype, 'submit').mockResolvedValue({ providerTaskId:'synthetic' });
  expect((await handle(request(),e)).status).toBe(status);
  expect(credit).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledTimes(status===202 ? 1 : 0);
  expect((await e.DB.prepare("SELECT COUNT(*) count FROM jobs").bind().all()).results).toEqual([{ count: status===202 ? 1 : 0 }]);
});
it('rejects unavailable provider credit before reservation but judges use their own allowance', async () => {
  const e=env(); e.YOUCAM_MODE='live'; e.YOUCAM_API_KEY='synthetic'; e.JUDGE_CODE='synthetic-judge';
  const credit=vi.spyOn(LiveAdapter.prototype,'creditBalance').mockRejectedValue(new Error('offline'));
  vi.spyOn(LiveAdapter.prototype,'submit').mockResolvedValue({ providerTaskId:'synthetic' });
  expect((await handle(request(),e)).status).toBe(500);
  expect((await e.DB.prepare('SELECT COUNT(*) count FROM jobs').bind().all()).results).toEqual([{count:0}]);
  credit.mockClear();
  expect((await handle(request({judgeCode:e.JUDGE_CODE}),e)).status).toBe(202);
  expect(credit).not.toHaveBeenCalled();
  expect((await e.DB.prepare("SELECT pool FROM reservations WHERE status='reserved'").bind().all()).results).toEqual([{pool:'judge'}]);
});
it.each([true,false])('a pre-task upload failure fileCreated=%s releases units and reports truthful cleanup', async fileCreated => {
  const { ServiceError } = await import('../../service/adapters');
  const e=env(); e.YOUCAM_MODE='live'; e.YOUCAM_API_KEY='synthetic';
  vi.spyOn(LiveAdapter.prototype,'submit').mockRejectedValue(new ServiceError('provider_error','Synthetic upload failure',502,true,fileCreated));
  const created:any=await (await handle(request(),e)).json();
  const deleted=await handle(new Request('https://local/api/analyses/'+created.job.id,{method:'DELETE'}),e);
  expect(await deleted.json()).toEqual({local:'deleted',provider:fileCreated?'unknown_task':'not_applicable'});
  expect((await e.DB.prepare('SELECT status,image_sha FROM reservations WHERE id=?').bind(created.job.id).all()).results).toEqual([{status:'released',image_sha:''}]);
});
it.each(['succeeded','failed','running','throw'] as const)('DELETE settles a nonterminal provider outcome %s', async state => {
  const e=env(); e.YOUCAM_MODE='live'; e.YOUCAM_API_KEY='synthetic';
  vi.spyOn(LiveAdapter.prototype,'submit').mockResolvedValue({providerTaskId:'synthetic'});
  const poll=vi.spyOn(LiveAdapter.prototype,'poll');
  if(state==='throw') poll.mockRejectedValue(new Error('offline'));
  else if(state==='succeeded') poll.mockResolvedValue({state,observations:[],zoneLabels:[],masks:{}});
  else if(state==='failed') poll.mockResolvedValue({state,code:'error_no_face',message:'Synthetic'});
  else poll.mockResolvedValue({state});
  const remove=vi.spyOn(LiveAdapter.prototype,'deleteTask').mockResolvedValue(undefined);
  const created:any=await (await handle(request(),e)).json();
  expect((await handle(new Request('https://local/api/analyses/'+created.job.id,{method:'DELETE'}),e)).status).toBe(200);
  expect(poll).toHaveBeenCalledExactlyOnceWith('synthetic', { includeMasks: false }); expect(remove).toHaveBeenCalledOnce();
  expect((await e.DB.prepare('SELECT status FROM reservations WHERE id=?').bind(created.job.id).all()).results).toEqual([{status:state==='succeeded'?'spent':state==='failed'?'released':'abandoned'}]);
});
it('cron erases expired digests and previous UTC day identifiers in both ledgers and jobs',async()=>{
  const e=env(), now=Date.now(), today=new Date(now).toISOString().slice(0,10), yesterday=new Date(now-86400000).toISOString().slice(0,10);
  for(const table of ['reservations','mock_reservations']) {
    for(const [id,day,created] of [['old',yesterday,now-86400000],['expired',today,now-1800001],['recent',today,now]] as const)
      await e.DB.prepare(`INSERT INTO ${table}(id,pool,ip_hash,session_id,image_sha,day,units,status,created_at) VALUES(?,'public','ip','session','digest',?,9,'spent',?)`).bind(id,day,created).run();
  }
  for(const [id,day] of [['old',yesterday],['recent',today]]) await e.DB.prepare("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,cleanup_status) VALUES(?,'failed','mock',?,?,'session','not_applicable')").bind(id,day+'T00:00:00.000Z',day+'T00:00:00.000Z').run();
  await scheduled({},e);
  const writes = vi.spyOn(D1Executor.prototype, 'run');
  await scheduled({},e);
  expect(writes.mock.calls.length).toBeGreaterThan(0);
  expect(await Promise.all(writes.mock.results.map(result => result.value))).toEqual(writes.mock.calls.map(() => 0));
  for(const table of ['reservations','mock_reservations']) {
    const rows=(await e.DB.prepare(`SELECT id,ip_hash,session_id,image_sha FROM ${table} WHERE id IN ('old','expired','recent') ORDER BY id`).bind().all()).results;
    expect(rows).toEqual([{id:'expired',ip_hash:'ip',session_id:'session',image_sha:''},{id:'old',ip_hash:'',session_id:'',image_sha:''},{id:'recent',ip_hash:'ip',session_id:'session',image_sha:'digest'}]);
  }
  expect((await e.DB.prepare('SELECT id,session_id FROM jobs ORDER BY id').bind().all()).results).toEqual([{id:'old',session_id:''},{id:'recent',session_id:'session'}]);
});
it('cron selects live cleanup ahead of older mock backlog',async()=>{
  const e=env(); e.YOUCAM_API_KEY='synthetic';
  for(let i=0;i<8;i++) await e.DB.prepare("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id,submit_started) VALUES(?,'running',?,'','','','synthetic',1)").bind(String(i),i<4?'mock':'live').run();
  let calls=0;
  await scheduled({},e,{},async()=>{calls++;return Response.json({data:{}});});
  expect(calls).toBe(4);
  expect((await e.DB.prepare("SELECT id FROM deleted_jobs ORDER BY id").bind().all()).results).toEqual(['4','5','6','7'].map(id=>({id})));
});

it.each(['reserved', 'abandoned'])('protects provider reserve with %s non-judge runs and held judge units', async status => {
  const e = env(); e.YOUCAM_MODE = 'live'; e.YOUCAM_API_KEY = 'synthetic';
  for (const [id, pool] of [['nonjudge', 'dev'], ['judge', 'judge']])
    await e.DB.prepare("INSERT INTO reservations(id,pool,ip_hash,session_id,image_sha,day,units,status,created_at) VALUES(?,?,'','','','',9,?,0)").bind(id, pool, status).run();
  vi.spyOn(LiveAdapter.prototype, 'creditBalance').mockResolvedValue(467);
  const submit = vi.spyOn(LiveAdapter.prototype, 'submit').mockResolvedValue({ providerTaskId: 'synthetic' });
  expect((await handle(request(), e)).status).toBe(429);
  expect(submit).not.toHaveBeenCalled();
  expect((await e.DB.prepare('SELECT COUNT(*) count FROM reservations').bind().all()).results).toEqual([{ count: 3 }]);
});
it('serializes concurrent requests against the same uncharged provider balance', async () => {
  const e = env(); e.YOUCAM_MODE = 'live'; e.YOUCAM_API_KEY = 'synthetic';
  vi.spyOn(LiveAdapter.prototype, 'creditBalance').mockResolvedValue(467);
  const submit = vi.spyOn(LiveAdapter.prototype, 'submit').mockResolvedValue({ providerTaskId: 'synthetic' });
  const responses = await Promise.all(['parallel-session-0001', 'parallel-session-0002'].map(sessionId => handle(request({ sessionId }), e)));
  expect(responses.map(response => response.status).sort()).toEqual([202, 429]);
  expect(submit).toHaveBeenCalledOnce();
});

it.each(['live', 'mock'] as const)('GET uses stored %s mode after the environment switches', async mode => {
  const e = env();
  e.YOUCAM_MODE = mode === 'live' ? 'mock' : 'live';
  e.YOUCAM_API_KEY = 'synthetic';
  const id = 'mode-switch-' + mode;
  const stamp = new Date(Date.now() - 15000).toISOString();
  const table = mode === 'mock' ? 'mock_reservations' : 'reservations';
  await e.DB.prepare("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id) VALUES(?,'running',?,?,?,'session','synthetic-task')").bind(id, mode, stamp, stamp).run();
  for (const ledger of ['reservations', 'mock_reservations'])
    await e.DB.prepare(`INSERT INTO ${ledger}(id,pool,ip_hash,session_id,image_sha,day,units,created_at) VALUES(?,'public','','','','',9,?)`).bind(id, Date.now()).run();
  const live = vi.spyOn(LiveAdapter.prototype, 'poll').mockResolvedValue({state:'succeeded', observations:[], zoneLabels:[], masks:{}});
  const mock = vi.spyOn(MockAdapter.prototype, 'poll').mockResolvedValue({state:'failed', code:'error_no_face', message:'Synthetic'});
  const response = await handle(new Request('https://local/api/analyses/' + id), e);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({job:{mode, state:mode === 'live' ? 'succeeded' : 'failed'}});
  expect(mode === 'live' ? live : mock).toHaveBeenCalledExactlyOnceWith('synthetic-task');
  expect(mode === 'live' ? mock : live).not.toHaveBeenCalled();
  expect((await e.DB.prepare(`SELECT status FROM ${table} WHERE id=?`).bind(id).all()).results).toEqual([{status:mode === 'live' ? 'spent' : 'released'}]);
  const other = mode === 'mock' ? 'reservations' : 'mock_reservations';
  expect((await e.DB.prepare(`SELECT status FROM ${other} WHERE id=?`).bind(id).all()).results).toEqual([{status:'reserved'}]);
});
