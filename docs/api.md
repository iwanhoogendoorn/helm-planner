# Helm's local API

Helm can serve JSON on this machine so other tools — scripts, shortcuts, an AI agent — can read and
change your tasks **through Helm** rather than by editing markdown behind its back. Every call runs the
same code the buttons run, so ids, daily-note mirrors, the Helm region, subtasks travelling with their
task and every other rule stay intact.

## Switching it on

Settings → **Local API**:

1. Turn on **Serve the API**. A token is generated the first time.
2. Copy the token. Change the port if 27125 is taken.

By default it listens on `127.0.0.1` only — no network interface — and Obsidian has to be running.
**Reachable from** widens that to your Tailscale address or to every interface; see
[From your phone (Tailscale)](#from-your-phone-tailscale).

Base URL: `http://127.0.0.1:27125/helm/v1`
Every request needs: `Authorization: Bearer <token>`

```bash
export HELM=http://127.0.0.1:27125/helm/v1
export TOKEN=…            # from Settings → Local API
curl -s $HELM/health -H "Authorization: Bearer $TOKEN"
```

## Ideas you need

- A task's **id** is its `🆔 tsk-…`. Use it everywhere. A task that has never needed one has `id: null`;
  use its `key` instead, and Helm gives it a real id the moment you change it.
- **scheduled** is the day a task is planned for. `null` unschedules it (back to where it lives).
- **part** is `morning`, `afternoon`, `evening` or `anytime`.
- **status** is `todo`, `doing`, `done`, `cancelled`, `waiting` or `forwarded`.
- Every write replies with `written`: the vault files that changed.

## Routes

### `GET /health`

```json
{ "ok": true, "version": "1.15.0", "ready": true, "today": "2026-08-29",
  "counts": { "tasks": 4231, "projects": 81, "habits": 3 } }
```

### `GET /tasks`

Query parameters, all optional:

| parameter | meaning |
|---|---|
| `status` | `open` (default), `done`, `all`, or an exact status |
| `project` | project id |
| `source` | `daily`, `project`, `inbox`, `note`, `goal` |
| `tag` | tag without the `#` |
| `date` | planned for exactly this day |
| `from`, `to` | planned within this range |
| `overdue` | `true` for open tasks past their due date |
| `q` | text the task contains |
| `limit` | default 200, max 1000 |

```bash
curl -s "$HELM/tasks?status=open&date=2026-08-29" -H "Authorization: Bearer $TOKEN"
curl -s "$HELM/tasks?overdue=true" -H "Authorization: Bearer $TOKEN"
```

### `GET /tasks/:id`

The whole task: `id`, `key`, `text`, `status`, `open`, `blocked`, `source`, `path`, `line`, `depth`,
`project`, `phase`, `scheduled`, `due`, `part`, `time`, `effortMinutes`, `progress`, `priority`, `tags`, `links`,
`blockedBy`, `parentId`, `subtasks`, `recurrence`.

### `POST /tasks`

```json
{ "text": "Ring the plumber", "scheduled": "2026-08-31", "part": "afternoon",
  "effortMinutes": 30, "due": "2026-09-02", "priority": "high",
  "time": "14:00", "timeEnd": "14:30",
  "projectId": "prj-kitchen", "phaseId": "ph-2", "parentId": "tsk-abc123" }
```

Only `text` is required. With `projectId` the task goes into the project note (and is mirrored onto the
day when `scheduled` is given); with `parentId` it becomes a subtask; with neither and no date it lands
in the inbox. Replies `201` with the created task.

### `POST /tasks/:id/subtasks`

`{ "text": "Proof it", "effortMinutes": 15 }` — same as `parentId`, spelled as a route.

### `PATCH /tasks/:id`

Send only what changes:

```json
{ "scheduled": "2026-09-01", "part": "morning", "status": "done",
  "text": "New wording", "due": null, "effortMinutes": 45, "priority": "normal",
  "projectId": "prj-kitchen", "phaseId": "ph-2" }
```

- `"projectId"` (with an optional `phaseId`) moves the task into that project,
  taking its notes, drawings and links with it.
- `"progress": 40` says you are 40% of the way and puts the task in progress; `100`
  finishes it, `null` takes the percentage off.
- `"scheduled": null` unschedules.
- `"due": null` and `"effortMinutes": null` clear those.
- `part` on its own moves it within its day.

### `DELETE /tasks/:id`

Deletes the task and everything nested under it. `{ "deleted": "tsk-…", "written": [ … ] }`.

### Projects

```
GET    /projects            ?status=active
GET    /projects/:id
POST   /projects            { "title": "Garden Rebuild", "area": "Home", "due": "2026-10-01",
                              "status": "active", "priority": "normal", "parentId": "prj-…", "period": "2026-Q4" }
PATCH  /projects/:id        any of title, status, priority, area, period, due, start
DELETE /projects/:id
```

`status` is one of `idea`, `planned`, `active`, `on-hold`, `done`, `cancelled`, `archived`;
`priority` one of `low`, `normal`, `medium`, `high`, `urgent`, `critical`.

## API v2 — everything the Helm iPhone app uses

`GET /health` answers `"api": 2` on a plugin that serves these routes. The v1 routes above are
unchanged; v2 adds fields and routes. A **ref** is a task's `id`, or its `key` when it has no id
yet — every route that takes `:id` accepts either. Every response carries `x-helm-revision`, and
`GET /health` carries the same `revision`: an integer that goes up on every change to the index
(rebuild, file re-parse, mutation), so a client can poll it and refresh only when it moves.

### Task JSON, extended

Beyond the v1 fields: `ref`, `title` (the text without tags and link noise), `projectTitle`,
`phaseId`, `created`, `start`, `done`, `cancelled`, `noteDate`, `section`, `timeEnd`,
`timeBlock: {start, end}|null`, `effortRaw`, `progress`, `recurrenceParsed`, `mirrorOf` (the
source task's ref, on a daily mirror line), `mirrorLink`, `parentRef`, `periodKey`; `subtasks[]`
gains `ref`. `GET /tasks/:id` also returns `children` (the subtask tree, up to five levels, in
note order), `followUps` (refs of tasks blocked on this one), `follows` (the task this one
continues) and `attachments: { notes, drawings }`.

`GET /tasks?ids=a,b,c` (up to 500 refs) returns those tasks in the order asked, unknown ones skipped.

### Project JSON, extended

`childIds`, `goalId`, `goalRef`, `pinned`, `order`, `folderNote`, `folder`, `links`,
`relatedTaskIds`; each phase carries `slug`, `taskCount`, `doneCount`, `state`
(`planned|active|done`) and `links`. `GET /projects/:id` and `GET /projects?health=true` add
`health`: `{ total, done, open, overdue, progress, nextAction, lastTouched, staleDays, flags,
phaseProgress }`. The list is sorted the way the Projects tab sorts (pinned first, then order,
status, priority, due); `?area=` filters on the project's area.

### `GET /health` and `GET /settings`

Health gains `api`, `revision`, `vault` (the vault's folder name) and `weekStartsOn`.
`GET /settings` is the client-relevant subset: the day's window (`dayStarts`, `dayEnds`,
`morningEnds`, `afternoonEnds`), `dailyCapacityMinutes`, `defaultEffortMinutes`, `weekStartsOn`,
`captureTags` (an array), `followupTag`, `staleProjectDays`, `rolloverTarget`, `showTimeBlocks`,
`focus` (the pomodoro settings), `daybookHeading`, the folders, `goalsHeading`,
`defaultCaptureTime`, `foldStepsByDefault`, `defaultTab`, and the resolved daily-note folder and
format.

### The day (Today tab)

```
GET  /day/:date                 the day as the Today tab reads it
POST /day/:date/note            create the daily note from the template → { path, written }
POST /day/:date/habits          put the day's due habits into the note → { added, written }
GET  /day/:date/candidates      Plan day: ranked candidates
POST /day/:date/plan            Plan day: write the plan
GET  /day/:date/wrapup          Wrap up: what is still open
POST /day/:date/wrapup          Wrap up: apply the decisions
POST /day/:date/rollover        carry every open line forward → { moved, unscheduled, written }
GET  /day/:date/daybook         the diary
POST /day/:date/daybook         { text, time?, icon? } → 201
PATCH  /day/:date/daybook/:line { text }
DELETE /day/:date/daybook/:line
POST /day/:date/daybook/:line/replies  { text, icon? } → 201
POST /focus/layout              lay tasks out as focus blocks and breaks
```

`GET /day/:date` returns `{ date, notePath, isToday, byPart: { morning, afternoon, evening,
anytime }, timeBlocks, done, openCount, doneCount, plannedMinutes, doneMinutes, capacityMinutes,
habits, daybook: { heading, entries }, timeline }`. Each entry of `byPart` is a **day item**:
`{ task, display, part, kind }` where `task` is the line to act on (send its `ref`), `display`
is the source task when the line is a mirror (else `null`: it is the same task), and `kind` is
`daily | mirror | unmirrored | elsewhere | timeblock | subtask`. `habits` lists every habit due
that day or ticked that day: `{ id, title, icon, iconImage, color, parts, dueToday, occurrences:
[ { part, state, line } ], streak }` (one occurrence per part for a parted habit). `timeline` is
the time grid: `{ timed: [ { task, start, end, column, columns } ], allDay }` in minutes from
midnight.

`GET /day/:date/candidates` → `{ capacityMinutes, plannedMinutes, candidates: [ { task, reason,
score, minutes } ] }`; `reason` is `overdue | due-soon | scheduled-past | next-action | inbox |
unblocked | in-progress`. `POST /day/:date/plan` takes `{ items: [ { ref, part? } ], remove?:
[ref], habits?: true }` and does what the modal's button does: creates the note, syncs the day's
habits, plans each item, then unschedules `remove` → `{ planned, removed, written }`. (The
habits are always synced when anything is planned; `habits: true` alone syncs them without
planning.)

`GET /day/:date/wrapup` → `{ open: [day item], suggestedDate, rolloverTarget, projectsTouched:
[ { id, title } ], doneCount, doneMinutes }`. `POST /day/:date/wrapup` takes
`{ decisions: [ { ref, fate, date?, part? } ], log?: [ { projectId, text } ] }` with `fate` one
of `tomorrow | date | unschedule | done | cancelled | keep`, applies them in order with the same
mutations the modal uses, keeps going past a failing item, then appends each log line to its
project → `{ applied, logged, failed: [ { ref, error } ], written }`.

`POST /day/:date/rollover` takes `{ to: date | null }` (default: the next day).

`POST /focus/layout` takes `{ start?: "09:00", end?, date?, tasks: [ { ref, minutes? } ] }` and
returns `{ from, to, busy, blocks: [ { taskKey, kind, start, end, index, of } ], overflow,
focusMinutes, breakMinutes }` from the focus settings; with `date` the day's timed items are
treated as booked.

### Habits

```
GET    /habits?all=true          active habits (all=true adds paused ones and ghosts: ticks whose note is gone)
GET    /habits/:id?history=week|month|quarter|year
POST   /habits                   { title, schedule, targetPerWeek?, graceDays?, icon?, parts?, color? } → 201
PATCH  /habits/:id               any of active, schedule, title, targetPerWeek (null clears), graceDays, icon, iconImage, parts, color
DELETE /habits/:id
POST   /habits/:id/state         { date?, state: done|skipped|missed|pending, part?, placeIn? }
POST   /habits/:id/move          { date?, part: morning|afternoon|evening|null }
POST   /habits/:id/pause         opens a pause span at today (the same as active: false)
POST   /habits/:id/resume        closes it
```

A habit carries its fields (`id`, `title`, `path`, `schedule` parsed with `raw`, `active`,
`targetPerWeek`, `graceDays`, `icon`, `iconImage`, `parts`, `color`, `created`, `pauses`,
`removed`) and `stats`: `dueToday`, `doneToday`, `today: [ { part, state } ]`, `streak`,
`bestStreak`, `rate7`, `rate30`, `doneThisWeek`, `scheduledThisWeek`, `days` (84 days of
`{ date, state }`). With `?history=` one habit also carries `history: { kind, periods, cells:
[ { period, due, done, rate, state } ], due, done, rate, streak, bestStreak, from }`.

`state` writes one occurrence for a day: `done` ticks it, `skipped` marks it `[-]`, `missed` and
`pending` both clear the tick (the line stays, as `[ ]`, and reads back as `missed`; `pending`
is what a day without a line reports). A habit with `parts` needs `part`; `placeIn` files a
day-level tick under a part of the day, as ticking on the Today tab does. `move` moves a
day-level habit's line into a part of the day for that date only. Pause and resume are what
`active: false` / `true` do; a pause with its own dates is not something Helm records.

### Inbox, week, calendar

`GET /inbox` → `{ inbox, loose: [ { path, title, count, tasks } ], looseTotal, looseGroups,
unscheduledProject, unscheduledProjectTotal }` — the Inbox tab's three lists, capped the way the
tab caps them: groups by count, each showing its first 15 tasks (`?perGroup=`), 200 rows over all
groups (`?limit=`), 100 undated project tasks (`?projectLimit=`). `GET /inbox/notes?path=&limit=100&offset=0`
pages one note's tasks for an expanded group. `GET /week?anchor=2026-09-11` → `{ start, end, capacityMinutes, days:
[ { date, open, done, minutes } ], overdue, unscheduledDue }`. `GET /calendar?from=&to=`
(at most 400 days) → `{ days: [ { date, open, done, dueUnplanned, minutes, openRefs, doneRefs,
dueUnplannedRefs } ] }`; add `&tasks=true` for `openTasks`, `doneTasks`, `dueUnplannedTasks`
instead of refs.

### Periods, horizons, goals

`GET /periods/:key` (`2026`, `2026-Q3`, `2026-09`, `2026-W37`) → `{ period, goals, projects,
projectsWithin, openTasks, doneTasks, isCurrent, isPast }`; a period is `{ key, kind, label,
from, to, notePath }` and projects carry `health`. `GET /horizons?year=2026` → `{ year,
quarters[4], months[12], current: { year, quarter, month, week } }`. `POST /periods/:key/note`
creates the periodic note from the template → `{ path, period, written }`.

`GET /goals?period=` lists goals `{ id, key, text, title, periodKey, status, path, line,
projectIds, progress, taskTotal, taskDone }`. `POST /goals { periodKey, text }` → 201.
`PATCH /goals/:id { status?: todo|done|cancelled, text? }`. `DELETE /goals/:id`.
`POST /projects/:id/goal { goalKey: "gol-…" | null }` binds a project to a goal (and to the
goal's period when the project has none) or unbinds it.

### Tasks — more writes

`PATCH /tasks/:id` also takes `time` + `timeEnd` (`time: null` clears the block; the line keeps
its section, a day view places it by its time), `progress` (0–100 puts it in progress, 100
finishes it, `null` clears the percentage), and `recurrence` (a rule like `every week on
monday`; `null` stops it repeating). `parentId` is refused with a 400: add the task under the
other one instead.

```
POST   /tasks/:id/stop-repeating
POST   /tasks/:id/followup          { date, text?, part?, markOriginalDone?, addTag?, effortMinutes?, due?, priority?, time?, timeEnd? } → 201 { followUp, original, written }
POST   /tasks/:id/plan-into         { date, time: { start, end }, effortMinutes? }
POST   /tasks/:id/project           { title?, status?, priority?, area?, parentId?, period?, due? } → 201 { project, carried, written }
POST   /tasks/:id/links             { url, label? }        DELETE /tasks/:id/links { url }
POST   /tasks/:id/subtasks/reorder  { beforeRef: "tsk-…" | null }   (null = to the end)
GET    /tasks/:id/attachments
```

A follow-up is refused (500) for a task with subtasks, as in the app: move it instead.

### Projects — more

`GET /projects/:id` is the whole project page: the project with `health`, `phases[]` each with
`tasks` (top-level tasks as trees with `children`), `looseTasks`, `children` (child projects
with health), `parent`, `goal`, `attachments`, `log` (`[ { date, text, line } ]` from the
`## Log` section) and `nextAction`. Project health and phase counts include subtasks.

`PATCH /projects/:id` also takes `pinned` (boolean), `order` (number or null) and `goal` (a goal
id or null). `parentId` is refused with a 400: Helm reads a project's parent from its folder.

```
POST   /projects/reorder                 { ids: [ … ] }    (numbers order 1..n)
PATCH  /projects/:id/phases/:slug        { title?, due?: date | null }
DELETE /projects/:id/phases/:slug        → { deleted, carried }   (its tasks move under ## Tasks; nothing is removed)
POST   /projects/:id/log                 { text } → 201 { log }
POST   /projects/:id/links               { url, label? }   DELETE /projects/:id/links { url }
POST   /projects/:id/related             { ref }           DELETE /projects/:id/related/:taskId
POST   /projects/:id/goal                { goalKey | null }
GET    /projects/:id/attachments
```

### Review, dashboard

`GET /review` → the Review tab: `{ weekStart, completedThisWeek, completedByProject, overdue,
inbox, waiting, dueNext14, projects, attention, activeCount, staleCount, noNextActionCount,
throughput: [ { weekStart, done } ], checklist: [ { id, label, done, count, auto } ],
goalsInPlay }`. Projects carry `health`. The checklist's `auto` items are ticked from the
numbers; `week` (“Next week planned”) is yours to tick in the app.

`GET /stats?from=&to=&sources=daily,project&project=&area=&tag=&period=` → the Dashboard's
numbers (`computeStats`): `totals`, `perDay`, `perWeek`, `cumulative`, `byPart`, `byWeekday`,
`adherence`, `byProject`, `byArea`, `byTag`, `ageBuckets`, `habits`, `goals`, `streak`, plus
`openTaskRefs` and `overdueTaskRefs` — the tasks behind `totals.open` and `totals.overdue`, so
those tiles drill down like the rest. Every task list is a list of **refs** (`taskRefs`,
`doneTaskRefs`, `openTaskRefs`, `overdueTaskRefs`) — fetch them with `GET /tasks?ids=`. Two
shapes to know: a series entry's `key` is an identifier and its `label` is the text the
Dashboard shows (the age bucket for tasks without a date is `key: "unknown"`, `label: "no
date"`; show `label`), and `goals[].projects` is a **count** of linked projects, not a list —
`GET /goals` has the ids. Without `from`/`to` it is the last 30 days; `sources` defaults to daily
notes only, as on the tab. `GET /stats/options` → `{ areas, tags, sources, projects:
[ { id, title, status } ], periods: { year, quarter, month, week } }` for the filter pickers.

### Search

`GET /search?q=&limit=50` → `{ query, hits: [ { kind, id, title, subtitle, path, line, score,
task? | project? | goal? | habit? | note? | drawing? } ] }` with the search box's grammar
(`#tag`, `@project`, `is:open|done|blocked|waiting|overdue`, `in:daily|project|inbox|note|goal`,
`due:`, `on:`, `kind:`). `GET /search/starting-points` → `{ groups: [ { label, icon, hits } ] }`
— what the box shows before anything is typed.

### Capture

`POST /capture/parse { text, scheduled?, part?, projectId?, phaseId?, tags?, due?, priority?,
effortMinutes?, time?, timeEnd?, recurrence? }` parses the line the way the Capture dialog
does and applies the overrides on top, without writing: `{ text, tags, priority, scheduled,
due, part, partByTime, effortMinutes, time, timeEnd, recurrence, project, unknownProject,
destination: { kind: inbox|day|project|project+day, date?, part?, projectId?, phaseId?,
sentence } }`. `POST /capture` with the same body performs the dialog's write → 201
`{ task, parsed, destination, written }`. An `@Name` that is not a project is a 400 on write
(and `unknownProject` on parse).

### Attachments and notes

```
GET  /tasks/:id/attachments · /projects/:id/attachments · /day/:date/attachments · /periods/:key/attachments · /habits/:id/attachments
POST /tasks/:id/notes · /projects/:id/notes · /day/:date/notes · /periods/:key/notes · /habits/:id/notes   { name? } → 201 { path, attachments, written }
DELETE /notes            { path }   (or ?path=)   — an attached note only; it goes to the trash
GET  /files?path=…       { path, content, mtime, kind } for a markdown file the index knows (project, daily, periodic, inbox, attached note)
```

`GET /files` is read-only and refuses anything outside the vault or unknown to the index.

### Report

`GET /report?scope=day|week|month|quarter|year&anchor=&sections=history,plan,ahead,projects,goals,habits,daybook&project=&includeClosed=true`
→ the export's data (`buildReport`) as JSON: `{ title, subtitle, from, to, scope, standing,
today, sections, headline, stats, plan, days, ahead, overdue, leftBehind, undated, projects,
projectDepths, projectWork, project, goals, habits, daybook }`. Tasks are embedded (it is a
print view); `stats` is the §Dashboard shape with refs; `projectDepths` and `projectWork` are
objects keyed by project id. `scope` defaults to the setting, `anchor` to today, `sections` to
all of them. `GET /projects/:id/report?scope=&anchor=` is the same report told from one
project. `GET /report.pdf` answers 501: the PDF is rendered in Obsidian's own window and cannot
be produced by the API.

### Maintenance

```
POST /maintenance/rebuild              → { rebuilt, ms, revision, counts }
POST /maintenance/reconcile            → { fixed, written }
POST /maintenance/move-recurring       { onlyFuture?: true } → { moved, written }
POST /maintenance/catch-up-recurring   { aheadDays?: 45 } → { spawned, written }
```

Rebuild is the full parse of the vault (seconds on a large one). `POST /projects/:id/archive`
and `DELETE /projects/:id` rebuild the index too after moving the folder — a deliberate choice
for a rare, destructive operation, and a known follow-up should it ever matter.

### Amendments (§14): bulk, slots, fit, skip, icons, diagnostics

**Tasks.** `PATCH /tasks/:id` also takes `start` (date or null, the `🛫` field) and `blockedBy`
(a list of refs, resolved to ids — a target without an id gets one; `[]` clears). `GET /tasks/:id`
adds `nextOccurrence` (the date “Skip this one” names, or null) and `misfiled` (a daily line dated
later than its note).

```
POST /tasks/:id/skip          cancel this occurrence of a repeating task → { task, next, written }
POST /tasks/:id/ensure-id     → { id, task, written }
GET  /tasks/:id/conflicts?date=&time=&timeEnd=&effortMinutes=   → { conflicts: [ { start, end, ref, label } ] }
POST /tasks/bulk              { refs, action: schedule|part|status|move|delete, date?, part?, status?, projectId?, phaseId? }
                              → { action, applied, appliedIds, covered, failed: [ { ref, error } ], written }
