import type { BreakoutLog, LogEntry } from '../../contracts/log';
import { buildLog, compareEntries } from '../../shared/log';
export const sourceLabel = { live: 'Live', sample: 'Sample (pre-analyzed)', mock: 'Mock (test data)' };

const concernLabel = { acne: 'Acne', redness: 'Redness', texture: 'Texture' };
const zoneLabel = { t_zone: 'T-zone', u_zone: 'U-zone', whole: 'Whole face', other: 'Other areas' };
const integerFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const displayScore = (value: number | undefined): string => value === undefined ? 'Missing' : String(Math.round(value * 10) / 10);
export const displayInteger = (value: number): string => integerFormatter.format(Math.round(value));
export function displayDate(value: string): string {
    if (!value) return 'Date missing';
    let date: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number);
        date = new Date(0);
        date.setFullYear(year!, month! - 1, day!);
        date.setHours(12, 0, 0, 0);
        if (date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day) return value;
    } else {
        date = new Date(value);
    }
    return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

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
        add('li', item.kind === 'change' ? `${displayDate(item.date)} · ${item.change.category} · Contains active: ${item.change.active}${item.change.note ? ` · ${item.change.note}` : ''}` : `${displayDate(item.date)} · ${sourceLabel[item.entry.source]}`, list);
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
            add('p', `${concernLabel[o.concern]}: ${displayScore(o.uiScore ?? o.rawScore)} · raw score ${displayScore(o.rawScore)}`).className = 'observation-line';
        add('h4', 'Zone labels from YouCam');
        for (const z of e.zoneLabels)
            add('p', `${zoneLabel[z.region]}: ${z.label}`).className = 'observation-line';
        if (!e.regions) add('p', 'Region estimates unavailable: one or more masks are missing or invalid. Missing masks do not mean zero.');
        if (e.regions) {
            add('h4', 'Region stats');
            add('p', 'Estimated by this app from the YouCam mask, not a YouCam measurement');
            for (const z of e.regions.zones)
                add('p', `${zoneLabel[z.zone]}: ${displayInteger(z.acneSpots)} marked spots · red area ${displayInteger(z.rednessPixels)}\u00a0px · average intensity ${displayInteger(z.rednessMeanAlpha)}`).className = 'observation-line';
            add('p', 'Marker blobs can merge and undercount. Overlapping zones count as T-zone.');
        }
    }
    add('h3', 'Still missing');
    const missing = add('ul', '');
    view.unknowns.forEach(u => add('li', u.text, missing));
    if (log.entries.length >= 2) {
        add('h3', 'Side-by-side entries');
        const select = (label: string, index: number) => { const l = add('label', label); const s = document.createElement('select'); log.entries.forEach((e, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${displayDate(e.date)} · ${sourceLabel[e.source]}`; s.append(o); }); s.selectedIndex = index; l.append(s); return s; };
        const a = select('First entry', 0), b = select('Second entry', 1), out = add('div', '');
        const update = () => { out.replaceChildren(); const result = compareEntries(log.entries[Number(a.value)]!, log.entries[Number(b.value)]!); if ('refused' in result) {
            add('p', result.refused, out);
            return;
        } for (const r of result.rows)
            add('p', `${concernLabel[r.concern]}: ${displayScore(r.a?.uiScore ?? r.a?.rawScore)} | ${displayScore(r.b?.uiScore ?? r.b?.rawScore)}`, out).className = 'observation-line'; for (const z of result.zones ?? [])
            add('p', `${zoneLabel[z.zone]}: marked spots ${displayInteger(z.a.acneSpots)} | ${displayInteger(z.b.acneSpots)}; red area (px) ${displayInteger(z.a.rednessPixels)} | ${displayInteger(z.b.rednessPixels)}; average intensity ${displayInteger(z.a.rednessMeanAlpha)} | ${displayInteger(z.b.rednessMeanAlpha)}`, out).className = 'observation-line'; };
        a.onchange = b.onchange = update;
        update();
    }
}
