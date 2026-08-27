import { describe, expect, it } from 'vitest';
import { setup, HABIT_WORKOUT } from './fixture';

const DRAW = (fm: string): string => `---\n${fm}\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n\`\`\`json\n{"type":"excalidraw","elements":[]}\n\`\`\`\n%%\n`;
const WORKOUT = { kind: 'habit' as const, id: 'hab-workout', title: 'Morning workout' };
const READ = { kind: 'habit' as const, id: 'hab-read', title: 'Evening reading' };

describe('notes and drawings tied to habits', () => {
  it('finds them by helm-habit frontmatter and by embeds / Notes lists in the habit note', async () => {
    const { index } = await setup({
      '81 AI/Workout plan.md': '---\nhelm-habit: hab-workout\n---\n# Workout plan\n',
      'Excalidraw/routine.excalidraw.md': DRAW('helm-habit: hab-workout'),
      'Excalidraw/shelf.excalidraw.md': DRAW(''),
      '10 PERSONAL/Books.md': '# Books\n',
      '02 PROJECTS/Habits/Evening reading.md': '---\ntype: habit\nid: hab-read\ntitle: Evening reading\nschedule: every day\n---\n\n## Notes\n\n- [[Books]]\n\n## Diagrams\n\n![[shelf.excalidraw]]\n',
    });
    expect(index.notesFor(WORKOUT).map((n) => n.title)).toEqual(['Workout plan']);
    expect(index.drawingsFor(WORKOUT).map((d) => d.title)).toEqual(['routine']);
    expect(index.notesFor(READ).map((n) => n.title)).toEqual(['Books']);
    expect(index.drawingsFor(READ).map((d) => d.title)).toEqual(['shelf']);
    expect(index.notesFor({ kind: 'date', date: '2026-08-26', title: '' }).map((n) => n.title)).toEqual([]);
  });

  it('creates a note and a drawing for a habit: keyed, related back to the habit note, listed / embedded there', async () => {
    const { m, vault, index } = await setup();
    const n = await m.createNote(WORKOUT, { name: 'Why I train' });
    expect(n).toBe('Notes/Why I train.md');
    expect(await vault.read(n)).toMatch(/^---\nhelm-habit: hab-workout\nrelated: "\[\[Morning workout\]\]"\n/);
    expect(await vault.read('02 PROJECTS/Habits/Morning workout.md')).toMatch(/## Notes\n\n- \[\[Why I train\]\]/);
    expect(index.notesFor(WORKOUT).map((x) => x.title)).toEqual(['Why I train']);
    const d = await m.createDrawing(WORKOUT);
    expect(d).toBe('Excalidraw/Morning workout.excalidraw.md');
    expect(await vault.read(d)).toMatch(/helm-habit: hab-workout/);
    expect(await vault.read('02 PROJECTS/Habits/Morning workout.md')).toContain('![[Morning workout.excalidraw]]');
    expect(index.drawingsFor(WORKOUT).map((x) => x.title)).toEqual(['Morning workout']);
    // Unlinking clears the key and the embed / list entry; the habit note is otherwise untouched.
    await m.unlinkNote(WORKOUT, n);
    await m.unlinkDrawing(WORKOUT, d);
    const hb = await vault.read('02 PROJECTS/Habits/Morning workout.md');
    expect(hb).not.toContain('[[Why I train]]');
    expect(hb).not.toContain('.excalidraw');
    expect(hb).toContain(HABIT_WORKOUT.trim().split('\n').slice(1, 4).join('\n'));
    expect(index.notesFor(WORKOUT)).toEqual([]);
    expect(index.drawingsFor(WORKOUT)).toEqual([]);
  });
});
