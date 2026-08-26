import { describe, expect, it } from 'vitest';
import { parseDrawing, renderExcalidrawDocument, drawingTitle, isDrawingPath, sanitiseElementIds } from '../../src/core/drawing';

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
  it('writes a valid Excalidraw document with blank-line separated text elements', () => {
    const doc = renderExcalidrawDocument({ elements: [{ id: 'a1b2c3d4e5', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }, { id: 'b1b2c3d4e5', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'Week 35' }, { id: 'c1b2c3d4e5', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'Two\nlines' }], frontmatter: { 'helm-period': '2026-W35' } });
    expect(doc).toContain('helm-period: 2026-W35');
    expect(doc).toContain('excalidraw-plugin: parsed');
    expect(doc).toContain('## Text Elements\nWeek 35 ^b1b2c3d4e5\n\nTwo\nlines ^c1b2c3d4e5\n');
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(doc)![1]!) as { elements: unknown[] };
    expect(json.elements).toHaveLength(3);
  });
});


describe('element ids', () => {
  it('gives imported elements opaque fixed-length ids and follows every reference', () => {
    const els = sanitiseElementIds([
      { id: 'stat_done', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, boundElements: [{ type: 'text', id: 'stat_done.txt' }] },
      { id: 'stat_done.txt', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '40', containerId: 'stat_done' },
      { id: 'title', type: 'ellipse', x: 0, y: 0, width: 1, height: 1 },
      { id: 'subtitle', type: 'arrow', x: 0, y: 0, width: 1, height: 1, startBinding: { elementId: 'stat_done', focus: 0, gap: 1 }, endBinding: { elementId: 'title', focus: 0, gap: 1 } },
    ] as never);
    const ids = els.map((e) => e.id);
    expect(ids.every((id) => /^h[a-z0-9]{9}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect((els[0]!['boundElements'] as { id: string }[])[0]!.id).toBe(ids[1]);
    expect(els[1]!['containerId']).toBe(ids[0]);
    expect((els[3]!['startBinding'] as { elementId: string }).elementId).toBe(ids[0]);
    expect((els[3]!['endBinding'] as { elementId: string }).elementId).toBe(ids[2]);
    // Already-clean ids are left alone; a rendered document never carries the skill's ids.
    expect(sanitiseElementIds(els)).toBe(els);
    const doc = renderExcalidrawDocument({ elements: [{ id: 'a_b', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'hi' }] });
    expect(doc).toMatch(/hi \^h[a-z0-9]{9}\n/);
    expect(doc).not.toContain('a_b');
  });
});

