# Changelog

## 1.18.0 — 2026-08-29

- The three things a task can do with a project — *Move to project…*, *Make a
  project from this…*, *Link to a project…* — are offered in the same words,
  in the same order, everywhere: the task menu, the task editor's *Project…*
  button, the inbox row, and three matching commands for the task under the
  cursor. One piece of code serves them all, so notes, drawings and links
  travel with the task whichever one you reach for.
- The project side mirrors it: beside *Add task* and *Link a task…* there is
  now **Move a task in…**, which takes an existing task from anywhere — with
  its notes, drawings and links — and makes it this project's work.

## 1.18.0 — 2026-08-29

- A task's notes, drawings and links now follow it into a project whichever
  way it gets there — the task menu, the inbox row, the task editor, the
  command, *Make a project from this…* or the API. The carrying happens inside
  the move itself, so no route can forget it.
- The API can move a task into a project: `PATCH /tasks/:id {"projectId":"…"}`
  (with an optional `phaseId`).

## 1.17.1 — 2026-08-29

- A project's links are reachable from its header too — a link button beside
  the notes and drawings ones, with the count on it, that opens, adds and
  removes them. The Links section further down does the same.

## 1.17.0 — 2026-08-29

- A project can point at tasks that live somewhere else — a daily note,
  another project — without moving them: *Link a task…* in the project's
  **Related tasks** section, or *Link to a project…* in a task's menu. They
  show as live rows with their real status, and they stay out of the project's
  own progress, velocity and ETA, because the project does not own them. The
  reference is stored by `🆔` under `## Related tasks`, so rewording the task
  does not break it; unlinking removes the reference, never the task.
- A project keeps its own **Links** now, beside its Notes and Diagrams: add,
  open and remove addresses from the project view, stored as a plain `## Links`
  list in the project note. An address without its `https://` gets one.

## 1.16.0 — 2026-08-29

- **Make a project from this…** in a task's menu: the project form opens with
  the task's name filled in, and creating it moves the task and its subtasks
  into the new project while keeping it on the day it was planned for (as a
  mirror), so nothing disappears from your plan.
- Whichever way a task joins a project — the new command or *Move to
  project…* — its notes and drawings are attached to the project as well, and
  the addresses in its text are listed under *Links* in the project note. The
  task keeps its own attachments; a note can belong to both. Running it twice
  adds nothing twice.

## 1.15.0 — 2026-08-29

- **A local API.** Settings → *Local API* switches on a small HTTP server on
  `127.0.0.1` so other tools on this machine — a script, a shortcut, an AI
  agent — can list, create, schedule, edit and delete tasks and projects.
  Every call runs the same code the buttons run, so ids, daily-note mirrors,
  the Helm region and subtasks-travel-with-their-task all still hold; a caller
  cannot get the vault into a state Helm would not. Off unless you turn it on,
  loopback only, and every request needs the token from Settings. Routes are
  documented in `docs/api.md`.

## 1.14.0 — 2026-08-29

- *Needs attention* keeps late work in front of you on every day you open —
  overdue and carried over alike — until you deal with it, by planning it onto
  a day from today onwards or finishing it. A subtask is never listed there in
  its own right, which is what made a far-off day look cluttered.
- *Add link…* copes with what people actually type: the URL and Label boxes
  filled the wrong way round are swapped for you, and an address without its
  `https://` gets one. When neither box holds an address the dialog says so
  under the fields instead of failing silently on the button.
- Moving a task off a past day now forwards its subtasks with it. They were
  left open in the old note, so they came back the next morning as
  *carried over* work of their own while the task itself sat on its new day.
- A subtask is never offered as carried-over work in its own right — it
  belongs to its task and travels with it.

## 1.13.0 — 2026-08-28

- A note created, renamed or moved anywhere outside Helm's scanned folders —
  the vault root, say — is now linkable straight away. Its name reached the
  link picker and `[[` completion only after a full re-index before, so a note
  you had just written could not be found.

