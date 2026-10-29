import { afterAll, beforeAll, expect, it } from '../../service/node_modules/vitest';
import { Miniflare } from '../../service/node_modules/miniflare';
import { build } from '../../service/node_modules/esbuild';
import jpeg from '../../service/node_modules/jpeg-js';
import { JSDOM } from '../../service/node_modules/jsdom';
import { readFileSync } from 'node:fs';
import { createApi, AnalysisError } from '../../web/src/api';
import { renderResults } from '../../web/src/results';
import { CONSENT_TEXT_VERSION, SCORED_CONCERNS } from '../../contracts';
import type { BreakoutLog, LogEntry } from '../../contracts/log';
import { deriveRegions } from '../../shared/regions';
import { buildLog, compareEntries, parseLogFile } from '../../shared/log';
import { serializeLog } from '../../web/src/log-file';
import { png } from '../shared/png';
let mf: Miniflare;
let api: ReturnType<typeof createApi>;
let id: string;
let log: BreakoutLog;
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-30', d1Databases: ['DB'], bindings: { YOUCAM_MODE: 'mock', IP_HASH_SECRET: 'synthetic-local-test-salt' }, outboundService: () => { throw new Error('External network forbidden'); } });
  const db = await mf.getD1Database('DB');
  for (const name of ['0001.sql', '0002.sql', '0003.sql', '0004.sql', '0005.sql']) {
    const sql = readFileSync(new URL(`../../service/migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await db.prepare(statement).run();
  }
  api = createApi((async (url, init) => {
    // Serialize browser-compatible multipart at the HTTP boundary before entering workerd.
    const request = new Request(new URL(String(url), 'http://local'), init);
    request.headers.set('CF-Connecting-IP', '192.0.2.1');
    return mf.dispatchFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers), ...(request.body ? { body: await request.arrayBuffer() } : {}) });
  }) as typeof fetch);
}, 30000);
afterAll(async () => { await mf?.dispose(); });
async function capture(sessionId: string): Promise<LogEntry> {
  const bytes = jpeg.encode({ width: 600, height: 800, data: Buffer.alloc(600 * 800 * 4, 255) }, 50).data;
  const created = await api.create(new Blob([bytes], { type: 'image/jpeg' }), { width: 600, height: 800, sessionId, consent: { granted: true, textVersion: CONSENT_TEXT_VERSION, acceptedAt: new Date().toISOString() } });
  id = created.job.id;
  expect(created.job.mode).toBe('mock');
  let result = await api.get(id);
  expect(result.job.state).toBe('running');
  await new Promise(resolve => setTimeout(resolve, 10010));
  result = await api.get(id);
  expect(result.job.state).toBe('succeeded');
  expect(result.observations.map(o => o.concern)).toEqual(SCORED_CONCERNS);
  expect(result.zoneLabels).toEqual([
    { region: 'whole', label: 'Combination & Sensitive', source: 'mock' },
    { region: 't_zone', label: 'Oily', source: 'mock' },
    { region: 'u_zone', label: 'Dry & Sensitive', source: 'mock' },
  ]);
  expect(Object.keys(result.masks!).sort()).toEqual(['acne', 'redness', 't_zone', 'u_zone']);
  const decode = (key: 'acne' | 'redness' | 't_zone' | 'u_zone') => {
    expect(result.masks![key]).toMatch(/^data:image\/png;base64,/);
    return png(Buffer.from(result.masks![key]!.split(',')[1], 'base64'));
  };
  const regions = deriveRegions({ acne: decode('acne'), redness: decode('redness'), tZone: decode('t_zone'), uZone: decode('u_zone') });
  expect(regions.zones.map(z => z.acneSpots)).toEqual([7, 21, 2]);
  expect(regions.zones.every(z => z.rednessPixels > 0 && z.rednessMeanAlpha > 0)).toBe(true);
  // Labels pass through skin_type verbatim; numeric zone estimates come from decoded masks.
  return { id, date: new Date().toISOString(), source: result.job.source, observations: result.observations, zoneLabels: result.zoneLabels, regions, framing: { guideShown: true, userConfirmedSameFraming: true, imageSize: { w: 600, h: 800 } } };
}
function render(value: BreakoutLog) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = globalThis.document;
  Object.assign(globalThis, { document: dom.window.document });
  try {
    const root = document.querySelector<HTMLElement>('#root')!;
    renderResults(root, value);
    return root.textContent!;
  } finally {
    Object.assign(globalThis, { document: previous });
    dom.window.close();
  }
}
it('uploads two synthetic JPEGs, polls the real worker, builds and compares a portable v2 log', async () => {
  const first = await capture('synthetic-e2e-first');
  await api.delete(first.id);
  await expect(api.get(first.id)).rejects.toMatchObject({ code: 'not_found' });
  const second = await capture('synthetic-e2e-second');
  log = { version: 'breakout-log.v1', createdAt: first.date, changes: [{ id: 'change', category: 'serum', startedOn: '2026-10-01', active: 'unknown' }], selfReport: { areas: 'cheeks', discomfort: 'none', reportedSevereSymptom: false }, entries: [first, second] };
  expect(buildLog(log).timeline.map(i => i.kind)).toEqual(['change', 'entry', 'entry']);
  expect(buildLog(log).unknowns.map(u => u.code)).toEqual(['cause_not_determined', 'no_live_baseline']);
  expect(compareEntries(first, second)).toEqual({ rows: first.observations.map(o => ({ concern: o.concern, a: o, b: o })), zones: first.regions!.zones.map(z => ({ zone: z.zone, a: z, b: z })) });
  const text = render(log);
  for (const value of ['Your breakout log', 'serum', 'Mock (test data)', 'acne: 40 | 40', 'Oily', 'Dry & Sensitive', 'Estimated by this app from the YouCam mask', 't_zone: marker blobs 7 | 7']) expect(text).toContain(value);
  const exported = serializeLog(log);
  expect(exported).not.toMatch(/data:|https?:|providerTaskId|masks|photo/i);
  expect(parseLogFile(JSON.parse(exported))).toEqual({ ok: true, log });
  const unconfirmed = structuredClone(log);
  unconfirmed.entries[1].framing.userConfirmedSameFraming = false;
  expect(render(unconfirmed)).toContain('Confirm the same framing');
}, 40000);
it('self-reported severe symptoms retain the v2 referral', () => {
  expect(render(log)).not.toContain('please see a dermatologist');
  const severe = structuredClone(log);
  severe.selfReport.reportedSevereSymptom = true;
  expect(render(severe)).toContain('Painful, swollen or spreading breakouts: please see a dermatologist or doctor.');
});
it('DELETE removes results; GET and second DELETE return uniform not_found', async () => {
  await api.delete(id);
  await expect(api.get(id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(api.delete(id)).resolves.toEqual({ local: 'deleted', provider: 'not_applicable' });
});
it.each([false, true])('real worker attempts provider task/delete; failure=%s still deletes locally', async fails => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const provider = new Miniflare({ modules: true, script: (await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })).outputFiles[0].text, compatibilityDate: '2026-07-30', d1Databases: ['DB'], bindings: { YOUCAM_MODE: 'live', YOUCAM_API_KEY: 'synthetic-test-only', YOUCAM_STORAGE_HOST_SUFFIXES: 'storage.example.com' }, outboundService: async request => {
    calls.push({ url: request.url, method: request.method, body: request.method === "POST" ? await request.json() : undefined });
    if (request.method === 'GET') return Response.json({ data: { task_status: 'running' } });
    return new Response('{}', { status: fails ? 503 : 200 });
  } });
  try {
    const db = await provider.getD1Database('DB');
    for (const name of ['0001.sql', '0002.sql', '0003.sql', '0004.sql', '0005.sql']) {
      const sql = readFileSync(new URL(`../../service/migrations/${name}`, import.meta.url), 'utf8');
      for (const statement of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await db.prepare(statement).run();
    }
    // Seed a provider-backed job so this cleanup test cannot submit a paid task.
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id) VALUES(?,?,?,?,?,?,?)').bind('cleanup', 'running', 'live', now, now, 'synthetic', 'synthetic-provider-task').run();
    expect((await provider.dispatchFetch('http://local/api/analyses/cleanup', { method: 'DELETE' })).status).toBe(200);
    expect(calls).toEqual([{ url: 'https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis/synthetic-provider-task', method: 'GET', body: undefined }, { url: 'https://yce-api-01.makeupar.com/s2s/v2.0/task/delete', method: 'POST', body: { task_id: 'synthetic-provider-task' } }]);
    for (const method of ['GET']) {
      const response = await provider.dispatchFetch('http://local/api/analyses/cleanup', { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'not_found', retryable: false } });
    }
  } finally { await provider.dispose(); }
});

it('workerd accepts real outbound init and rejects redirects with exactly one dispatch', async () => {
  const bundle = await build({ stdin: { contents: `
    import { LiveAdapter } from './adapters';
    export default { async fetch(request) {
      try {
        await new LiveAdapter('synthetic').deleteTask(new URL(request.url).pathname);
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ code: error.code, message: error.message }, { status: 502 });
      }
    } };
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  const calls: string[] = [];
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-30', outboundService: async request => {
    calls.push(request.url);
    const body = await request.json() as { task_id: string };
    return body.task_id === '/success' ? Response.json({ data: {} })
      : new Response(null, { status: 307, headers: { location: 'https://never.example/redirect' } });
  } });
  try {
    const success = await runtime.dispatchFetch('http://local/success');
    expect(await success.json()).toEqual({ ok: true });
    const redirect = await runtime.dispatchFetch('http://local/redirect');
    expect(redirect.status).toBe(502);
    expect(await redirect.json()).toEqual({ code: 'provider_error', message: 'Outbound redirect response rejected.' });
    expect(calls).toEqual(Array(2).fill('https://yce-api-01.makeupar.com/s2s/v2.0/task/delete'));
  } finally { await runtime.dispose(); }
});

