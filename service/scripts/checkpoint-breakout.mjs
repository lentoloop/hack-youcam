import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';

const defaultDir = 'fixtures';
async function main() {
  const mock = process.env.MOCK === "1";
  const source = mock ? "mock" : "live";
  const compiled = await build({
    stdin: { contents: `export { MockAdapter } from './service/adapters'; export { deriveRegions } from './shared/regions'; export { buildLog } from './shared/log'; export { renderResults } from './web/src/results'; export { serializeLog } from './web/src/log-file';`, resolveDir: new URL('../../', import.meta.url).pathname },
    bundle: true, write: false, platform: 'node', format: 'esm',
  });
  const { MockAdapter, deriveRegions, buildLog, renderResults, serializeLog } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const input = mock ? await new MockAdapter().poll("mock:success") : JSON.parse(await readFile(resolve(process.env.IN ?? `${defaultDir}/run2-normalized.json`), 'utf8'));
  const check = (name, condition) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); if (!condition) throw Error(name); };
  check(`${source} acne/redness/texture observations`, ['acne', 'redness', 'texture'].every(c => input.observations?.some(o => o.concern === c && o.source === source && Number.isFinite(o.rawScore))));
  check('zoneLabels >= 1', Array.isArray(input.zoneLabels) && input.zoneLabels.length >= 1);
  const decode = async key => {
    const value = input.masks?.[key];
    if (typeof value !== 'string' || !/^data:image\/png;base64,/.test(value)) throw Error(`Missing PNG mask: ${key}`);
    const { data, info } = await sharp(Buffer.from(value.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  };
  const [acne, redness, tZone, uZone] = await Promise.all(['acne', 'redness', 't_zone', 'u_zone'].map(decode));
  const regions = deriveRegions({ acne, redness, tZone, uZone });
  check('regions has 3 zones', regions.zones.length === 3);
  const today = new Date(), started = new Date(today);
  started.setUTCDate(started.getUTCDate() - 7);
  const log = {
    version: 'breakout-log.v1', createdAt: today.toISOString(),
    changes: [{ id: 'example-change', category: 'retinoid serum (example)', startedOn: started.toISOString().slice(0, 10), active: 'yes' }],
    selfReport: { areas: 'cheeks and jaw (example)', discomfort: 'mild (example)', reportedSevereSymptom: false },
    entries: [{ id: `checkpoint-${source}`, date: today.toISOString(), source, observations: input.observations, zoneLabels: input.zoneLabels, regions, framing: { guideShown: true, userConfirmedSameFraming: true, imageSize: { w: 600, h: 800 } } }],
  };
  const view = buildLog(log), file = serializeLog(log);
  check('log-file excludes image data, URLs and provider IDs', !/data:|http|task_id|file_id/i.test(file));
  const dom = new JSDOM('<!doctype html><html><head><meta charset="utf-8"><title>Breakout Log (working title)</title></head><body><main id="results"></main></body></html>');
  globalThis.document = dom.window.document;
  try {
    const root = document.getElementById('results');
    renderResults(root, log);
    const text = root.textContent;
    check('HTML contains scores', input.observations.every(o => text.includes(`${o.concern}: ${o.uiScore ?? o.rawScore} · raw score: ${o.rawScore}`)));
    check('HTML contains app-estimate label', text.includes('Estimated by this app from the YouCam mask, not a YouCam measurement'));
    check('HTML contains cause unknown text', view.unknowns.some(u => u.code === 'cause_not_determined' && text.includes(u.text)));
    const out = resolve(process.env.OUT_DIR ?? (mock ? '/tmp/breakout-checkpoint' : defaultDir));
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, 'log-view.json'), JSON.stringify(view, null, 2) + '\n');
    await writeFile(resolve(out, 'log-file.json'), file + '\n');
    await writeFile(resolve(out, 'log-card.html'), dom.serialize() + '\n');
  } finally { dom.window.close(); delete globalThis.document; }
}
try { await main(); }
catch (error) { console.error(`FAIL checkpoint: ${error.message}`); process.exitCode = 1; }
