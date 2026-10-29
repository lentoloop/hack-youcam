import { expect, it } from 'vitest';
import { parseLogFile } from '../../shared/log';
import { serializeLog } from '../../web/src/log-file';
import type { BreakoutLog, IngredientNote } from '../../contracts/log';
const log: BreakoutLog = { version: 'breakout-log.v1', createdAt: '2026-10-29T00:00:00Z', changes: [], entries: [], selfReport: { areas: '', discomfort: '', reportedSevereSymptom: false } };
const note: IngredientNote = { id: 'n', date: '2026-10-29', category: 'Serum', active: 'unknown', ingredients: 'glycerin' };
it('round trips notes additively and preserves bytes for logs without notes', () => {
    expect(serializeLog(log)).toBe(JSON.stringify(log, null, 2));
    const withNotes = { ...log, ingredientNotes: [note] };
    expect(parseLogFile(JSON.parse(serializeLog(withNotes)))).toEqual({ ok: true, log: withNotes });
});
it('rejects invalid note dates, text lengths, fields and active values', () => {
    for (const patch of [{ date: '2026-02-30' }, { date: '29/10/2026' }, { startedOn: '' }, { category: '' }, { category: 'x'.repeat(81) }, { ingredients: 'x'.repeat(501) }, { note: 'x'.repeat(501) }, { id: 'x'.repeat(65) }, { active: 'maybe' }, { source: 'live' }]) {
        expect(parseLogFile({ ...log, ingredientNotes: [{ ...note, ...patch }] }).ok).toBe(false);
    }
});
