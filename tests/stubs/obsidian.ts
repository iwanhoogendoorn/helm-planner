/* Obsidian's HTMLElement extensions, the handful the UI uses. */
if (typeof HTMLElement !== 'undefined') {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto['setText'] = function (this: HTMLElement, t: string) { this.textContent = t; return this; };
  proto['addClass'] = function (this: HTMLElement, ...c: string[]) { this.classList.add(...c.flatMap((x) => x.split(/\s+/)).filter(Boolean)); return this; };
  proto['removeClass'] = function (this: HTMLElement, ...c: string[]) { this.classList.remove(...c); return this; };
  proto['empty'] = function (this: HTMLElement) { while (this.firstChild) this.removeChild(this.firstChild); return this; };
  proto['createEl'] = function (this: HTMLElement, tag: string, o?: { text?: string; cls?: string; type?: string; placeholder?: string; attr?: Record<string, string> }) { const e = document.createElement(tag); if (o?.text) e.textContent = o.text; if (o?.cls) e.className = o.cls; if (o?.type) (e as HTMLInputElement).type = o.type; if (o?.placeholder) (e as HTMLInputElement).placeholder = o.placeholder; for (const [k, v] of Object.entries(o?.attr ?? {})) e.setAttribute(k, v); this.appendChild(e); return e; };
  proto['createSpan'] = function (this: HTMLElement, o?: { text?: string; cls?: string }) { return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('span', o); };
  proto['toggleClass'] = function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); return this; };
  proto['detach'] = function (this: HTMLElement) { this.remove(); };
  proto['show'] = function (this: HTMLElement) { this.style.display = ''; return this; };
  proto['hide'] = function (this: HTMLElement) { this.style.display = 'none'; return this; };
  (globalThis as unknown as Record<string, unknown>)['createDiv'] = (o?: { text?: string; cls?: string }) => (document.createElement('div') as unknown as { createDiv: (o?: unknown) => HTMLElement }).createDiv(o);
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
export class PluginSettingTab { containerEl: HTMLElement = document.createElement('div'); app: unknown; constructor(app: unknown, _p: unknown) { this.app = app; } hide(): void {} }
export class Setting {
  settingEl: HTMLElement; infoEl: HTMLElement; nameEl: HTMLElement; descEl: HTMLElement; controlEl: HTMLElement;
  constructor(el: HTMLElement) {
    this.settingEl = el.createDiv({ cls: 'setting-item' }); this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' }); this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' }); this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }
  setName(n: string): this { this.nameEl.textContent = n; return this; }
  setDesc(d: string): this { this.descEl.textContent = d; return this; }
  setHeading(): this { this.settingEl.classList.add('setting-item-heading'); return this; }
  setClass(c: string): this { this.settingEl.classList.add(c); return this; }
  addText(cb: (t: TextComponent) => void): this { cb(new TextComponent(this.controlEl)); return this; }
  addToggle(cb: (t: ToggleComponent) => void): this { cb(new ToggleComponent(this.controlEl)); return this; }
  addDropdown(cb: (d: DropdownComponent) => void): this { cb(new DropdownComponent(this.controlEl)); return this; }
  addSlider(cb: (s: SliderComponent) => void): this { cb(new SliderComponent(this.controlEl)); return this; }
  addButton(cb: (b: ButtonComponent) => void): this { cb(new ButtonComponent(this.controlEl)); return this; }
  addExtraButton(cb: (b: ExtraButtonComponent) => void): this { cb(new ExtraButtonComponent(this.controlEl)); return this; }
}
export class TextComponent { inputEl: HTMLInputElement; private cb?: (v: string) => unknown; constructor(el: HTMLElement) { this.inputEl = el.createEl('input', { type: 'text' }) as HTMLInputElement; this.inputEl.addEventListener('input', () => this.cb?.(this.inputEl.value)); } setPlaceholder(p: string): this { this.inputEl.placeholder = p; return this; } setValue(v: string): this { this.inputEl.value = v; return this; } getValue(): string { return this.inputEl.value; } onChange(cb: (v: string) => unknown): this { this.cb = cb; return this; } }
export class ToggleComponent { toggleEl: HTMLElement; value = false; private cb?: (v: boolean) => unknown; constructor(el: HTMLElement) { this.toggleEl = el.createDiv({ cls: 'checkbox-container' }); this.toggleEl.addEventListener('click', () => { this.setValue(!this.value); this.cb?.(this.value); }); } setValue(v: boolean): this { this.value = v; this.toggleEl.classList.toggle('is-enabled', v); return this; } onChange(cb: (v: boolean) => unknown): this { this.cb = cb; return this; } }
export class DropdownComponent { selectEl: HTMLSelectElement; private cb?: (v: string) => unknown; constructor(el: HTMLElement) { this.selectEl = el.createEl('select') as HTMLSelectElement; this.selectEl.addEventListener('change', () => this.cb?.(this.selectEl.value)); } addOptions(o: Record<string, string>): this { for (const [v, t] of Object.entries(o)) { const op = document.createElement('option'); op.value = v; op.textContent = t; this.selectEl.appendChild(op); } return this; } setValue(v: string): this { this.selectEl.value = v; return this; } onChange(cb: (v: string) => unknown): this { this.cb = cb; return this; } }
export class SliderComponent { sliderEl: HTMLInputElement; private cb?: (v: number) => unknown; constructor(el: HTMLElement) { this.sliderEl = el.createEl('input', { type: 'range' }) as HTMLInputElement; this.sliderEl.addEventListener('input', () => this.cb?.(Number(this.sliderEl.value))); } setLimits(min: number, max: number, step: number): this { this.sliderEl.min = String(min); this.sliderEl.max = String(max); this.sliderEl.step = String(step); return this; } setValue(v: number): this { this.sliderEl.value = String(v); return this; } setDynamicTooltip(): this { return this; } onChange(cb: (v: number) => unknown): this { this.cb = cb; return this; } }
export class ButtonComponent { buttonEl: HTMLButtonElement; constructor(el: HTMLElement) { this.buttonEl = el.createEl('button') as HTMLButtonElement; } setButtonText(t: string): this { this.buttonEl.textContent = t; return this; } setCta(): this { return this; } setWarning(): this { this.buttonEl.classList.add('mod-warning'); return this; } setIcon(): this { return this; } setTooltip(): this { return this; } onClick(cb: () => unknown): this { this.buttonEl.addEventListener('click', () => cb()); return this; } }
export class ExtraButtonComponent { extraSettingsEl: HTMLElement; constructor(el: HTMLElement) { this.extraSettingsEl = el.createDiv({ cls: 'clickable-icon extra-setting-button' }); } setIcon(i: string): this { this.extraSettingsEl.setAttribute('data-icon', i); return this; } setTooltip(): this { return this; } onClick(cb: () => unknown): this { this.extraSettingsEl.addEventListener('click', () => cb()); return this; } }
export class AbstractInputSuggest<T> { constructor(public app: unknown, public inputEl: HTMLInputElement) { AbstractInputSuggest.instances.push(this as AbstractInputSuggest<unknown>); } getSuggestions(_q: string): T[] { return []; } renderSuggestion(_v: T, _el: HTMLElement): void {} selectSuggestion(_v: T): void {} close(): void {} static instances: AbstractInputSuggest<unknown>[] = []; }
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
export class TFolder { path = ''; }
export class MarkdownView {}
export function normalizePath(p: string): string { return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export function setIcon(el: HTMLElement, name: string): void { el.setAttribute('data-icon', name); }
export function debounce<T extends (...a: never[]) => unknown>(fn: T): T { return fn; }
