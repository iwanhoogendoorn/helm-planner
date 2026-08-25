/* Minimal obsidian stub for unit tests. */
export class Plugin {}
export class ItemView {}
export class Modal { app: unknown; contentEl = document?.createElement?.('div'); constructor(app: unknown) { this.app = app; } open(): void {} close(): void {} }
export class Notice { constructor(public msg: string) {} }
export class PluginSettingTab {}
export class Setting { constructor(_el: unknown) {} setName(): this { return this; } setDesc(): this { return this; } addText(): this { return this; } addToggle(): this { return this; } addDropdown(): this { return this; } addSlider(): this { return this; } addButton(): this { return this; } }
export class TFile {}
export class TFolder {}
export function normalizePath(p: string): string { return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export function setIcon(): void {}
export function debounce<T extends (...a: never[]) => unknown>(fn: T): T { return fn; }
