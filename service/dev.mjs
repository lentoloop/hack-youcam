// Local mock runtime only. No provider requests or cloud account needed.
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const bundle = await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const mf = new Miniflare({ port: 8787, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-03', d1Databases: ['DB'], bindings: { YOUCAM_MODE: 'mock', IP_HASH_SECRET: crypto.randomUUID() }, outboundService: () => { throw new Error('External network forbidden in local mock mode'); } });
const db = await mf.getD1Database('DB');
for (const name of ['0001.sql', '0002.sql', '0003.sql', '0004.sql']) {
  for (const statement of readFileSync(`migrations/${name}`, 'utf8').replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await db.prepare(statement).run();
}
console.log(`Mock worker ready at ${await mf.ready}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await mf.dispose(); process.exit(); });
