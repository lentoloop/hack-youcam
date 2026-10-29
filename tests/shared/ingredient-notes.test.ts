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
it('rejects duplicate note IDs even when their dates and contents differ', () => {
    const withNotes = { ...log, ingredientNotes: [note, { ...note, date: '2026-10-24', category: 'Lotion' }] };
    expect(parseLogFile(JSON.parse(JSON.stringify(withNotes)))).toEqual({ ok: false, reason: 'Duplicate ingredient note ID.' });
});
it('rejects invalid note dates, fields and active values', () => {
    for (const patch of [{ date: '2026-02-30' }, { date: '29/10/2026' }, { startedOn: '' }, { category: '' }, { active: 'maybe' }, { source: 'live' }]) {
        expect(parseLogFile({ ...log, ingredientNotes: [{ ...note, ...patch }] }).ok).toBe(false);
    }
});
it.each([['id', 64], ['category', 80], ['ingredients', 500], ['note', 500]] as const)('accepts %s at %i characters and rejects one more', (field, limit) => {
    const text = 'word '.repeat(Math.ceil((limit + 1) / 5));
    const atLimit = { ...log, ingredientNotes: [{ ...note, [field]: text.slice(0, limit) }] };
    expect(parseLogFile(atLimit)).toEqual({ ok: true, log: atLimit });
    const overLimit = { ...log, ingredientNotes: [{ ...note, [field]: text.slice(0, limit + 1) }] };
    expect(parseLogFile(overLimit)).toEqual({ ok: false, reason: 'Invalid ingredient note.' });
});
