/**
 * The song note a task belongs to through its project — for a song: a sub-project of a music board.
 * Its song is the attached note marked as one (Maestro's `type: song`), else the first note listed under
 * its `## Notes`. Any other project's tasks have no song, whatever notes the project links: a reference
 * note under a plain project's Notes is not something every task in it is “a step of”.
 */
import type { Task } from '../core/types';
import type { UiContext } from './context';

export function projectSongNote(ctx: UiContext, t: Task): string | undefined {
  if (!t.projectId) return undefined;
  const projects = ctx.index.snapshot.projects;
  const p = projects.get(t.projectId);
  if (!p) return undefined;
  const parent = p.parentId ? projects.get(p.parentId) : undefined;
  if (parent?.profile !== 'music') return undefined;
  const notes = ctx.index.notesFor({ kind: 'project', id: p.id, title: p.title });
  const song = notes.find((n) => ctx.index.song(n.path));
  return song ? song.path.replace(/\.md$/, '') : ctx.index.noteLinksOf(p.path)[0];
}
