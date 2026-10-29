import { run2Masks } from '../../service/fixtures/run2-masks';
import { CONSENT_TEXT } from '../../contracts';
import { it, expect, vi, afterEach } from '../../web/node_modules/vitest';
import { SAMPLE } from '../../web/src/sample';
import { serializeLog } from '../../web/src/log-file';
import { prepareImage } from '../../web/src/image';
import { pollJob } from '../../web/src/poll';
import type { GetAnalysisResponse } from '../../contracts/analysis';
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });
it('crops to 600x800 JPEG and releases bitmap', async () => { const close = vi.fn(), drawImage = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close })); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D); vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['jpeg'], { type: 'image/jpeg' }))); const result = await prepareImage(new File(['x'], 'x.jpg')); expect(result.width).toBe(600); expect(result.height).toBe(800); expect(drawImage).toHaveBeenCalledWith(expect.anything(), 175, 0, 450, 600, 0, 0, 600, 800); expect(close).toHaveBeenCalledOnce(); });
it('runs full mocked upload, derives regions, downloads numbers and deletes analysis', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    const result: GetAnalysisResponse = { job: { id: 'mock-job', state: 'succeeded', mode: 'mock', source: 'mock', createdAt: 'now', updatedAt: 'now' }, observations: SAMPLE.observations.map(o => ({ ...o, source: 'mock' })), zoneLabels: SAMPLE.zoneLabels.map(z => ({ ...z, source: 'mock' })), masks: { ...run2Masks } };
    let cleanupAttempts = 0;
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(init?.method === 'DELETE' ? Response.json({ local: 'deleted', provider: ++cleanupAttempts === 1 ? 'failed' : 'deleted' }) : Response.json(init?.method === 'POST' ? { job: result.job, deduplicated: false } : result)));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 600, height: 800, close: vi.fn() }));
    const pixels = new Uint8ClampedArray(600 * 800 * 4);
    pixels[3] = 255;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ width: 600, height: 800, data: pixels }) } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['jpeg'], { type: 'image/jpeg' })));
    let downloaded: Blob | undefined;
    vi.stubGlobal('URL', class extends URL {
        static createObjectURL(blob: Blob) { downloaded = blob; return 'blob:test'; }
        static revokeObjectURL() { }
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { });
    await import('../../web/src/main');
    const click = (id: string) => (document.getElementById(id) as HTMLButtonElement).click();
    expect(document.querySelector('#consent label')!.textContent).toBe(CONSENT_TEXT);
    click('agree');
    click('continue');
    click('add-change');
    (document.querySelector('[aria-label="Category"]') as HTMLInputElement).value = 'serum';
    (document.querySelector('[aria-label="Started on"]') as HTMLInputElement).value = '2026-10-01';
    (document.getElementById('areas') as HTMLInputElement).value = 'cheeks';
    click('severe');
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'synthetic.jpg')] });
    input.dispatchEvent(new Event('change'));
    click('analyze');
    await vi.advanceTimersByTimeAsync(10001);
    const text = document.getElementById('results')!.textContent!;
    for (const value of ['Your breakout log', 'Acne: 66', 'Oily', 'Region stats', 'Estimated by this app from the YouCam mask, not a YouCam measurement', 'Still missing', 'cannot tell which product', 'Mock (test data)', 'please see a dermatologist'])
        expect(text).toContain(value);
    click('severe');
    (document.querySelector('[aria-label="Category"]') as HTMLInputElement).value = 'updated serum';
    (document.getElementById('discomfort') as HTMLTextAreaElement).value = 'edited after analysis';
    click('download');
    expect(document.getElementById('results')!.textContent).not.toContain('please see a dermatologist');
    expect(document.getElementById('results')!.textContent).toContain('updated serum');
    expect(downloaded).toBeDefined();
    vi.useRealTimers();
    const encoded = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(downloaded!); });
    expect(encoded).not.toMatch(/data:|https?:|"image"|"masks"/i);
    const parsed = JSON.parse(encoded);
    expect(parsed.selfReport.discomfort).toBe('edited after analysis');
    expect(parsed.changes[0].category).toBe('updated serum');
    expect(parsed.entries[0].regions.zones[0].acneSpots).toBe(1);
    expect(serializeLog(parsed)).toBeTruthy();
    click('delete');
    expect(fetcher).toHaveBeenLastCalledWith('/api/analyses/mock-job', { method: 'DELETE', keepalive: true });
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('Deleted here. Perfect Corp. cleanup failed.'));
    expect(document.getElementById('retry-delete')!.hidden).toBe(false);
    click('retry-delete');
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('Perfect Corp. confirmed deletion'));
    expect(document.getElementById('retry-delete')!.hidden).toBe(true);
    click('clear');
    expect(document.getElementById('results')!.textContent).toBe('');
});
it('sample makes no request and expires at 30 minutes', async () => { vi.useFakeTimers(); vi.resetModules(); vi.stubGlobal('fetch', vi.fn()); document.body.innerHTML = '<div id="app"></div>'; await import('../../web/src/main'); (document.getElementById('sample') as HTMLButtonElement).click(); expect(document.getElementById('results')!.textContent).toContain('Sample (pre-analyzed)'); expect(fetch).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(30 * 60 * 1000); expect(document.getElementById('results')!.textContent).toBe(''); });
it('poll deadline ignores a late result', async () => { vi.useFakeTimers(); let resolve!: (v: GetAnalysisResponse) => void; const done = vi.fn(), timeout = vi.fn(); pollJob(() => new Promise(r => { resolve = r; }), done, vi.fn(), timeout); await vi.advanceTimersByTimeAsync(120000); expect(timeout).toHaveBeenCalledOnce(); resolve({} as GetAnalysisResponse); await Promise.resolve(); expect(done).not.toHaveBeenCalled(); });

