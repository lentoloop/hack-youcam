import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

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

export function isMirrorRequest(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

async function startBrowser(profile) {
  const child = spawn('/usr/bin/google-chrome', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-background-networking', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timeout (15 s)')), 15000);
    let buffer = '';
    const finish = (error, value) => {
      clearTimeout(timer);
      if (error) reject(error); else resolveReady(value);
    };
    child.once('error', () => finish(new Error('Chrome launch failed')));
    child.once('exit', () => finish(new Error('Chrome exited before CDP became ready')));
    child.stderr.on('data', chunk => {
      buffer = (buffer + chunk.toString()).slice(-16384);
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) finish(null, match[1]);
    });
  });
  return { child, endpoint };
}

async function connectCDP(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  let onEvent = () => {};
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) { onEvent(message); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`CDP ${request.method} failed (code ${message.error.code})`));
    else request.resolve(message.result);
  });
  const rejectPending = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`CDP connection closed during ${request.method}`));
    }
    pending.clear();
  };
  socket.addEventListener('close', rejectPending);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout (10 s)')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  return {
    events(handler) { onEvent = handler; },
    send(method, params = {}) {
      return new Promise((resolveCommand, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timeout (10 s)`)); }, 10000);
        pending.set(id, { resolve: resolveCommand, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error(`CDP ${method} send failed`)); }
      });
    },
    close() { rejectPending(); socket.close(); },
  };
}

async function main() {
// Capture a fetched release artifact through loopback CDP without package dependencies.
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
let server;
let browser;
let cdp;
let currentShot = 'setup';
let networkFailure;
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
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src data: 'self'; font-src data: 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  server = createServer(async (request, response) => {
    // Serve only generated mirror files, never profiles, screenshots, or traversal paths.
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!/^\/(?:index\.html|asset-\d+\.(?:js|css)|font-\d+-\d+\.woff2?)$/.test(pathname)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(join(scratch, pathname.slice(1)));
      const type = pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', () => reject(new Error('Loopback mirror server failed')));
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await startBrowser(join(scratch, 'profile'));
  const endpoint = new URL(await browser.endpoint);
  if (endpoint.hostname !== '127.0.0.1') throw new Error('CDP endpoint is not loopback');
  const targets = await fetch(`http://${endpoint.host}/json/list`, { signal: AbortSignal.timeout(10000) }).then(response => response.json());
  const target = targets.find(item => item.type === 'page');
  if (!target || new URL(target.webSocketDebuggerUrl).hostname !== '127.0.0.1') throw new Error('Loopback CDP page target missing');
  cdp = await connectCDP(target.webSocketDebuggerUrl);
  cdp.events(message => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const allowed = isMirrorRequest(request.url, origin);
    if (!allowed) networkFailure = 'Off-origin request attempted; network guard blocked it';
    cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' })
      .catch(error => { networkFailure = error.message; });
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('Page evaluation failed');
    return result.result.value;
  };
  const checkState = async shot => {
    if (networkFailure) throw new Error(networkFailure);
    const state = await evaluate(`({ ready: document.documentElement.dataset.captureReady, failure: document.documentElement.dataset.captureFailure })`);
    if (state.failure) throw new Error(`Page guard failed: ${String(state.failure).replace(/(?:https?:|file:)[^\s]+/g, '[resource]').slice(0, 240)}`);
    if (networkFailure) throw new Error(networkFailure);
    return state.ready === shot;
  };
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    for (const [name, shot] of [['01-consent', 'consent'], ['01b-capture', 'capture'], ['02-observations', 'observations'], ['03-product-changes', 'product-changes'], ['04-explanation', 'explanation']]) {
      const file = `${name}-${width}x${height}.png`;
      const staged = join(scratch, file);
      currentShot = file;
      const page = join(scratch, 'index.html');
      await writeFile(page, html.replace(/<head(?:\s[^>]*)?>/i, head => head + policy + harness(shot)));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      await cdp.send('Page.navigate', { url: 'about:blank' });
      const blankDeadline = Date.now() + 10000;
      while (await evaluate('location.href') !== 'about:blank') {
        if (Date.now() >= blankDeadline) throw new Error('Page reset timeout (10 s)');
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      const navigation = await cdp.send('Page.navigate', { url: `${origin}/index.html?demo=synthetic` });
      if (navigation.errorText) throw new Error('Page navigation failed');
      const deadline = Date.now() + 20000;
      while (!await checkState(shot)) {
        if (Date.now() >= deadline) throw new Error('Page readiness timeout (20 s)');
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
      }
      const { cssVisualViewport: viewport } = await cdp.send('Page.getLayoutMetrics');
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
        clip: { x: viewport.pageX, y: viewport.pageY, width, height, scale: 1 },
      });
      if (!await checkState(shot)) throw new Error('Page readiness lost after screenshot');
      await writeFile(staged, Buffer.from(screenshot.data, 'base64'));
      const png = await readFile(staged);
      if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(`Wrong PNG dimensions for ${file}`);
      manifest.shots.push({ file, width, height, state: shot, sha256: sha(png) });
    }
  }
  // Publish only after every state and both viewport sizes pass.
  for (const shot of manifest.shots) await rename(join(scratch, shot.file), join(output, shot.file));
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Captured ${manifest.shots.length} PNGs from Sample-only release assets. Zero analysis requests permitted.`);
} catch (error) {
  throw new Error(`Capture failed for ${currentShot}: ${String(error.message).replaceAll(scratch, '[scratch]')}`);
} finally {
  cdp?.close();
  if (browser?.child.pid && browser.child.exitCode === null && browser.child.signalCode === null) {
    const exited = new Promise(resolveExit => browser.child.once('exit', resolveExit));
    browser.child.kill('SIGKILL');
    await exited;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
  }
  await rm(scratch, { recursive: true, force: true });
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
