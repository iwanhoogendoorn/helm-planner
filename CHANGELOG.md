# Changelog

## 0.5.0 — 2026-08-26

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
