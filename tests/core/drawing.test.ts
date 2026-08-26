import { describe, expect, it } from 'vitest';
import { parseDrawing, renderExcalidrawDocument, drawingTitle, isDrawingPath, parseExcalidrawScene, sanitiseElementIds } from '../../src/core/drawing';
import { layoutDiagram, parseDiagramSpec, KIND_SCHEMAS } from '../../src/core/diagram';
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
    expect(entries.every((e) => /\^h[a-z0-9]{9}$/.test(e.trim()))).toBe(true);
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

describe('diagram kinds', () => {
  const texts = (els: { type: string; text?: unknown }[]): string[] => els.filter((e) => e.type === 'text').map((e) => String(e.text));
  const arrows = (els: { type: string }[]): number => els.filter((e) => e.type === 'arrow').length;
  it('hub: centre, spokes with arrows from the centre, flow with arrows, sources', () => {
    const spec = parseDiagramSpec(JSON.stringify({ kind: 'hub', title: 'OCI networking', summary: 'S', center: 'VCN', spokes: [{ name: 'Subnets', detail: 'public or private' }, { name: 'DRG' }, { name: 'Route tables' }], flow: ['Create VCN', 'Add subnets', 'Attach DRG'], sources: ['OCI docs'], highlights: ['DRG is regional'] }))!;
    expect(spec.kind).toBe('hub');
    const els = layoutDiagram(spec);
    expect(texts(els)).toEqual(expect.arrayContaining(['VCN', 'Subnets', 'public or private', 'How it works', '1. Create VCN', 'Sources', 'OCI docs', 'Easy to get wrong', 'DRG is regional']));
    expect(arrows(els)).toBe(3 + 2);
    const a = els.find((e) => e.type === 'arrow') as unknown as { startBinding: { elementId: string }; endBinding: { elementId: string } };
    expect(els.some((e) => e.id === a.startBinding.elementId && e.type === 'rectangle')).toBe(true);
    expect(els.some((e) => e.id === a.endBinding.elementId)).toBe(true);
    const hub = els.find((e) => e.id === a.startBinding.elementId)!;
    expect((hub['boundElements'] as { type: string }[]).filter((b) => b.type === 'arrow')).toHaveLength(3);
  });
  it('flow: prerequisites, ordered steps with effort and verify, arrows between consecutive steps, stalls', () => {
    const els = layoutDiagram(parseDiagramSpec(JSON.stringify({ kind: 'flow', title: 'Get certified', summary: 'passed exam', before: ['Partner email'], steps: [{ title: 'Book exam', effort: '15m', verify: 'confirmation mail' }, { title: 'Study', effort: '10h' }, { title: 'Sit exam' }, { title: 'Renew' }, { title: 'Brag' }], stalls: ['No slots → try another centre'] }))!);
    expect(texts(els)).toEqual(expect.arrayContaining(['Done = passed exam', 'Before you start', 'Partner email', '1. Book exam\n⏱ 15m\n✓ confirmation mail', '5. Brag', 'Where it stalls']));
    expect(arrows(els)).toBe(4);
    // The arrow that wraps from the end of row one to the start of row two is routed with elbows, not a diagonal.
    const wrapArrow = (els.filter((e) => e.type === 'arrow') as unknown as { points: number[][] }[])[3]!;
    expect(wrapArrow.points).toHaveLength(4);
    expect(wrapArrow.points[1]![0]).toBe(0);
  });
  it('matrix: options across, criteria down, cells, the pick highlighted', () => {
    const els = layoutDiagram(parseDiagramSpec(JSON.stringify({ kind: 'matrix', title: 'Which cert first', options: ['NCA-AIIO', 'NCA-GENL'], criteria: ['cost', 'time'], cells: [['$125', '$125'], ['60 min', '60 min']], pick: { option: 'NCA-GENL', why: 'closest to daily work' }, next: ['Check voucher'] }))!);
    const t = texts(els);
    expect(t).toEqual(expect.arrayContaining(['NCA-AIIO', 'NCA-GENL', 'cost', 'time', '$125', '60 min', 'Pick: NCA-GENL — closest to daily work', 'To be sure, find out', 'Check voucher']));
    const rects = els.filter((e) => e.type === 'rectangle') as unknown as { backgroundColor: string }[];
    expect(rects.filter((r) => r.backgroundColor === '#e6fcf5')).toHaveLength(2); // the picked column's cells
  });
  it('checklist: three columns of ☐ items, pitfalls under During, mistakes strip', () => {
    const els = layoutDiagram(parseDiagramSpec(JSON.stringify({ kind: 'checklist', title: 'Before the exam', before: ['ID ready'], during: [{ step: 'Read twice', pitfall: 'skimming' }], after: ['Save certificate'], mistakes: ['Late → no refund'] }))!);
    expect(texts(els)).toEqual(expect.arrayContaining(['Before', 'During', 'After', '☐ ID ready', '☐ Read twice', '⚠ skimming', '☐ Save certificate', 'Most common mistakes', 'Late → no refund']));
  });
  it('lesson: worked example with arrows, terms, quiz cards with answers, summary box', () => {
    const els = layoutDiagram(parseDiagramSpec(JSON.stringify({ kind: 'lesson', title: 'RAG in one lesson', summary: 'Retrieve, then generate.', example: ['Chunk docs', 'Embed', 'Retrieve top-k', 'Generate'], terms: [{ term: 'Embedding', meaning: 'vector of meaning' }], quiz: [{ q: 'What is top-k?', a: 'the k nearest chunks' }] }))!);
    expect(texts(els)).toEqual(expect.arrayContaining(['Worked example', '1. Chunk docs', '4. Generate', 'Terms', 'Embedding — vector of meaning', 'Quiz yourself', 'Q1. What is top-k?', 'A: the k nearest chunks', 'Retrieve, then generate.']));
    expect(arrows(els)).toBe(3);
  });
  it('an unknown or missing kind falls back to columns; every kind has a schema', () => {
    expect(parseDiagramSpec('{"kind":"weird","title":"x","themes":[{"name":"A","items":["y"]}]}')!.kind).toBeUndefined();
    expect(Object.keys(KIND_SCHEMAS)).toEqual(['columns', 'hub', 'flow', 'matrix', 'checklist', 'lesson']);
    expect(parseDiagramSpec('{"kind":"flow","title":"x"}')).toBeUndefined();
  });
});
