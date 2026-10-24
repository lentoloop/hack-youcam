import {
  CONSENT_TEXT_VERSION,
  IMAGE_LIMITS,
  POLLING,
  type AdapterEnv,
  type AnalysisJob,
  type ApiError,
  type Observation,
  type BudgetPool,
} from "../contracts";
import {
  createAdapter,
  MockAdapter,
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
}
// Results exist only in this isolate, expire after 30 minutes, and are never written to D1.
// An isolate restart loses results; callers must retake. Images are not retained after submit.
const results = new Map<
  string,
  { expires: number; observations: Observation[] }
>();
const polls = new Map<string, Promise<Response>>();
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
    ...(row.provider_task_id ? { providerTaskId: row.provider_task_id } : {}),
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
              run: (query, args) =>
                sql.run(
                  query.replaceAll("reservations", "mock_reservations"),
                  args,
                ),
            }
          : sql,
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
        env.JUDGE_CODE && meta.judgeCode === env.JUDGE_CODE
          ? "judge"
          : env.DEV_CODE && meta.judgeCode === env.DEV_CODE
            ? "dev"
            : "public";
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
      const id = reservation.reservationId,
        now = new Date().toISOString();
      await sql.run(
        "INSERT INTO jobs(id,state,mode,created_at,updated_at,session_id) VALUES(?,?,?,?,?,?)",
        [id, "queued", env.YOUCAM_MODE, now, now, meta.sessionId],
      );
      try {
        const task = await adapter.submit(image);
        await sql.run(
          "UPDATE jobs SET state='running',provider_task_id=?,updated_at=? WHERE id=?",
          [task.providerTaskId, new Date().toISOString(), id],
        );
      } catch (error) {
        if (error instanceof ServiceError && error.safeToRelease) {
          await budget.release(id);
          await sql.run(
            "UPDATE jobs SET state='failed',error_code='provider_error',updated_at=? WHERE id=?",
            [new Date().toISOString(), id],
          );
        } else {
          // Ambiguous submission failure may have created a paid task. Keep reservation, never recreate.
          await sql.run(
            "UPDATE jobs SET error_code='timeout',updated_at=? WHERE id=?",
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
      const id = decodeURIComponent(match[1]);
      const row = (await sql.all<Row>("SELECT * FROM jobs WHERE id=?", [id]))[0];
      if (!row || await deleted(id)) return fail("not_found", "This session result has expired or does not exist.", 404);
      await sql.run("INSERT OR IGNORE INTO deleted_jobs(id) VALUES(?)", [id]);
      results.delete(id);
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "GET" && match) {
      const id = decodeURIComponent(match[1]),
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
        return json({ job: job(row), observations: result.observations });
      }
      if (row.state === "failed" || !row.provider_task_id)
        return json({ job: job(row), observations: [] });
      if (polls.has(id)) return await polls.get(id)!;
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
      if (!claimed) return json({ job: job(row), observations: [] });
      const pending = (async () => {
        try {
          const poll = await createAdapter(env).poll(row.provider_task_id!);
          if (poll.state === "succeeded") {
            await budget.commit(id);
            if (!await deleted(id)) results.set(id, {
              expires: Date.parse(row.created_at) + 1800000,
              observations: poll.observations,
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
        });
      })();
      polls.set(id, pending);
      try {
        return await pending;
      } finally {
        polls.delete(id);
      }
    }
    return fail("not_found", "Route not found.", 404);
  } catch (error) {
    if (error instanceof ServiceError)
      return fail(error.code, error.message, error.status);
    return fail("provider_error", "The request could not be completed.", 500);
  }
}
export default { fetch: handle };