```

Bulk runs the way the selection bar does: every task gets an id first, each is acted on once, a
subtask whose parent is in the set is `covered` (it travels with the parent), and one failure does
not stop the rest.

**Day.** `POST /day/:date/write-unmirrored` is the Today tab's “Write them” button: every project
task planned on the day without a mirror line gets one → `{ mirrored, failed, written }`.
`GET /day/:date/slots?minutes=30&part=&notBefore=` → `{ free: [ { start, end } ], bookings:
[ { start, end, ref, label } ], preferred: { start, end } }` — the free windows of a part (or the
day), what is booked, and the slot Helm would offer.

`POST /day/:date/fit { refs? }` is “Fit the day” **without the AI**: Helm's own sizing
(`proposePlan`'s fallback) laid out with the focus settings around what is booked, returned as a
proposal → `{ source: "helm", from, to, busy, blocks, overflow, focusMinutes, breakMinutes,
changes: [ { ref, sourceRef, time, timeEnd, effortMinutes } ] }`; nothing is written. `ref` is
the **day row's** ref — for a project task planned on the day, its mirror line (`tsk-x@date`),
the same key `GET /day/:date` uses — so blocks and changes match the day's rows directly;
`sourceRef` is the task itself. Either may be sent back to `fit/apply`. `POST /day/:date/fit/apply
{ changes }` performs the modal's writes (one time block per task from its first focus block to its
last, and its minutes) → `{ applied, failed, written }`. The `claude -p` sizing stays desktop-only:
it runs a CLI on the Mac.

**Projects.** `POST /projects` also forwards `goal`, `tags`, `objective`, `notes` (lines under
`## Notes`), `phases: [ { title, due?, tasks? } ]` and `tasks` to `createProject`.
`POST /projects/:id/phases { title, due? }` with no `tasks` adds a bare phase.
`POST /projects/:id/phases/:slug/links { url, label? }` and `DELETE …/links { url }` manage the
links under a phase heading.