## 1.12.0 — 2026-08-28

- Subtasks: *Add subtask…* in a task's menu writes an indented line under it in
  the same note (Shift+Enter keeps the dialog open for the next one).
- Subtasks travel with their task: dragging it to another part of the day and
  scheduling it for another day take the whole subtree along, finished
  subtasks included and still ticked. Moving a task between parts used to
  leave its subtasks behind, and the day's time-ordering could split a task
  from them.
- A task that has subtasks is moved, not followed up: *Follow up…* is off for
  it (“move it instead”), which keeps one subtree in one place. A subtask
  itself follows up like any other task — the new one lands on its day as a
  normal top-level task, linked back to the subtask.
- A finished subtask keeps its place under its parent **and** shows among the
  day's done work, carrying a *part of ‹task›* chip that opens the parent — so
  it can never read as a subtask of the row above it.

## 1.11.0 — 2026-08-28

- Dashboard: a *Counting tasks in* row of pills under the filters for **where
  the counted tasks live** — *Daily notes* (on
  by default), *Project notes*, *Tasks in other notes*, *Inbox* — each switched
  on or off on its own, and the last one on stays on. Counting every stray
  task in every note made the totals meaningless; now the KPIs, charts and
  tables answer “what did I actually plan and do”.
- Dashboard opens on **This week** instead of the last 30 days.

- *Link existing note…* now finds every note in the vault, including project,
  periodic and habit notes — a song, book or recipe kept as a project note is
  a note like any other, and the picker says which kind it is. Only drawings
  and real daily notes stay out (a day is attached to as a day).

## 1.10.0 — 2026-08-28

- Dragging a timed task into another part of the day retimes it: it takes the
  first free slot there and keeps its length (21:00–22:00 dropped on a morning
  with a standup until 08:30 becomes 08:30–09:30). Tasks without a time are
  moved as they were, and Anytime leaves the clock alone.
- Picking a part whose hours have already passed now offers its first free
  slot rather than giving up on the day — the same rule in Capture, *Follow
  up…*, the task editor and drag-and-drop.
- Moving a task to another day now takes the part of the day with it: every
  date in the task menu (Today, Tomorrow, Next week) opens onto *Morning /
  Afternoon / Evening / Anytime*, with *Keep the ‹part›* first so a plain
  move is still one click away. *Pick a date…* has the same choice as a row
  in the dialog.

## 1.9.0 — 2026-08-28

- Ticking a habit without fixed parts now files it under the part of the day
  you are in — checked, exactly as it looks when you drag it there — instead
  of only sitting in the Habits list. Unticking leaves the line where it is,
  and tomorrow the habit is general again.
- Moving a task's start time now moves its end with it. Picking a part of
  the day (or *Move to …*) on a task with times but no estimate used to set
  the start and leave the old end behind it — 18:00–10:00.

## 1.8.0 — 2026-08-28

- Picking a part of the day now sets the time with it: Capture, *Follow up…*
  and the task editor jump the block to the first **free** slot in that part
  (18:00 for an empty evening, 19:20 when something runs until then), never
  earlier than now on today. Falls back to the part's start time when the day
  is not known yet.
- The overlap warning now offers a way out: *Move to 11:00* — the first gap
  after the clash that is long enough for the task's effort.
- Settings → Parts of the day: *Day starts at* (08:00) and *Day ends at*
  (22:00) bound the morning and the evening, and the slot search.

## 1.7.0 — 2026-08-28

- Search: the magnifier in the header (or the *Search everything* command)
  opens one search over tasks, projects, goals, habits, notes and drawings.
  Results are grouped by kind and best title match first; ↑↓ moves, Enter
  opens (a project or goal lands on its tab, everything else in its note),
  and a task hit can be edited straight from the list. Narrow it down with
  `#tag`, `@project`, `is:open|done|blocked|waiting|overdue`,
  `due:today|week|<date>`, `on:<date>` and `kind:task|note|drawing|…`. The
  dialog sizes itself to the window instead of spilling out of its own box.
