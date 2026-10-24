/** FROZEN CONTRACT (Kai, 2026-10-24). Unit budget guard backed by D1 (atomic reservations). */

export const BUDGET = {
  totalFreeUnits: 1000,
  /** Hard cap we allow ourselves to spend; 10 units never touched. */
  budgetUnits: 990,
  unitsPerSdRun: 9,
  /** Judge pool, reserved out of budgetUnits (50 runs). */
  judgeReserveUnits: 450,
  /** Public live cap (20 runs); the rest of the non-judge pool is dev/rehearsal/repair. */
  publicLiveCapUnits: 180,
  maxConcurrentLive: 2,
  maxLivePerIpPerDay: 2,
} as const;

export type BudgetPool = "judge" | "public" | "dev";

export interface ReservationRequest {
  pool: BudgetPool;
  /** Hashed client IP (never store raw IP). */
  ipHash: string;
  sessionId: string;
  imageSha256: string;
  units: number;
}

export type ReservationResult =
  | { ok: true; reservationId: string; deduplicatedJobId?: string }
  | { ok: false; reason: "quota_exhausted" | "rate_limited" };

export interface BudgetStatus {
  spentUnits: number;
  reservedUnits: number;
  remainingByPool: Record<BudgetPool, number>;
}

export interface BudgetGuard {
  /** Atomic: checks pool remaining, per-IP daily cap, concurrency, and session dedupe. */
  reserve(req: ReservationRequest): Promise<ReservationResult>;
  /** Provider task succeeded: units become spent. */
  commit(reservationId: string): Promise<void>;
  /** Provider failed (units only charged on success): release reservation. Not called on timeout. */
  release(reservationId: string): Promise<void>;
  /**
   * v3 (R1 blocker 3): job deleted/expired/ambiguous before a terminal provider state. Frees the concurrency slot
   * immediately but conservatively keeps the units held (counted as reserved/spent liability, never returned to a
   * pool) until a later confirmed outcome commits or releases them. Idempotent.
   */
  abandon(reservationId: string): Promise<void>;
  status(): Promise<BudgetStatus>;
}