it.each([
    ['malformed JSON', '{', /JSON|property|position/i],
    ['unknown version', JSON.stringify({ version: 'old' }), /Unexpected fields|Invalid version/],
    ['embedded image', JSON.stringify({ image: 'data:image/png;base64,AA==' }), /Unsafe/],
])('shows import rejection for %s and preserves the log', async (_name, contents, message) => {
    vi.resetModules(); document.body.innerHTML = '<div id="app"></div>';
    await import('../../web/src/main');
    document.getElementById('sample')!.click();
    const before = document.getElementById('results')!.textContent;
    const input = document.getElementById('import') as HTMLInputElement;
    const file = new File([contents], 'invalid.json');
    Object.defineProperty(file, 'text', { value: async () => contents });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toMatch(message));
    expect(document.getElementById('results')!.textContent).toBe(before);
});
it('clear resets the log, report, consent and download state', async () => {
    vi.resetModules(); document.body.innerHTML = '<div id="app"></div>';
    await import('../../web/src/main');
    document.getElementById('add-change')!.click();
    (document.getElementById('areas') as HTMLInputElement).value = 'cheeks';
    document.getElementById('sample')!.click();
    expect((document.getElementById('download') as HTMLButtonElement).disabled).toBe(false);
    document.getElementById('clear')!.click();
    expect(document.getElementById('results')!.textContent).toBe('');
    expect(document.getElementById('changes')!.children).toHaveLength(0);
    expect((document.getElementById('areas') as HTMLInputElement).value).toBe('');
    for (const id of ['download', 'continue']) expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('status')!.textContent).toBe('Log cleared.');
});
it.each([false, true])('comparison requires same-framing confirmation: %s', async confirmed => {
    const { renderResults } = await import('../../web/src/results');
    const first = structuredClone(SAMPLE), second = structuredClone(SAMPLE);
    second.id = 'second'; second.date = '2026-10-25T08:35:00.000Z'; second.observations[0]!.uiScore = 71;
    first.framing.userConfirmedSameFraming = second.framing.userConfirmedSameFraming = confirmed;
    const root = document.createElement('section');
    renderResults(root, { version: 'breakout-log.v1', createdAt: SAMPLE.date, changes: [], selfReport: { areas: '', discomfort: '', reportedSevereSymptom: false }, entries: [first, second] });
    expect(root.textContent).toContain('Sample (pre-analyzed)');
    expect(root.textContent).toContain('Side-by-side entries');
    if (confirmed) {
        expect(root.textContent).toContain('Acne: 66 | 71');
        expect(root.textContent).toContain('T-zone: marked spots 7 | 7');
        expect(root.textContent).not.toMatch(/%|delta|improv|Confirm the same framing/i);
        const selects = root.querySelectorAll('select');
        selects[1]!.value = '0'; selects[1]!.dispatchEvent(new Event('change'));
        expect(root.textContent).toContain('Acne: 66 | 66');
    } else {
        expect(root.textContent).toContain('Confirm the same framing for both entries first.');
        expect(root.textContent).not.toContain('Acne: 66 | 71');
    }
});
it('rejects oversized PNG dimensions before browser decoding', async () => {
    const { decodeMask } = await import('../../web/src/regions-browser');
    const bytes = Uint8Array.from(atob(run2Masks.acne!.split(',')[1]!), c => c.charCodeAt(0));
    bytes[16] = 127;
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    await expect(decodeMask('data:image/png;base64,' + btoa(String.fromCharCode(...bytes)))).rejects.toThrow('dimensions');
    expect(decode).not.toHaveBeenCalled();
});

