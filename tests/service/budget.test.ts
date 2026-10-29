import { describe, it, expect } from "../../service/node_modules/vitest";
import { D1BudgetGuard, MemoryBudgetGuard } from "../../service/budget";
import { database } from "./helpers";
const req = (n: number, pool: "public" | "judge" | "dev" = "public") => ({
  pool,
  ipHash: "hash" + n,
  sessionId: "session" + n,
  imageSha256: "sha" + n,
  units: 9,
});
for (const kind of ["memory", "sqlite"])
  describe(kind + " atomic budget", () => {
    const make = (now?: () => number) =>
      kind === "memory"
        ? new MemoryBudgetGuard(now)
        : new D1BudgetGuard(database().sql, now);
    it("abandon frees concurrency while holding units and permits later confirmation", async () => {
      const g = make();
      for (const n of [1,2]) { const r = await g.reserve(req(n)); if (!r.ok) throw Error(); await g.abandon(r.reservationId); }
      expect((await g.status()).reservedUnits).toBe(18);
      expect((await g.status()).remainingByPool.judge).toBe(450);
      expect((await g.reserve(req(3, 'judge'))).ok).toBe(true);
      const r = await g.reserve(req(1)); if (!r.ok) throw Error();
      await g.release(r.reservationId);
      expect((await g.status()).remainingByPool.public).toBe(171);
    });
    it("dedupes session hash", async () => {
      const g = make();
      const a = await g.reserve(req(1));
      const b = await g.reserve(req(1));
      expect(a.ok && b.ok && b.deduplicatedJobId).toBe(a.ok && a.reservationId);
      expect((await g.status()).reservedUnits).toBe(9);
    });
    it("allows only two concurrent reservations", async () => {
      const g = make();
      const rs = await Promise.all([1, 2, 3, 4].map((n) => g.reserve(req(n))));
      expect(rs.filter((x) => x.ok)).toHaveLength(2);
    });
    it("isolates judge concurrency and exempts judges from shared-IP attempts", async () => {
      const g = make();
      const others = await Promise.all([1, 2].map(n => g.reserve({ ...req(n), ipHash: "nat" })));
      expect(others.every(result => result.ok)).toBe(true);
      const judges = await Promise.all([3, 4].map(n => g.reserve({ ...req(n, "judge"), ipHash: "nat" })));
      expect(judges.every(result => result.ok)).toBe(true);
      expect(await g.reserve({ ...req(5, "judge"), ipHash: "nat" })).toEqual({ ok: false, reason: "rate_limited" });
      for (const result of judges) if (result.ok) await g.commit(result.reservationId);
      expect((await g.reserve({ ...req(6, "judge"), ipHash: "nat" })).ok).toBe(true);
      for (const result of others) if (result.ok) await g.commit(result.reservationId);
      expect(await g.reserve({ ...req(7), ipHash: "nat" })).toEqual({ ok: false, reason: "rate_limited" });
    });
    it("commits and releases idempotently", async () => {
      const g = make();
      const a = await g.reserve(req(1));
      if (!a.ok) throw Error();
      await g.commit(a.reservationId);
      await g.release(a.reservationId);
      await g.commit(a.reservationId);
      expect((await g.status()).spentUnits).toBe(kind === "sqlite" ? 18 : 9);
    });
    it("failure frees units and concurrency", async () => {
      const g = make();
      const a = await g.reserve(req(1));
      if (!a.ok) throw Error();
      await g.release(a.reservationId);
      expect((await g.status()).reservedUnits).toBe(0);
      expect((await g.reserve(req(2))).ok).toBe(true);
    });
    it("enforces IP daily attempts even on failure", async () => {
      const g = make();
      for (let n = 0; n < 2; n++) {
        const a = await g.reserve({ ...req(n), ipHash: "same" });
        if (a.ok) await g.release(a.reservationId);
      }
      expect(await g.reserve({ ...req(4), ipHash: "same" })).toEqual({
        ok: false,
        reason: "rate_limited",
      });
    });
    it("preserves judge/dev pools when public exhausted", async () => {
      const g = make();
      for (let n = 0; n < 20; n++) {
        const a = await g.reserve(req(n));
        if (!a.ok) throw Error();
        await g.commit(a.reservationId);
      }
      expect(await g.reserve(req(21))).toEqual({
        ok: false,
        reason: "quota_exhausted",
      });
      expect((await g.reserve(req(22, "judge"))).ok).toBe(true);
      expect((await g.status()).remainingByPool).toEqual({
        public: 0,
        judge: 441,
        dev: kind === "sqlite" ? 351 : 360,
      });
    });
    it("dedupe expires after thirty minutes", async () => {
      let now = 1_000_000;
      const g = make(() => now);
      const a = await g.reserve(req(1));
      if (a.ok) await g.commit(a.reservationId);
      now += 1800001;
      const b = await g.reserve(req(1));
      expect(b.ok && b.deduplicatedJobId).toBeUndefined();
    });
  });
for (const kind of ["memory", "sqlite"]) {
  it(kind + " enforces all pool caps totaling 990 units", async () => {
    const g =
      kind === "memory"
        ? new MemoryBudgetGuard()
        : new D1BudgetGuard(database().sql);
    let n = 100;
    for (const [pool, count] of [
      ["public", 20],
      ["judge", 50],
      ["dev", kind === "sqlite" ? 39 : 40],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const r = await g.reserve(req(n++, pool));
        expect(r.ok).toBe(true);
        if (r.ok) await g.commit(r.reservationId);
      }
      expect(await g.reserve(req(n++, pool))).toEqual({
        ok: false,
        reason: "quota_exhausted",
      });
    }
    expect(await g.status()).toEqual({
      spentUnits: 990,
      reservedUnits: 0,
      remainingByPool: { public: 0, judge: 0, dev: 0 },
    });
  });
}

it('memory orphan reconciliation frees slots while retaining uncertain liability', async()=>{
 let now=0; const g=new MemoryBudgetGuard(()=>now);
 for(const id of ['a','b']) await g.reserve({pool:'public',ipHash:id,sessionId:id,imageSha256:id,units:9});
 now=1800001;
 await g.reconcileOrphans(new Set());
 expect(await g.status()).toMatchObject({reservedUnits:18,remainingByPool:{judge:450}});
 expect((await g.reserve({pool:'judge',ipHash:'judge',sessionId:'judge',imageSha256:'judge',units:9})).ok).toBe(true);
});
it('reservation and job batch roll back together on insertion failure',async()=>{
 const {db,sql}=database();
 db.exec("CREATE TRIGGER fail_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const guard=new D1BudgetGuard(sql,()=>Date.now(),'live');
 await expect(guard.reserve(req(1))).rejects.toThrow('synthetic failure');
 expect(db.prepare('SELECT COUNT(*) n FROM reservations').get()).toEqual({n:1});
 db.exec('DROP TRIGGER fail_job');
 const result=await guard.reserve(req(1)); expect(result.ok).toBe(true);
 expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({n:1});
});
