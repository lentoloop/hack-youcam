import {
  CONSENT_TEXT_VERSION,
  POLLING,
  type ConsentRecord,
} from "../../contracts";
import { createApi, AnalysisError } from "./api";
import { prepareImage } from "./image";
import { mockFetch } from "./mock";
import { SAMPLE } from "./sample";
import { renderResults, sourceLabel } from "./results";
import "./style.css";
import { pollJob } from "./poll";
const env = (
  import.meta as ImportMeta & {
    env: { DEV: boolean; VITE_USE_SERVICE?: string };
  }
).env;
const mock = env.DEV && env.VITE_USE_SERVICE !== "true";
const api = createApi(mock ? mockFetch() : fetch);
const root = document.querySelector<HTMLElement>("#app")!;
root.innerHTML = `<header><a href="/">Before Another Bottle</a><span>${mock ? "Mock development" : "Service connection"}</span></header><main><h1>A little clarity.<br>Before checkout.</h1><p>Four cosmetic observations. Three generic products. One next step that starts with what you own.</p><section id="consent"><h2>Your face, your choice</h2><label><input id="agree" type="checkbox">I have permission to upload this face to Perfect Corp. for cosmetic analysis. Our app deletes session images/results on exit or after 30 minutes; provider results remain available for 24 hours. This is not medical advice.</label><p>Provider source-image retention is UNCONFIRMED. Consent version: ${CONSENT_TEXT_VERSION}</p><button id="continue" disabled>Continue to photo</button></section><section id="capture" hidden><h2>Start with even light</h2><div class="frame" aria-label="Face framing guide"><span>Face the camera</span></div><p>Fill more than 60% of the image width with your face. Use soft, even light, no filters, and remove obstructions. Minimum short side: 480 pixels.</p><label>Take a selfie<input id="camera" type="file" accept="image/*" capture="user"></label><label>Or upload a photo<input id="upload" type="file" accept="image/*"></label><label>Judge access code (optional)<input id="judge" type="password" autocomplete="off"></label></section><button id="sample">Try Sample (pre-analyzed)</button><p>Synthetic fixture numbers with a placeholder silhouette; no photo or API call.</p><section id="status" role="status" aria-live="polite"></section><button id="resume" hidden>Resume existing job</button><section id="results"></section><button id="clear">End session and clear</button><footer>Cosmetic guidance only. No diagnosis. Images and results stay in this session for at most 30 minutes.</footer></main>`;
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let consent: ConsentRecord | undefined;
let sessionId = crypto.randomUUID();
let jobId: string | undefined;
let stopPoll: (() => void) | undefined;
let generation = 0;
let expires: ReturnType<typeof setTimeout> | undefined;
function armExpiry() {
  if (!expires) expires = setTimeout(clear, 30 * 60 * 1000);
}
function clear() {
  generation++;
  stopPoll?.();
  clearTimeout(expires);
  expires = undefined;
  jobId = undefined;
  consent = undefined;
  sessionId = crypto.randomUUID();
  get("results").replaceChildren();
  get("status").textContent = "Session cleared.";
  get("capture").hidden = true;
  get("consent").hidden = false;
  get<HTMLInputElement>("agree").checked = false;
  get<HTMLButtonElement>("continue").disabled = true;
  get("resume").hidden = true;
  for (const id of ["camera", "upload", "judge"])
    get<HTMLInputElement>(id).value = "";
}
get("clear").onclick = clear;
window.addEventListener("pagehide", clear);
get<HTMLInputElement>("agree").onchange = () => {
  get<HTMLButtonElement>("continue").disabled =
    !get<HTMLInputElement>("agree").checked;
};
get("continue").onclick = () => {
  consent = {
    granted: true,
    textVersion: CONSENT_TEXT_VERSION,
    acceptedAt: new Date().toISOString(),
  };
  armExpiry();
  get("consent").hidden = true;
  get("capture").hidden = false;
};
function error(e: unknown) {
  get("status").textContent =
    e instanceof Error
      ? e.message
      : "Connection failed. Check your connection, then resume the existing job if available.";
  get("resume").hidden = !jobId;
  if (e instanceof AnalysisError && e.code === "not_found") {
    jobId = undefined;
    get("resume").hidden = true;
  }
}
function poll(token: number) {
  if (!jobId) return;
  const id = jobId;
  stopPoll = pollJob(
    () => api.get(id),
    (result) => {
      if (token !== generation) return;
      get("status").textContent =
        `${sourceLabel[result.job.source]} · ${result.job.state} · Job ${id}`;
      if (result.job.state === "succeeded") {
        get("resume").hidden = true;
        renderResults(get("results"), result.observations);
        get("results").scrollIntoView?.({ block: "start" });
      } else if (result.job.state === "failed") {
        error(new AnalysisError(result.job.error?.code ?? "provider_error"));
      }
    },
    (e) => {
      if (token === generation) error(e);
    },
    () => {
      if (token !== generation) return;
      get("status").textContent =
        `Still processing. Job ${id} is kept in this session. Resume without uploading again.`;
      get("resume").hidden = false;
    },
  );
}
get("resume").onclick = () => {
  stopPoll?.();
  get("resume").hidden = true;
  poll(++generation);
};
async function upload(file: File) {
  if (!consent) return;
  const token = ++generation;
  stopPoll?.();
  jobId = undefined;
  get("resume").hidden = true;
  get("results").replaceChildren();
  get("status").textContent = "Preparing JPEG on your device…";
  try {
    const image = await prepareImage(file);
    if (token !== generation) return;
    get("status").textContent = "Submitting analysis…";
    const { job } = await api.create(image.blob, {
      consent,
      width: image.width,
      height: image.height,
      sessionId,
      ...(get<HTMLInputElement>("judge").value
        ? { judgeCode: get<HTMLInputElement>("judge").value }
        : {}),
    });
    if (token !== generation) return;
    jobId = job.id;
    get("status").textContent =
      `${sourceLabel[job.source]} · Processing · Job ${job.id}. Checking every ${POLLING.intervalMs / 1000} seconds…`;
    poll(token);
  } catch (e) {
    if (token === generation) error(e);
  } finally {
    for (const id of ["camera", "upload"]) get<HTMLInputElement>(id).value = "";
  }
}
for (const id of ["camera", "upload"])
  get<HTMLInputElement>(id).onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void upload(file);
  };
get("sample").onclick = () => {
  generation++;
  stopPoll?.();
  jobId = undefined;
  get("resume").hidden = true;
  armExpiry();
  get("status").textContent =
    "Sample (pre-analyzed) · Synthetic fixture, not a live analysis.";
  renderResults(get("results"), SAMPLE);
  get("results").scrollIntoView?.({ block: "start" });
};
