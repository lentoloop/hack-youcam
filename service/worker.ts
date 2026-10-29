import {
  CONSENT_TEXT_VERSION,
  IMAGE_LIMITS,
  POLLING,
  type AdapterEnv,
  type ProviderCleanup,
  type AnalysisJob,
  type ApiError,
  type Observation,
  type ZoneLabel,
  type MaskSet,
  type BudgetPool,
} from "../contracts";
import {
  createAdapter,
  MockAdapter,
  LiveAdapter,
  ServiceError,
  type MockFixture,
} from "./adapters";
import { D1BudgetGuard, D1Executor } from "./budget";
import { normalizeImage, sha256 } from "./image";
export interface Env extends AdapterEnv {
  DB: D1Database;
  IP_HASH_SECRET?: string;
  JUDGE_CODE?: string;
  DEV_CODE?: string;
  YOUCAM_STORAGE_HOST_SUFFIXES?: string;
}
// Results exist only in this isolate, expire after 30 minutes, and are never written to D1.
// An isolate restart loses results; callers must retake. Images are not retained after submit.
const results = new Map<
  string,
  { expires: number; observations: Observation[]; zoneLabels: ZoneLabel[]; masks: MaskSet }
>();
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function fail(code: ApiError["error"]["code"], message: string, status = 400) {
  return json(
    {
      error: {
        code,
        message,
        retryable: ["timeout", "rate_limited", "provider_error"].includes(code),
      },
    },
    status,
  );
}
interface Row {
  cleanup_status: ProviderCleanup;
  submit_started: number;
  submission_generation: number;
  id: string;
  state: AnalysisJob["state"];
  mode: AnalysisJob["mode"];
  provider_task_id: string | null;
  created_at: string;
  updated_at: string;
  session_id: string;
  error_code: ApiError["error"]["code"] | null;
}
function job(row: Row): AnalysisJob {
  return {
    id: row.id,
    state: row.state,
    mode: row.mode,
    source: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.error_code
      ? {
          error: {
            code: row.error_code,
            message:
              row.error_code === "timeout"
                ? "Analysis is still pending. Resume polling this task."
                : "Analysis could not be completed.",
            retryable: row.error_code === "timeout",
          },
        }
      : {}),
  };
}
async function codeMatches(value: unknown, expected: string): Promise<boolean> {
  if (typeof value !== "string") return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([value, expected].map(v => crypto.subtle.digest("SHA-256", encode.encode(v))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
function decodeJobId(value: string): string {
  try { return decodeURIComponent(value); }
  catch { throw new ServiceError("not_found", "Route not found.", 404); }
}
export async function handle(request: Request, env: Env): Promise<Response> {
  for (const [id, result] of results)
    if (result.expires <= Date.now()) results.delete(id);
  try {
    const url = new URL(request.url),
      sql = new D1Executor(env.DB),
      budget = new D1BudgetGuard(
        env.YOUCAM_MODE === "mock"
          ? {
              all: (query, args) =>
                sql.all(
                  query.replaceAll("reservations", "mock_reservations"),
                  args,
                ),
              batch: statements => sql.batch(statements.map(s => ({...s, sql:s.sql.replaceAll("reservations", "mock_reservations")}))),
              run: (query, args) =>
                sql.run(
                  query.replaceAll("reservations", "mock_reservations"),
                  args,
                ),
            }
          : sql,
        () => Date.now(), env.YOUCAM_MODE === "mock" ? "mock" : "live",
      );
    if (request.method === "POST" && url.pathname === "/api/analyses") {
      const length = Number(request.headers.get("content-length"));
      if (length > IMAGE_LIMITS.maxBytes + 65536)
        throw new ServiceError("invalid_image", "Upload is too large.", 413);
      // Bound the whole multipart body even for chunked requests.
      const reader = request.body?.getReader();
      if (!reader) throw new ServiceError("invalid_image", "Missing upload.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > IMAGE_LIMITS.maxBytes + 65536) {
          await reader.cancel();
          throw new ServiceError("invalid_image", "Upload is too large.", 413);
        }
        chunks.push(part.value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        body.set(c, offset);
        offset += c.length;
      }
      let form: FormData, meta: any;
      try {
        form = await new Response(body, {
          headers: {
            "Content-Type": request.headers.get("content-type") ?? "",
          },
        }).formData();
        meta = JSON.parse(String(form.get("meta")));
      } catch {
        throw new ServiceError(
          "invalid_image",
          "Invalid multipart upload or metadata.",
        );
      }
      if (
        meta?.consent?.granted !== true ||
        meta.consent.textVersion !== CONSENT_TEXT_VERSION ||
        typeof meta.consent.acceptedAt !== "string" ||
        !Number.isFinite(Date.parse(meta.consent.acceptedAt))
      )
        throw new ServiceError(
          "consent_required",
          "Current consent is required.",
        );
      if (
        typeof meta.sessionId !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(meta.sessionId)
      )
        throw new ServiceError(
          "invalid_image",
          "A random session identifier is required.",
        );
      const file = form.get("image");
      if (!file || typeof file === "string")
        throw new ServiceError("invalid_image", "Missing JPEG.");
      const image = await normalizeImage(file as File);
      if (image.width !== meta.width || image.height !== meta.height)
        throw new ServiceError(
          "invalid_image",
          "Image dimensions do not match metadata.",
        );
      let adapter = createAdapter(env);
      if (
        env.YOUCAM_MODE === "mock" &&
        [
          "success",
          "error_no_face",
          "error_src_face_too_small",
          "timeout",
        ].includes(meta.mockFixture)
      )
        adapter = new MockAdapter(meta.mockFixture as MockFixture);
      if (!env.IP_HASH_SECRET)
        throw new ServiceError(
          "live_unavailable",
          "Server privacy configuration is unavailable.",
          503,
        );
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip)
        throw new ServiceError(
          "live_unavailable",
          "Trusted client address is unavailable.",
          503,
        );
      const pool: BudgetPool =
        env.JUDGE_CODE && await codeMatches(meta.judgeCode, env.JUDGE_CODE)
          ? "judge"
          : env.DEV_CODE && await codeMatches(meta.judgeCode, env.DEV_CODE)
            ? "dev"
            : "public";
      if (adapter instanceof LiveAdapter && pool !== "judge") {
        const judgeSpentOrHeld = 450 - (await budget.status()).remainingByPool.judge;
        if (await adapter.creditBalance() - 9 < 460 - judgeSpentOrHeld)
          return fail("quota_exhausted", "Analysis allowance is unavailable. Try a labeled sample.", 429);
      }
      const reservation = await budget.reserve({
        pool,
        ipHash: await sha256(
          new TextEncoder().encode(env.IP_HASH_SECRET + "\0" + ip),
        ),
        sessionId: meta.sessionId,
        imageSha256: image.sha256,
        units: 9,
      });
      if (!reservation.ok)
        return fail(
          reservation.reason,
          "Analysis allowance is unavailable. Try a labeled sample.",
          429,
        );
      if (reservation.deduplicatedJobId) {
        const row = (
          await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [
            reservation.deduplicatedJobId,
          ])
        )[0];
        if (!row)
          return fail(
            "timeout",
            "Submission is in progress. Retry the same image.",
            503,
          );
        return json({ job: job(row), deduplicated: true }, 202);
      }
      const id = reservation.reservationId;
      try {
        await sql.run("UPDATE jobs SET submit_started=1,submission_generation=submission_generation+1 WHERE id=?", [id]);
        const task = await adapter.submit(image);
        await sql.run(
          "UPDATE jobs SET cleanup_status='pending',state='running',provider_task_id=?,updated_at=? WHERE id=?",
          [task.providerTaskId, new Date().toISOString(), id],
        );
        // Recording the handle precedes checking durable cancellation intent.
        if ((await sql.all("SELECT id FROM deleted_jobs WHERE id=?", [id])).length) {
          await budget.abandon(id);
          await cleanup((await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [id]))[0], env, sql);
        }
      } catch (error) {
        if (error instanceof ServiceError && error.safeToRelease) {
          await budget.release(id);
          await sql.run(
            "UPDATE jobs SET cleanup_status=?,state='failed',error_code='provider_error',updated_at=? WHERE id=? AND cleanup_status!='deleted' AND provider_task_id IS NULL",
            [error.fileCreated ? "unknown_task" : "not_applicable", new Date().toISOString(), id],
          );
        } else {
          // Ambiguous creation keeps unit liability but frees execution capacity.
          await budget.abandon(id);
          await sql.run(
            "UPDATE jobs SET cleanup_status=CASE WHEN provider_task_id IS NULL THEN 'unknown_task' ELSE cleanup_status END,error_code='timeout',updated_at=? WHERE id=? AND cleanup_status!='deleted'",
            [new Date().toISOString(), id],
          );
        }
      }
      return json(
        {
          job: job(
            (await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [id]))[0],
          ),
          deduplicated: false,
        },
        202,
      );
    }
    const match = url.pathname.match(/^\/api\/analyses\/([^/]+)$/);
    const deleted = async (id: string) => (await sql.all("SELECT id FROM deleted_jobs WHERE id=?", [id])).length > 0;
    if (request.method === "DELETE" && match) {
      const id = decodeJobId(match[1]);
      const row = (await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [id]))[0];
      if (!row) return fail("not_found", "This session result does not exist.", 404);
      await sql.run("INSERT OR IGNORE INTO deleted_jobs(id) VALUES(?)", [id]);
      results.delete(id);
      await sql.run(`UPDATE ${row.mode === 'mock' ? 'mock_reservations' : 'reservations'} SET status='abandoned' WHERE id=? AND status='reserved'`, [id]);
      const table = row.mode === "mock" ? "mock_reservations" : "reservations";
      await sql.run(`UPDATE ${table} SET image_sha='' WHERE id=?`, [id]);
      if (row.provider_task_id && !["succeeded", "failed"].includes(row.state)) {
        try {
          const outcome = await createAdapter({ ...env, YOUCAM_MODE: row.mode }).poll(row.provider_task_id);
          if (outcome.state === "succeeded" || outcome.state === "failed") {
            await sql.run(`UPDATE ${table} SET status=? WHERE id=? AND status IN ('reserved','abandoned')`, [outcome.state === "succeeded" ? "spent" : "released", id]);
            await sql.run("UPDATE jobs SET state=? WHERE id=?", [outcome.state, id]);
          }
        } catch { /* An uncertain provider outcome keeps its unit liability. */ }
      }
      const provider = await cleanup(row, env, sql);
      return json({ local: "deleted", provider: provider === "unknown_task" && row.state === "queued" ? "pending" : provider });
    }
    if (request.method === "GET" && match) {
      const id = decodeJobId(match[1]),
        row = (await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [id]))[0];
      if (!row || await deleted(id) || Date.now() - Date.parse(row.created_at) >= 1800000)
        return fail(
          "not_found",
          "This session result has expired or does not exist.",
          404,
        );
      if (row.state === "succeeded") {
        const result = results.get(id);
        if (!result)
          return fail(
            "not_found",
            "Session results are no longer available. Retake the photo.",
            404,
          );
        return json({ job: job(row), observations: result.observations, zoneLabels: result.zoneLabels, masks: result.masks });
      }
      if (row.state === "failed" || !row.provider_task_id)
        return json({ job: job(row), observations: [], zoneLabels: [] });
      // Provider polls are spaced at least ten seconds, including across isolates.
      const claimed = await sql.run(
        "UPDATE jobs SET updated_at=? WHERE id=? AND updated_at=? AND updated_at<=?",
        [
          new Date().toISOString(),
          id,
          row.updated_at,
          new Date(Date.now() - POLLING.intervalMs).toISOString(),
        ],
      );
      if (!claimed) return json({ job: job(row), observations: [], zoneLabels: [] });
      {
        try {
          const poll = await createAdapter(env).poll(row.provider_task_id!);
          if (poll.state === "succeeded") {
            await budget.commit(id);
            if (!await deleted(id)) results.set(id, {
              expires: Date.parse(row.created_at) + 1800000,
              observations: poll.observations,
              zoneLabels: poll.zoneLabels,
              masks: poll.masks,
            });
            await sql.run(
              "UPDATE jobs SET state='succeeded',error_code=NULL WHERE id=?",
              [id],
            );
          } else if (poll.state === "failed") {
            await budget.release(id);
            await sql.run(
              "UPDATE jobs SET state='failed',error_code=? WHERE id=?",
              [poll.code, id],
            );
          } else if (
            Date.now() - Date.parse(row.created_at) >=
            POLLING.uiTimeoutMs
          )
            await sql.run("UPDATE jobs SET error_code='timeout' WHERE id=?", [
              id,
            ]);
        } catch {
          await sql.run("UPDATE jobs SET error_code='timeout' WHERE id=?", [
            id,
          ]);
        }
        if (await deleted(id)) {
          results.delete(id);
          return fail("not_found", "This session result has expired or does not exist.", 404);
        }
        return json({
          job: job(
            (await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [id]))[0],
          ),
          observations: results.get(id)?.observations ?? [],
          zoneLabels: results.get(id)?.zoneLabels ?? [],
          ...(results.has(id) ? { masks: results.get(id)!.masks } : {}),
        });
      }
    }
    return fail("not_found", "Route not found.", 404);
  } catch (error) {
    if (error instanceof ServiceError)
      return fail(error.code, error.message, error.status);
    return fail("provider_error", "The request could not be completed.", 500);
  }
}
export async function cleanup(row: Row, env: Env, sql: D1Executor, fetcher: typeof fetch = fetch.bind(globalThis)): Promise<ProviderCleanup> {
  // At most two snapshots: bounded retries also bound scheduled invocation cost.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (row.cleanup_status === 'deleted') return 'deleted';
    let status: ProviderCleanup = row.mode === 'mock' ? 'not_applicable' :
      row.provider_task_id ? 'pending' : row.cleanup_status === 'not_applicable' || !row.submit_started ? 'not_applicable' : 'unknown_task';
    if (status === 'pending') {
      await sql.run("UPDATE jobs SET cleanup_attempts=cleanup_attempts+1,cleanup_last_attempt_at=? WHERE id=? AND provider_task_id IS ? AND submission_generation=? AND cleanup_status!='deleted'", [new Date().toISOString(), row.id, row.provider_task_id, row.submission_generation]);
      try {
        if (!env.YOUCAM_API_KEY) throw Error('Cleanup credentials unavailable');
        await new LiveAdapter(env.YOUCAM_API_KEY, fetcher).deleteTask(row.provider_task_id!);
        status = 'deleted';
      } catch { status = 'failed'; }
    }
    const changed = await sql.run("UPDATE jobs SET cleanup_status=?,provider_task_id=CASE WHEN ? IN ('deleted','not_applicable') THEN NULL ELSE provider_task_id END WHERE id=? AND provider_task_id IS ? AND submission_generation=? AND submit_started=? AND cleanup_status!='deleted'", [status, status, row.id, row.provider_task_id, row.submission_generation, row.submit_started]);
    if (changed) return status;
    row = (await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [row.id]))[0];
    if (!row) return 'unknown_task';
  }
  return row.cleanup_status;
}
export async function scheduled(_event: unknown, env: Env, _ctx?: unknown, fetcher: typeof fetch = fetch.bind(globalThis)) {
  const sql = new D1Executor(env.DB);
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
  for (const table of ["reservations", "mock_reservations"])
    await sql.run(`UPDATE ${table} SET image_sha=CASE WHEN created_at<=? OR id IN (SELECT id FROM deleted_jobs) THEN '' ELSE image_sha END, ip_hash=CASE WHEN day<? THEN '' ELSE ip_hash END, session_id=CASE WHEN day<? THEN '' ELSE session_id END WHERE created_at<=? OR day<? OR id IN (SELECT id FROM deleted_jobs)`, [now-1800000, today, today, now-1800000, today]);
  await sql.run("UPDATE jobs SET session_id='' WHERE substr(created_at,1,10)<?", [today]);
  // Uncertain units remain held; only execution slots are reclaimed.
  for (const table of ['reservations', 'mock_reservations'])
    await sql.run(`UPDATE ${table} SET status='abandoned' WHERE status='reserved' AND created_at<=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.id=${table}.id)`, [Date.now()-1800000]);
  const rows = await sql.all<Row>(`SELECT * FROM jobs WHERE (created_at<=? OR id IN (SELECT id FROM deleted_jobs))
    AND cleanup_status NOT IN ('deleted','not_applicable') AND (cleanup_status!='unknown_task' OR provider_task_id IS NOT NULL) ORDER BY mode='live' DESC,cleanup_last_attempt_at,created_at LIMIT 4`, [new Date(Date.now()-1800000).toISOString()]);
  for (const row of rows) {
    const table = row.mode === 'mock' ? 'mock_reservations' : 'reservations';
    await sql.batch([
      {sql: "INSERT OR IGNORE INTO deleted_jobs(id) VALUES(?)", args: [row.id]},
      {sql: `UPDATE ${table} SET status='abandoned' WHERE id=? AND status='reserved'`, args: [row.id]},
    ]);
    results.delete(row.id);
    await cleanup(row, env, sql, fetcher);
  }
}
export default { fetch: handle, scheduled };