it('two parallel GET polls use independent workerd responses and only one provider poll', async () => {
  let started!: () => void, finish!: () => void;
  const polling = new Promise<void>(resolve => { started = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  const runtime = new Miniflare({ modules: true, script: (await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })).outputFiles[0].text, compatibilityDate: '2026-07-30', d1Databases: ['DB'], bindings: { YOUCAM_MODE: 'live', YOUCAM_API_KEY: 'synthetic', YOUCAM_STORAGE_HOST_SUFFIXES: 'storage.example.com' }, outboundService: async request => {
    expect(request.url).toBe('https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis/synthetic-parallel');
    calls++;
    started();
    await release;
    return Response.json({ data: { task_status: 'success', results: { output: [] } } });
  } });
  try {
    const db = await runtime.getD1Database('DB');
    for (const name of ['0001.sql', '0002.sql', '0003.sql', '0004.sql', '0005.sql'])
      for (const sql of readFileSync(new URL(`../../service/migrations/${name}`, import.meta.url), 'utf8').replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await db.prepare(sql).run();
    const now = new Date().toISOString(), old = new Date(Date.now()-11000).toISOString();
    await db.prepare("INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id,provider_task_id) VALUES('parallel','running','live',?,?,'synthetic','synthetic-parallel')").bind(now, old).run();
    const first = runtime.dispatchFetch('http://local/api/analyses/parallel');
    await polling;
    const second = runtime.dispatchFetch('http://local/api/analyses/parallel');
    const timer = setTimeout(finish, 100);
    const responses = await Promise.all([first, second]);
    clearTimeout(timer);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map(response => response.json())) as { job: { state: string } }[];
    expect(bodies[0].job.state).toBe('succeeded');
    expect(['running', 'succeeded']).toContain(bodies[1].job.state);
    expect(calls).toBe(1);
  } finally { finish(); await runtime.dispose(); }
}, 10000);
