/**
 * Prompts: ready-to-paste briefs about a task's (or project's) subject, for the
 * Claude app or CLI. Each is a small note in the vault so it is indexed,
 * attached to its target like a drawing, and trashable. Five angles, so the
 * second prompt on a subject is not the first one again.
 */
import { parseDocument } from './document';
import { scalar } from './frontmatter';
import type { IsoDate } from './types';

export type PromptAngle = 'deep-dive' | 'plan' | 'options' | 'learn' | 'checklist';

export const PROMPT_ANGLES: { id: PromptAngle; label: string; icon: string; hint: string }[] = [
  { id: 'deep-dive', label: 'Deep dive', icon: 'telescope', hint: 'understand the subject properly: concepts, how it works, sources' },
  { id: 'plan', label: 'Action plan', icon: 'list-checks', hint: 'a concrete step-by-step plan to get it done' },
  { id: 'options', label: 'Options & trade-offs', icon: 'git-compare', hint: 'the realistic alternatives compared, with a recommendation' },
  { id: 'learn', label: 'Learn it', icon: 'graduation-cap', hint: 'a tutor that teaches, then quizzes' },
  { id: 'checklist', label: 'Checklist & pitfalls', icon: 'shield-alert', hint: 'what to check and what goes wrong' },
];

export interface Prompt {
  path: string;
  title: string;
  n: number;
  angle: PromptAngle;
  text: string;
  mtime?: number;
  taskIds: string[];
  projectRefs: string[];
  dates: IsoDate[];
  periodKeys: string[];
}

/** Build the prompt text for an angle from a subject brief (task or project plus context). */
export function buildPrompt(angle: PromptAngle, brief: string, opts: { extra?: string } = {}): string {
  const common = [
    'Be concrete and specific to this subject; no generic advice. Prefer current, primary sources and say when something is uncertain or depends on my situation. Keep it tight: headings and short bullets, no preamble.',
    ...(opts.extra?.trim() ? [`Extra instructions: ${opts.extra.trim()}`] : []),
  ];
  const body: Record<PromptAngle, string[]> = {
    'deep-dive': [
      'I want to properly understand the subject below before I act on it.',
      'Give me:',
      '1. What it is and why it matters — two or three sentences.',
      '2. The key concepts and terms I need, each in one line.',
      '3. How it actually works in practice: the moving parts and how they connect.',
      '4. What people commonly get wrong or underestimate.',
      '5. The 3–5 best sources to go deeper (official docs, standards, one strong write-up), with one line on what each is good for.',
      '6. Three questions I should be able to answer afterwards, with the answers.',
    ],
    plan: [
      'Turn the subject below into a plan I can execute.',
      'Give me:',
      '1. The outcome, stated precisely (what “done” looks like).',
      '2. Prerequisites and what to gather or decide first.',
      '3. Steps in order, each with an effort estimate (minutes or hours), what it produces, and how I verify it worked.',
      '4. Where it can stall, and what to do then.',
      '5. A compact version of the plan I can paste into my task manager as subtasks (one line each).',
    ],
    options: [
      'Lay out the realistic ways to approach the subject below.',
      'Give me:',
      '1. The 3–5 real options (not strawmen), one paragraph each.',
      '2. A comparison table: cost, time, effort, risk, fit for my context, reversibility.',
      '3. The one you would pick for me and why, plus the condition under which you would switch.',
      '4. What I would need to find out to be sure.',
    ],
    learn: [
      'Act as a tutor for the subject below.',
      'First give me a lesson of at most 400 words that a smart beginner can follow, built around one concrete example. Then quiz me: five questions from easy to hard, one at a time, waiting for my answer before the next, correcting me briefly when I am wrong. End with a one-paragraph summary I can keep.',
    ],
    checklist: [
      'I am about to work on the subject below. Give me a checklist and the pitfalls.',
      'Give me:',
      '1. Before I start: things to check, have, or decide (checkbox list).',
      '2. While doing it: the steps where mistakes happen and the tell-tale signs.',
      '3. Afterwards: how I verify it is right, and what to clean up or record.',
      '4. The three mistakes people make most often on this, and how to avoid each.',
    ],
  };
  return [...body[angle], '', ...common, '', 'SUBJECT', brief.trim()].join('\n');
}

export const PROMPT_FILE_SUFFIX = ' — prompt ';

export function renderPromptNote(o: { n: number; angle: PromptAngle; text: string; target: Record<string, string>; today: IsoDate; subject: string }): string {
  const fm = ['---', `helm-prompt: ${o.n}`, `helm-prompt-angle: ${o.angle}`, ...Object.entries(o.target).map(([k, v]) => `${k}: ${v}`), `created: ${o.today}`, 'tags: [helm-prompt]', '---'];
  const label = PROMPT_ANGLES.find((a) => a.id === o.angle)?.label ?? o.angle;
  return [...fm, '', `# Prompt ${o.n} · ${label}`, '', `> For: ${o.subject}`, '', '```', o.text, '```', ''].join('\n');
}

export function isPromptNote(content: string): boolean { return /^---[\s\S]*?\nhelm-prompt:\s*\d+[\s\S]*?\n---/.test(content); }

const list = (v: unknown): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : String(v).trim() === '' ? [] : [String(v).trim()]);

export function parsePromptNote(path: string, content: string, mtime?: number): Prompt | undefined {
  const doc = parseDocument(content);
  const fm = doc.frontmatter.values;
  const n = Number(scalar(fm['helm-prompt']) ?? '');
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const angle = (scalar(fm['helm-prompt-angle']) ?? 'deep-dive') as PromptAngle;
  const m = /```\n([\s\S]*?)\n```/.exec(content);
  return {
    path, title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''), n, angle: PROMPT_ANGLES.some((a) => a.id === angle) ? angle : 'deep-dive', text: m?.[1] ?? '',
    ...(mtime !== undefined ? { mtime } : {}),
    taskIds: list(fm['helm-task']), projectRefs: list(fm['helm-project']).map((x) => x.replace(/^\[\[|\]\]$/g, '')), dates: list(fm['helm-date']), periodKeys: list(fm['helm-period']),
  };
}
