import { describe, expect, it } from 'vitest';
import { derivedKey, hash, randomId, slugify, uniqueId } from '../../src/core/ids';

describe('ids (CD-10)', () => {
  it('random ids carry their prefix and draw from the alphabet', () => {
    let i = 0;
    const rng = (): number => [0, 0.999, 0.5][i++ % 3]!;
    expect(randomId('tsk', 6, rng)).toBe('tsk-a9sa9s');
    expect(randomId('prj')).toMatch(/^prj-[a-z0-9]{6}$/);
  });

  it('unique ids skip taken ones, grow longer when crowded, and give up eventually', () => {
    const taken = new Set(['tsk-aaaaaa']);
    expect(uniqueId('tsk', (id) => taken.has(id), () => 0.5)).toBe('tsk-ssssss');
    let calls = 0;
    const id = uniqueId('tsk', (x) => { calls++; return x.length === 10; }, () => 0);
    expect(id).toBe('tsk-aaaaaaaa');
    expect(calls).toBe(21);
    expect(() => uniqueId('tsk', () => true)).toThrow('Could not generate a unique id');
  });

  it('hashes deterministically', () => {
    expect(hash('')).toBe(hash(''));
    expect(hash('abc')).not.toBe(hash('abd'));
    expect(hash('abc')).toMatch(/^[0-9a-z]{7}$/);
  });

  it('derives a key from the file, the occurrence and the trimmed text', () => {
    expect(derivedKey('a.md', 0, ' Buy milk ')).toBe(derivedKey('a.md', 0, 'Buy milk'));
    expect(derivedKey('a.md', 1, 'Buy milk')).not.toBe(derivedKey('a.md', 0, 'Buy milk'));
    expect(derivedKey('b.md', 0, 'Buy milk')).not.toBe(derivedKey('a.md', 0, 'Buy milk'));
    expect(derivedKey('a.md', 0, 'x')).toMatch(/^d:/);
  });

  it('slugs', () => {
    expect(slugify('Phase: Outline & Plan!')).toBe('phase-outline-plan');
    expect(slugify('Ünïcode 2026')).toBe('u-ni-code-2026'); // combining marks split words: phase ids already depend on it
    expect(slugify('***')).toBe('untitled');
  });
});
