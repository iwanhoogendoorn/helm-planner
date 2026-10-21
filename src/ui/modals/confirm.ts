/**
 * Ask before doing something: one themed, tracked modal for every "are you sure?" in Helm. It replaces
 * `window.confirm`, which is synchronous, ignores the theme, is not closed when the plugin unloads and
 * behaves differently on mobile. Answers true for the confirm button, false for Cancel, Escape or close.
 */
import { Modal, type App } from 'obsidian';
import { button, h } from '../dom';

export interface ConfirmOptions {
  title: string;
  /** What will happen. Blank lines start a new paragraph. */
  body?: string;
  /** The confirm button's label. */
  cta?: string;
  /** A destructive action: the button is drawn as a warning and Cancel gets the focus. */
  warning?: boolean;
}

type Host = { app: App; trackModal?: (m: { close: () => void; onClose?: () => void }) => void };

export function confirmModal(ctx: Host, o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new Modal(ctx.app);
    m.titleEl.setText(o.title);
    m.contentEl.addClass('helm-modal', 'helm-confirm-modal');
    let answer = false;
    const done = (yes: boolean): void => { answer = yes; m.close(); };
    const cancel = button('Cancel', { onClick: () => done(false) });
    const ok = button(o.cta ?? 'OK', { primary: !o.warning, cls: o.warning ? 'mod-warning helm-confirm-ok' : 'helm-confirm-ok', onClick: () => done(true) });
    const paras = (o.body ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    m.contentEl.append(
      ...paras.map((p) => h('p', { cls: 'helm-confirm-text', text: p })),
      h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), cancel, ok),
    );
    const origClose = m.onClose.bind(m);
    m.onClose = () => { origClose(); resolve(answer); };
    m.open();
    ctx.trackModal?.(m);
    (o.warning ? cancel : ok).focus();
  });
}
