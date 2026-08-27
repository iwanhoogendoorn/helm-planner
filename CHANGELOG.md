# Changelog

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