it.each(['?demo=synthetic', '', '?demo=other'])('shows synthetic demo disclosure only for the explicit mode: %s', async query => {
    vi.resetModules();
    window.history.replaceState({}, '', '/' + query);
    document.body.innerHTML = '<div id="app"></div>';
    await import('../../web/src/main');
    const banner = document.getElementById('synthetic-demo');
    if (query === '?demo=synthetic') {
        expect(banner?.textContent).toBe('Demo images are AI-generated synthetic faces, not real people. Created with Grok.');
        expect(banner?.closest('[hidden]')).toBeNull();
        document.getElementById('sample')!.click();
        expect(banner?.isConnected).toBe(true);
        expect(banner?.closest('[hidden]')).toBeNull();
    } else expect(banner).toBeNull();
});
it('labels the sample scores as coming from an AI-generated synthetic face', async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    await import('../../web/src/main');
    expect(document.body.textContent).toContain('Sample uses pre-analyzed run2 scores from an AI-generated synthetic face, not a real person. Created with Grok.');
    document.getElementById('sample')!.click();
    expect(document.getElementById('status')!.textContent).toContain('scores from an AI-generated synthetic face');
});

it.each([false, true])('ends cleanup retries without a provider task and starts another analysis directly: %s', async startDirectly => {
    vi.useFakeTimers(); vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    const job = { id: 'failed-upload', state: 'failed', mode: 'live', source: 'live', createdAt: 'now', updatedAt: 'now', error: { code: 'provider_error' } };
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(Response.json(init?.method === 'DELETE' ? { local: 'deleted', provider: 'unknown_task' } : init?.method === 'POST' ? { job, deduplicated: false } : { job })));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 600, height: 800, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['jpeg'], { type: 'image/jpeg' })));
    await import('../../web/src/main');
    document.getElementById('agree')!.click(); document.getElementById('continue')!.click();
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'photo.jpg')] });
    input.dispatchEvent(new Event('change')); document.getElementById('analyze')!.click();
    await vi.advanceTimersByTimeAsync(10001);
    document.getElementById('delete')!.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.getElementById('status')!.textContent).toContain('Cleanup cannot be retried');
    expect(document.getElementById('status')!.textContent).toContain('expire after 30 days');
    expect(document.getElementById('retry-delete')!.hidden).toBe(true);
    expect(document.getElementById('resume')!.hidden).toBe(true);
    expect(document.getElementById('start-analysis')!.hidden).toBe(false);
    const requests = fetcher.mock.calls.length;
    if (startDirectly) {
        input.dispatchEvent(new Event('change'));
        document.getElementById('analyze')!.click();
        expect(document.getElementById('start-analysis')!.hidden).toBe(true);
        await vi.advanceTimersByTimeAsync(10001);
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
        expect(document.getElementById('start-analysis')!.hidden).toBe(true);
    } else {
        document.getElementById('start-analysis')!.click();
        expect(document.getElementById('capture')!.hidden).toBe(false);
        expect(document.activeElement).toBe(input);
        document.getElementById('delete')!.click();
        expect(fetcher).toHaveBeenCalledTimes(requests);
    }
});


