import { expect, it } from '../../web/node_modules/vitest';
import source from '../../web/src/ingredient-notes.ts?raw';
import { renderIngredientNotes } from '../../web/src/ingredient-notes';
import { CAUSE_CAVEAT } from '../../shared/log';
import type { BreakoutLog } from '../../contracts/log';
const fresh = (): BreakoutLog => ({ version: 'breakout-log.v1', createdAt: '2026-10-29T00:00:00Z', changes: [], entries: [], selfReport: { areas: '', discomfort: '', reportedSevereSymptom: false } });
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