- Search works as a workflow, not just a lookup: it opens on what is overdue,
  what is planned for today and what you edited last; one-click filter chips
  (Open, Overdue, Due this week, Today, and by kind); a checkbox on every task
  hit to tick it off without leaving; ⌘/Ctrl+Enter (or right-click, or the ⋯
  button) for the full task menu — schedule, part of the day, follow up,
  notes, drawings, links; clicking a group header narrows to that kind; and
  when nothing fits, *Capture “…”* turns what you typed into a new task. The
  query is remembered while Obsidian stays open.
- Search says where a task lives — *Daily note*, *Project · <name>*, *Inbox*
  or *Other note · <note>* — and `in:daily`, `in:project`, `in:inbox`,
  `in:note` (with chips for the first three) narrow the results to one of
  them. `kind:` still picks what sort of thing to look for; `in:` picks which
  note a task sits in.
- Follow-ups no longer add `#followup` on their own: the ⛔ link to the
  original is what makes one, and the tag is a toggle in the *Follow up…*
  dialog (off unless you switch it on). A task that waits on another shows
  the *follows …* chip whether or not it carries the tag.
- Chips that name a task (follows …, follow-ups, links) show plain words —
  tags, wikilink brackets and URLs stripped — and are cut with an ellipsis
  instead of being clipped mid-word by a neighbour.
- Links on tasks: a bare URL in a task now renders as a clickable link with a
  readable label (host and path); the task menu's *Links* submenu opens,
  adds (*Add link…*: URL + optional label, written as a markdown link that
  Tasks understands) and removes links; the task editor has a Links
  section that updates at once and saves with the task. In a row the links
  are taken out of the text and shown as pills under it, like notes and
  drawings. As many links as you like.

## 1.6.2 — 2026-08-28

- Follow-ups: the original's notes and drawings are linked to the new task
  too. A follow-up of a task whose id appears in more than one note (a
  carried-over line, say) referenced an internal key like `tsk-abc~5`,
  which then showed as raw text instead of the follow chip — fixed, and such
  lines written earlier now parse as the plain id.

## 1.6.1 — 2026-08-27

- Dashboard line charts: the last date label no longer overprints its
  neighbour; a regular label that would collide with it is dropped instead.
- A habit without fixed parts of the day can be moved into the Morning,
  Afternoon or Evening for one day only: drag its card onto the part, or
  right-click → *For this day*. Its line moves in that day's note (tick state
  and all), it shows as a chip in that part with a *morning today* marker on
  the card, and the next day it is back in the Habits section. Streaks and
  stats count the moved tick like any other.

## 1.6.0 — 2026-08-27

- Capture: a *Tags* row of one-click toggles (`#meeting`, `#followup`,
  `#task` by default — Settings → Planning → Writing → *Quick tags*). One
  click puts the tag in front of the text, another removes it; typing the
  tag yourself lights the chip up too.
- New tasks straight from the calendar, at every scope: a *+* on each week
  column and month cell, a *New task* button in the week / month / quarter /
  year header (lands on today when the period holds it, else its first day),
  and a right-click menu on any day — week columns, month cells, the
  mini-month dots in quarter and year — with *New task on …*, *Plan this
  day*, *Open day*, *Open daily note*. Month and quarter blocks in the
  quarter and year views right-click to *New task in <month>*.
- Hovering a task no longer nudges the layout: the row's action buttons
  always take their space and are only revealed on hover (always shown on
  touch screens), so nothing rewraps or shifts underneath the pointer.
- Today: finished tasks stay in their part of the day as faded ghost rows
  under the open ones (with a green *N done* chip in the header), instead of
  being swept into a Done section at the bottom — a morning you worked
  through no longer looks like an empty morning.
