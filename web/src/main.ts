import { CONSENT_TEXT, CONSENT_TEXT_VERSION, type ConsentRecord, type ProviderCleanup } from '../../contracts/analysis';
import type { BreakoutLog, ProductChange } from '../../contracts/log';
import { createApi, AnalysisError } from './api';
import { prepareImage } from './image';
import { SAMPLE, SAMPLE_DESCRIPTION } from './sample';
import { renderResults, sourceLabel } from './results';
import { pollJob } from './poll';
import { captureGuide } from './capture-guide';
import { regionsFromMasks } from './regions-browser';
import { downloadLog, importLog } from './log-file';
import './style.css';
const api = createApi(), root = document.querySelector<HTMLElement>('#app')!;
root.innerHTML = `<header>Breakout Log (working title)</header><main><h1>Make room for the facts.<span class="hero-riso-patch" aria-hidden="true"></span></h1><p>Record product changes and cosmetic appearance observations to bring to a professional.</p><section id="consent"><h2>Your face, your choice</h2><label><input id="agree" type="checkbox">${CONSENT_TEXT}</label><p>Consent version: ${CONSENT_TEXT_VERSION}</p><button id="continue" disabled>Continue to photo</button></section>${new URLSearchParams(window.location.search).get('demo') === 'synthetic' ? '<aside id="synthetic-demo" class="demo-banner">Demo images are AI-generated synthetic faces, not real people. Created with Grok.</aside>' : ''}<section id="capture" hidden>${captureGuide}<label>Take a selfie<input id="camera" type="file" accept="image/*" capture="user"></label><label>Or upload a photo<input id="upload" type="file" accept="image/*"></label><p id="photo-status"></p><label>Judge access code (optional)<input id="judge" type="password" autocomplete="off"></label><section id="report"><h2>Your own account</h2><label>Areas<input id="areas"></label><label>Discomfort<textarea id="discomfort"></textarea></label><label><input id="severe" type="checkbox">Painful, swollen or spreading breakouts</label><h2>Recent product changes</h2><p>Active means an active ingredient such as a retinoid, acid or BPO.</p><div class="table-scroll"><table><thead><tr><th>Category</th><th>Started on</th><th>Contains active?</th><th>Note</th><th></th></tr></thead><tbody id="changes"></tbody></table></div><button id="add-change">Add product change</button></section><button id="analyze" disabled>Analyze and add entry</button></section><button id="sample">Try Sample (pre-analyzed)</button><p>${SAMPLE_DESCRIPTION}</p><section id="status" role="status" aria-live="polite"></section><button id="resume" hidden>Resume existing job</button><section id="results"></section><button id="download" disabled>Download log</button><label>Import log<input id="import" type="file" accept="application/json,.json"></label><button id="clear">Clear log</button><button id="retry-delete" hidden>Retry cleanup</button><button id="start-analysis" hidden>Start a new analysis</button><button id="delete">Delete my analysis</button><footer>Appearance records only. No diagnosis. Session expires after 30 minutes.</footer></main>`;
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fresh = (): BreakoutLog => ({ version: 'breakout-log.v1', createdAt: new Date().toISOString(), changes: [], selfReport: { areas: '', discomfort: '', reportedSevereSymptom: false }, entries: [] });
let log = fresh(), consent: ConsentRecord | undefined, sessionId = crypto.randomUUID(), jobId: string | undefined, stopPoll: (() => void) | undefined, generation = 0, expires: ReturnType<typeof setTimeout> | undefined, pending: File | undefined, submittedFraming = false, submittedAt = '';
const recordedJobs = new Set<string>();
const cleanupIds = new Set<string>();
const cleanupMessages: Record<ProviderCleanup, string> = {
    deleted: 'Perfect Corp. confirmed deletion of the analysis and its input files.',
    pending: 'Perfect Corp. cleanup is pending. Retry cleanup to check again.',
    failed: 'Perfect Corp. cleanup failed. Retry cleanup to try again.',
    not_applicable: 'No Perfect Corp. analysis needs cleanup.',
    unknown_task: 'The provider supplied no task ID. Cleanup cannot be retried. Uploaded files that cannot be deleted expire after 30 days. Start a new analysis to try another photo.',
};
function error(e: unknown) { get('status').textContent = e instanceof Error ? e.message : 'Connection failed.'; get('resume').hidden = !jobId; if (e instanceof AnalysisError && e.code === 'not_found') {
    deleteCurrent();
    get('resume').hidden = true;
} }
function armExpiry() { if (!expires)
    expires = setTimeout(clear, 30 * 60 * 1000); }
