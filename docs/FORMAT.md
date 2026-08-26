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
| `➕ YYYY-MM-DD` | created — written only when the *Stamp created date* setting is on |
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

The plan is made of the note's **own section headings**: the first heading
anywhere in the note whose text (after an optional `A.`-style prefix) is
Habits, Morning, Afternoon, Evening (also Tonight), or Anytime (also Today,
Tasks, From projects). Each section runs to the next heading of the same or
a higher level. Writes are line-level and never touch anything else in the
note. A missing section is created beside its siblings (Habits first,
Anytime last, at the siblings' heading level). Only a note with none of
these headings gets Helm's own block under the plan heading (`## Plan` by
default), which looks like:

```markdown
## Plan
### Habits
- [x] 🏃 Morning workout 🆔 hab-xxxxxx ✅ 2026-08-27
### Morning
- [ ] Mirror of a project task 🆔 tsk-xxxxxx 📅 2026-09-30 🔗 [[Project]]
### Afternoon
- [ ] Standalone task ⏱️ 30m
### Evening
### Anytime
- [ ] Another standalone task
```

- Sub-sections appear in this order; empty ones are omitted. `Today`,
  `Tasks`, `From projects` are read as *Anytime* (older notes).
- The sub-heading a line sits under is its **part of the day**.
- Unrecognised lines inside the section are kept, below the parts.
- Nothing outside the section is ever written by Helm.
- A note without the heading gets it on first write, placed per the
  **regionPlacement** setting (before the first heading by default).
- Legacy `%% helm:start %%` … `%% helm:end %%` markers are still read; the
  next write replaces them with the plain heading form. A start marker
  without an end marker makes the note read-only for Helm.
- Task lines outside the section are indexed as daily tasks with
  `section: outside`, their part derived from a leading time block (`morningEnds`
  / `afternoonEnds` settings); empty planner slots are ignored.

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
icon: 🏃                     # optional emoji
icon_image: 02 PROJECTS/Habits/icons/Morning workout.png   # optional; uploaded PNGs land here
```

When both are set the image wins. Uploads are stored as-is (a 256×256 PNG
from flaticon works nicely) under `<habits folder>/icons/`.

Completions are lines in `### Habits` carrying the habit id: `[x]` done,
`[-]` skipped (neutral), anything else a miss. The completion date is the
note's date.

## 5. Horizons: goals and periods

**Periods** are keys: `2026` (year), `2026-Q3` (quarter), `2026-08` (month), `2026-W35` (ISO week).
Read leniently (`Q3 2026`, `Aug 2026`, `08-2026`), always written in that
canonical form.

**Periodic notes** are located via the Periodic Notes plugin (yearly /
quarterly / monthly / weekly folder + moment format; defaults `YYYY`,
`YYYY-[Q]Q`, `YYYY-MM`, `gggg-[W]ww`) or the plugin settings. A week belongs
to the month, quarter and year its Thursday falls in (ISO). A note's period is parsed from its path.

**Goals** are depth-0 task lines under the goals heading (`## Goals` by
default; `Objectives` / `OKRs` also recognised) of a periodic note:

```markdown
- [ ] Publish the book 🆔 gol-xxxxxx ➕ 2026-08-26
```

Status follows the checkbox (`[x]` = achieved). Id prefix `gol-`. Everything
else in a periodic note is ignored by Helm.

**Project binding** — frontmatter on the project note:

| Key | Value |
|---|---|
| `period` (also read: `horizon`, `quarter`, `month`, `year`) | a period key |
| `goal` (also read: `goals`) | a goal's `🆔`, or its exact text / `[[link]]` |

A project bound to `2026-08` is also *within* `2026-Q3` and `2026`. Goal
progress = done/total tasks of the projects linked to it, or 100 % when the
goal line is ticked.

## 6. Inbox

Any note; default `01 INBOX/Inbox.md`. Captures without a date or project are
appended. Planning an inbox task onto a day moves the line (with its subtree)
into that day's `### Today`.

## 7. Ids

`tsk-` / `prj-` / `hab-` / `gol-` + 6 lowercase base36 characters, random, checked for
collisions against the index at generation time. A line without a `🆔` is
keyed by a hash of (path, line, text) that changes when the line moves.

## 8. Diagnostics

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
| HELM-P07 | project `period` not understood |
| HELM-G01 | project `goal` matches no goal line |
