/**
 * Notes, drawings and links for a task that does not exist yet — Capture's twin of the editor's
 * sections. What you pick is held here; `apply` writes it once the task has been made, so a capture
 * you cancel leaves nothing behind.
 */
import type { DrawingTarget, Task } from '../core/types';
import type { TaskLink } from '../core/links';
import { button, h, iconButton } from './dom';
import type { UiContext } from './context';
import { askNameAndLocation } from './fields';
import { pickNote } from './notes';
import { pickDrawing, targetForTask } from './drawings';
import { draftLinks, linksSection } from './links';

type Pending = { kind: 'new'; name?: string; folder?: string } | { kind: 'link'; path: string; title: string };

export interface DraftAttachments {
  notes: HTMLElement;
  drawings: HTMLElement;
  links: HTMLElement;
  /** The links to put on the line. */
  linkList: () => TaskLink[];
  /** Anything that needs the task to exist first (a note or a drawing). */
  needsTask: () => boolean;
  /** Write the notes and drawings for the task just made. */
  apply: (task: Task) => Promise<void>;
  /** Start again — after Shift+Enter keeps Capture open for the next one. */
  clear: () => void;
}

export function draftAttachments(ctx: UiContext, o: { title: () => string; projectTarget: () => DrawingTarget | undefined }): DraftAttachments {
  let notes: Pending[] = [];
  let drawings: Pending[] = [];
  const links = draftLinks();
  // Before the task exists its folder follows the project it is going into, as it will once it is made.
  const provisional = (): DrawingTarget => ({ kind: 'task', key: '(new task)', title: o.title() || 'task' });
  const folderFor = (kind: 'note' | 'drawing'): string => ctx.mutations.defaultFolderFor(o.projectTarget() ?? provisional(), kind);

  const notesEl = h('div', { cls: 'helm-attach-section' });
  const drawingsEl = h('div', { cls: 'helm-attach-section' });
  const label = (p: Pending, kind: 'note' | 'drawing'): string => p.kind === 'link' ? p.title : `New ${kind}: ${p.name ?? `“${o.title() || 'named after the task'}”`}`;
  const row = (p: Pending, kind: 'note' | 'drawing', drop: () => void): HTMLElement => h('div', { cls: 'helm-attach-row' },
    h('span', { cls: 'helm-hint', text: p.kind === 'link' ? 'link' : 'new' }),
    h('span', { text: label(p, kind), title: p.kind === 'link' ? p.path : `Made in ${p.folder ?? folderFor(kind)} when you add the task` }),
    h('span', { cls: 'helm-spacer' }),
    iconButton('x', 'Leave it out', () => drop()),
  );
  const drawList = (el: HTMLElement, kind: 'note' | 'drawing'): void => {
    const list = kind === 'note' ? notes : drawings;
    const set = (next: Pending[]): void => { if (kind === 'note') notes = next; else drawings = next; drawList(el, kind); };
    const taken = new Set(list.flatMap((p) => (p.kind === 'link' ? [p.path] : [])));
    el.replaceChildren(
      ...list.map((p) => row(p, kind, () => set(list.filter((x) => x !== p)))),
      ...(list.length === 0 ? [h('div', { cls: 'helm-hint', text: kind === 'note' ? 'No notes yet.' : 'No drawings yet.' })] : []),
      h('div', { cls: 'helm-drawing-actions' },
        button(kind === 'note' ? 'New note' : 'New drawing', { icon: kind === 'note' ? 'file-plus' : 'pen-tool', cls: 'helm-btn-quiet', onClick: () => askNameAndLocation(ctx, {
          title: `New ${kind} for ${o.title() || 'this task'}`,
          placeholder: kind === 'note' ? 'e.g. research, notes from the call' : 'e.g. flow, mind map, sketch',
          defaultFolder: folderFor(kind),
          preview: (name, folder) => (kind === 'note' ? ctx.mutations.notePathFor(provisional(), name, folder || folderFor(kind)) : ctx.mutations.drawingPathFor(provisional(), name, folder || folderFor(kind))),
          onDone: (r) => { if (r) set([...list, { kind: 'new', ...r }]); },
        }) }),
        button('Link existing', { icon: 'link', cls: 'helm-btn-quiet', onClick: () => {
          if (kind === 'note') pickNote(ctx, taken, (n) => set([...list, { kind: 'link', path: n.path, title: n.title }]));
          else pickDrawing(ctx, taken, (d) => {
            if (d.legacy) { ctx.notify(`“${d.title}” is a raw .excalidraw file, so it has no frontmatter to hold the link. Convert it first, then attach it.`); return; }
            set([...list, { kind: 'link', path: d.path, title: d.title }]);
          });
        } }),
      ),
    );
  };
  drawList(notesEl, 'note');
  drawList(drawingsEl, 'drawing');
  const linksEl = linksSection(ctx, links);

  return {
    notes: notesEl,
    drawings: drawingsEl,
    links: linksEl,
    linkList: () => links.list(),
    needsTask: () => notes.length > 0 || drawings.length > 0,
    apply: async (task) => {
      const target = targetForTask(task);
      for (const p of notes) {
        if (p.kind === 'new') await ctx.mutations.createNote(target, { ...(p.name ? { name: p.name } : {}), ...(p.folder ? { folder: p.folder } : {}) });
        else await ctx.mutations.linkNote(target, p.path);
      }
      for (const p of drawings) {
        if (p.kind === 'new') await ctx.mutations.createDrawing(target, { ...(p.name ? { name: p.name } : {}), ...(p.folder ? { folder: p.folder } : {}) });
        else await ctx.mutations.linkDrawing(target, p.path);
      }
    },
    clear: () => {
      notes = []; drawings = []; links.set([]);
      drawList(notesEl, 'note'); drawList(drawingsEl, 'drawing');
      linksEl.dispatchEvent(new Event('helm-redraw'));
    },
  };
}