- An uploaded habit icon (PNG) no longer blows up to full size on the habit
  board, Today's part chips or the Dashboard tracker: it is 18–22 px
  everywhere except the form's preview box.

## 1.5.0 — 2026-08-27

- Dashboard → *Habit tracker*: every habit over its whole life, one column
  per week, month, quarter or year (switch at the top right), each cell the
  share of scheduled occurrences done, in the habit's colour; totals, rate,
  current and best streak per row; paused habits included. Click a cell to
  open that week or horizon. Shows something even with no habits (a New
  habit button), and sits above the Projects table.
- Habits that changed or went away are handled honestly: editing a schedule
  or the parts of the day records the old definition in the habit note
  (`history`), pausing / resuming records the span (`paused`), and every
  statistic judges each day by the rules that applied then. A habit whose
  note was deleted still appears in the tracker — rebuilt from the ticks
  left in your daily notes, marked *removed*. A tick on a day the habit was
  not scheduled counts as a bonus, never above 100%.
- *Habit consistency* now covers the whole selected range (it silently
  stopped at 84 days before, so “This year” and “12 months” were wrong).

## 1.4.0 — 2026-08-27

- Notes and drawings for habits: the same New / Link existing / Manage
  menus as tasks, days and projects — from a habit card's right-click menu
  and the habit form. Attachments carry `helm-habit: hab-…`, `related` links
  back to the habit note, and the habit note lists them under *Notes* /
  *Diagrams*; the card shows small count pills that open them. The New habit
  form takes them too: queue *New note… / Link note… / New drawing… / Link
  drawing…* while filling it in and they are created or linked the moment the
  habit is.
- Settings → Setup: a self-repairing checklist — companion plugins (Daily
  Notes, Tasks, Periodic Notes, Templater, Excalidraw: enabled / disabled /
  not installed, with Enable or Install), every folder and note Helm uses
  (Create when missing, Change… jumps to the right section), the daily and
  periodic templates (Create writes Helm's built-in ones), and one *Fix
  everything* button. Helm ships a daily note template too now.
- Double-booking guard: when Capture, Follow up or the task editor has a day
  and a time, Helm checks everything already timed on that day (its tasks,
  mirrored project tasks and your own planner slots), shows an inline
  “Overlaps 14:00–15:00 Team meeting” warning, and asks before writing.
  Without an end time the effort (or the default effort) decides the length.
- Capture has a Day row: Today · Tomorrow · +2 · Next week · Inbox, plus a
  date field, preset to the day you are looking at and overriding whatever
  the text says — so a task for another day is one click away from any view.
- Follow up…: continue a task another day (with time and effort, prefilled from the original; the original is never changed) from its menu or the editor —
  own title, day (tomorrow and quick picks), part of the day, and “mark the
  original done”. The follow-up carries #followup and depends on the original
  (⛔ id), so it reads “follows: …”, the original shows “→ Fri 28”, and it is
  blocked until the original is ticked. Project tasks continue inside the same
  project and phase, mirrored onto the day. Tag name in Settings → Planning.
- Habit board on Today: a coloured card per habit — today's tick (one per
  part for morning/afternoon/evening habits), streak and this-week count,
  the current week as seven cells you can click to fix a past day, and a
  30-day ring. Habits get a colour (picked in the form, or assigned from
  the id) that the part chips, the Review heat map and the Dashboard bars
  share.
- Habits are manageable where you see them: a labelled *New habit* button on
  the Habits section, a right-click menu on every habit chip (Edit, Mark
  done / Skip today / Clear, Pause or Resume, Open note, Delete habit…), the
  same menu on Review rows, and a Delete button in the edit form. Deleting
  trashes the habit note and removes its lines from today; past notes keep
  their ticks.

## 1.3.0 — 2026-08-27

- New drawing / New note dialog: a Location field (folder picker, prefilled
  with the default) and a live preview of the path that will be created.
  Defaults: a task's drawing or note goes into its project's folder when it
  has one; the general folder otherwise. A name you type is used as the file
  name on its own — the task title is no longer prefixed — and default names
  are cut to 60 characters.

