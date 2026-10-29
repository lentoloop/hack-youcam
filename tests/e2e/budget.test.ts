import { afterEach, expect, it } from '../../service/node_modules/vitest';
import { Miniflare } from '../../service/node_modules/miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { D1BudgetGuard, D1Executor } from '../../service/budget';
import type { BudgetPool, ReservationRequest } from '../../contracts';
const runtimes: Miniflare[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())); });
async function setup() {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("local"); } };', compatibilityDate: '2026-07-30', d1Databases: ['DB'], outboundService: () => { throw new Error('External network forbidden'); } });
  runtimes.push(runtime);
  const db = await runtime.getD1Database('DB');
  const directory = new URL('../../service/migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync(new URL(file, directory), 'utf8').replace(/--[^\n]*/g, '').split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  return { db, guard: new D1BudgetGuard(new D1Executor(db as unknown as D1Database), () => Date.now(), 'live') };
}
function request(pool: BudgetPool, suffix = crypto.randomUUID(), ipHash = suffix): ReservationRequest {
  return { pool, ipHash, sessionId: suffix, imageSha256: suffix, units: 9 };
}
it('D1 exhausts dev/public while preserving all 450 judge units', async () => {
  const { db, guard } = await setup();
  expect(await guard.status()).toEqual({ spentUnits: 9, reservedUnits: 0, remainingByPool: { dev: 351, public: 180, judge: 450 } });
  expect((await db.prepare('SELECT created_at FROM reservations').first<{ created_at: number }>())?.created_at).toBe(Date.parse('2026-10-25T19:18:00+08:00'));
  expect(await db.prepare('SELECT ip_hash,session_id,image_sha,status FROM reservations').first()).toEqual({ ip_hash: '', session_id: '', image_sha: '', status: 'spent' });
  for (const [pool, runs] of [['dev', 39], ['public', 20]] as const) {
    for (let i = 0; i < runs; i++) {
      const reservation = await guard.reserve(request(pool));
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await guard.commit(reservation.reservationId);
    }
    expect(await guard.reserve(request(pool))).toEqual({ ok: false, reason: 'quota_exhausted' });
  }
  expect((await guard.status()).remainingByPool).toEqual({ dev: 0, public: 0, judge: 450 });
  expect((await db.prepare('SELECT COUNT(*) count FROM jobs').first<{ count: number }>())?.count).toBe(59);
  for (let i = 0; i < 50; i++) {
    const reservation = await guard.reserve(request('judge'));
    expect(reservation.ok).toBe(true);
    if (reservation.ok) await guard.commit(reservation.reservationId);
  }
  expect(await guard.reserve(request('judge'))).toEqual({ ok: false, reason: 'quota_exhausted' });
  expect(await guard.status()).toEqual({ spentUnits: 990, reservedUnits: 0, remainingByPool: { dev: 0, public: 0, judge: 0 } });
}, 30000);
it('D1 batch deduplicates parallel requests into one reservation and job', async () => {
  const { db, guard } = await setup();
  const input = request('public');
  const results = await Promise.all([guard.reserve(input), guard.reserve(input)]);
  expect(results.every(result => result.ok)).toBe(true);
  expect(new Set(results.map(result => result.ok ? result.reservationId : '')).size).toBe(1);
  expect((await db.prepare("SELECT COUNT(*) count FROM reservations WHERE status='reserved'").first<{ count: number }>())?.count).toBe(1);
  expect((await db.prepare('SELECT COUNT(*) count FROM jobs').first<{ count: number }>())?.count).toBe(1);
});
it('D1 batch rolls reservation back when job insertion fails', async () => {
  const { db, guard } = await setup();
  await db.prepare("CREATE TRIGGER reject_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
  await expect(guard.reserve(request('public'))).rejects.toThrow('synthetic failure');
  expect((await db.prepare('SELECT COUNT(*) count FROM reservations').first<{ count: number }>())?.count).toBe(1);
  expect((await db.prepare('SELECT COUNT(*) count FROM jobs').first<{ count: number }>())?.count).toBe(0);
  expect((await guard.status()).remainingByPool.public).toBe(180);
});
it('judges share NAT without public IP caps and have separate bounded concurrency', async () => {
  const { guard } = await setup();
  const ip = 'shared-nat';
  const others = await Promise.all([guard.reserve(request('public', 'public-a', ip)), guard.reserve(request('dev', 'dev-a', ip))]);
  expect(others.every(result => result.ok)).toBe(true);
  const judges = await Promise.all([guard.reserve(request('judge', 'judge-a', ip)), guard.reserve(request('judge', 'judge-b', ip))]);
  expect(judges.every(result => result.ok)).toBe(true);
  expect(await guard.reserve(request('judge', 'judge-full', ip))).toEqual({ ok: false, reason: 'rate_limited' });
  for (const row of judges) if (row.ok) await guard.commit(row.reservationId);
  expect((await guard.reserve(request('judge', 'judge-c', ip))).ok).toBe(true);
  for (const row of others) if (row.ok) await guard.commit(row.reservationId);
  expect(await guard.reserve(request('public', 'public-ip-full', ip))).toEqual({ ok: false, reason: 'rate_limited' });
});
it('D1 reserves uncharged non-judge units atomically while preserving judge credit', async () => {
  const { db, guard } = await setup();
  const judge = await guard.reserve(request('judge'));
  expect(judge.ok).toBe(true);
  const results = await Promise.all([
    guard.reserve(request('public'), 467),
    guard.reserve(request('dev'), 467),
  ]);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.filter(result => !result.ok)).toEqual([{ ok: false, reason: 'quota_exhausted' }]);
  const held = results.find(result => result.ok);
  if (!held?.ok) throw new Error('Expected a held non-judge reservation');
  await guard.abandon(held.reservationId);
  expect(await guard.reserve(request('public'), 467)).toEqual({ ok: false, reason: 'quota_exhausted' });
  expect((await db.prepare("SELECT SUM(units) units FROM reservations WHERE pool!='judge' AND status IN ('reserved','abandoned')").first<{ units: number }>())?.units).toBe(9);
  if (judge.ok) await guard.commit(judge.reservationId);
  expect((await guard.reserve(request('public'), 467)).ok).toBe(true);
});