**Habits.** `GET /habits/:id/icon` → the `iconImage` file's bytes with its content type
(png, jpeg, svg, gif, webp); 404 when the habit has none. Uploading an icon is not a route.

**Diagnostics.** `GET /diagnostics` → `{ revision, ready, builtAt, diagnostics: [ { severity,
code, message, path, line } ], dailyNotes }` (the latter lists days whose Helm region is broken).

### Drawings, linking notes, binary files (Phase C)

Every attachable thing — `/tasks/:id`, `/projects/:id`, `/day/:date`, `/periods/:key`,
`/habits/:id` — answers the same five sub-routes:

```
GET    …/attachments              { notes, drawings }
POST   …/notes        { name?, folder? }   create a note attached here → 201 { path, target, attachments, written }
POST   …/notes/link   { path }             attach an existing note (a helm-* key is written into its frontmatter)
DELETE …/notes/link   { path }             detach it
POST   …/drawings     { name?, folder? }   create an Excalidraw drawing attached here → 201
POST   …/drawings/link   { path }          attach an existing drawing (Obsidian-format `.excalidraw.md` only; Helm refuses raw `.excalidraw` and `.canvas` files, as in the app)
DELETE …/drawings/link   { path }          detach it
```

`GET /notes/linkable?q=&limit=50` → `{ total, notes: [ { path, title, kind } ] }` — the picker's
list: every note that can be attached (daily notes are attached as days, drawings are not notes),
title-prefix matches first. `DELETE /drawings { path }` trashes a drawing Helm knows and removes
its embeds. `DELETE /notes { path }` (above) does the same for an attached note.