async function deleteCurrent(id = jobId) { if (!id) return;
    cleanupIds.add(id);
    try {
        const result = await api.delete(id);
        get('status').textContent = `Deleted here. ${cleanupMessages[result.provider]}`;
        get('start-analysis').hidden = result.provider !== 'unknown_task';
        if (result.provider === 'deleted' || result.provider === 'not_applicable' || result.provider === 'unknown_task') { cleanupIds.delete(id); if (jobId === id) jobId = undefined; }
        get('retry-delete').hidden = cleanupIds.size === 0;
    } catch (e) { get('retry-delete').hidden = false; get('status').textContent = e instanceof Error ? e.message : 'Cleanup request failed. Retry cleanup.'; }
}
get('start-analysis').onclick = () => { get('start-analysis').hidden = true; get('consent').hidden = Boolean(consent); get('capture').hidden = !consent; get('status').textContent = 'Select a photo to start a new analysis.'; get(consent ? 'upload' : 'agree').focus(); };
get('retry-delete').onclick = () => { for (const id of cleanupIds) void deleteCurrent(id); };
function render() { renderResults(get('results'), log); get<HTMLButtonElement>('download').disabled = false; }
function clear() { get('start-analysis').hidden = true; generation++; stopPoll?.(); deleteCurrent(); clearTimeout(expires); expires = undefined; log = fresh(); recordedJobs.clear(); consent = undefined; pending = undefined; sessionId = crypto.randomUUID(); get('results').replaceChildren(); get('capture').hidden = true; get('consent').hidden = false; get<HTMLInputElement>('agree').checked = false; get<HTMLButtonElement>('continue').disabled = true; get<HTMLButtonElement>('download').disabled = true; get<HTMLButtonElement>('analyze').disabled = true; get('resume').hidden = true; get('changes').replaceChildren(); for (const id of ['camera', 'upload', 'judge', 'areas', 'discomfort', 'import'])
    get<HTMLInputElement>(id).value = ''; for (const id of ['severe', 'framing'])
    get<HTMLInputElement>(id).checked = false; get('photo-status').textContent = ''; get('status').textContent = 'Log cleared.'; }
function addChange(c?: ProductChange) { const row = document.createElement('tr'); row.dataset.id = c?.id ?? crypto.randomUUID(); row.innerHTML = '<td><input aria-label="Category"></td><td><input type="date" aria-label="Started on"></td><td><select aria-label="Contains active"><option>unknown</option><option>yes</option><option>no</option></select></td><td><input aria-label="Note"></td><td><button>Remove</button></td>'; const fields = row.querySelectorAll('input'); fields[0]!.value = c?.category ?? ''; fields[1]!.value = c?.startedOn ?? ''; fields[2]!.value = c?.note ?? ''; row.querySelector('select')!.value = c?.active ?? 'unknown'; row.querySelector('button')!.onclick = () => row.remove(); get('changes').append(row); }
function readReport() { log.selfReport = { areas: get<HTMLInputElement>('areas').value, discomfort: get<HTMLTextAreaElement>('discomfort').value, reportedSevereSymptom: get<HTMLInputElement>('severe').checked }; log.changes = Array.from(get('changes').querySelectorAll('tr')).map(row => { const f = row.querySelectorAll('input'); return { id: row.dataset.id!, category: f[0]!.value, startedOn: f[1]!.value, active: row.querySelector('select')!.value as ProductChange['active'], note: f[2]!.value }; }); }
get('add-change').onclick = () => addChange();
get('clear').onclick = clear;
window.addEventListener('pagehide', clear);
get('delete').onclick = () => { generation++; stopPoll?.(); deleteCurrent(); get('resume').hidden = true; get('status').textContent = 'Analysis deletion requested. Your downloaded record remains until cleared.'; };
get<HTMLInputElement>('agree').onchange = () => { get<HTMLButtonElement>('continue').disabled = !get<HTMLInputElement>('agree').checked; };
get('continue').onclick = () => { consent = { granted: true, textVersion: CONSENT_TEXT_VERSION, acceptedAt: new Date().toISOString() }; armExpiry(); get('consent').hidden = true; get('capture').hidden = false; };
for (const id of ['camera', 'upload'])
    get<HTMLInputElement>(id).onchange = e => { pending = (e.target as HTMLInputElement).files?.[0]; get<HTMLButtonElement>('analyze').disabled = !pending; get('photo-status').textContent = pending ? 'Photo selected. Complete your account below.' : ''; };
