# Helm — design

Written the night of 2026-08-26, while rebuilding Task Command Center from
scratch. This records the decisions and the reasons, so they can be argued
with later.

## What was wrong with the previous plugin

Task Command Center (TCC) was a *lens* — five tabs of numbers, boards and
charts over the vault — and it was a good one. But it did not have a
**workflow**. It told you what existed; it did not walk you through a day.
The daily note was a target for mirror lines, not the centre of anything.
Phases needed a `> [!phase]` callout with three mandatory fields. Planning
was "set a date on a task". Nothing happened at the end of a day.

Helm keeps the sound parts (Obsidian Tasks format, project note canonical,
daily mirrors, habit completions in daily notes, everything rebuildable from
markdown) and replaces the surface with four rituals.

## The four rituals

| Ritual | When | What it does |
|---|---|---|
| **Plan day** | morning | Ranked candidates → pick → write the plan (habits, tasks, mirrors) into the daily note. Capacity bar keeps it honest. |
| **Work** | all day | Tick in Helm or in the note. Capture in one line. Drag across the week. Everything is one write to one line. |
| **Wrap up** | evening | For each open item: tomorrow / a date / off the calendar / done / cancelled. Past note keeps `[>]`. One optional line logged to every project touched. |
| **Review** | weekly | Throughput, overdue, inbox, stale projects, projects with no next action, habit streaks, done-by-project. A checklist with auto-ticked items. |

The Today tab is the cockpit for the first three. The Review tab is the fourth.
Week and Projects are the two maps you consult in between; Inbox is the
holding pen.

## Ownership rules

- **Project tasks live in the project note.** The daily note carries a mirror
  line (same `🆔`, plus `🔗 [[Project]]`). Status flows both ways; everything
  else flows project → mirror.
- **Standalone tasks live in the daily note** (`### Today`). Planning an inbox
  task *moves* it there. Rescheduling a daily task moves it to the other note.
- **Tasks in other notes** (extra folders, `Backlog Tasks.md`) stay where they
  are; planning them adds `⏳` and a mirror with `🔗 [[That note]]`.
- **Past daily notes are a log.** Nothing is deleted from them; moved lines
  become `[>]`. A tick on a past mirror still finishes the source (the more
  advanced status wins), but the past line is never rewritten by sync.
- **Ids are assigned lazily.** A line gets a `🆔` the first time it needs one
  (when it is mirrored). A vault full of bare `- [ ]` lines stays bare.

## Phases without ceremony

`## Phase: Name 📅 2026-09-15` is a phase. Its status is **derived**: done when
every non-cancelled task is done, active when any is done or in progress,
planned otherwise. The target date is optional and lives on the heading. The
old callout (`> [!phase] status:: … | target:: … | order:: …`) was three fields
a human had to keep true by hand; two of them were computable and the third
was document order.

`## Tasks` (any heading literally called Tasks) holds loose tasks. Anything
else with checkboxes is loose too. A note that already has `## Milestones`,
`## Deliverables`, dataview blocks — untouched, inert, fine.

## Next action

The one PM concept worth enforcing: every active project has a **next
action** — the first open, unblocked, startable leaf task in the first phase
that still has work, preferring one already in progress. Review flags active
projects without one. Plan day offers it. The project list shows it. An
umbrella (a project with child projects) is exempt when a child is active.

## Ranking candidates for a day

```
overdue         100 + days overdue (cap 30) + priority
due-soon         80 + closeness + priority
carried over     70 + priority (+2 in an active project)
in progress      60 + priority (+2)
next action      40 + project priority×2 + task priority
inbox            20 + priority
```

Blocked tasks, tasks with a future `🛫`, and parents whose children are still
open (unless the parent itself is dated) are never candidates.

## Capture grammar

Chosen to be typeable without thinking: dates as words, `!` for priority
(more bangs, more urgent), `@` for project, `~` for effort, `#` for tags,
times as times. The preview under the input shows the parse *and the
destination* before Enter.

## What Helm reads from Obsidian

Daily-note folder, format and template from `.obsidian/daily-notes.json`,
falling back to the Periodic Notes plugin. The user's own daily template
(`07:00 - 08:00:` slots, Templater tags) is honoured: time-slot lines with
text show as **time blocks** on Today; empty slots are ignored; when Helm has
to create a note it fills `{{date}}`, `tp.file.title`, `tp.date.now` and
strips other Templater tags rather than leaving raw code.

## Scope of the index

Helm indexes: the projects folder, the habits folder, the daily-note folder,
the inbox note, and any extra folders you list. Not the whole vault — the
vault this was built for has 141,000 checkbox lines in 29,000 notes, most of
them not tasks in any planning sense. Scope is a setting.

## Sync and loops

Every write updates the index synchronously, so the next step of the same
operation sees fresh line numbers. Obsidian's `modify` event re-parses the
file (250 ms debounce) and, 600 ms later, `reconcile()` compares every
mirror with its source and fixes disagreements. Writes that change nothing
are skipped, so the loop terminates.

## Not done, deliberately

- No kanban board. The week grid with drag-and-drop covers the "move things
  between buckets" itch; a status board over a markdown vault mostly
  produced columns nobody moved cards in.
- No time-tracking. `⏱️` is an estimate for capacity; actuals are not
  recorded.
- No charts beyond the throughput sparkline and habit heat strips. Numbers
  that lead to an action are on the Review tab; numbers that do not were cut.
- No JSON export. Everything is markdown in a documented format; a consumer
  parses that.
