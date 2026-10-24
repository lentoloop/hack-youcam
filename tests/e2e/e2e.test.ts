import { afterAll, beforeAll, expect, it } from '../../service/node_modules/vitest';
import { Miniflare } from '../../service/node_modules/miniflare';
import { build } from '../../service/node_modules/esbuild';
import jpeg from '../../service/node_modules/jpeg-js';
import { JSDOM } from '../../service/node_modules/jsdom';
import { readFileSync } from 'node:fs';
import { createApi, AnalysisError } from '../../web/src/api';
import { renderResults } from '../../web/src/results';
import { CONSENT_TEXT_VERSION } from '../../contracts';
let mf: Miniflare;
let api: ReturnType<typeof createApi>;
let id: string;
let observations: any[];
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-03', d1Databases: ['DB'], bindings: { YOUCAM_MODE: 'mock', IP_HASH_SECRET: 'synthetic-local-test-salt' }, outboundService: () => { throw new Error('External network forbidden'); } });
  const db = await mf.getD1Database('DB');
  for (const name of ['0001.sql', '0002.sql']) {
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
it('uploads a valid synthetic JPEG, polls real worker, and renders three cards with the real decision', async () => {
  const bytes = jpeg.encode({ width: 480, height: 480, data: Buffer.alloc(480 * 480 * 4, 255) }, 50).data;
  const created = await api.create(new Blob([bytes], { type: 'image/jpeg' }), { width: 480, height: 480, sessionId: 'synthetic-e2e-session', consent: { granted: true, textVersion: CONSENT_TEXT_VERSION, acceptedAt: new Date().toISOString() } });
  id = created.job.id;
  expect(created.job.mode).toBe('mock');
  let result = await api.get(id);
  for (let i = 0; result.job.state === 'running' && i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 10010));
    result = await api.get(id);
  }
  expect(result.job.state).toBe('succeeded');
  observations = result.observations;
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { document: dom.window.document });
  const root = document.querySelector<HTMLElement>('#root')!;
  renderResults(root, observations);
  expect(root.querySelectorAll('.products article')).toHaveLength(3);
  expect(root.querySelector('.decision')?.getAttribute('data-action')).toBe('consider_category');
  dom.window.close();
}, 40000);
it('self-reported severe symptoms escalate without a product push', () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { document: dom.window.document });
  const root = document.querySelector<HTMLElement>('#root')!;
  renderResults(root, observations);
  root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[4].click();
  expect(root.querySelector('.decision')?.getAttribute('data-action')).toBe('see_dermatologist');
  expect(root.querySelector<HTMLElement>('.products')!.hidden).toBe(true);
  expect(root.querySelector('.decision')!.textContent).not.toContain('Consider this category');
  dom.window.close();
});
it('DELETE removes results; GET and second DELETE return uniform not_found', async () => {
  await api.delete(id);
  await expect(api.get(id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(api.delete(id)).rejects.toBeInstanceOf(AnalysisError);
});
