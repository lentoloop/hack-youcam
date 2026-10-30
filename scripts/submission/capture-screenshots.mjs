import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Ignore literal text, but inspect code inside template substitutions. Unknown import
// forms also fail closed, including computed dynamic imports and import.meta URLs.
export function hasSplitModuleGraph(source, html = '') {
  if (/<link\b[^>]*\brel\s*=\s*(?:"[^"]*\bmodulepreload\b[^"]*"|'[^']*\bmodulepreload\b[^']*'|modulepreload\b)/i.test(html)) return true;
  let index = 0;
  function scan(templateExpression = false) {
    let depth = 0;
    let exporting = false;
    while (index < source.length) {
      const char = source[index++];
      if (char === '/' && source[index] === '/') {
        while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      } else if (char === '/' && source[index] === '*') {
        const end = source.indexOf('*/', index + 1);
        if (end < 0) return true;
        index = end + 2;
      } else if (char === '/' && /(?:^|[=(:,[!&|?;]|=>|\b(?:return|throw|case|yield))\s*$/.test(source.slice(0, index - 1))) {
        let inClass = false;
        let closed = false;
        while (index < source.length) {
          const next = source[index++];
          if (next === '\\') index++;
          else if (next === '[') inClass = true;
          else if (next === ']') inClass = false;
          else if (next === '/' && !inClass) { closed = true; break; }
          else if (next === '\n' || next === '\r') return true;
        }
        if (!closed) return true;
      } else if (char === '"' || char === "'") {
        let closed = false;
        while (index < source.length) {
          const next = source[index++];
          if (next === '\\') index++;
          else if (next === char) { closed = true; break; }
        }
        if (!closed) return true;
      } else if (char === '`') {
        let closed = false;
        while (index < source.length) {
          const next = source[index++];
          if (next === '\\') index++;
          else if (next === '`') { closed = true; break; }
          else if (next === '$' && source[index] === '{') {
            index++;
            if (scan(true)) return true;
          }
        }
        if (!closed) return true;
      } else if (/[a-zA-Z_$\\]/.test(char)) {
        const start = index - 1;
        while (index < source.length && /[\w$\\]/.test(source[index])) index++;
        const word = source.slice(start, index);
        // Escaped identifiers and regex literals are deliberately conservative:
        // this is a guard for a known bundle, not a general JavaScript parser.
        if (word.includes('\\') || word === 'import') return true;
        if (word === 'export') exporting = true;
        if (exporting && word === 'from') return true;
      } else if (char === ';') {
        exporting = false;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        if (templateExpression && depth === 0) return false;
        depth--;
      }
    }
    return templateExpression;
  }
  return scan();
}

async function main() {
// Capture a fetched release artifact with browser networking disabled. No CDP or dependencies.
const base = new URL(process.env.BASE_URL || 'https://before-another-bottle.ktwu1997.workers.dev/');
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password ||
    [...base.searchParams.keys()].some(key => key !== 'demo')) {
  throw new Error('BASE_URL must be an HTTP(S) app URL without credentials or extra query parameters.');
}
base.search = '?demo=synthetic';
base.hash = '';
const output = resolve('docs/submission/shots');
const scratch = await mkdtemp(join(tmpdir(), 'breakout-submission-'));
const manifest = { source: base.href, capturedAt: new Date().toISOString(), mode: 'Sample only; local mirror of fetched release assets', resources: [], shots: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fetchStatic(url) {
  if (url.origin !== base.origin || /\/api(?:\/|$)/i.test(url.pathname)) throw new Error('Refusing non-static or cross-origin resource.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Static fetch failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  manifest.resources.push({ url: url.href, sha256: sha(bytes) });
  return bytes;
}
function harness(shot) {
  return String.raw`<script>
(() => {
  let failed = false;
  const fail = message => {
    if (failed) return;
    failed = true;
    document.documentElement.dataset.captureFailure = String(message);
    delete document.documentElement.dataset.captureReady;
  };
  window.addEventListener('error', event => fail(event.message || 'Resource error'), true);
  window.addEventListener('unhandledrejection', event => fail(event.reason));
  window.addEventListener('securitypolicyviolation', event => fail('Blocked network or resource: ' + event.violatedDirective));
  const blocked = () => { fail('Analysis/network request attempted. Capture stopped.'); throw Error('Network disabled for submission capture'); };
  window.fetch = blocked;
  XMLHttpRequest.prototype.open = blocked;
  navigator.sendBeacon = blocked;
  window.WebSocket = class { constructor() { blocked(); } };
  window.EventSource = class { constructor() { blocked(); } };
  const get = id => document.getElementById(id);
  const guard = () => {
    if (get('analyze') && !get('analyze').disabled) fail('Real-analysis control enabled');
    if (get('judge')?.value || get('upload')?.files?.length || get('camera')?.files?.length) fail('Photo or judge credentials present');
    if ([...document.querySelectorAll('.source-badge')].some(el => el.textContent !== 'Sample (pre-analyzed)')) fail('Non-Sample analysis state');
    if (/preparing jpeg|processing|queued|running|live ·|mock \(/i.test(get('status')?.textContent || '')) fail('Real-analysis processing state');
    if (get('resume') && !get('resume').hidden) fail('An analysis job is present');
  };
  new MutationObserver(guard).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      if (!get('synthetic-demo') || !get('sample') || !get('agree')) throw Error('Release UI or synthetic disclosure missing');
      if (${JSON.stringify(shot)} !== 'consent') {
        get('agree').click();
        get('continue').click();
      }
      if (['observations', 'product-changes', 'explanation'].includes(${JSON.stringify(shot)})) {
        get('areas').value = 'Cheeks (fictional demo self-report)';
        get('discomfort').value = 'Not recorded';
        get('add-change').click();
        const row = get('changes').querySelector('tr');
        row.querySelector('[aria-label="Category"]').value = 'Moisturizer (fictional demo)';
        row.querySelector('[aria-label="Started on"]').value = '2026-10-23';
        row.querySelector('[aria-label="Note"]').value = 'Recent product change; cause unknown';
        get('sample').click();
        if (!get('results').textContent.includes('Sample (pre-analyzed)') || !get('results').textContent.includes('No live baseline yet.')) throw Error('Expected Sample state missing');
      }
      let target = get('consent');
      if (${JSON.stringify(shot)} === 'capture') target = get('capture');
      if (${JSON.stringify(shot)} === 'product-changes') target = get('report');
      if (${JSON.stringify(shot)} === 'observations') target = document.querySelector('.source-badge');
      if (${JSON.stringify(shot)} === 'explanation') target = [...get('results').querySelectorAll('h3')].find(el => el.textContent === 'Still missing');
      if (!target) throw Error('Screenshot target missing');
      await document.fonts.ready;
      target.scrollIntoView({ block: 'start' });
      guard();
      if (!failed) document.documentElement.dataset.captureReady = ${JSON.stringify(shot)};
    } catch (error) { fail(error.message); }
  });
})();
</script>`;
}
try {
  await mkdir(output, { recursive: true });
  let html = (await fetchStatic(base)).toString('utf8');
  if (hasSplitModuleGraph('', html)) throw new Error('Split module build detected; static mirror needs review.');
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)];
  const assets = new Map();
  for (const match of refs) {
    const url = new URL(match[1], base);
    if (!/\.(?:js|css)$/.test(url.pathname)) throw new Error('Unexpected HTML resource; review this release before capture.');
    assets.set(url.href, { url, original: match[1] });
  }
  if (![...assets.values()].some(asset => asset.url.pathname.endsWith('.js'))) throw new Error('No release JavaScript found.');
  for (const [index, asset] of [...assets.values()].entries()) {
    let bytes = await fetchStatic(asset.url);
    // Fail closed if a future build needs a module graph or additional resource fetches.
    const text = bytes.toString('utf8');
    if (asset.url.pathname.endsWith('.js') && hasSplitModuleGraph(text)) {
      throw new Error('Split module build detected; static mirror needs review.');
    }
    if (asset.url.pathname.endsWith('.css')) {
      if (/@import/i.test(text)) throw new Error('Unbundled CSS imports need review.');
      let css = text;
      for (const [fontIndex, match] of [...text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].entries()) {
        if (match[1].startsWith('data:')) continue;
        const fontUrl = new URL(match[1], asset.url);
        if (!/\.woff2?$/.test(fontUrl.pathname)) throw new Error('Unexpected CSS resource needs review.');
        const fontName = `font-${index}-${fontIndex}${fontUrl.pathname.endsWith('.woff2') ? '.woff2' : '.woff'}`;
        await writeFile(join(scratch, fontName), await fetchStatic(fontUrl));
        css = css.replaceAll(match[0], `url("./${fontName}")`);
      }
      bytes = Buffer.from(css);
    }
    const name = `asset-${index}${asset.url.pathname.endsWith('.js') ? '.js' : '.css'}`;
    await writeFile(join(scratch, name), bytes);
    html = html.replaceAll(`"${asset.original}"`, `"./${name}"`).replaceAll(`'${asset.original}'`, `'./${name}'`);
  }
  // All fetched assets are local. Browser API calls and remote resource loads are forbidden.
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' file:; style-src 'unsafe-inline' file:; img-src data: file:; font-src data: file:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    for (const [name, shot] of [['01-consent', 'consent'], ['01b-capture', 'capture'], ['02-observations', 'observations'], ['03-product-changes', 'product-changes'], ['04-explanation', 'explanation']]) {
      const file = `${name}-${width}x${height}.png`;
      const staged = join(scratch, file);
      const page = join(scratch, 'index.html');
      await writeFile(page, html.replace(/<head(?:\s[^>]*)?>/i, head => head + policy + harness(shot)));
      const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${join(scratch, 'profile-' + name + '-' + width)}`, `--window-size=${width},${height}`, '--force-device-scale-factor=1', '--virtual-time-budget=8000', '--run-all-compositor-stages-before-draw', `--screenshot=${staged}`, '--dump-dom', pathToFileURL(page).href + '?demo=synthetic'];
      const result = spawnSync('/usr/bin/google-chrome', args, { encoding: 'utf8', timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
      const dom = result.stdout || '';
      if (result.error || result.status !== 0 || dom.includes('data-capture-failure=') || !dom.includes(`data-capture-ready="${shot}"`)) {
        // Do not publish Chrome output: it can contain temporary profile paths.
        throw new Error(`Capture failed for ${file}; browser failure or unsafe/unexpected UI state. No image published for this shot.`);
      }
      const png = await readFile(staged);
      if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(`Wrong PNG dimensions for ${file}`);
      manifest.shots.push({ file, width, height, state: shot, sha256: sha(png) });
    }
  }
  // Publish only after every state and both viewport sizes pass.
  for (const shot of manifest.shots) await rename(join(scratch, shot.file), join(output, shot.file));
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Captured ${manifest.shots.length} PNGs from Sample-only release assets. Zero analysis requests permitted.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