## 1.2.0 — 2026-08-27

- Habits can be done in parts of the day: pick Morning / Afternoon / Evening
  (several for a habit you do twice) in the habit form. Each part gets its
  own checkbox line at the top of that section in the daily note; Today shows
  the chips inside the parts; a day counts as done when every tick is done
  (some done = partial), streaks and rates roll up per day and per week from
  the occurrences. Once-a-day habits stay in the Habits section as before.

## 1.1.0 — 2026-08-27

- A carried-over task put on today no longer stays in “Needs attention”: the
  forwarded `[>]` record it leaves in yesterday's note is not open work.
- `[[` completion in every task input (Capture, Inbox, task editor, quick add,
  project form, goals): note titles of the vault are offered as you type,
  drawings as `Title.excalidraw`; picking one closes the link and keeps the
  rest of the line.

## 1.0.0 — 2026-08-26

First finished release. Everything below since 0.4.2 ships in it.

- Notes attached to tasks, projects, days and periods, the same way as
  drawings: *New note…*, *Link existing note…* (any note in the vault — the
  key goes in its frontmatter, so it can live anywhere), *Manage notes…* with
  Open / Unlink / Move to trash. A task also owns the notes its own text
  links (`Call the plumber || [[Plumber quotes]]`); a project, daily or
  periodic note owns the notes listed under its `## Notes` heading, which is
  where Helm writes the links. Task-text links to a drawing attach it too.
- Drawings: Excalidraw (and Canvas) files are indexed and attached to tasks,
  projects, days, weeks, months, quarters and years — by Helm's own
  `helm-task` / `helm-project` / `helm-date` / `helm-period` frontmatter, by
  the note that embeds them, by the project folder they sit in, by a name that
  starts with the note's title, or by links in their text. Every task row,
  day, period and project shows what exists (open with a click) and offers
  *New drawing…* (named, placed and embedded for you). Settings → Drawings.
- Built-in yearly, quarterly, monthly and weekly note templates (Templater
  flavour: navigation links derived from the title, a Goals section, focus
  and review). Helm uses your override, else the Periodic Notes template,
  else the built-in one. Settings → Horizons lets you pick a template per
  kind, write the built-in ones into the vault (Create / Replace…), and turn
  on *Create this period’s notes on startup* (default on): this week’s,
  month’s, quarter’s and year’s notes are created when Helm loads. Commands:
  *Create this week’s, month’s, quarter’s and year’s notes* and *Write Helm’s
  periodic note templates*.
- Template renderer understands `startOf`/`endOf` (isoWeek, month, quarter,
  year), quarter arithmetic and the `Q` token; `<%* … %>` script blocks are
  left to Templater.
- Settings redesigned in the AWTY / Food Spot / WRL shell: a left nav
  (Folders · Daily notes · Horizons · Planning · View · About) over grouped
  panels with an icon, a subtitle and a status chip (found / not found /
  follows Obsidian / custom). Folder and note fields are pickers, excluded
  and extra paths are chips with a picker, times are time inputs, sliders
  show their value, `?` reveals the long explanation. About has Re-index and
  Reset to defaults.
- One crumb bar on every tab, same spot and style, tab name first.
- New project form is a builder: add phases as cards (name, target date,
  reorder, remove) and tasks per phase or loose, one per row. Task rows use
  the capture grammar (`due friday !high ~1h`, `every week`…) and preview
  their chips before anything is written.
- New habit form is click-driven: emoji grid or an uploaded PNG icon
  (stored under `<habits folder>/icons/`, linked as `icon_image`), schedule
  presets (every day, weekdays, weekends, pick days, every N days, monthly),
  weekday toggles, target-per-week and grace as segmented buttons.
