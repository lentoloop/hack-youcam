import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
const ledger = "/workspace/eng/youcam-units.log";
const host = "https://yce-api-01.makeupar.com";
const taskPath = "/s2s/v2.0/task/skin-analysis";
let remaining = "unknown", taskId, outcome = "pre-task-failure", used = 0, stopped = false, started = false, rawResult;
const timestamp = () => new Date(Date.now() + 8 * 3600000).toISOString().replace("Z", "+08:00");
async function log(endpoint, status, units = 0, note = "") {
  const line = `${timestamp()} step=s4-live endpoint=${endpoint} http=${status} units_used=${units} remaining=${remaining} note=${note}\n`;
  await appendFile(ledger, line);
  process.stdout.write(line);
}
const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k, /url|(?:^|_)id$|token/i.test(k) ? "[REDACTED]" : redact(v)]));
  if (typeof value === "string" && /https?:|X-Amz-|Bearer\s/i.test(value)) return "[REDACTED]";
  return value;
};
async function main() {
  if (!process.env.YOUCAM_API_KEY || process.env.SMOKE_LIVE_CONFIRM !== "1") throw Error("Key and SMOKE_LIVE_CONFIRM=1 required");
  const history = await readFile(ledger, "utf8"); // fail closed if ledger unavailable
  const lines = history.split("\n").filter(l => l.includes("step=s4-live"));
  const units = lines.reduce((sum,l) => sum + Number(l.match(/units_used=(\d+)/)?.[1] ?? 0), 0);
  const starts = lines.filter(l => l.includes("note=run-start")).length;
  if (units + 9 > 10 || lines.some(l => /units_used=9\b/.test(l))) throw Error("Step budget consumed");
  // Max 3 runs (2 session + 1 operator); refuse after any unresolved or successful task.
  if (starts >= 3 || lines.some(l => /note=run-end-(unresolved|success)/.test(l)) || (starts && !lines.some(l => /note=run-end-(task-error|pre-task-failure)/.test(l)))) throw Error("Run limit or unresolved prior run");
  await log("LOCAL", "-", 0, "run-start");
  started = true;
  let created = false;
  const wrapped = async (input, init = {}) => {
    if (stopped) throw Error("Safety stop active");
    const url = new URL(String(input));
    const provider = url.origin === host;
    const path = provider ? url.pathname : "upload";
    const endpoint = `${init.method ?? "GET"} ${path.startsWith(taskPath + "/") ? taskPath + "/[task_id]" : path}`;
    if (path === taskPath && init.method === "POST") {
      if (created) throw Error("Only one task creation allowed");
      created = true;
      outcome = "unresolved";
    }
    let res;
    try { res = await fetch(input, init); }
    catch { await log(endpoint, "network-error"); throw Error("Network request failed"); }
    let body;
    if (provider) { try { body = await res.clone().json(); } catch {} }
    const balanceCall = path === "/s2s/v1.0/client/credit";
    let note = "";
    if (balanceCall && !res.ok) remaining = "unknown";
    if (balanceCall && res.ok) {
      const rows = body?.results ?? body?.data?.results;
      const numbers = Array.isArray(rows) ? rows.map(r => Number(r.amount_dec)).filter(Number.isFinite) : [];
      if (numbers.length) {
        const next = numbers.reduce((a,b) => a+b, 0);
        if (remaining !== "unknown" && (Number(remaining) - next > 9 || (Number(remaining) > next && used === 0))) {
          stopped = true; note = "unexpected-balance-drop";
        }
        remaining = next;
      }
    }
    const success = path.startsWith(taskPath + "/") && body?.data?.task_status === "success";
    const charge = success && used === 0 ? 9 : 0;
    if (success) { used += charge; rawResult = body; outcome = "success"; }
    if (path.startsWith(taskPath + "/") && body?.data?.task_status === "error") outcome = "task-error";
    if ([401,403,429].includes(res.status) && !(balanceCall && res.status === 401)) {
      stopped = true; note = "safety-stop";
    }
    await log(endpoint, res.status, charge, note);
    if (stopped) throw Error("Safety stop; no further real calls");
    return res;
  };
  const request = async path => {
    const res = await wrapped(host + path, { headers: { Authorization: ["Bearer", process.env.YOUCAM_API_KEY].join(" ") } });
    return res.ok ? res.json() : null;
  };
  // Follow documented pagination, once per page; never retry an HTTP call.
  let next, skus = [];
  const seen = new Set();
  do {
    const cost = await request("/s2s/v2.0/credit/feature-cost" + (next ? "?starting_token=" + encodeURIComponent(next) : ""));
    const page = cost?.result?.skus;
    if (!Array.isArray(page)) throw Error("Unsupported feature cost schema");
    console.log("feature-cost:", JSON.stringify(page.map(({ description, amount, unit, proc_unit }) => ({ description, amount, unit, proc_unit }))));
    skus.push(...page.filter(v => /^(?:AI Skin Analysis for SD 1\s*~\s*4 concerns|AI Skin Analysis V2\.0 SD \(1-4 concerns\))$/i.test(v.description)));
    next = cost.result.next_token;
    if (next && seen.has(next)) throw Error("Repeated cost page");
    seen.add(next);
  } while (!skus.length && next);
  console.log("feature-cost SD 1~4:", JSON.stringify(skus.map(({ description, amount }) => ({ description, amount }))));
  if (skus.length !== 1 || skus[0].amount !== 9) throw Error("SD 1~4 feature cost is not exactly 9");
  await request("/s2s/v1.0/client/credit");
  const compiled = await build({ entryPoints: [new URL("../adapters.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
  const { LiveAdapter, MockAdapter } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
  const adapter = new LiveAdapter(process.env.YOUCAM_API_KEY, wrapped);
  const bytes = new Uint8Array(await readFile("/workspace/eng/youcam-test-face/test-face.jpg"));
  const task = await adapter.submit({ bytes, contentType: "image/jpeg", width: 600, height: 800, sha256: "smoke-runtime-only" });
  taskId = task.providerTaskId;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    const result = await adapter.poll(taskId);
    if (result.state === "running") continue;
    if (result.state === "failed") { console.log("Task error:", result.code); break; }
    console.log("Normalized observations:", JSON.stringify(result.observations));
    const mock = await new MockAdapter().poll("mock:success");
    const required = ["concern", "rawScore", "source"];
    const matches = mock.state === "succeeded" && result.observations.length === mock.observations.length &&
      mock.observations.every(m => result.observations.some(o => o.concern === m.concern && required.every(k => typeof o[k] === typeof m[k])));
    console.log("Schema vs mock:", matches ? "matched concern/rawScore/source; source differs (live/mock); optional uiScore provider display score" : "DIFFERED");
    await mkdir(new URL("../fixtures/", import.meta.url), { recursive: true });
    await writeFile(new URL("../fixtures/live-sample-result.json", import.meta.url), JSON.stringify(redact(rawResult), null, 2) + "\n");
    break;
  }
  await request("/s2s/v1.0/client/credit");
  await adapter.deleteTask(taskId);
}
try { await main(); }
catch (e) { console.error("Smoke stopped safely:", String(e?.message ?? e).slice(0, 200)); process.exitCode = 1; }
finally {
  // Keep the sanitized provider shape even if normalization failed after a charged success.
  if (rawResult) {
    await mkdir(new URL("../fixtures/", import.meta.url), { recursive: true });
    await writeFile(new URL("../fixtures/live-sample-result.json", import.meta.url), JSON.stringify(redact(rawResult), null, 2) + "\n");
  }
  if (started)
    await log("LOCAL", "-", 0, `run-end-${outcome}`);
}