`GET /files/binary?path=…` serves the bytes of an image (png, jpg, gif, webp, svg) or a
`.excalidraw` / `.canvas` file with the right content type — only for drawings the index knows
and the icon images of habits the index knows; anything else, an image merely dropped in the
icons folder included, is a 404.

Every path a caller names — a `folder` for a new note or drawing, a note or drawing to link, a
file to read, a habit's `iconImage` — must be relative and inside the vault: no leading slash,
no `..`, no empty segment, no control character. Such a value is refused with a 400 (or a 404
on a read) before anything is touched, and the vault adapters refuse it again underneath.
Text fields (`text`, `name`, `title`, `icon`, …) must be one line: a newline or control
character is a 400, and a frontmatter value is always written as one escaped YAML scalar.
An unparseable `due`, `start`, `effortMinutes`, `time` or `timeEnd` is a 400 on create and on
PATCH; only an explicit `null` clears a field.

One known limit: the path guard is lexical. It refuses a path that names its way out of the
vault; it does not resolve symbolic links, so a symlink that already sits inside the vault and
points outside it is followed by Obsidian like any other file — a habit icon `run.png` that is
a symlink would be served. Creating such a link needs local filesystem access, which already
means being able to read the target, so this is not something the API adds. It concerns
Obsidian only: the dev server's `FsVault` walks with `Dirent.isFile` / `isDirectory` and
never indexes a symlink.

