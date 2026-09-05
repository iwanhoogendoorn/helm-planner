/**
 * Export a report: choose the period, choose what goes in it, see what it will hold, print it.
 *
 * The dialogue is deliberately the same for a day and for a year — the only thing that changes is how
 * much of it applies. What it will contain is counted before anything is rendered, so an empty report is
 * something you find out here rather than in a PDF reader.
 */
import { Modal } from 'obsidian';
import type { IsoDate } from '../../core/types';
import { addDays, addMonths, addYears } from '../../core/dates';
import { ALL_SECTIONS, buildReport, rangeOf, REPORT_SCOPES, type Report, type ReportScope, type ReportSections } from '../../data/report';
import { canExportPdf, exportHtmlToPdf, printViaDialog } from '../../data/pdf';
import { renderReport, reportFileName } from '../report/html';
import { button, chip, h, icon } from '../dom';
import type { UiContext } from '../context';

const SECTION_LABELS: { id: keyof ReportSections; label: string; hint: string; scopes?: ReportScope[] }[] = [
  { id: 'history', label: 'What happened', hint: 'Totals, the shape of the period, how much of the plan held' },
  { id: 'plan', label: 'The day / the days', hint: 'The plan itself, hour by hour or day by day', scopes: ['day', 'week'] },
  { id: 'ahead', label: 'What is ahead', hint: 'Open work dated inside the period, and what is carried in overdue' },
  { id: 'projects', label: 'Projects', hint: 'Progress, next actions and due dates' },
  { id: 'goals', label: 'Goals', hint: 'The goals bound to this period' },
  { id: 'habits', label: 'Habits', hint: 'How often each one was kept' },
  { id: 'daybook', label: 'Diary', hint: 'The daybook entries of the day or week', scopes: ['day', 'week'] },
];

/** What the settings remember between exports, so the dialogue opens the way you left it. */
export const sectionsFrom = (saved: string[] | undefined): ReportSections =>
  (saved === undefined ? { ...ALL_SECTIONS } : Object.fromEntries(Object.keys(ALL_SECTIONS).map((k) => [k, saved.includes(k)])) as unknown as ReportSections);

export const sectionsTo = (s: ReportSections): string[] => Object.entries(s).filter(([, on]) => on).map(([k]) => k);

/** Step a period backwards or forwards by one of itself. */
export function step(scope: ReportScope, anchor: IsoDate, by: number): IsoDate {
  if (scope === 'day') return addDays(anchor, by);
  if (scope === 'week') return addDays(anchor, 7 * by);
  if (scope === 'month') return addMonths(anchor, by);
  if (scope === 'quarter') return addMonths(anchor, 3 * by);
  return addYears(anchor, by);
}

export function openExportReport(ctx: UiContext, opts: { scope?: ReportScope; anchor?: IsoDate; projectId?: string } = {}): void {
  const settings = ctx.settings();
  let scope: ReportScope = opts.scope ?? settings.reportScope ?? 'week';
  let anchor: IsoDate = opts.anchor ?? ctx.today();
  const sections = sectionsFrom(settings.reportSections);

  const m = new Modal(ctx.app);
  m.titleEl.setText(opts.projectId ? 'Export this project' : 'Export a report');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-export');
  const body = h('div');
  root.appendChild(body);

  const report = (): Report => buildReport(ctx.index.snapshot, {
    scope, anchor, sections, ...(opts.projectId ? { projectId: opts.projectId } : {}),
  }, ctx.today(), ctx.settings(), (d) => ctx.index.daybook(d));

  const save = (): void => void ctx.saveSettings({ reportScope: scope, reportSections: sectionsTo(sections) });

  function draw(): void {
    const r = report();
    const { from, to } = rangeOf(scope, anchor, ctx.settings().weekStartsOn);
    const ahead = r.ahead.reduce((s, d) => s + d.tasks.length, 0);

    const scopes = h('div', { cls: 'helm-segmented' }, ...REPORT_SCOPES.map((s) =>
      h('button', { cls: ['helm-seg', scope === s.id && 'is-active'], text: s.label, onClick: () => { scope = s.id; draw(); } })));

    const nav = h('div', { cls: 'helm-export-nav' },
      h('button', { cls: 'helm-seg', title: 'The one before', onClick: () => { anchor = step(scope, anchor, -1); draw(); } }, icon('chevron-left')),
      h('div', { cls: 'helm-export-period' }, h('strong', { text: r.title }), h('span', { cls: 'helm-hint', text: r.subtitle })),
      h('button', { cls: 'helm-seg', title: 'The one after', onClick: () => { anchor = step(scope, anchor, 1); draw(); } }, icon('chevron-right')),
      h('button', { cls: 'helm-seg', text: 'Now', title: 'Back to the period we are in', onClick: () => { anchor = ctx.today(); draw(); } }),
    );

    const boxes = h('div', { cls: 'helm-export-sections' }, ...SECTION_LABELS.filter((s) => !s.scopes || s.scopes.includes(scope)).map((s) => {
      const input = h('input', { attr: { type: 'checkbox', ...(sections[s.id] ? { checked: 'checked' } : {}) } }) as HTMLInputElement;
      input.addEventListener('change', () => { sections[s.id] = input.checked; save(); draw(); });
      return h('label', { cls: 'helm-toggle helm-export-section', attr: { title: s.hint } }, input, h('span', { text: s.label }));
    }));

    const counts = h('div', { cls: 'helm-export-counts' },
      chip(`${r.stats.totals.done} done`, 'done'),
      chip(`${ahead} ahead`, 'scheduled'),
      r.overdue.length > 0 ? chip(`${r.overdue.length} overdue`, 'due is-overdue', 'Past their due date') : null,
      r.leftBehind > 0 ? chip(`${r.leftBehind} left from before`, 'forwarded', 'Open, planned before this period, with no due date — counted, not listed') : null,
      chip(`${r.projects.length} project${r.projects.length === 1 ? '' : 's'}`, 'project'),
      r.goals.length > 0 ? chip(`${r.goals.length} goal${r.goals.length === 1 ? '' : 's'}`, 'count') : null,
      r.daybook.length > 0 ? chip(`${r.daybook.reduce((s, d) => s + d.entries.length, 0)} diary`, 'note') : null,
    );

    const go = async (how: 'pdf' | 'print'): Promise<void> => {
      const html = renderReport(r, `${ctx.today()} ${ctx.now()}`);
      m.close();
      save();
      if (how === 'print' || !canExportPdf()) {
        printViaDialog(html);
        if (how === 'pdf') ctx.notify('No PDF writer here — the print dialogue can save one instead.');
        return;
      }
      ctx.notify('Building the document…');
      const out = await exportHtmlToPdf(html, reportFileName(r), (msg) => ctx.notify(msg));
      if (out === 'unsupported') printViaDialog(html);
    };

    body.replaceChildren(
      h('div', { cls: 'helm-export-head' }, scopes, h('span', { cls: 'helm-spacer' }), h('span', { cls: 'helm-hint', text: `${from} → ${to}` })),
      ...(opts.projectId ? [] : [nav]),
      counts,
      h('div', { cls: 'helm-hint', text: 'What goes in:' }),
      boxes,
      h('div', { cls: 'helm-modal-buttons' },
        button('Cancel', { onClick: () => m.close() }),
        button('Print…', { icon: 'printer', title: 'Open the print dialogue instead — it can save a PDF too', onClick: () => void go('print') }),
        button('Export PDF', { primary: true, icon: 'file-down', onClick: () => void go('pdf') }),
      ),
    );
  }

  draw();
  m.open();
  ctx.trackModal(m);
}
