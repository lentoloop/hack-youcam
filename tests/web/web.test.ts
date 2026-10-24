import { it, expect, vi, afterEach } from '../../web/node_modules/vitest';
import { SAMPLE } from '../../web/src/sample';
import { serializeLog } from '../../web/src/log-file';
import { prepareImage } from '../../web/src/image';
import { pollJob } from '../../web/src/poll';
import type { GetAnalysisResponse } from '../../contracts/analysis';
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('crops to 600x800 JPEG and releases bitmap', async () => { const close = vi.fn(), drawImage = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close })); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D); vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['jpeg'], { type: 'image/jpeg' }))); const result = await prepareImage(new File(['x'], 'x.jpg')); expect(result.width).toBe(600); expect(result.height).toBe(800); expect(drawImage).toHaveBeenCalledWith(expect.anything(), 175, 0, 450, 600, 0, 0, 600, 800); expect(close).toHaveBeenCalledOnce(); });
it('runs full mocked upload, derives regions, downloads numbers and deletes analysis', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    const result: GetAnalysisResponse = { job: { id: 'mock-job', state: 'succeeded', mode: 'mock', source: 'mock', createdAt: 'now', updatedAt: 'now' }, observations: SAMPLE.observations.map(o => ({ ...o, source: 'mock' })), zoneLabels: SAMPLE.zoneLabels.map(z => ({ ...z, source: 'mock' })), masks: { acne: 'data:image/png;base64,AA==', redness: 'data:image/png;base64,AA==', t_zone: 'data:image/png;base64,AA==', u_zone: 'data:image/png;base64,AA==' } };
    const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(init?.method === 'POST' ? { job: result.job, deduplicated: false } : result)));
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
    for (const value of ['Your breakout log', 'acne: 66', 'Oily', 'Region stats', 'Estimated by this app from the YouCam mask, not a YouCam measurement', 'Still missing', 'cannot tell which product', 'Mock (test data)', 'please see a dermatologist'])
        expect(text).toContain(value);
    click('download');
    expect(downloaded).toBeDefined();
    vi.useRealTimers();
    const encoded = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(downloaded!); });
    expect(encoded).not.toMatch(/data:|https?:|"image"|"masks"/i);
    const parsed = JSON.parse(encoded);
    expect(parsed.entries[0].regions.zones[0].acneSpots).toBe(1);
    expect(serializeLog(parsed)).toBeTruthy();
    click('delete');
    expect(fetcher).toHaveBeenLastCalledWith('/api/analyses/mock-job', { method: 'DELETE', keepalive: true });
    click('clear');
    expect(document.getElementById('results')!.textContent).toBe('');
});
it('sample makes no request and expires at 30 minutes', async () => { vi.useFakeTimers(); vi.resetModules(); vi.stubGlobal('fetch', vi.fn()); document.body.innerHTML = '<div id="app"></div>'; await import('../../web/src/main'); (document.getElementById('sample') as HTMLButtonElement).click(); expect(document.getElementById('results')!.textContent).toContain('Sample (pre-analyzed)'); expect(fetch).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(30 * 60 * 1000); expect(document.getElementById('results')!.textContent).toBe(''); });
it('poll deadline ignores a late result', async () => { vi.useFakeTimers(); let resolve!: (v: GetAnalysisResponse) => void; const done = vi.fn(), timeout = vi.fn(); pollJob(() => new Promise(r => { resolve = r; }), done, vi.fn(), timeout); await vi.advanceTimersByTimeAsync(120000); expect(timeout).toHaveBeenCalledOnce(); resolve({} as GetAnalysisResponse); await Promise.resolve(); expect(done).not.toHaveBeenCalled(); });
