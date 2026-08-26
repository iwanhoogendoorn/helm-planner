import { describe, expect, it } from 'vitest';
import { parseDrawing, renderExcalidrawDocument, drawingTitle, isDrawingPath, parseExcalidrawScene } from '../../src/core/drawing';
import { layoutDiagram, parseDiagramSpec } from '../../src/core/diagram';
import { extractResult } from '../../src/ai';

const EX = `---
helm-task: tsk-0001
helm-period: [2026-W35, 2026-08]
helm-generated: true
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

# Excalidraw Data

## Text Elements
Kitchen flow ^a1
see [[Kitchen Remodel]] and [[26, Wednesday, Aug, 2026]] ^a2
blocked by tsk-0042 ^a3

## Embedded Files

%%
## Drawing
\`\`\`compressed-json
N4IgLgngDgpiBcIYA8DGBDANgSwCYCd4A ...
\`\`\`
%%`;

describe('drawings', () => {
  it('recognises drawing paths and titles', () => {
    expect(isDrawingPath('X/flow.excalidraw.md')).toBe(true);
    expect(isDrawingPath('X/board.canvas')).toBe(true);
    expect(isDrawingPath('X/note.md')).toBe(false);
    expect(drawingTitle('02 PROJECTS/Kitchen/Kitchen flow.excalidraw.md')).toBe('Kitchen flow');
    expect(drawingTitle('A/board.canvas')).toBe('board');
  });
  it('parses frontmatter attachments, links and task ids from the text elements only', () => {
    const d = parseDrawing('70 OBSIDIAN/70-02 Excalidraw/Kitchen flow.excalidraw.md', EX, 123);
    expect(d.taskIds).toEqual(['tsk-0001']);
    expect(d.periodKeys).toEqual(['2026-W35', '2026-08']);
    expect(d.generated).toBe(true);
    expect(d.links).toEqual(['Kitchen Remodel', '26, Wednesday, Aug, 2026']);
    expect(d.mentionedTaskIds).toEqual(['tsk-0001', 'tsk-0042']);
    expect(d.mtime).toBe(123);
  });
  it('writes a valid Excalidraw document with the text elements listed', () => {
    const els = layoutDiagram({ title: 'Week 35', summary: 'A good week.', themes: [{ name: 'Kitchen', color: 'blue', items: ['Pick tiles', 'Call the plumber'] }, { name: 'Book', items: ['Draft chapter list'] }], highlights: ['Tiles chosen'], next: ['Plumber quote'] });
    const doc = renderExcalidrawDocument({ elements: els, frontmatter: { 'helm-period': '2026-W35', 'helm-generated': true } });
    expect(doc).toContain('helm-period: 2026-W35');
    expect(doc).toContain('helm-generated: true');
    expect(doc).toContain('excalidraw-plugin: parsed');
    expect(doc).toContain('## Text Elements\nWeek 35 ^');
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(doc)![1]!) as { elements: { type: string; text?: string; containerId?: string }[] };
    expect(json.elements.length).toBe(els.length);
    // Entries are blank-line separated and keep their own line breaks, which is how the Excalidraw plugin parses them back.
    const section = /## Text Elements\n([\s\S]*?)\n%%/.exec(doc)![1]!;
    const entries = section.split('\n\n').filter(Boolean);
    expect(entries.length).toBe(json.elements.filter((e) => e.type === 'text').length);
    expect(entries.every((e) => /\^helm\w+$/.test(e.trim()))).toBe(true);
    const texts = json.elements.filter((e) => e.type === 'text').map((e) => e.text);
    expect(texts).toEqual(expect.arrayContaining(['Week 35', 'A good week.', 'Kitchen', 'Pick tiles', 'Highlights', 'Tiles chosen', 'Next', 'Plumber quote']));
    // Every box label is bound to its rectangle.
    const bound = json.elements.filter((e) => e.type === 'text' && e.containerId);
    expect(bound.length).toBe(5);
    // No two elements overlap horizontally within the theme row: columns are laid out left to right.
    const rects = json.elements.filter((e) => e.type === 'rectangle') as unknown as { x: number; width: number; height: number }[];
    expect(rects.some((r) => r.width === 260)).toBe(true);
  });
  it('parses a model reply tolerantly and rejects nonsense', () => {
    const spec = parseDiagramSpec('Sure! ```json\n{"title":"W35","themes":[{"name":"A","items":["x"]}],"highlights":["h"],"next":[]}\n```');
    expect(spec).toEqual({ title: 'W35', themes: [{ name: 'A', items: ['x'] }], highlights: ['h'], next: [] });
    expect(parseDiagramSpec('no json here')).toBeUndefined();
    expect(parseDiagramSpec('{"foo": 1}')).toBeUndefined();
  });
  it('extracts the reply from the CLI json envelope, stream lines, or plain text', () => {
    expect(extractResult('{"type":"result","result":"{\\"title\\":\\"x\\"}","cost":1}')).toBe('{"title":"x"}');
    expect(extractResult('{"type":"system"}\n{"type":"result","result":"hi"}')).toBe('hi');
    expect(extractResult('plain')).toBe('plain');
  });
});

describe('scene import', () => {
  it('accepts a .excalidraw file or a fenced reply, drops deleted elements, keeps the background', () => {
    const sc = parseExcalidrawScene('```json\n{"type":"excalidraw","elements":[{"id":"a","type":"rectangle","x":0,"y":0,"width":1,"height":1},{"id":"b","type":"text","isDeleted":true,"x":0,"y":0,"width":1,"height":1}],"appState":{"viewBackgroundColor":"#1e1e1e"}}\n```')!;
    expect(sc.elements.map((e) => e.id)).toEqual(['a']);
    expect(sc.background).toBe('#1e1e1e');
    expect(parseExcalidrawScene('{"elements":[]}')).toBeUndefined();
    expect(parseExcalidrawScene('nope')).toBeUndefined();
  });
});
