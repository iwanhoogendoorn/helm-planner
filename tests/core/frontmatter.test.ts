import { describe, expect, it } from 'vitest';
import { parseFrontmatter, setFrontmatter, unquote, yamlScalar } from '../../src/core/frontmatter';

const read = (lines: string[], key: string): unknown => parseFrontmatter(lines).values[key];

describe('frontmatter scalar codec (CD-06)', () => {
  const values = ['C:\\x: y', '"quoted"', "it's", 'a\\b\\\\c', 'tab\there', 'two\nlines', 'x: y # not a comment', '#1 habit', '[[Link|Alias]]', 'plain', 'Fix bug #12', ' padded '];
  it('parse(set(x)) === x for awkward values', () => {
    for (const v of values) expect(read(setFrontmatter(['# body'], { k: v }), 'k')).toBe(v);
  });
  it('is stable over repeated read-then-write', () => {
    for (const v of values) {
      let lines = setFrontmatter(['# body'], { k: v });
      for (let i = 0; i < 3; i++) lines = setFrontmatter(lines, { k: read(lines, 'k') as string });
      expect(read(lines, 'k')).toBe(v);
    }
  });
  it('round-trips list items', () => {
    const items = ['C:\\temp', 'say "hi"', 'a: b'];
    let lines = setFrontmatter(['# body'], { k: items });
    lines = setFrontmatter(lines, { k: read(lines, 'k') as string[] });
    expect(read(lines, 'k')).toEqual(items);
  });
  it('undoes escapes the way YAML does', () => {
    expect(unquote('"C:\\\\temp"')).toBe('C:\\temp');
    expect(unquote('"say \\"hi\\""')).toBe('say "hi"');
    expect(unquote("'it''s'")).toBe("it's");
    expect(yamlScalar('C:\\temp')).toBe('C:\\temp'); // plain scalars carry no escapes
  });
});

describe('frontmatter reader (CD-12)', () => {
  it('drops an inline comment from a plain value', () => {
    expect(read(['---', 'title: a # comment', 'url: https://x.y/#frag', '---'], 'title')).toBe('a');
    expect(read(['---', 'url: https://x.y/#frag', '---'], 'url')).toBe('https://x.y/#frag');
    expect(read(['---', 'title: "a # kept"', '---'], 'title')).toBe('a # kept');
  });
  it('reads block scalars instead of their indicator', () => {
    const lines = ['---', 'x: >', '  folded', '  text', 'y: |-', '  line one', '', '  line two', 'z: 1', '---', 'body'];
    expect(read(lines, 'x')).toBe('folded text');
    expect(read(lines, 'y')).toBe('line one\n\nline two');
    expect(read(lines, 'z')).toBe('1');
  });
  it('replaces a block scalar whole, never leaving its lines behind', () => {
    const lines = ['---', 'x: |', '  one', '', '  two', 'z: 1', '---', 'body'];
    expect(setFrontmatter(lines, { x: 'new' })).toEqual(['---', 'x: new', 'z: 1', '---', 'body']);
    expect(setFrontmatter(lines, { x: undefined })).toEqual(['---', 'z: 1', '---', 'body']);
  });
});

describe('setFrontmatter (CD-11)', () => {
  it('never changes the caller\'s array', () => {
    const lines = ['', '', 'body'];
    const out = setFrontmatter(lines, { gone: undefined });
    expect(out).toEqual(['body']);
    expect(lines).toEqual(['', '', 'body']);
  });
});
