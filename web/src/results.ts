import type { BreakoutLog, LogEntry } from '../../contracts/log';
import { buildLog, compareEntries } from '../../shared/log';
export const sourceLabel = { live: 'Live', sample: 'Sample (pre-analyzed)', mock: 'Mock (test data)' };
export function renderResults(root: HTMLElement, log: BreakoutLog) {
    root.replaceChildren();
    root.className = 'log-card';
    const add = (tag: string, text: string, parent: HTMLElement = root) => { const el = document.createElement(tag); el.textContent = text; parent.append(el); return el; };
    add('h2', 'Your breakout log');
    add('p', `Self-reported areas: ${log.selfReport.areas || 'Not provided'}. Discomfort: ${log.selfReport.discomfort || 'Not provided'}.`);
    const view = buildLog(log);
    if (view.referral)
        add('p', view.referral).className = 'referral';
    add('h3', 'Timeline');
    const list = add('ol', '');
    for (const item of view.timeline)
        add('li', item.kind === 'change' ? `${item.date || 'Date missing'} · ${item.change.category} · Contains active: ${item.change.active}${item.change.note ? ` · ${item.change.note}` : ''}` : `${item.date} · ${sourceLabel[item.entry.source]}`, list);
    add('h3', 'Baseline');
    if (view.baseline)
        entry(view.baseline);
    else
        add('p', 'No live baseline yet.');
    for (const e of log.entries)
        if (e !== view.baseline) {
            add('h3', `${sourceLabel[e.source]} entry`);
            entry(e);
        }
    function entry(e: LogEntry) {
        add('span', sourceLabel[e.source]).className = 'source-badge';
        add('p', 'YouCam score, higher = clearer');
        for (const o of e.observations)
            add('p', `${o.concern}: ${o.uiScore ?? o.rawScore} · raw score: ${o.rawScore}`);
        add('h4', 'Zone labels from YouCam');
        for (const z of e.zoneLabels)
            add('p', `${z.region}: ${z.label}`);
        if (e.regions) {
            add('h4', 'Region stats');
            add('p', 'Estimated by this app from the YouCam mask, not a YouCam measurement');
            for (const z of e.regions.zones)
                add('p', `${z.zone}: ${z.acneSpots} marker blobs · ${z.rednessPixels} redness pixels · mean alpha ${z.rednessMeanAlpha.toFixed(2)}`);
            add('p', 'Marker blobs can merge and undercount. Overlapping zones count as T-zone.');
        }
    }
    add('h3', 'Still missing');
    const missing = add('ul', '');
    view.unknowns.forEach(u => add('li', u.text, missing));
    if (log.entries.length >= 2) {
        add('h3', 'Side-by-side entries');
        const select = (label: string, index: number) => { const l = add('label', label); const s = document.createElement('select'); log.entries.forEach((e, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${e.date} · ${sourceLabel[e.source]}`; s.append(o); }); s.selectedIndex = index; l.append(s); return s; };
        const a = select('First entry', 0), b = select('Second entry', 1), out = add('div', '');
        const update = () => { out.replaceChildren(); const result = compareEntries(log.entries[Number(a.value)]!, log.entries[Number(b.value)]!); if ('refused' in result) {
            add('p', result.refused, out);
            return;
        } for (const r of result.rows)
            add('p', `${r.concern}: ${r.a?.uiScore ?? r.a?.rawScore ?? 'Missing'} | ${r.b?.uiScore ?? r.b?.rawScore ?? 'Missing'}`, out); for (const z of result.zones ?? [])
            add('p', `${z.zone}: marker blobs ${z.a.acneSpots} | ${z.b.acneSpots}; redness pixels ${z.a.rednessPixels} | ${z.b.rednessPixels}; mean alpha ${z.a.rednessMeanAlpha.toFixed(2)} | ${z.b.rednessMeanAlpha.toFixed(2)}`, out); };
        a.onchange = b.onchange = update;
        update();
    }
}
