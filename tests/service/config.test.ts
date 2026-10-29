import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
it('deploy configuration binds DB and matches every local workerd compatibility date', () => {
  const config = readFileSync(new URL('../../service/wrangler.toml', import.meta.url), 'utf8');
  const date = config.match(/^compatibility_date = "([\d-]+)"$/m)?.[1];
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(config).toMatch(/\[\[d1_databases\]\]\s+binding = "DB"\s+database_name = "[^"]+"\s+database_id = "[^"]+"/);
  for (const file of ['../../service/dev.mjs', '../e2e/e2e.test.ts', '../e2e/budget.test.ts']) {
    const dates = [...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/compatibilityDate: '([\d-]+)'/g)].map(match => match[1]);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every(value => value === date)).toBe(true);
  }
});

it('serves the web SPA on workers.dev and runs the Worker only for API paths', () => {
  const config = readFileSync(new URL('../../service/wrangler.toml', import.meta.url), 'utf8');
  const assets = config.match(/^\[assets\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  expect(config).toMatch(/^workers_dev = true$/m);
  expect(assets).toMatch(/^directory = "\.\.\/web\/dist"$/m);
  expect(assets).toMatch(/^run_worker_first = \["\/api\/\*"\]$/m);
  expect(assets).toMatch(/^not_found_handling = "single-page-application"$/m);
  expect(assets).not.toMatch(/^binding\s*=/m);
});

it('tracked configuration defaults to mock with bounded cleanup cron', () => {
  const config = readFileSync(new URL('../../service/wrangler.toml', import.meta.url), 'utf8');
  expect(config).toMatch(/^YOUCAM_MODE = "mock"$/m);
  expect(config).toMatch(/^crons = \["\*\/15 \* \* \* \*"\]$/m);
});

const deployConfig = new URL('../../service/wrangler.deploy.toml', import.meta.url);
it.skipIf(!existsSync(deployConfig))('local deploy configuration differs only in database ID and mode', () => {
  const normalize = (config: string) => config
    .replace(/^database_id\s*=.*$/gm, 'database_id = "<local>"')
    .replace(/^YOUCAM_MODE\s*=.*$/gm, 'YOUCAM_MODE = "<local>"');
  const tracked = readFileSync(new URL('../../service/wrangler.toml', import.meta.url), 'utf8');
  const deployed = readFileSync(deployConfig, 'utf8');
  expect(normalize(deployed) === normalize(tracked), 'Deploy configuration drifted beyond database_id and YOUCAM_MODE').toBe(true);
});