A phase has the same five under `/projects/:id/phases/:slug/…`. `DELETE /drawings` only removes a
drawing that is attached to something. `GET /files` also serves the text of a `.excalidraw` /
`.canvas` drawing the index knows (`kind: "drawing"`).

`GET /day/:date` also carries `dailyNote: { exists, hasRegion, regionBroken }`.

## Attachments

Notes and drawings attach by a frontmatter key: `helm-task`, `helm-project`, `helm-phase`
(`prj-…#slug`), `helm-date`, `helm-period` or `helm-habit`.

## Errors

| code | meaning |
|---|---|
| 400 | the body is wrong — the message says how |
| 401 | missing or wrong token |
| 404 | no such task, project or route |
| 405 | that method is not allowed on that route |
| 413 | body over 1 MB |
| 500 | Helm threw — the message comes back |

## A worked example

```bash
# what is late?
curl -s "$HELM/tasks?overdue=true" -H "Authorization: Bearer $TOKEN" | jq '.tasks[] | {id, text, due}'

# push one to Monday morning
curl -s -X PATCH $HELM/tasks/tsk-zlecjp -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"scheduled":"2026-08-31","part":"morning"}'

# capture something new for today
curl -s -X POST $HELM/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"Book the venue","scheduled":"2026-08-29"}'
```

