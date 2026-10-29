import { expect, it, vi } from '../../web/node_modules/vitest';
import source from '../../web/src/ingredient-notes.ts?raw';
import { renderIngredientNotes } from '../../web/src/ingredient-notes';
import { CAUSE_CAVEAT } from '../../shared/log';
import type { BreakoutLog } from '../../contracts/log';
import { importLog } from '../../web/src/log-file';
const fresh = (): BreakoutLog => ({ version: 'breakout-log.v1', createdAt: '2026-10-29T00:00:00Z', changes: [], entries: [], selfReport: { areas: '', discomfort: '', reportedSevereSymptom: false } });
it('refuses to import notes with duplicate IDs', async () => {
    const note = { id: 'n', date: '2026-10-29', category: 'Serum', ingredients: '', active: 'unknown' };
    const contents = JSON.stringify({ ...fresh(), ingredientNotes: [note, { ...note, category: 'Lotion' }] });
    const file = new File([contents], 'duplicate-notes.json');
    file.text = async () => contents;
    await expect(importLog(file)).rejects.toThrow('Duplicate ingredient note ID.');
});
it('assigns a unique ID when generated IDs collide with imported notes', () => {
    const log = fresh();
    const existingId = '00000000-0000-4000-8000-000000000001';
    const nextId = '00000000-0000-4000-8000-000000000002';
    log.ingredientNotes = [{ id: existingId, date: '2026-10-29', category: 'Serum', ingredients: '', active: 'unknown' }];
    const original = JSON.stringify(log.ingredientNotes[0]);
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(existingId).mockReturnValue(nextId);
    try {
        const root = document.createElement('div');
        renderIngredientNotes(root, log, () => {});
        root.querySelector<HTMLInputElement>('[name=date]')!.value = '2026-10-28';
        root.querySelector<HTMLInputElement>('[name=category]')!.value = 'Lotion';
        root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        expect(log.ingredientNotes.map(n => n.id)).toEqual([existingId, nextId]);
        expect(JSON.stringify(log.ingredientNotes[0])).toBe(original);
    } finally {
        uuid.mockRestore();
    }
});
it('edits one note and leaves every other note byte-identical', () => {
    const log = fresh();
    log.ingredientNotes = [
        { id: 'older', date: '2026-10-24', category: 'Cream', active: 'no', ingredients: 'water, glycerin', note: 'Evening', startedOn: '2026-10-01' },
        { id: 'target', date: '2026-10-29', category: 'Serum', active: 'yes', ingredients: 'niacinamide' },
        { id: 'same-day', date: '2026-10-29', category: 'Lotion', active: 'unknown', ingredients: '', note: '' },
    ];
    const before = log.ingredientNotes.map(n => JSON.stringify(n));
    const root = document.createElement('div');
    renderIngredientNotes(root, log, () => {});
    root.querySelector<HTMLButtonElement>('article button')!.click();
    root.querySelector<HTMLInputElement>('[name=category]')!.value = 'Gel';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(log.ingredientNotes).toHaveLength(3);
    expect(log.ingredientNotes[1]).toEqual({ id: 'target', date: '2026-10-29', category: 'Gel', active: 'yes', ingredients: 'niacinamide' });
    for (const index of [0, 2]) expect(JSON.stringify(log.ingredientNotes[index])).toBe(before[index]);
});
it('keeps the caveat visible, adds, orders, safely renders and edits notes', () => {
    const log = fresh(); const root = document.createElement('div');
    const render = () => renderIngredientNotes(root, log, render);
    render(); expect(root.textContent).toContain(CAUSE_CAVEAT); expect(root.textContent).toContain('No ingredient notes yet.');
    const submit = (date: string, category: string) => {
        root.querySelector<HTMLInputElement>('[name=date]')!.value = date;
        root.querySelector<HTMLInputElement>('[name=category]')!.value = category;
        root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    };
    submit('2026-10-24', '<img src=x>'); submit('2026-10-29', 'Serum');
    expect([...root.querySelectorAll('time')].map(t => t.dateTime)).toEqual(['2026-10-29', '2026-10-24']);
    expect(root.querySelector('img')).toBeNull();
    root.querySelector<HTMLButtonElement>('article button')!.click(); submit('2026-10-28', 'Lotion');
    expect(log.ingredientNotes).toHaveLength(2); expect(log.ingredientNotes?.find(n => n.category === 'Lotion')?.date).toBe('2026-10-28');
});
it('retains all source badges for analysis days', () => {
    const log = fresh();
    log.ingredientNotes = [{ id: 'n', date: '2026-10-29', category: 'Serum', ingredients: '', active: 'unknown' }];
    log.entries = [{ id: 'e', date: '2026-10-29T00:00:00Z', source: 'mock', observations: [], zoneLabels: [], framing: { guideShown: true, userConfirmedSameFraming: false, imageSize: { w: 600, h: 800 } } }];
    const root = document.createElement('div'); renderIngredientNotes(root, log, () => {});
    expect(root.querySelector('.source-badge')?.textContent).toBe('Mock (test data)');
});
it('scans notes UI source and rendered copy for prohibited language except the required shared caveat', () => {
    const root = document.createElement('div'); renderIngredientNotes(root, fresh(), () => {});
    const banned = /\b(try|stop using|switch to|works|helped|improved|caused|ratings?|stars?|good|bad)\b|return deadline/i;
    expect(source).not.toMatch(banned);
    expect(root.textContent!.replace(CAUSE_CAVEAT, '')).not.toMatch(banned);
});
