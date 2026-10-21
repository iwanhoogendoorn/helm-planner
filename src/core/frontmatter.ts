/**
 * A deliberately small YAML reader/writer for note frontmatter.
 *
 * Reads: `key: scalar`, `key: [a, b]`, `key:` followed by `  - item` lines,
 * quoted strings, `[[wikilinks]]`. Everything else is kept as raw text and
 * written back untouched. Writes change only the lines of the keys they set.
 */

export interface Frontmatter {
  /** Parsed values: string, string[] or null (empty). */
  values: Record<string, string | string[] | null>;
  /** Raw lines between the `---` fences, without the fences. */
  lines: string[];
  /** Index of the line after the closing fence (0 when no frontmatter). */
  endLine: number;
  present: boolean;
  eol: string;
}

const KEY_RE = /^([A-Za-z0-9_][\w .-]*?):(?:\s+(.*?))?\s*$/;

export function splitLines(content: string): { lines: string[]; eol: string } {
  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/g) ?? []).length;
  const eol = crlf > lf ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  return { lines, eol };
}

export function parseFrontmatter(lines: string[], eol = '\n'): Frontmatter {
  const fm: Frontmatter = { values: {}, lines: [], endLine: 0, present: false, eol };
  if (lines[0]?.trim() !== '---') return fm;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---' || lines[i]!.trim() === '...') { close = i; break; }
  }
  if (close === -1) return fm;
  fm.present = true;
  fm.endLine = close + 1;
  fm.lines = lines.slice(1, close);
  let i = 0;
  while (i < fm.lines.length) {
    const line = fm.lines[i]!;
    const m = KEY_RE.exec(line);
    if (!m || /^\s/.test(line)) { i++; continue; }
    const key = m[1]!;
    const rawVal = m[2];
    // A block scalar (`|` or `>`, with any chomping/indent indicator): its value is the indented lines below.
    if (rawVal !== undefined && /^[|>][+-]?\d*(?:\s+#.*)?$/.test(rawVal)) {
      let j = i + 1;
      const body: string[] = [];
      while (j < fm.lines.length && (fm.lines[j]!.trim() === '' || /^\s/.test(fm.lines[j]!))) body.push(fm.lines[j++]!);
      while (body.length > 0 && body[body.length - 1]!.trim() === '') body.pop();
      const indent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length));
      const text = body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      fm.values[key] = rawVal.startsWith('|') ? text.join('\n') : text.map((l) => l.trim()).join(' ').replace(/ {2,}/g, ' ').trim();
      i = j;
      continue;
    }
    if (rawVal === undefined || rawVal === '') {
      // Block list?
      const items: string[] = [];
      let j = i + 1;
      while (j < fm.lines.length && /^\s+-\s*/.test(fm.lines[j]!)) {
        items.push(unquote(fm.lines[j]!.replace(/^\s+-\s*/, '')));
        j++;
      }
      if (items.length > 0) { fm.values[key] = items; i = j; continue; }
      fm.values[key] = null;
      i++;
      continue;
    }
    if (rawVal.startsWith('[') && rawVal.endsWith(']') && !rawVal.startsWith('[[')) {
      const inner = rawVal.slice(1, -1).trim();
      fm.values[key] = inner === '' ? [] : splitInline(inner).map(unquote);
    } else fm.values[key] = unquote(rawVal);
    i++;
  }
  return fm;
}

function splitInline(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let q: string | null = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

const ESCAPES: Record<string, string> = { '\\': '\\', '"': '"', '/': '/', n: '\n', r: '\r', t: '\t', '0': '\0' };

/** The inverse of `yamlScalar`: escapes undone inside "…", `''` inside '…', an inline ` # comment` dropped from a plain value. */
export function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, (all, c: string) => ESCAPES[c] ?? all);
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t.replace(/\s+#.*$/, '');
}

/** First scalar of a value that may be a list. */
export function scalar(v: string | string[] | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v[0]?.trim() || undefined;
  return v.trim() || undefined;
}

export function list(v: string | string[] | null | undefined): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean);
  return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function needsQuotes(v: string): boolean {
  return v === '' || /^[\s#&*!|>'"%@`{}[\],?:-]/.test(v) || /:\s/.test(v) || /\s#/.test(v) || /\s$/.test(v) || v.startsWith('[[') || /[\u0000-\u001f\u007f]/.test(v);
}

/** One YAML scalar on one line: a value that would break the line (a newline, a control character) is escaped inside quotes, never written raw. */
export function yamlScalar(v: string): string {
  if (!needsQuotes(v)) return v;
  const esc = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\u0000-\u001f\u007f]/g, '');
  return `"${esc}"`;
}

/** The line after a key's value: past its block-list items, or a block scalar's (or nested map's) indented lines. */
function valueEnd(body: string[], idx: number): number {
  const block = /:\s*[|>]/.test(body[idx]!);
  let end = idx + 1;
  for (let j = idx + 1; j < body.length; j++) {
    if (/^\s+\S/.test(body[j]!)) end = j + 1;
    else if (!(block && body[j]!.trim() === '')) break; // a blank line belongs to a block scalar only when more of it follows
  }
  return end;
}

/**
 * Set keys in a note's frontmatter, creating the frontmatter when absent.
 * Returns the new full line array. Only the touched keys' lines change;
 * an existing block-list value is replaced by a scalar or list as given.
 */
export function setFrontmatter(lines: string[], updates: Record<string, string | string[] | null | undefined>): string[] {
  const fm = parseFrontmatter(lines);
  const body = fm.present ? [...fm.lines] : [];
  const render = (key: string, v: string | string[] | null): string[] => {
    if (v === null) return [`${key}:`];
    if (Array.isArray(v)) return v.length === 0 ? [`${key}: []`] : [`${key}:`, ...v.map((x) => `  - ${yamlScalar(x)}`)];
    return [`${key}: ${yamlScalar(v)}`];
  };
  for (const [key, v] of Object.entries(updates)) {
    let idx = -1;
    for (let i = 0; i < body.length; i++) {
      const m = KEY_RE.exec(body[i]!);
      if (m && !/^\s/.test(body[i]!) && m[1] === key) { idx = i; break; }
    }
    // `undefined` removes the key (and its list items); `null` keeps it with an empty value.
    if (v === undefined) {
      if (idx === -1) continue;
      body.splice(idx, valueEnd(body, idx) - idx);
      continue;
    }
    if (idx === -1) { body.push(...render(key, v)); continue; }
    const end = valueEnd(body, idx);
    body.splice(idx, end - idx, ...render(key, v));
  }
  // Nothing left in the block: drop it rather than leave an empty `---` pair behind.
  if (body.every((l) => l.trim() === '')) { const rest = fm.present ? lines.slice(fm.endLine) : [...lines]; while (rest.length > 0 && rest[0]!.trim() === '') rest.shift(); return rest; }
  if (fm.present) return ['---', ...body, '---', ...lines.slice(fm.endLine)];
  return ['---', ...body, '---', ...lines];
}