## From your phone (Tailscale)

The Helm iPhone app (and anything else on another device) needs to reach Obsidian's API over a
network. The intended way is [Tailscale](https://tailscale.com): a private WireGuard mesh between your
own devices, so nothing is opened to the internet and nothing needs port forwarding.

1. Install Tailscale on the Mac running Obsidian and on the phone; sign both into the same tailnet.
2. Settings → **Local API** → **Reachable from** → *Tailscale (your tailnet)*. Helm finds the Mac's
   Tailscale IPv4 (always in `100.64.0.0/10`, e.g. `100.67.202.68`) and binds to that address only —
   your Wi-Fi or Ethernet interfaces stay closed. If Tailscale is not running, Helm says so and falls
   back to `127.0.0.1`.
3. The settings tab shows the URL to put in the app, e.g. `http://100.67.202.68:27125/helm/v1`, next to
   the running status. Copy it and the token into the app.

Traffic between the devices is encrypted by WireGuard, and every request still needs the token.
*All interfaces (`0.0.0.0`)* also exists, for a LAN you control; it is plain HTTP on every network the
Mac is on, so prefer Tailscale.

**HTTPS with `tailscale serve`.** Some clients (App Transport Security on iOS, browsers) prefer TLS.
Keep Helm on `127.0.0.1` and let Tailscale terminate HTTPS with a certificate for your machine's
tailnet name:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:27125
# → https://<machine>.<tailnet>.ts.net/helm/v1   (Tailscale prints the exact name)
tailscale serve status
tailscale serve reset     # stop
```

`tailscale serve` is reachable from your tailnet only (unlike `tailscale funnel`, which is public —
do not use that for Helm). MagicDNS and HTTPS certificates must be enabled in the tailnet's DNS
settings.

## Developing against the API without Obsidian

`npm run serve:dev` serves the same API over a plain folder (`HELM_VAULT`, default
`~/dev/helm-iphone-vault`; seed one with `HELM_VAULT=… npm run seed`). Same routes, same index and
mutations, with a filesystem adapter standing in for Obsidian; edits made on disk are picked up. The
token is read from, or created in, `<vault>/.helm-dev-token`. `HELM_PORT` (default 27127), `HELM_HOST`
(default `127.0.0.1`; `0.0.0.0` or a Tailscale address to reach it from a phone) and `HELM_TODAY`
(`YYYY-MM-DD`, to freeze the day) are the other knobs. The script refuses paths that look like a real
vault.

## Why not the Local REST API plugin?

That plugin serves *files*: it can read and write the markdown, which is enough to see your tasks but
not to change them safely. Scheduling a task is not "add `⏳ 2026-08-31` to a line" — Helm also mirrors
it into the daily note, keeps the Helm region in order, moves the subtasks with it and gives the line an
id if it needs one. Bytes in, bytes out cannot do that. Use the Local REST API for reading notes, and
this API for anything that changes a task.
