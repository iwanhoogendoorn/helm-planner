/* Obsidian's HTMLElement extensions, the handful the UI uses. */
if (typeof HTMLElement !== 'undefined') {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto['setText'] = function (this: HTMLElement, t: string) { this.textContent = t; return this; };
  proto['addClass'] = function (this: HTMLElement, ...c: string[]) { this.classList.add(...c.flatMap((x) => x.split(/\s+/)).filter(Boolean)); return this; };
  proto['removeClass'] = function (this: HTMLElement, ...c: string[]) { this.classList.remove(...c); return this; };
  proto['empty'] = function (this: HTMLElement) { while (this.firstChild) this.removeChild(this.firstChild); return this; };
  proto['createEl'] = function (this: HTMLElement, tag: string, o?: { text?: string; cls?: string }) { const e = document.createElement(tag); if (o?.text) e.textContent = o.text; if (o?.cls) e.className = o.cls; this.appendChild(e); return e; };
  proto['createDiv'] = function (this: HTMLElement, o?: { text?: string; cls?: string }) { return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('div', o); };
}
/* Minimal obsidian stub for unit tests (jsdom for UI tests). */
export class Plugin { app: unknown; manifest: unknown; constructor(app: unknown, manifest: unknown) { this.app = app; this.manifest = manifest; } }
export class ItemView { contentEl: HTMLElement; app: unknown; navigation = true; constructor(public leaf: unknown) { this.contentEl = document.createElement('div'); } async setState(): Promise<void> {} }
export class WorkspaceLeaf {}
export class Modal {
  app: unknown; titleEl: HTMLElement; contentEl: HTMLElement; opened = false;
  constructor(app: unknown) { this.app = app; this.titleEl = document.createElement('div'); this.contentEl = document.createElement('div'); }
  open(): void { this.opened = true; Modal.last = this; }
  close(): void { this.opened = false; this.onClose(); }
  onClose(): void {}
  static last: Modal | undefined;
}
export class FuzzySuggestModal<T> extends Modal { setPlaceholder(): void {} getItems(): T[] { return []; } }
export class Notice { static messages: string[] = []; constructor(public msg: string) { Notice.messages.push(msg); } }
export class PluginSettingTab { containerEl: HTMLElement = document.createElement('div'); constructor(_app: unknown, _p: unknown) {} }
export class Setting { constructor(_el: unknown) {} setName(): this { return this; } setDesc(): this { return this; } setHeading(): this { return this; } addText(): this { return this; } addToggle(): this { return this; } addDropdown(): this { return this; } addSlider(): this { return this; } addButton(): this { return this; } }
export class Menu {
  items: { title: string; click?: () => void; sub?: Menu }[] = [];
  static last: Menu | undefined;
  addItem(fn: (i: MenuItem) => void): this { const it = new MenuItem(); fn(it); this.items.push({ title: it.title, click: it.clickFn, sub: it.sub }); return this; }
  addSeparator(): this { return this; }
  showAtMouseEvent(): void { Menu.last = this; }
  showAtPosition(): void { Menu.last = this; }
}
class MenuItem { title = ''; clickFn?: () => void; sub?: Menu; setTitle(t: string): this { this.title = t; return this; } setIcon(): this { return this; } setChecked(): this { return this; } setWarning(): this { return this; } onClick(f: () => void): this { this.clickFn = f; return this; } setSubmenu(): Menu { this.sub = new Menu(); return this.sub; } }
export class TFile { path = ''; stat = { mtime: 0 }; }
export class TFolder {}
export class MarkdownView {}
export function normalizePath(p: string): string { return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export function setIcon(el: HTMLElement, name: string): void { el.setAttribute('data-icon', name); }
export function debounce<T extends (...a: never[]) => unknown>(fn: T): T { return fn; }
