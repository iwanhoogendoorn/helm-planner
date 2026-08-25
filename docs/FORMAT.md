# Helm — on-disk format

Everything Helm reads and writes. Version 1.

## 1. Task lines

Standard Obsidian Tasks emoji format. Any list bullet (`-`, `*`, `+`, `1.`)
followed by `[x]` is a task line.

| Marker | Status | Terminal |
|---|---|---|
| `[ ]` | todo | |
| `[/]` | in progress | |
| `[x]` `[X]` | done | yes |
| `[-]` | cancelled | yes |
| `[>]` | forwarded (moved to another day) | |
| `[?]` | waiting on someone | |
| other | todo (marker preserved) | |

| Symbol | Field |
|---|---|
| `🆔 tsk-xxxxxx` | id (assigned by Helm when first needed) |
| `➕ YYYY-MM-DD` | created |
| `🛫 YYYY-MM-DD` | start — not actionable before |
| `⏳ YYYY-MM-DD` | scheduled — the day it is planned on |
| `📅 YYYY-MM-DD` | due |
| `✅` / `❌ YYYY-MM-DD` | done / cancelled on |
| `🔺 ⏫ 🔼 🔽 ⏬` | priority highest · high · medium · low · lowest |
| `🔁 every week on monday` | recurrence (Obsidian Tasks phrasing, `when done` supported) |
| `⛔ tsk-a, tsk-b` | blocked by |
| `⏱️ 1h30m` | effort estimate (Helm extension) |
| `🔗 [[Note]]` | this line mirrors a task in *Note* (Helm extension) |

A leading `HH:MM` or `HH:MM - HH:MM:` in the text is a **time block**.

Text is everything before the first *usable* symbol (a symbol whose value
parses). Anything unrecognised after that is kept verbatim and re-emitted.
Untouched lines round-trip byte for byte. Lines Helm rewrites use the
canonical order: text · 🆔 · ➕ · 🛫 · ⏳ · 📅 · priority · 🔁 · ⛔ · 🔗 · ⏱️ ·
unknown tokens · ✅/❌.

Subtasks are indentation (tab = 2 columns, space = 1; equal width = siblings).
Fenced code blocks are inert.

## 2. Project notes

A note whose frontmatter has `type: project` (also accepts `type: Project Note`).
Helm creates `<projectsFolder>/<Name>/<Name>.md`.

```yaml
type: project
id: prj-xxxxxx          # assigned on creation; a derived id is used if missing
title: …
status: active          # idea planned active on-hold done cancelled archived (synonyms accepted: completed, paused, someday…)
priority: normal        # low normal medium high urgent critical
area: …                 # free text
parent: Umbrella Title  # optional; else the folder tree decides
start_date: / due_date: # also read: start, due, deadline, target_date
tags: [...]
```

List-valued scalars (`status:\n  - active`) are read; the first item counts.
Unknown keys are preserved.

**Phases**: a heading `## Phase: Title` (also `Fase:`, `Stage:`, `Milestone:`,
any heading level) optionally ending in `📅 YYYY-MM-DD`. A phase owns the task
lines until the next heading of the same or higher level. Phase id =
`<projectId>#<slug>`; status is derived from its tasks.

**Loose tasks**: task lines outside every phase. New ones go under a heading
called `Tasks` (created at the end of the note when missing).

**Children**: a project inside another project's folder is its child; a
`parent:` key wins over the folder tree. Cycles are ignored.

**Log**: `appendLog` writes `- YYYY-MM-DD — text` under a heading called
`Log`, `Journal` or `Notes`, creating `## Log` at the end when missing.

## 3. Daily notes

Located via the Daily Notes / Periodic Notes settings (folder + moment
format), or the plugin settings when set. The date of a note is parsed from
its path with the same format.

The Helm region:

```markdown
%% helm:start %%
## Plan
### Habits
- [x] 🏃 Morning workout 🆔 hab-xxxxxx ✅ 2026-08-27
### Today
- [ ] Standalone task ⏱️ 30m
### From projects
- [ ] Mirror of a project task 🆔 tsk-xxxxxx 📅 2026-09-30 🔗 [[Project]]
%% helm:end %%
```

- Sections appear in this order; empty sections are omitted.
- Unrecognised lines inside the region are kept, below the sections.
- Nothing outside the markers is ever written by Helm.
- A start marker without an end marker makes the note read-only for Helm.
- A note without markers gets them on first write, placed per the
  **regionPlacement** setting (before the first heading by default).
- Task lines outside the region are indexed as daily tasks with
  `section: outside`; lines with a time block and no text (empty planner
  slots) are ignored.

**Mirror lines** carry the source's `🆔`, text, priority, due, recurrence,
effort and time block plus `🔗 [[Source note]]`. They never carry `⏳` (the
note *is* the date). Their index key is `<id>@<date>`.

**Sync**: status — the more advanced wins (`todo < doing < waiting <
forwarded < cancelled < done`); everything else source → mirror, and only
for today and later. Past notes are never rewritten by sync.

## 4. Habits

```yaml
type: habit
id: hab-xxxxxx
title: Morning workout
schedule: every weekday      # Obsidian Tasks phrasing or RRULE:FREQ=…;BYDAY=…
active: true
target_per_week: 4           # optional
grace_days: 1                # misses tolerated before a streak breaks
icon: 🏃                     # optional
```

Completions are lines in `### Habits` carrying the habit id: `[x]` done,
`[-]` skipped (neutral), anything else a miss. The completion date is the
note's date.

## 5. Inbox

Any note; default `01 INBOX/Inbox.md`. Captures without a date or project are
appended. Planning an inbox task onto a day moves the line (with its subtree)
into that day's `### Today`.

## 6. Ids

`tsk-` / `prj-` / `hab-` + 6 lowercase base36 characters, random, checked for
collisions against the index at generation time. A line without a `🆔` is
keyed by a hash of (path, line, text) that changes when the line moves.

## 7. Diagnostics

| Code | Meaning |
|---|---|
| HELM-P01 | project without `id` |
| HELM-P02 | unknown project status |
| HELM-P03 | duplicate phase title in one note |
| HELM-P04 | duplicate project id |
| HELM-P05 / P06 | `parent:` ambiguous / not found |
| HELM-T01 | duplicate task id |
| HELM-D01 | daily note region has no end marker |
| HELM-M01 | mirror line points at an unknown task |