it('rounds displayed scores without trailing zeroes and preserves missing scores', async () => {
    const { displayScore } = await import('../../web/src/results');
    expect(displayScore(45.7384)).toBe('45.7');
    expect(displayScore(0)).toBe('0');
    expect(displayScore(66)).toBe('66');
    expect(displayScore(undefined)).toBe('Missing');
});

it('groups rounded whole counts and alpha values', async () => {
    const { displayInteger } = await import('../../web/src/results');
    expect(displayInteger(31980)).toBe('31,980');
    expect(displayInteger(53.797967479674796)).toBe('54');
    expect(displayInteger(0)).toBe('0');
});

it('keeps date-only calendar days and preserves absent or invalid dates', async () => {
    const { displayDate } = await import('../../web/src/results');
    expect(displayDate('2026-10-20')).toBe('20 Oct 2026');
    expect(displayDate('2024-02-29')).toBe('29 Feb 2024');
    expect(displayDate('2026-02-29')).toBe('2026-02-29');
    expect(displayDate('2026-13-01')).toBe('2026-13-01');
    expect(displayDate('invalid')).toBe('invalid');
    expect(displayDate('')).toBe('Date missing');
    const instant = '2026-10-20T00:30:00.000Z';
    const localDay = new Date(instant).getDate();
    expect(displayDate(instant)).toBe(`${localDay} Oct 2026`);
});

it('renders mapped zones, rounded values and dates while preserving exported data', async () => {
    const { renderResults } = await import('../../web/src/results');
    const first = structuredClone(SAMPLE), second = structuredClone(SAMPLE);
    first.observations[0]!.uiScore = 0;
    second.id = 'second'; second.date = '2026-10-25T08:35:00.000Z';
    delete second.observations[0]!.uiScore;
    second.observations = second.observations.filter(o => o.concern !== 'texture');
    first.framing.userConfirmedSameFraming = second.framing.userConfirmedSameFraming = true;
    const log = { version: 'breakout-log.v1' as const, createdAt: SAMPLE.date,
        changes: [{ id: 'cleanser', category: 'Cleanser', startedOn: '2026-10-20', active: 'yes' as const, note: '2% salicylic acid' }],
        selfReport: { areas: '', discomfort: '', reportedSevereSymptom: false }, entries: [first, second] };
    const before = serializeLog(log);
    const root = document.createElement('section'); root.id = 'results';
    renderResults(root, log);
    for (const text of ['Acne: 0 · raw score 45.7', 'Redness: 60 · raw score 32.2', 'Texture: 70 · raw score 55.7',
        'Whole face: Combination & Sensitive', 'T-zone: Oily', 'U-zone: Dry & Sensitive',
        'T-zone: 7 marked spots · red area 31,980\u00a0px · average intensity 54',
        'U-zone: 21 marked spots · red area 24,120\u00a0px · average intensity 88',
        'Other areas: 2 marked spots · red area 1,838\u00a0px · average intensity 46',
        '20 Oct 2026 · Cleanser · Contains active: yes · 2% salicylic acid',
        'Acne: 0 | 45.7', 'Texture: 70 | Missing',
        'T-zone: marked spots 7 | 7; red area (px) 31,980 | 31,980; average intensity 54 | 54']) expect(root.textContent).toContain(text);
    const options = root.querySelectorAll('select:first-of-type option');
    expect(options[0]!.textContent).toBe('24 Oct 2026 · Sample (pre-analyzed)');
    expect(options[0]!.getAttribute('value')).toBe('0');
    expect(options[1]!.getAttribute('value')).toBe('1');
    const after = serializeLog(log);
    expect(after).toBe(before);
    expect(after).toContain('45.7384');
    expect(after).toContain('"t_zone"');
    expect(after).toContain('2026-10-24T08:35:00.000Z');
    expect(after).not.toContain('T-zone');
    expect(after).not.toContain('24 Oct 2026');
    expect(first.observations[0]!.rawScore).toBe(45.7384);
    expect(first.date).toBe('2026-10-24T08:35:00.000Z');
});
