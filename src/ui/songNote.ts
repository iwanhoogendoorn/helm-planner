/** The song note a task belongs to through its project: the note attached with `helm-project` or listed under `## Notes`. */
import type { Task } from '../core/types';
import type { UiContext } from './context';

export function projectSongNote(ctx: UiContext, t: Task): string | undefined {
  if (!t.projectId) return undefined;
  const p = ctx.index.snapshot.projects.get(t.projectId);
  if (!p) return undefined;
  const notes = ctx.index.notesFor({ kind: 'project', id: p.id, title: p.title });
  const song = notes.find((n) => ctx.index.song(n.path));
  return song ? song.path.replace(/\.md$/, '') : ctx.index.noteLinksOf(p.path)[0];
}