function poll(token: number) { if (!jobId)
    return; const id = jobId; stopPoll = pollJob(() => api.get(id), result => { if (token !== generation)
    return; get('status').textContent = `${sourceLabel[result.job.source]} · ${result.job.state}`; if (result.job.state === 'succeeded') {
    get('resume').hidden = true;
    void (async () => { try {
        const regions = result.masks ? await regionsFromMasks(result.masks) : undefined;
        if (token !== generation)
            return;
        if (!recordedJobs.has(id)) {
            recordedJobs.add(id);
            log.entries.push({ id: crypto.randomUUID(), date: submittedAt, source: result.job.source, observations: result.observations, zoneLabels: result.zoneLabels, ...(regions ? { regions } : {}), framing: { guideShown: true, userConfirmedSameFraming: submittedFraming, imageSize: { w: 600, h: 800 } } });
        }
        render();
    }
    catch (e) {
        if (token === generation)
            error(e);
    } })();
}
else if (result.job.state === 'failed')
    error(new AnalysisError(result.job.error?.code ?? 'provider_error')); }, e => { if (token === generation)
    error(e); }, () => { if (token === generation) {
    get('status').textContent = 'Still processing. Resume this job without uploading again.';
    get('resume').hidden = false;
} }); }
get('resume').onclick = () => { stopPoll?.(); get('resume').hidden = true; poll(++generation); };
get('analyze').onclick = () => { void (async () => { if (!pending || !consent)
    return; get('start-analysis').hidden = true; const file = pending, token = ++generation; readReport(); submittedFraming = get<HTMLInputElement>('framing').checked; submittedAt = new Date().toISOString(); stopPoll?.(); deleteCurrent(); get<HTMLButtonElement>('analyze').disabled = true; get('resume').hidden = true; get('status').textContent = 'Preparing JPEG on your device…'; try {
    const image = await prepareImage(file);
    if (token !== generation)
        return;
    const { job } = await api.create(image.blob, { consent, width: image.width, height: image.height, sessionId, ...(get<HTMLInputElement>('judge').value ? { judgeCode: get<HTMLInputElement>('judge').value } : {}) });
    if (token !== generation) {
        void api.delete(job.id).catch(error);
        return;
    }
    jobId = job.id;
    get('status').textContent = `${sourceLabel[job.source]} · Processing`;
    poll(token);
}
catch (e) {
    if (token === generation)
        error(e);
}
finally {
    if (token === generation) {
        pending = undefined;
        for (const id of ['camera', 'upload'])
            get<HTMLInputElement>(id).value = '';
    }
} })(); };
get('sample').onclick = () => { generation++; stopPoll?.(); deleteCurrent(); get('resume').hidden = true; armExpiry(); readReport(); if (!log.entries.some(e => e.id === SAMPLE.id))
    log.entries.push(structuredClone(SAMPLE)); get('status').textContent = `Sample (pre-analyzed), not a live analysis. ${SAMPLE_DESCRIPTION}`; render(); };
get('download').onclick = () => { try {
    readReport();
    render();
    downloadLog(log);
}
catch (e) {
    error(e);
} };
get<HTMLInputElement>('import').onchange = () => { const file = get<HTMLInputElement>('import').files?.[0]; if (!file)
    return; const token = ++generation; stopPoll?.(); deleteCurrent(); void importLog(file).then(value => { if (token !== generation)
    return; log = value; armExpiry(); get<HTMLInputElement>('areas').value = log.selfReport.areas; get<HTMLTextAreaElement>('discomfort').value = log.selfReport.discomfort; get<HTMLInputElement>('severe').checked = log.selfReport.reportedSevereSymptom; get('changes').replaceChildren(); log.changes.forEach(addChange); render(); get('status').textContent = 'Log imported on this device.'; }).catch(error); };
