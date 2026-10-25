import { readFile, appendFile, writeFile, mkdir, realpath, open, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { build } from "esbuild";
const ledger = "/workspace/eng/youcam-units.log";
const host = "https://yce-api-01.makeupar.com";
const taskPath = "/s2s/v2.0/task/skin-analysis";
const creditPath = "/s2s/v1.0/client/credit";
let balance = "unknown", adapter, taskId, used = 0, created = false, lock;
let outcome = "pre-task-failure";
const timestamp = () => new Date(Date.now() + 8 * 3600000).toISOString().replace("Z", "+08:00");
async function log(endpoint, status, units = 0, before = balance, note = "") {
  const line = `${timestamp()} step=breakout-live endpoint=${endpoint} http=${status} units_used=${units} remaining=${balance} balance_before=${before} balance_after=${balance} note=${note}\n`;
  await appendFile(ledger, line);
  process.stdout.write(line);
}
async function wrapped(input, init = {}) {
  const url = new URL(String(input));
  const provider = url.origin === host;
  if (!provider) console.log((init.method && init.method !== "GET" ? "upload-host=" : "mask-host=") + url.hostname);
  const path = provider ? url.pathname : "mask-or-upload";
  const method = init.method ?? "GET";
  const endpoint = `${method} ${path.startsWith(taskPath + "/") ? taskPath + "/[task_id]" : path}`;
  if (path === taskPath && method === "POST") {
    if (created || !Number.isFinite(balance) || balance - 9 < 460) throw Error("Task allowance unavailable");
    created = true;
    outcome = "unresolved";
    await log(endpoint, "intent", 0, balance, "task-submit");
  }
  const before = balance;
  let res;
  try { res = await fetch(input, { ...init, redirect: "manual" });
      if ((res.status >= 300 && res.status < 400) || res.status === 0 || res.type === "opaqueredirect")
        throw Object.assign(new Error("Outbound redirect response rejected."), { code: "provider_error" }); }
  catch { await log(endpoint, "network-error", 0, before); throw Error("Provider request failed"); }
  let body;
  if (provider) { try { body = await res.clone().json(); } catch {} }
  if (path === creditPath) {
    balance = "unknown";
    const rows = body?.results ?? body?.data?.results;
    if (res.ok && Array.isArray(rows) && rows.length && rows.every(r => Number.isFinite(Number(r.amount_dec))))
      balance = rows.reduce((sum, r) => sum + Number(r.amount_dec), 0);
  }
  const success = path.startsWith(taskPath + "/") && body?.data?.task_status === "success";
  const charge = success && used === 0 ? 9 : 0;
  if (success) { used += charge; outcome = "success"; }
  if (path.startsWith(taskPath + "/") && body?.data?.task_status === "error") outcome = "task-error";
  await log(endpoint, res.status, charge, before);
  return res;
}
async function credit() {
  const response = await wrapped(host + creditPath, {
    headers: { Authorization: ["Bearer", process.env.YOUCAM_API_KEY].join(" ") },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok || !Number.isFinite(balance)) throw Error("Credit balance unavailable");
}
async function main() {
  if (process.env.SMOKE_LIVE_CONFIRM !== "1" || !process.env.YOUCAM_API_KEY)
    throw Error("SMOKE_LIVE_CONFIRM=1 and YOUCAM_API_KEY required");
  const root = await realpath("/workspace/eng/youcam-test-face");
  const face = await realpath(resolve(process.env.FACE ?? root + "/ai-acne-face-01.jpg"));
  const demoRoot = await realpath("/workspace/eng/youcam-demo-face");
  if (![root, demoRoot].some(approved => face.startsWith(approved + sep))) throw Error("FACE must be inside an approved face directory");
  // Exclusive lock prevents concurrent operators from bypassing the two-run cap.
  lock = await open(ledger + ".breakout-lock", "wx");
  const lines = (await readFile(ledger, "utf8")).split("\n").filter(l => /\bstep=breakout-live\b/.test(l));
  const intents = lines.filter(l => /note=task-submit\b/.test(l)).length;
  // Legacy runs have no intent line: count each historical charged success as a run.
  const legacy = lines.filter(l => /\bunits_used=9\b/.test(l) && !lines.slice(0, lines.indexOf(l)).some(x => /note=task-submit\b/.test(x))).length;
  if (intents + legacy >= 2) throw Error("Two task runs already recorded");
  if (lines.some(l => /note=run-end-.*-cleanup-failed\b/.test(l))) throw Error("Prior cleanup failed; reconcile before another run");
  const starts = lines.filter(l => /note=run-start\b/.test(l)).length;
  const ends = lines.filter(l => /note=run-end-(success|task-error|pre-task-failure)\b/.test(l)).length;
  if (starts > ends) throw Error("Prior run unresolved; reconcile ledger before another run");
  await log("LOCAL", "-", 0, balance, "run-start");
  try {
    await credit(); // First provider call; reserve includes a 10-unit cushion over judge's 450.
    if (balance - 9 < 460) throw Error("Credit reserve would be breached");
    const bytes = new Uint8Array(await readFile(face));
    const compiled = await build({ entryPoints: [new URL("../adapters.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
    const { LiveAdapter } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
    if (process.env.SMOKE_LEARN_HOSTS !== "1" && !process.env.YOUCAM_STORAGE_HOST_SUFFIXES?.split(',').some(s => s.trim())) throw Error("Storage allowlist required");
    adapter = new LiveAdapter(process.env.YOUCAM_API_KEY, wrapped, process.env.SMOKE_LEARN_HOSTS === "1" ? "" : process.env.YOUCAM_STORAGE_HOST_SUFFIXES);
    taskId = (await adapter.submit({ bytes, contentType: "image/jpeg", width: 600, height: 800, sha256: "runtime-only" })).providerTaskId;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10000));
      const result = await adapter.poll(taskId);
      if (result.state === "running") continue;
      if (result.state === "failed") throw Error("Analysis failed: " + result.code);
      const { observations, zoneLabels, masks } = result;
      console.log(JSON.stringify({ observations, maskBytes: Object.fromEntries(Object.entries(masks).map(([k,v]) => [k, Buffer.from(v.split(",")[1], "base64").length])) }));
      const output = resolve(process.env.OUT ?? "/workspace/eng/spikes/youcam-breakout-20261025/live-smoke/result.json");
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify({ observations, zoneLabels, masks }, null, 2) + "\n", { mode: 0o600 });
      return;
    }
    throw Error("Analysis timed out; no new task created");
  } finally {
    // Cleanup is attempted even after polling, output, or credit failures.
    let cleanup = created ? "failed" : "deleted";
    try { if (adapter && taskId) { await adapter.deleteTask(taskId); cleanup = "deleted"; } }
    finally {
      if (created) { try { await credit(); } catch { process.exitCode = 1; } }
      await log("LOCAL", "-", 0, balance, `run-end-${outcome}-cleanup-${cleanup}`);
    }
  }
}
try { await main(); }
catch { console.error("Breakout smoke stopped; inspect the sanitized ledger for status."); process.exitCode = 1; }
finally { if (lock) { await lock.close(); await unlink(ledger + ".breakout-lock"); } }
