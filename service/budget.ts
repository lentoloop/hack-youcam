import {
  BUDGET,
  type BudgetGuard,
  type BudgetPool,
  type BudgetStatus,
  type ReservationRequest,
  type ReservationResult,
} from "../contracts";
export interface SqlExecutor {
  all<T>(sql: string, args?: unknown[]): Promise<T[]>;
  run(sql: string, args?: unknown[]): Promise<number>;
  batch?(statements: {sql: string; args: unknown[]}[]): Promise<void>;
}
export class D1Executor implements SqlExecutor {
  constructor(private db: D1Database) {}
  async batch(statements: {sql: string; args: unknown[]}[]) {
    await this.db.batch(statements.map(s => this.db.prepare(s.sql).bind(...s.args)));
  }
  async all<T>(sql: string, args: unknown[] = []): Promise<T[]> {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .all<T>()
    ).results;
  }
  async run(sql: string, args: unknown[] = []) {
    return (
      await this.db
        .prepare(sql)
        .bind(...args)
        .run()
    ).meta.changes;
  }
}
const caps: Record<BudgetPool, number> = {
  judge: BUDGET.judgeReserveUnits,
  public: BUDGET.publicLiveCapUnits,
  dev:
    BUDGET.budgetUnits - BUDGET.judgeReserveUnits - BUDGET.publicLiveCapUnits,
};
export class D1BudgetGuard implements BudgetGuard {
  constructor(
    private sql: SqlExecutor,
    private now = () => Date.now(),
    private jobMode?: "live" | "mock",
  ) {}
  async reserve(r: ReservationRequest): Promise<ReservationResult> {
    if (r.units !== BUDGET.unitsPerSdRun)
      return { ok: false, reason: "quota_exhausted" };
    const now = this.now(),
      day = new Date(now).toISOString().slice(0, 10),
      id = crypto.randomUUID();
    // One SQLite write statement serializes all checks, including dedupe, across isolates.
    const insert = {sql: `INSERT INTO reservations(id,pool,ip_hash,session_id,image_sha,day,units,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE
      NOT EXISTS(SELECT 1 FROM reservations WHERE session_id=? AND image_sha=? AND created_at>?)
      AND (SELECT COALESCE(SUM(units),0) FROM reservations WHERE pool=? AND status!='released')+?<=?
      AND (SELECT COUNT(*) FROM reservations WHERE ip_hash=? AND day=?)<2
      AND (SELECT COUNT(*) FROM reservations WHERE status='reserved')<2`,
      args: [
        id,
        r.pool,
        r.ipHash,
        r.sessionId,
        r.imageSha256,
        day,
        r.units,
        now,
        r.sessionId,
        r.imageSha256,
        now - 1800000,
        r.pool,
        r.units,
        caps[r.pool],
        r.ipHash,
        day,
      ]};
    if (this.jobMode && this.sql.batch) {
      const stamp = new Date(now).toISOString();
      await this.sql.batch([insert, {sql: "INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id) SELECT id,'queued',?,?,?,session_id FROM reservations WHERE id=?", args:[this.jobMode,stamp,stamp,id]}]);
    } else await this.sql.run(insert.sql, insert.args);
    const rows = await this.sql.all<{ id: string }>(
      `SELECT id FROM reservations WHERE session_id=? AND image_sha=? AND created_at>? ORDER BY created_at LIMIT 1`,
      [r.sessionId, r.imageSha256, now - 1800000],
    );
    if (rows[0])
      return {
        ok: true,
        reservationId: rows[0].id,
        ...(rows[0].id !== id ? { deduplicatedJobId: rows[0].id } : {}),
      };
    const status = await this.status();
    return {
      ok: false,
      reason:
        status.remainingByPool[r.pool] < r.units
          ? "quota_exhausted"
          : "rate_limited",
    };
  }
  async commit(id: string) {
    await this.sql.run(
      "UPDATE reservations SET status='spent' WHERE id=? AND status IN ('reserved','abandoned')",
      [id],
    );
  }
  async release(id: string) {
    await this.sql.run(
      "UPDATE reservations SET status='released' WHERE id=? AND status IN ('reserved','abandoned')",
      [id],
    );
  }
  async abandon(id: string) {
    await this.sql.run("UPDATE reservations SET status='abandoned' WHERE id=? AND status='reserved'", [id]);
  }
  async status(): Promise<BudgetStatus> {
    const rows = await this.sql.all<{
      pool: BudgetPool;
      status: string;
      units: number;
    }>(
      "SELECT pool,status,SUM(units) units FROM reservations GROUP BY pool,status",
    );
    const result: BudgetStatus = {
      spentUnits: 0,
      reservedUnits: 0,
      remainingByPool: { ...caps },
    };
    for (const r of rows)
      if (r.status !== "released") {
        result.remainingByPool[r.pool] -= r.units;
        if (r.status === "spent") result.spentUnits += r.units;
        else result.reservedUnits += r.units;
      }
    return result;
  }
}
// Same public interface; synchronous mutation before await makes in-isolate reservation atomic.
export class MemoryBudgetGuard implements BudgetGuard {
  private rows: (ReservationRequest & {
    id: string;
    at: number;
    status: string;
  })[] = [];
  constructor(private now = () => Date.now()) {}
  async reserve(r: ReservationRequest): Promise<ReservationResult> {
    if (r.units !== BUDGET.unitsPerSdRun)
      return { ok: false, reason: "quota_exhausted" };
    const at = this.now(),
      existing = this.rows.find(
        (x) =>
          x.sessionId === r.sessionId &&
          x.imageSha256 === r.imageSha256 &&
          x.at > at - 1800000,
      );
    if (existing)
      return {
        ok: true,
        reservationId: existing.id,
        deduplicatedJobId: existing.id,
      };
    if (
      r.units !== 9 ||
      this.rows
        .filter((x) => x.pool === r.pool && x.status !== "released")
        .reduce((n, x) => n + x.units, 0) +
        r.units >
        caps[r.pool]
    )
      return { ok: false, reason: "quota_exhausted" };
    if (
      this.rows.filter((x) => x.status === "reserved").length >= 2 ||
      this.rows.filter(
        (x) =>
          x.ipHash === r.ipHash &&
          new Date(x.at).toISOString().slice(0, 10) ===
            new Date(at).toISOString().slice(0, 10),
      ).length >= 2
    )
      return { ok: false, reason: "rate_limited" };
    const id = crypto.randomUUID();
    this.rows.push({ ...r, id, at, status: "reserved" });
    return { ok: true, reservationId: id };
  }
  async commit(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (r && ["reserved", "abandoned"].includes(r.status)) r.status = "spent";
  }
  async release(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (r && ["reserved", "abandoned"].includes(r.status)) r.status = "released";
  }
  async abandon(id: string) {
    const r = this.rows.find(x => x.id === id);
    if (r?.status === 'reserved') r.status = 'abandoned';
  }
  async reconcileOrphans(existingJobIds: ReadonlySet<string>) {
    for (const row of this.rows) if (row.status === "reserved" && row.at <= this.now()-1800000 && !existingJobIds.has(row.id)) row.status = "abandoned";
  }
  async status(): Promise<BudgetStatus> {
    const s: BudgetStatus = {
      spentUnits: 0,
      reservedUnits: 0,
      remainingByPool: { ...caps },
    };
    for (const r of this.rows)
      if (r.status !== "released") {
        s.remainingByPool[r.pool] -= r.units;
        if (r.status === "spent") s.spentUnits += r.units;
        else s.reservedUnits += r.units;
      }
    return s;
  }
}