- Habit icons (image or emoji) show in Today, Plan day and Review.
- Since 0.4.2: breadcrumbs across Today, Calendar, Projects and Horizons;
  week columns split by part of the day; dashboard drill-downs open in a
  popup; capture time inputs with an effort dropdown linked to the end time
  and a default start of the current hour; archive and delete actions on
  projects; vault events batched into one re-link (fixes the rapid-refresh
  freeze); modals closed on plugin unload; weekday titles spelled out.

## 0.4.2 — 2026-08-26

- Recurring tasks: a daily line dated later than its note (the next
  occurrence Obsidian Tasks spawns) is planned on its own date, is never
  "carried over", is skipped by wrap-up, and is moved into the right daily
  note automatically (or with the new *Move recurring tasks to their next
  date* command).

## 0.4.1 — 2026-08-26

- Helm now plans **inside the daily note's own sections** (`# Day planner ›
  A. Morning / B. Afternoon / C. Evening`, Habits, Anytime) with line-level
  edits; the `## Plan` block is only a fallback for notes without them.
- New daily notes are handed to Templater when it is installed; the fallback
  renderer evaluates `moment()` chains and offsets.
- Charts render at real pixel width; dashboard KPI and legend layout fixes.

## 0.4.0 — 2026-08-26

- **Calendar tab** with Week · Month · Quarter · Year scopes, breadcrumbs,
  drill-down (year → quarter → month → week → day), month grid with
  drag-to-plan and due-but-unplanned markers, quarter/year heat maps of
  completions, and each period's goals and projects underneath.
- Commands: Open Month / Quarter / Year.

## 0.3.0 — 2026-08-26

- **Clean daily notes**: no more `%% helm %%` markers. The plan is the
  section under `## Plan`; legacy markers are read and dropped on the next
  write. `➕` created dates are no longer stamped unless you turn it on.
- **Parts of the day**: Morning / Afternoon / Evening / Anytime sub-sections
  in the note; drop zones on the Today tab; "Part of the day" in the task
  menu and editor; per-item part in Plan day; "tomorrow evening" in capture;
  your planner time slots fall into a part by their start time.
- **Week horizon**: goals in weekly notes (shown on the Week tab), projects
  can bind to `2026-W35`.
- **Dashboard** tab: filterable by range, project, area, tag, horizon —
  done per day/week, cumulative flow, plan adherence, by part of day, by
  weekday, by area, by tag, open-task age, project velocity and ETA, habit
  consistency, goal progress; everything drills into its tasks.

## 0.2.0 — 2026-08-26

- **Horizons**: yearly / quarterly / monthly goals in periodic notes; projects
  bound to a period (`period:`) and a goal (`goal:`); a Horizons tab, goal
  progress rolled up from projects, goals in Review, period/goal pickers in
  the project form and detail, a boost for current-period work in Plan day.
- Fixed: a loose project note in the projects folder (`02 PROJECTS/X.md`) was
  treated as an umbrella of every project; only folder notes can be.
- New setting **Never index these paths** (archives), defaulting to the
  vault's archive folders.

## 0.1.0 — 2026-08-26

First build. A ground-up rewrite of the idea behind Task Command Center,
organised around the day.

- Five tabs: Today (the cockpit), Week (drag between days), Projects
  (portfolio → detail with derived phase status and inline add), Inbox
  (capture + triage), Review (weekly health check).
- Rituals: Plan day, Wrap up (with `[>]` records in past notes), weekly
  Review with a checklist.
- One-line natural-language capture with live preview and destination.
- Project note canonical, daily note mirrors, two-way status sync, source →
  mirror everything else; past daily notes never rewritten.
- Habits with derived streaks, rates and heat strips from daily-note ticks.
- Reads the existing `02 PROJECTS` notes (`type: project`, list-or-scalar
  frontmatter, `deadline`/`target_date`/`start_date`) without migration.
- Honours the user's daily template: time-slot lines become time blocks.
- 82 automated tests (parser round-trips, planner, every mutation, jsdom
  renders of every tab and modal) plus an in-app self-test command.
