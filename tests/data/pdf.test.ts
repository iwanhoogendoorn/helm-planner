// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canExportPdf, exportHtmlToPdf, printViaDialog } from '../../src/data/pdf';

type Req = (m: string) => unknown;
const g = globalThis as unknown as { require?: Req };

/** A stand-in for Electron's remote dialog, fs, os and path. */
function fakeElectron(opts: { cancel?: boolean; dialogError?: Error; tmpError?: Error }) {
  const written = new Map<string, unknown>();
  const removed: string[] = [];
  const opened: string[] = [];
  const req: Req = (m) => {
    if (m === 'electron') return { remote: { dialog: { showSaveDialog: async () => { if (opts.dialogError) throw opts.dialogError; return opts.cancel ? { canceled: true } : { canceled: false, filePath: '/out/report.pdf' }; } }, shell: { openPath: (p: string) => opened.push(p) } } };
    if (m === 'fs') return { writeFileSync: (p: string, d: unknown) => { if (opts.tmpError && p.startsWith('/tmp')) throw opts.tmpError; written.set(p, d); }, unlinkSync: (p: string) => removed.push(p) };
    if (m === 'os') return { tmpdir: () => '/tmp' };
    if (m === 'path') return { join: (...p: string[]) => p.join('/') };
    throw new Error(`unexpected ${m}`);
  };
  return { req, written, removed, opened };
}

afterEach(() => { delete g.require; vi.useRealTimers(); document.body.innerHTML = ''; });

describe('pdf export (CD-10)', () => {
  it('says unsupported where there is no Electron', async () => {
    expect(canExportPdf()).toBe(false);
    expect(await exportHtmlToPdf('<p>x</p>', 'r.pdf', () => {})).toBe('unsupported');
  });

  it('a cancelled save is not a failure', async () => {
    g.require = fakeElectron({ cancel: true }).req;
    expect(canExportPdf()).toBe(true);
    const notes: string[] = [];
    expect(await exportHtmlToPdf('<p>x</p>', 'r.pdf', (m) => notes.push(m))).toBe('cancelled');
    expect(notes).toEqual([]);
  });

  it('reports a dialogue or temp-file failure', async () => {
    const notes: string[] = [];
    g.require = fakeElectron({ dialogError: new Error('no window') }).req;
    expect(await exportHtmlToPdf('<p>x</p>', 'r.pdf', (m) => notes.push(m))).toBe('failed');
    g.require = fakeElectron({ tmpError: new Error('disk full') }).req;
    expect(await exportHtmlToPdf('<p>x</p>', 'r.pdf', (m) => notes.push(m))).toBe('failed');
    expect(notes).toEqual(['Could not open the save dialogue — no window', 'Could not prepare the document for printing — disk full']);
  });

  it('renders off-screen, prints, writes the file, cleans up and opens it', async () => {
    vi.useFakeTimers();
    const e = fakeElectron({});
    g.require = e.req;
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag);
      if (tag === 'webview') Object.assign(el, { printToPDF: async () => pdf });
      return el;
    });
    const notes: string[] = [];
    const done = exportHtmlToPdf('<p>x</p>', 'r.pdf', (m) => notes.push(m));
    await vi.advanceTimersByTimeAsync(0);
    const view = document.querySelector('webview')!;
    expect(view.getAttribute('src')).toMatch(/^file:\/\/\/tmp\/helm-report-\d+\.html$/);
    view.dispatchEvent(new Event('did-finish-load'));
    await vi.advanceTimersByTimeAsync(400);
    expect(await done).toBe('saved');
    expect(e.written.get('/out/report.pdf')).toBe(pdf);
    expect(e.removed).toHaveLength(1);
    expect(e.opened).toEqual(['/out/report.pdf']);
    expect(notes).toEqual(['PDF saved to /out/report.pdf']);
    expect(document.querySelector('webview')).toBeNull();
  });

  it('gives up after a load failure or a timeout', async () => {
    vi.useFakeTimers();
    g.require = fakeElectron({}).req;
    const notes: string[] = [];
    const failed = exportHtmlToPdf('<p>x</p>', 'r.pdf', (m) => notes.push(m));
    await vi.advanceTimersByTimeAsync(0);
    document.querySelector('webview')!.dispatchEvent(new Event('did-fail-load'));
    expect(await failed).toBe('failed');
    const slow = exportHtmlToPdf('<p>x</p>', 'r.pdf', (m) => notes.push(m));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await slow).toBe('failed');
    expect(notes).toEqual(['The document could not be rendered for PDF export.', 'PDF export timed out.']);
  });

  it('falls back to the print dialogue in a hidden frame', () => {
    vi.useFakeTimers();
    printViaDialog('<p>hello</p>');
    const frame = document.querySelector('iframe')!;
    expect(frame.contentDocument!.body.textContent).toBe('hello');
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, 'print', { value: print });
    Object.defineProperty(frame.contentWindow!, 'focus', { value: () => {} });
    vi.advanceTimersByTime(400);
    expect(print).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
