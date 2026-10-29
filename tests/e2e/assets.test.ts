import { expect, it } from '../../service/node_modules/vitest';
import { Miniflare } from '../../service/node_modules/miniflare';
import { build } from '../../service/node_modules/esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('routes API requests ahead of assets and serves the SPA for other missing paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youcam-assets-'));
  let runtime: Miniflare | undefined;
  try {
    const html = '<!doctype html><html><body>YouCam routing fixture</body></html>';
    await writeFile(join(directory, 'index.html'), html);
    const bundle = await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
    runtime = new Miniflare({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-07-30',
      d1Databases: ['DB'],
      bindings: { YOUCAM_MODE: 'mock' },
      assets: {
        directory,
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: false,
          static_routing: { user_worker: ['/api/*'] },
        },
        assetConfig: { not_found_handling: 'single-page-application' },
      },
      outboundService: () => { throw new Error('External network forbidden'); },
    });
    const missing = await runtime.dispatchFetch('http://local/api/x');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });

    const fallback = await runtime.dispatchFetch('http://local/log/history', { headers: { accept: 'text/html' } });
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get('content-type')).toContain('text/html');
    expect(await fallback.text()).toBe(html);

    const form = new FormData();
    form.set('meta', JSON.stringify({ consent: { granted: false } }));
    const request = new Request('http://local/api/analyses', { method: 'POST', body: form });
    const denied = await runtime.dispatchFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.arrayBuffer(),
    });
    expect(denied.status).toBe(400);
    expect(denied.headers.get('content-type')).toContain('application/json');
    expect(await denied.json()).toMatchObject({ error: { code: 'consent_required' } });
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
