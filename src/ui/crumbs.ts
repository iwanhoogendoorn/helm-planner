/** A breadcrumb trail: `2026 › Q3 › Aug › W35 › Wed 26`. Every crumb but the last is a link. */
import { h } from './dom';
import type { IsoDate } from '../core/types';
import { humanDate, MONTH_SHORT } from '../core/dates';
import { periodOf } from '../core/periods';
import type { UiContext } from './context';

export interface Crumb { label: string; onClick?: () => void; active?: boolean; title?: string }

export function breadcrumbs(items: Crumb[], cls = ''): HTMLElement {
  const wrap = h('nav', { cls: ['helm-crumbs', cls], attr: { 'aria-label': 'Breadcrumb' } });
  items.forEach((c, i) => {
    if (i > 0) wrap.appendChild(h('span', { cls: 'helm-crumb-sep', text: '›' }));
    wrap.appendChild(c.onClick
      ? h('button', { cls: ['helm-crumb', c.active && 'is-active'], text: c.label, title: c.title ?? '', onClick: c.onClick })
      : h('span', { cls: ['helm-crumb', 'is-static', c.active && 'is-active'], text: c.label, title: c.title ?? '' }));
  });
  return wrap;
}

/** The time trail for a date: year › quarter › month › week (› day), each opening that calendar scope. */
export function dateCrumbs(ctx: UiContext, date: IsoDate, active: 'year' | 'quarter' | 'month' | 'week' | 'day', opts: { day?: boolean } = {}): Crumb[] {
  const y = periodOf(date, 'year');
  const q = periodOf(date, 'quarter');
  const m = periodOf(date, 'month');
  const w = periodOf(date, 'week');
  const go = (scope: 'week' | 'month' | 'quarter' | 'year'): (() => void) => () => ctx.navigate('week', { date, scope });
  const out: Crumb[] = [
    { label: y.label, onClick: go('year'), active: active === 'year', title: 'Year' },
    { label: `Q${q.quarter}`, onClick: go('quarter'), active: active === 'quarter', title: q.label },
    { label: MONTH_SHORT[(m.month ?? 1) - 1]!, onClick: go('month'), active: active === 'month', title: m.label },
    { label: `W${w.week}`, onClick: go('week'), active: active === 'week', title: w.label },
  ];
  if (opts.day) out.push({ label: humanDate(date, ctx.today()), onClick: () => ctx.navigate('today', { date }), active: active === 'day', title: date });
  return out;
}
