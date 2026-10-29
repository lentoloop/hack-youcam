import { SCORED_CONCERNS } from '../contracts/analysis';
import type { BreakoutLog, BuildLog, CompareEntries, ParseLogFile } from '../contracts/log';
export const CAUSE_CAVEAT = 'This log cannot tell which product, if any, caused the change.';
const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const compareEntries: CompareEntries = (a, b) => {
    if (!a.framing.userConfirmedSameFraming || !b.framing.userConfirmedSameFraming)
        return { refused: 'Confirm the same framing for both entries first.' };
    if (a.framing.imageSize.w !== b.framing.imageSize.w || a.framing.imageSize.h !== b.framing.imageSize.h || (a.regions && b.regions && (a.regions.method !== b.regions.method || a.regions.imageSize.w !== b.regions.imageSize.w || a.regions.imageSize.h !== b.regions.imageSize.h)))
        return { refused: 'Image sizes or region methods differ.' };
    return { rows: SCORED_CONCERNS.map(concern => { const left = a.observations.find(o => o.concern === concern), right = b.observations.find(o => o.concern === concern); return { concern, ...(left ? { a: left } : {}), ...(right ? { b: right } : {}) }; }), ...(a.regions && b.regions ? { zones: a.regions.zones.map(z => ({ zone: z.zone, a: z, b: b.regions!.zones.find(v => v.zone === z.zone)! })) } : {}) };
};
export const buildLog: BuildLog = log => {
    const entries = [...log.entries].sort((a, b) => a.date.localeCompare(b.date));
    const unknowns = [{ code: 'cause_not_determined' as const, text: CAUSE_CAVEAT }];
    const view: ReturnType<BuildLog> = { timeline: [...log.changes.map(change => ({ kind: 'change' as const, date: change.startedOn, change })), ...entries.map(entry => ({ kind: 'entry' as const, date: entry.date, entry }))].sort((a, b) => a.date.localeCompare(b.date)), unknowns };
    const baseline = entries.find(e => e.source === 'live');
    if (baseline)
        view.baseline = baseline;
    if (!view.baseline)
        view.unknowns.push({ code: 'no_live_baseline', text: 'A live appearance baseline is still missing.' });
    if (log.changes.some(c => !day(c.startedOn)))
        view.unknowns.push({ code: 'missing_start_date', text: 'Add a valid start date for every product change.' });
    if (entries.some((a, i) => entries.slice(i + 1).some(b => 'refused' in compareEntries(a, b))))
        view.unknowns.push({ code: 'cross_day_not_comparable', text: 'These entries cannot be compared with the current framing, sizes or methods.' });
    if (log.selfReport.reportedSevereSymptom)
        view.referral = 'Painful, swollen or spreading breakouts: please see a dermatologist or doctor.';
    return view;
};
export const parseLogFile: ParseLogFile = json => {
    try {
        const encoded = JSON.stringify(json);
        if (!encoded || encodeURIComponent(encoded).replace(/%[A-F\d]{2}/gi, 'x').length > 200 * 1024 || /data:|https?:|iVBORw0KGgo|\/9j\/|[A-Za-z0-9+\/]{200,}/i.test(encoded))
            throw Error('Unsafe or oversized log.');
        const obj = (x: unknown, required: string[], optional: string[] = []) => { if (!x || typeof x !== 'object' || Array.isArray(x))
            throw Error('Expected object.'); const r = x as Record<string, unknown>; if (required.some(k => !(k in r)) || Object.keys(r).some(k => !required.includes(k) && !optional.includes(k)))
            throw Error('Unexpected fields.'); return r; };
        const str = (x: unknown, max = 500): x is string => typeof x === 'string' && x.length <= max;
        const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
        const arr = (x: unknown) => { if (!Array.isArray(x))
            throw Error('Expected array.'); return x; };
        const source = (x: unknown) => str(x) && ['live', 'sample', 'mock'].includes(x);
        const iso = (x: unknown) => str(x) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(x) && day(x.slice(0, 10)) && Number.isFinite(Date.parse(x));
        const size = (x: unknown, fixed = false) => { const r = obj(x, ['w', 'h']); return num(r.w) && num(r.h) && Number.isInteger(r.w) && Number.isInteger(r.h) && Number(r.w) > 0 && Number(r.h) > 0 && (!fixed || (r.w === 600 && r.h === 800)); };
        const r = obj(json, ['version', 'createdAt', 'changes', 'selfReport', 'entries'], ['ingredientNotes']);
        if (r.version !== 'breakout-log.v1' || !iso(r.createdAt))
            throw Error('Invalid version or date.');
        const s = obj(r.selfReport, ['areas', 'discomfort', 'reportedSevereSymptom']);
        if (!str(s.areas) || !str(s.discomfort) || typeof s.reportedSevereSymptom !== 'boolean')
            throw Error('Invalid self report.');
        for (const c of arr(r.changes)) {
            const v = obj(c, ['id', 'category', 'startedOn', 'active'], ['note']);
            if (!str(v.id, 64) || !str(v.category, 80) || !str(v.startedOn) || !day(v.startedOn) || !['yes', 'no', 'unknown'].includes(v.active as string) || ('note' in v && !str(v.note)))
                throw Error('Invalid product change.');
        }
        const noteIds = new Set<string>();
        if ('ingredientNotes' in r) for (const n of arr(r.ingredientNotes)) {
            const v = obj(n, ['id', 'date', 'category', 'active', 'ingredients'], ['note', 'startedOn']);
            if (!str(v.id, 64) || !v.id || !str(v.date) || !day(v.date) || !str(v.category, 80) || !v.category.trim() || !str(v.ingredients) || !['yes', 'no', 'unknown'].includes(v.active as string) || ('note' in v && !str(v.note)) || ('startedOn' in v && (!str(v.startedOn) || !day(v.startedOn))))
                throw Error('Invalid ingredient note.');
            if (noteIds.has(v.id))
                throw Error('Duplicate ingredient note ID.');
            noteIds.add(v.id);
        }
        for (const e of arr(r.entries)) {
            const v = obj(e, ['id', 'date', 'source', 'observations', 'zoneLabels', 'framing'], ['regions']);
            if (!str(v.id, 64) || !iso(v.date) || !source(v.source))
                throw Error('Invalid entry.');
            const f = obj(v.framing, ['guideShown', 'userConfirmedSameFraming', 'imageSize']);
            if (f.guideShown !== true || typeof f.userConfirmedSameFraming !== 'boolean' || !size(f.imageSize))
                throw Error('Invalid framing.');
            for (const o of arr(v.observations)) {
                const n = obj(o, ['concern', 'rawScore', 'source'], ['uiScore']);
                if (!SCORED_CONCERNS.includes(n.concern as never) || !source(n.source) || n.source !== v.source || !num(n.rawScore) || Number(n.rawScore) > 100 || ('uiScore' in n && (!num(n.uiScore) || Number(n.uiScore) > 100)))
                    throw Error('Invalid observation.');
            }
            for (const z of arr(v.zoneLabels)) {
                const n = obj(z, ['region', 'label', 'source']);
                if (!['whole', 't_zone', 'u_zone'].includes(n.region as string) || !str(n.label) || !source(n.source) || n.source !== v.source)
                    throw Error('Invalid label.');
            }
            if ('regions' in v) {
                const n = obj(v.regions, ['method', 'imageSize', 'zones']);
                if (n.method !== 'mask-heuristic.v1' || !size(n.imageSize, true))
                    throw Error('Invalid regions.');
                const zones = arr(n.zones);
                if (zones.length !== 3)
                    throw Error('Invalid zones.');
                zones.forEach((z, i) => { const t = obj(z, ['zone', 'acneSpots', 'rednessPixels', 'rednessMeanAlpha']); if (t.zone !== ['t_zone', 'u_zone', 'other'][i] || !num(t.acneSpots) || !Number.isInteger(t.acneSpots) || !num(t.rednessPixels) || !Number.isInteger(t.rednessPixels) || Number(t.rednessPixels) > 480000 || !num(t.rednessMeanAlpha) || Number(t.rednessMeanAlpha) > 255)
                    throw Error('Invalid statistics.'); });
            }
        }
        return { ok: true, log: json as BreakoutLog };
    }
    catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'Invalid log.' };
    }
};
