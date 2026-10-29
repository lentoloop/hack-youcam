import type { BreakoutLog, IngredientNote } from '../../contracts/log';
import { CAUSE_CAVEAT, parseLogFile } from '../../shared/log';
import { displayDate, sourceLabel } from './results';

export function renderIngredientNotes(root: HTMLElement, log: BreakoutLog, changed: () => void) {
    root.replaceChildren();
    root.className = 'log-card zone-journal';
    const section = document.createElement('section');
    section.className = 'ingredient-notes';
    root.append(section);
    const add = (tag: string, text: string, parent = section, className = '') => {
        const el = document.createElement(tag);
        el.textContent = text;
        el.className = className;
        parent.append(el);
        return el;
    };
    add('h3', 'Ingredient notes');
    add('p', CAUSE_CAVEAT, add('div', '', section, 'ingredient-caveat'));
    const notes = [...(log.ingredientNotes ?? [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!notes.length) add('p', 'No ingredient notes yet.', add('section', '', section, 'note-empty'));
    let day: HTMLElement | undefined;
    let date = '';
    for (const note of notes) {
        if (date !== note.date) {
            date = note.date;
            day = add('section', '', section, 'note-day');
            const time = document.createElement('time');
            time.dateTime = date;
            time.textContent = displayDate(date);
            add('h4', '', day).append(time);
        }
        const card = add('article', '', day, 'ingredient-note');
        add('h4', note.category, card);
        add('p', `Contains active: ${note.active}`, card);
        const ingredients = add('p', 'Ingredients noted: ', card, 'ingredient-list');
        for (const ingredient of note.ingredients.split(',').map(s => s.trim()).filter(Boolean))
            add('span', ingredient, ingredients, 'ingredient-chip');
        if (note.note) add('p', `Note: ${note.note}`, card);
        if (note.startedOn) add('p', `Started on ${displayDate(note.startedOn)}`, card);
    }
    for (const group of section.querySelectorAll<HTMLElement>('.note-day')) {
        const date = group.querySelector('time')!.dateTime;
        for (const source of new Set(log.entries.filter(e => e.date.slice(0, 10) === date).map(e => e.source)))
            add('span', sourceLabel[source], group, 'source-badge');
    }
    const form = document.createElement('form');
    form.className = 'note-form';
    form.innerHTML = '<label>Date<input name="date" type="date" required></label><label>Product<input name="category" maxlength="80" required></label><label>Contains active?<select name="active"><option>unknown</option><option>yes</option><option>no</option></select></label><label>Ingredients noted<textarea name="ingredients" maxlength="500"></textarea></label><label>Note<textarea name="note" maxlength="500"></textarea></label><label>Started on<input name="startedOn" type="date"></label><button type="submit">Add note</button>';
    const status = add('p', '');
    status.setAttribute('role', 'status');
    section.append(form);
    form.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(form);
        const value = (key: string) => String(data.get(key) ?? '').trim();
        const active = value('active');
        if (active !== 'yes' && active !== 'no' && active !== 'unknown') return;
        const ingredientNotes = [...(log.ingredientNotes ?? [])];
        let id = crypto.randomUUID();
        while (ingredientNotes.some(n => n.id === id)) id = crypto.randomUUID();
        const note: IngredientNote = { id, date: value('date'), category: value('category'), active, ingredients: value('ingredients'), ...(value('note') ? { note: value('note') } : {}), ...(value('startedOn') ? { startedOn: value('startedOn') } : {}) };
        ingredientNotes.push(note);
        const checked = parseLogFile({ ...log, ingredientNotes });
        if (!checked.ok) { status.textContent = 'Enter valid dates and text within the field limits.'; return; }
        log.ingredientNotes = ingredientNotes;
        changed();
    };
}
