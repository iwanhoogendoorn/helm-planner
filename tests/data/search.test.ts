import { describe, expect, it } from 'vitest';
import { setup, TODAY } from './fixture';
import { parseQuery, resolveDate, search } from '../../src/data/search';

const NOTE = '---\nhelm-task: tsk-0001\n---\n# Chapter research\n';
const DRAW = '---\nhelm-project: prj-book\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n```json\n{"type":"excalidraw","elements":[]}\n```\n%%\n';

const titles = (hits: { title: string }[]): string[] => hits.map((x) => x.title);

describe('query parsing', () => {
  it('splits words, tags, projects and filters', () => {
    const q = parseQuery('chapter #urgent @Oracle is:open due:week kind:task extra', TODAY);
    expect(q).toMatchObject({ words: ['chapter', 'extra'], tags: ['urgent'], projects: ['oracle'], kinds: ['task'], status: 'open', dueBy: '2026-09-01' });
    expect(parseQuery('', TODAY).empty).toBe(true);
    expect(parseQuery('is:nonsense on:whenever', TODAY).words).toEqual(['is:nonsense', 'on:whenever']); // unknown filters are just words
    expect(resolveDate('tomorrow', TODAY)).toBe('2026-08-27');
    expect(resolveDate('2026-09-09', TODAY)).toBe('2026-09-09');
  });
});

describe('searching everything', () => {
  it('finds tasks, projects, goals, habits, notes and drawings, best title match first', async () => {
    const { index } = await setup({ '81 AI/Chapter research.md': NOTE, 'Excalidraw/Book layout.excalidraw.md': DRAW });
    const s = index.snapshot;
    const hits = search(s, 'chapter', { today: TODAY });
    expect(hits[0]!.kind).toBe('task'); // "Chapter 1" starts with the word
    expect(titles(hits)).toEqual(expect.arrayContaining(['Chapter 1', 'Chapter 2', 'Draft chapter list', 'Chapter research']));
    expect(hits.find((x) => x.kind === 'note')!.title).toBe('Chapter research');
    expect(titles(search(s, 'kitchen', { today: TODAY }))).toContain('Kitchen Remodel');
    expect(search(s, 'kitchen', { today: TODAY }).some((x) => x.kind === 'project')).toBe(true);
    expect(titles(search(s, 'workout', { today: TODAY }))).toEqual(['Morning workout']);
    expect(titles(search(s, 'book layout', { today: TODAY }))).toEqual(['Book layout']);
    expect(search(s, 'zzzznothing', { today: TODAY })).toEqual([]);
    expect(search(s, '', { today: TODAY })).toEqual([]);
  });

  it('narrows by kind, project, status and dates; filters that only make sense for tasks drop the rest', async () => {
    const { index } = await setup({ '81 AI/Chapter research.md': NOTE });
    const s = index.snapshot;
    expect(search(s, 'chapter kind:note', { today: TODAY }).map((x) => x.kind)).toEqual(['note']);
    expect(search(s, 'chapter kind:task', { today: TODAY }).every((x) => x.kind === 'task')).toBe(true);
    const inProject = search(s, '@Oracle Book', { today: TODAY });
    expect(inProject.every((x) => x.kind === 'task')).toBe(true); // a project filter is about tasks
    expect(titles(inProject)).toContain('Draft chapter list');
    const done = search(s, 'is:done', { today: TODAY });
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((x) => x.task!.status === 'done')).toBe(true);
    const due = search(s, 'is:open due:2026-08-20', { today: TODAY });
    expect(titles(due)).toContain('Chapter 1');
    expect(search(s, 'on:2026-08-25', { today: TODAY }).every((x) => (x.task!.scheduled ?? x.task!.noteDate) === '2026-08-25')).toBe(true);
    expect(search(s, 'is:overdue', { today: TODAY }).every((x) => x.task!.due! < TODAY)).toBe(true);
  });

  it('matches other fields weakly and never lists a mirrored copy', async () => {
    const { index } = await setup();
    const s = index.snapshot;
    const byProject = search(s, 'Remodel quotes', { today: TODAY }); // words spread over title and project
    expect(titles(byProject)).toContain('Get three quotes');
    const keys = search(s, 'chapter', { today: TODAY }).filter((x) => x.kind === 'task').map((x) => x.task!.origin);
    expect(keys).not.toContain('daily-mirror');
  });
});
