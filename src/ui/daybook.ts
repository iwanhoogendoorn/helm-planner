/**
 * The day's diary, in the day view: what happened, when, and what came back.
 *
 * One line to write in, entries newest-last so the day reads downwards, replies tucked under the entry
 * they answer. Everything lands in the daily note as plain markdown, so the note stays yours.
 */
import { Menu } from 'obsidian';
import type { IsoDate } from '../core/types';
import type { DaybookEntry } from '../core/daybook';
import { button, h, icon, iconButton, richText, section } from './dom';
import type { UiContext } from './context';
import { askText } from './fields';

/** The Daybook section for one day, with its entries and the box to add another. */
export function daybookSection(ctx: UiContext, date: IsoDate, store: Map<string, boolean>): HTMLElement {
  const entries = ctx.index.daybook(date);
  const jot = h('input', {
    cls: 'helm-quickadd-input helm-daybook-input',
    attr: { type: 'text', placeholder: `What just happened?  (${ctx.now()})` },
  });
  const add = (): void => {
    const text = jot.value.trim();
    if (text === '') return;
    jot.value = '';
    void ctx.run('Daybook', () => ctx.mutations.addDaybookEntry(date, text));
  };
  jot.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });

  const rows = entries.map((e) => entryRow(ctx, date, e));
  return section('Daybook', {
    count: entries.length, store, key: 'daybook', cls: 'helm-daybook', collapsed: false,
    actions: [iconButton('file-text', 'Open the day’s note at the daybook', () => void ctx.openFile(ctx.index.dailyPath(date) ?? '', entries[0]?.line))],
  },
    ...rows,
    h('div', { cls: 'helm-quickadd helm-daybook-add' }, icon('pen-line'), jot, button('Jot', { onClick: add })),
  );
}

function entryRow(ctx: UiContext, date: IsoDate, e: DaybookEntry): HTMLElement {
  const menu = (ev: MouseEvent): void => {
    ev.preventDefault();
    const m = new Menu();
    m.addItem((i) => i.setTitle('Reply…').setIcon('corner-down-right').onClick(() => askText(ctx, {
      title: 'Reply', label: 'Your note', placeholder: 'What came of it?', cta: 'Add',
      onDone: (text) => { if (text) void ctx.run('Daybook', () => ctx.mutations.addDaybookReply(date, e.line, text)); },
    })));
    m.addItem((i) => i.setTitle('Edit…').setIcon('pencil').onClick(() => askText(ctx, {
      title: `Entry at ${e.time}`, label: 'Text', value: e.text, cta: 'Save',
      onDone: (text) => { if (text) void ctx.run('Daybook', () => ctx.mutations.updateDaybookEntry(date, e.line, text)); },
    })));
    m.addItem((i) => i.setTitle('Open in the note').setIcon('file-text').onClick(() => void ctx.openFile(ctx.index.dailyPath(date) ?? '', e.line)));
    m.addSeparator();
    m.addItem((i) => i.setTitle('Delete').setIcon('trash-2').setWarning(true).onClick(() => {
      if (!window.confirm(`Delete the ${e.time} entry?`)) return;
      void ctx.run('Daybook', () => ctx.mutations.removeDaybookEntry(date, e.line));
    }));
    m.showAtMouseEvent(ev);
  };
  return h('div', { cls: 'helm-daybook-entry', onContextMenu: menu },
    h('div', { cls: 'helm-daybook-line' },
      h('button', { cls: 'helm-daybook-time', title: 'Open this line in the note', onClick: () => void ctx.openFile(ctx.index.dailyPath(date) ?? '', e.line) }, h('span', { text: e.time })),
      e.icon ? h('span', { cls: 'helm-daybook-icon', text: e.icon }) : null,
      h('span', { cls: 'helm-daybook-text' }, richText(e.text, (t) => ctx.openLink(t, ctx.index.dailyPath(date)))),
      h('span', { cls: 'helm-spacer' }),
      iconButton('more-horizontal', 'More…', menu, 'helm-daybook-more'),
    ),
    ...e.replies.map((r) => h('div', { cls: 'helm-daybook-reply' },
      h('span', { cls: 'helm-daybook-icon', text: r.icon || '💬' }),
      h('span', {}, richText(r.text, (t) => ctx.openLink(t, ctx.index.dailyPath(date)))),
    )),
  );
}
