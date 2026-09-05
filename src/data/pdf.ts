/**
 * Turning a document into a PDF on your disk.
 *
 * The desktop app is Electron, so a hidden `webview` can render the page and print itself to PDF at
 * exactly A4 with no hardware margins — the document's own padding is the margin. Nothing leaves the
 * machine. Where there is no Electron (mobile, or a stripped runtime) the browser's own print dialogue
 * is offered instead, which reaches the same printer and the same “save as PDF”.
 */
export type ExportResult = 'saved' | 'cancelled' | 'failed' | 'unsupported';

interface Bits {
  showSaveDialog: (o: { defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<{ canceled: boolean; filePath?: string }>;
  writeFile: (path: string, data: Uint8Array | string) => void;
  tmpFile: (name: string, content: string) => string;
  removeFile: (path: string) => void;
  openPath?: (path: string) => void;
}

function electron(): Bits | null {
  const req = (globalThis as unknown as { require?: (m: string) => unknown }).require;
  if (typeof req !== 'function') return null;
  try {
    const el = req('electron') as { remote?: { dialog?: unknown; shell?: { openPath: (p: string) => void } } };
    const fs = req('fs') as { writeFileSync: (p: string, d: Uint8Array | string) => void; unlinkSync: (p: string) => void };
    const os = req('os') as { tmpdir: () => string };
    const path = req('path') as { join: (...p: string[]) => string };
    const dialog = el.remote?.dialog as Bits['showSaveDialog'] extends never ? never : { showSaveDialog: Bits['showSaveDialog'] } | undefined;
    if (!dialog || !fs || !os) return null;
    return {
      showSaveDialog: (o) => dialog.showSaveDialog(o),
      writeFile: (p, d) => fs.writeFileSync(p, d),
      tmpFile: (name, content) => { const target = path.join(os.tmpdir(), name); fs.writeFileSync(target, content); return target; },
      removeFile: (p) => fs.unlinkSync(p),
      ...(el.remote?.shell ? { openPath: (p: string) => el.remote!.shell!.openPath(p) } : {}),
    };
  } catch {
    return null;
  }
}

export const canExportPdf = (): boolean => electron() !== null;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Ask where it should go, render it off-screen, print it, write it. Returns what happened so the caller
 * can say so — a cancelled save is not a failure and should not be reported as one.
 */
export async function exportHtmlToPdf(html: string, suggestedName: string, notify: (msg: string) => void): Promise<ExportResult> {
  const bits = electron();
  if (!bits) return 'unsupported';
  let chosen: { canceled: boolean; filePath?: string };
  try {
    chosen = await bits.showSaveDialog({ defaultPath: suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  } catch (e) {
    notify(`Could not open the save dialogue — ${errorText(e)}`);
    return 'failed';
  }
  if (chosen.canceled || !chosen.filePath) return 'cancelled';
  const target = chosen.filePath;

  let tmpPath: string;
  try {
    tmpPath = bits.tmpFile(`helm-report-${Date.now()}.html`, html);
  } catch (e) {
    notify(`Could not prepare the document for printing — ${errorText(e)}`);
    return 'failed';
  }

  const view = document.createElement('webview') as HTMLElement & { printToPDF: (o: unknown) => Promise<Uint8Array> };
  view.setAttribute('nodeintegration', 'false');
  // A4 at 96dpi, off-screen: the frame is the page, so nothing reflows between preview and paper.
  view.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;opacity:0;pointer-events:none;';
  view.setAttribute('src', `file://${tmpPath}`);

  return new Promise<ExportResult>((resolve) => {
    let settled = false;
    let timeoutId = 0;
    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      view.remove();
      try { bits.removeFile(tmpPath); } catch { /* a temp file left behind is not worth a notice */ }
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      notify(message);
      resolve('failed');
    };
    view.addEventListener('did-finish-load', () => {
      // A beat for fonts and layout to settle before the page is frozen into a PDF.
      window.setTimeout(() => {
        void (async () => {
          try {
            const data = await view.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
            if (settled) return;
            bits.writeFile(target, data);
            settled = true;
            cleanup();
            notify(`PDF saved to ${target}`);
            bits.openPath?.(target);
            resolve('saved');
          } catch (e) {
            fail(`Could not write the PDF — ${errorText(e)}`);
          }
        })();
      }, 350);
    }, { once: true });
    view.addEventListener('did-fail-load', () => fail('The document could not be rendered for PDF export.'), { once: true });
    timeoutId = window.setTimeout(() => fail('PDF export timed out.'), 20_000);
    document.body.appendChild(view);
  });
}

/** The way out where there is no Electron: the browser's own print dialogue, which can save a PDF too. */
export function printViaDialog(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  }, 400);
}
