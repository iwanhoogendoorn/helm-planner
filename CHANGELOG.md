# Changelog

## Unreleased

- **A project keeps its finished tasks in view.** Ticking one off used to make it
  vanish from the phase unless you found the “Show done” box; it now stays, faded and
  struck through, under the work that is left — the same way a day keeps what you
  finished on it. The phase's `2/5` still counts what is done, and unticking **Show
  done** puts them away when you want a clean list. The board, table and timeline of a
  project sort the finished ones last too.

## 1.24.5 — 2026-09-02

- **A day reads at a glance: the task solid, today's step solid, the rest faded.** On
  any day a task is shown on, the steps planned for other days are dimmed as context
  and the one for the day you are looking at stands out — the same way a step
  borrowed onto another day already worked. A step with no day of its own is part of
  the task, so it stays solid.
- A **record left on a past day is no longer borrowed** into the day it was planned
  for. Moving a task off yesterday leaves `[>]` lines behind carrying their `⏳`
  dates; the one planned for today turned up on today as a ghost “moved on” row
  beside the real thing. A record is a record; only live steps are borrowed.

## 1.24.4 — 2026-09-02

- **Work that moved on is a record, not a day's worth of done.** Moving a task off a
  past day leaves a `[>]` line behind so the day still says what happened — but Helm
  was drawing that line as finished: struck through, counted in the day's “done”, and
  a task whose steps had all moved read “4/4”. A left-behind line now says **“moved
  on”**, sits with the day's record rather than among its open work, is counted
  separately (“2 moved on”), and a task's own count only counts steps you actually
  finished.

- **Plan one step of a task for another day, without taking it out of the task.**
  Schedule a subtask — from its menu, the date picker, or a bulk move — and the day is
  written on its own line (`⏳ 2026-09-04`) while it stays exactly where it is, in
  order, under the task it belongs to.
  - On its **task's day** it is still listed with its brothers and sisters, now saying
    where it is going: “→ Fri 4 Sep”.
  - On **that day** the whole task turns up around it: the task itself and its other
    steps in ghost, faded, with the step planned for that day solid among them. The
    context is the task, not a label — you can see what this belongs to, what is
    already done, and which day each of the other steps is waiting for. Two steps
    planned for the same day share one block.
  - Give it a part of the day and it takes a free slot there, like anything else; take
    the day off again and it goes back to being a plain step.
  - **Moving things around respects all of it.** Drag a step onto another day, or a
    part of one, and it is planned there — it never leaves the task it belongs to. On
    the day it is planned for you can drag it between parts; the ghost rows around it
    cannot be dragged, because they live somewhere else. And moving the **task**
    itself to another day carries its steps along with each one's own plan intact.

## 1.24.3 — 2026-09-01

- **The calendar covers the whole day**, midnight to midnight, instead of stopping at
  the end of your working day — a 22:30 line had nowhere to be, and nothing could be
  dropped there. It opens on the hours you work (today, a little before now), and it
  stays where you scrolled it when the view refreshes.
- **Dragging a task on the calendar now shows where it will land.** Pick a box up and
  a dashed block follows the pointer with the time on it — “10:15–11:00” — moving in
  quarter-hour steps and carrying the task's own length, so you aim at a time instead
  of guessing. Where the label says it will land is where it lands.
- **Pick a slot on the calendar and Capture opens on it.** Click an empty hour for a
  task there, or **press and drag across the grid** to choose the hours yourself — a
  band follows the pointer showing “14:00–15:30”, and the dialog opens with exactly
  that, snapped to the quarter. Clicking used to open Capture with no time at all.
- The **Next / Previous day arrows on a single day in the Calendar tab** now keep you
  in the Calendar. The day is drawn by the same view the Today tab uses, and its
  arrows were navigating to Today, so stepping to the next day threw you out of the
  tab you were in.
- **Dragging on the calendar lands on the quarter hour, where the box looks like it
  will.** The drop used the pointer's position rather than the top of the box, so a
  box grabbed by its middle jumped upwards by however far down you had taken hold of
  it, and the rounding fell to the nearest hour as often as the nearest quarter. It
  now snaps to 07:15, 07:30, 07:45 … measured from the box's own top, keeps the
  task's length, and never lands above the grid or past its end.

## 1.24.2 — 2026-09-01

- A part of the day that holds tasks **without a time** now says so, with a button to
  **move them to Anytime** in one go. Helm gives a task a slot when it puts it in a
  part, but it does not rewrite lines it did not write — birthday lines from a daily
  template, say — so this is the one click that tidies them.

## 1.24.1 — 2026-09-01

- A finished task that has since **moved to another day** now shows the date it was
  actually finished — “✓ Tue 1 Sep” — instead of “✓ Today”. Subtasks travel with
  their task, so a subtask ticked yesterday would sit on tomorrow's plan claiming it
  was done today.

## 1.24.0 — 2026-09-01

- **The daybook, in the day view.** Every day now shows what happened under a
  **Daybook** section: each entry with its time, its icon and whatever came back
  written underneath it, the way your notes already look.
  - **Jot a line** in the box at the bottom and press Enter — it lands in the day's
    note stamped with the current time, in time order, wherever in the day it belongs.
  - **Right-click an entry** to reply to it, reword it, open that exact line in the
    note, or delete it (replies and all).
  - It reads and writes the plain markdown you already keep — `- **13:42** ⌨️ …` with
    tab-indented `- 💬 *…*` replies — so the note stays yours, editable and syncable
    without Helm. An existing daybook is added to, never rewritten.
  - Browse to any day to read its diary. A past day with nothing in it stays quiet.
  - Settings → the heading name, if yours is not “Daybook”.

## 1.23.6 — 2026-09-01

- **Skipping one occurrence of a repeating task no longer ends the series.** A
  meeting that was called off is cancelled for that day and the next one still comes:
  the task menu offers **“Skip this one — next Tue 8 Sep”**, and marking any repeating
  task cancelled does the same. To end a repeat for good there is **“Stop repeating”**,
  which takes the 🔁 off and leaves the occurrence you are looking at.
- A cancelled line now **says so**: “skipped Today” on a repeating task, “cancelled”
  on any other. A greyed-out row with a line through it was leaving you to guess.

## 1.23.5 — 2026-09-01

- **Capture suggests a time that is actually free.** It used to offer the current
  hour, which is how you got 11:00 sitting on top of an 11:00 meeting; it now offers
  the first free slot from now on, with an end from the estimate. And opening Capture
  from a part of the day — the **+** on Morning, Afternoon or Evening — starts in
  that part with a free slot in it, instead of the current hour with the part button
  merely lit.
- The task menu offers each day **once**. For a task already on today, “Today ▸” and
  “Part of Today ▸” were the same list doing the same thing — scheduling a task to
  the day it is already on is not a move. The day it sits on is now only offered as
  “Part of …”; the other days still move it, and still offer to keep its part.

## 1.23.4 — 2026-09-01

- **A part of the day is a time of day.** A task with no time belongs in **Anytime**;
  the moment it lands in Morning, Afternoon or Evening — dragged, moved from the
  menu, planned with a part, or set through the API — it takes the **first free slot
  in that part**, long enough for its estimate, and stays there. Move it back to
  **Anytime for that day** and the time is given back. A time that already suits the
  part it lands in is left exactly as it is.
- Capture: picking **morning / afternoon / evening** now fills the whole block — a
  free slot in that part *and* an end time — instead of leaving the day's first hour
  in the box. Fixes the preview drawing itself twice, and the end time sliding away
  when the start moved.
- **A phase can hold its own notes, drawings and web links.** Each phase header now
  carries the same three buttons a project and a task have; what you attach belongs
  to that phase, not to the project as a whole, and shows under it. A note or drawing
  says so in its frontmatter (`helm-phase: prj-…#slug`) and is embedded under the
  phase's heading; a web address is written as a plain link there. New notes and
  drawings made for a phase land in the project's own folder.

## 1.23.3 — 2026-08-31

- **A day's plan can no longer gain a second copy of a task.** Rewriting the plan
  works from a snapshot of the note; if the file had moved on in between — the line
  was just edited, by hand or by another write — Helm could treat a line it already
  had as a new one and add it again, duplicating the task and every subtask under it.
  A rewrite now never writes a line the section already holds.

## 1.23.2 — 2026-08-31

- **A subtask can no longer be pulled out of its task by a stray drop.** Dropping one
  on a part of the day it already sits in used to promote it to a task of its own —
  easy to do by half an inch while reordering, and then it is left behind the next
  time its parent moves on. Helm now says what to do instead: drop it on a sibling to
  reorder it, or on another day to genuinely take it out. The part-of-the-day menu is
  gone from subtasks for the same reason — a subtask sits where its task sits.
- A **part-done task keeps its percentage and its “in progress”** when it moves to
  another day. Moving a task starts the new day fresh, but a line reading “to do,
  75%” is a contradiction.
- The part-of-the-day menu now **names the day it will use**: “Part of Tomorrow”,
  with “Morning of Tomorrow · Afternoon of Tomorrow · …” inside. It only ever moves a
  task within the day it is already on — it never changes the date — but “Afternoon”
  on its own read as “this afternoon” and looked like it would drag the task back to
  today.
- **How far along a task is.** A task in progress can carry a percentage, written on
  the line as `📈 40%`:
  - **right-click the checkbox** for the quick steps — 10 · 25 · 50 · 75 · 90 —
    “No percentage”, or “100% — done”, which finishes it outright;
  - the same list is under **Progress** in the task menu, and the editor has a
    **How far along** slider you can drag;
  - the row shows a **40%** chip and a thin bar, and the checkbox itself **fills up**
    as you go, so a long list shows its state at a glance.
  Setting a percentage puts the task in progress — nothing sits at “to do” with 40%
  against its name — and finishing or reopening it clears the number, because a done
  task is not “40% done”. Setting it on a mirrored line sets it on the task itself.

## 1.23.1 — 2026-08-31

- **Subtasks show up under the task you added them to.** When two notes hold the same
  🆔 — a day you moved work off leaves a “forwarded” record behind wearing the same
  id — the second copy was given a key of its own, but its subtasks were still keyed
  to the id, so they hung themselves on whichever copy the index read first. The
  lines were always written in the right place; they were drawn under a dead twin,
  or nowhere you were looking. Three fixes: subtasks now follow their own copy; a
  lookup by id returns the live line and only falls back to a closed record when
  there is nothing else; and a forwarded record **gives up its id**, so the clash
  stops happening in the first place.

## 1.23.0 — 2026-08-31

- **Drag a subtask onto one of its siblings to put it in that place**, or onto the
  space below the list to send it to the end. It takes its own children with it, and
  the lines move verbatim, so ids, times and everything else on them are untouched.
  Only siblings reorder: drop a subtask anywhere else and the day or project
  underneath handles it as before.

## 1.22.1 — 2026-08-31

- The year's little months now show **the date in every square**, so a green day is
  a day you can name instead of a dot to count along to.
- The **Calendar** view is offered only where a grid says something a list cannot:
  1 day, 3 days, Week and Workweek. A month, a quarter and a year are read better as
  the list already draws them — months with their counts, goals and projects — so
  those scopes no longer carry the switch, and the month grid and year heat map are
  gone rather than left lying about.

## 1.22.0 — 2026-08-31

- Work that runs past a boundary now shows as a **ghost in the part it eats into**:
  dinner from 17:00 to 19:30 stays in the afternoon where it starts, and the evening
  carries a dashed copy saying “from the afternoon, runs on until 19:30”, with a
  “1 running in” chip on the heading. Same for a morning meeting that runs into the
  afternoon. The part's own count still only counts what is planned for it, and the
  “drop a task here” hint gives way — an evening with two and a half hours spoken
  for is not an empty evening.
- **A real calendar.** The Calendar tab now has a **List / Calendar** switch and the
  scopes to go with it: **1 day · 3 days · Week · Workweek · Month · Quarter · Year**.
  In Calendar view a day is drawn as time, not as a list:
  - a **time grid** with the hours down the side, a column per day and every timed
    task as a box where its time is — overlapping work sits side by side, the
    working day stretches to cover anything outside it, and a red line marks now;
  - an **all-day row** above the grid for what is planned but not timed;
  - a **month** of day cells with the day's work inside, a count, and “+n more”;
  - a **year** as a heat map, a square per day, darker the more is open.
  Click a box to open the task, click an empty slot to capture one there, drag a box
  — or a whole selection — onto another day or hour to move it. Boxes are coloured
  by where the work comes from: meetings, project work, habits, plain tasks, and
  finished work greyed and struck through. In **List** view the 1-day scope draws the
  day itself inside the Calendar tab, rather than sending you off to Today — which
  had made the tab look unclickable.
- **Pick several tasks and move them in one go.** Cmd-click (Ctrl-click) a task to
  pick it out, Shift-click to take everything down to there. A bar appears at the
  top of the view: *Plan for…* (a day and a part), *Part of the day*, *Move to
  project…*, *Mark done*, *Clear* — and right-clicking any picked row offers the
  same. **Dragging one of them drags all of them**, into a part of the day, a day in
  the week or calendar, or a project's board column. It works in every view that
  lists tasks, subtasks travel with their parents as always, and each task goes
  through the ordinary single-task move — a selection is a shortcut, never a second
  code path.
- **Fixed, the real cause:** rewriting a day's plan could tear one of two
  identically worded lines out of its place and re-append it at the end of the
  section — where it read as a subtask of whatever now sat above it. Every line in
  the region is matched to its old self by an identity key, and two lines worded the
  same share one; the map kept only the first, so the second twin looked new. It
  keeps every line that answers to a key now, in order. This was never about moving
  several tasks at once: one ordinary move of one task was enough, as long as some
  list in that day repeated itself (“Delete all transferred data locally”, once per
  account).
- A bulk move could also tear a subtask off its parent and leave it
  under whichever task moved last. A task's key is its 🆔 when it has one and
  otherwise a hash of its file, its wording and which occurrence of that wording it
  is — so moving the first task changed what a later key pointed at, and two
  subtasks worded the same in one list (“Delete all transferred data locally”) was
  all it took. Every picked task is now stamped with a real id **before** anything
  is written, found again by that id when its turn comes, and skipped when its
  parent has already carried it along. A mirrored project task is no longer passed
  over when it is picked.
- A raw `*.excalidraw` file now says **why** it cannot be attached — it has no
  frontmatter to hold the link — and names the fix (“Excalidraw: Convert
  *.excalidraw to *.md files”). The picker marks them rather than letting you pick
  one and hit a puzzling error about canvases.
- An empty day still ahead now shows **Morning, Afternoon and Evening** alongside
  Anytime, each ready to be dropped into, instead of collapsing to “Nothing planned
  yet” with only Anytime standing. A day in the past is still a record: parts with
  nothing in them stay out of it.
- **A Repeat row in Capture**, under Tags: Daily · Weekdays · Weekly · Monthly ·
  Yearly, plus a **when done** toggle that counts the next one from the day you tick
  it. The buttons write the same phrase you would have typed, so the line stays the
  one truth — switching presets replaces the repeat instead of stacking a second
  one, and a repeat you typed by hand (“every 2 weeks on monday”) keeps a button of
  its own. The task editor's Repeat field carries the same row.
- Capture: “weekly when done” and friends now hand the whole phrase to the repeat
  instead of leaving “when done” sitting in the task's text, and “annually” is
  understood alongside “yearly”.

## 1.21.2 — 2026-08-30

- The “3 sub-projects” chip is now a **handle**: click it and the family opens in
  place — a card, row or timeline bar each — so you can drag one sub-project into
  another column, open it or right-click it **without picking up its master**.
  Click again to fold them back in. Works the same in the board, the table and the
  timeline.
- A sub-project you drag into another column no longer floats there context-free:
  the column grows the **master's card in outline** — same shape as the card an
  opened umbrella shows above its children, dashed to say it lives elsewhere, with
  the status it lives in and how many of its family are here — and the strays sit
  under it the way they would at home. The table and the timeline say it with an
  “under ⮕ 3D Printing” chip instead, having no columns to group in.

## 1.21.1 — 2026-08-30

- The board, table and timeline show **umbrellas only**: a sub-project no longer
  gets a card of its own, it is folded into its parent — its open and done tasks
  counted there, its dates stretching the parent's timeline bar — with a
  “3 sub-projects” chip saying how many it stands for. Open the umbrella to see
  them. Filter by a sub-project's name and it stands on its own again.
- Folding only happens within a column: a sub-project you put **on hold** stays in
  On hold on its own — putting it on hold does not put the master on hold — and its
  work is counted on its own card rather than twice.

## 1.21.0 — 2026-08-30

- Four ways to look at your work, switched from the toolbar, in **both** the
  project list and inside a project:
  - **List** — as before.
  - **Board** — inside a project, a column per phase (drag a card to move the
    task into it); in the list, a column per status (drag a project to change
    it).
  - **Table** — inside a project: task, phase, status, due, effort; in the
    list: project, status, priority, area, open, done, due, last activity.
    Any column sorts, click again to reverse.
  - **Timeline** — weeks across the top; inside a project the phases run from
    their earliest to their latest date, in the list the projects run from
    start to due. Says so plainly when nothing is dated.
  Each choice sticks while Obsidian is open. On a board every column header
  stays put and each column scrolls its own cards; in a table and a timeline
  the header row stays as you scroll.
- Phases can be **deleted**: a bin next to the pencil on each phase header. It
  asks first, tells you how many tasks are involved, then removes the heading
  and moves everything it held into the project's own task list — the work is
  never deleted with the grouping.

## 1.20.0 — 2026-08-29

- Projects can be **pinned** and **put in your own order**. Pin one from its
  menu and it sits at the top of the list, marked; drag a card onto another to
  move it, or use *Move up* / *Move down* in the menu. Both are kept in the
  project note (`pinned: true`, `order: 3`), so they survive a reindex and read
  fine outside Helm. Ordering applies within a status group, which is how the
  list is built; projects you never ordered keep their usual place, after the
  ones you did. Unpinning or clearing an order takes the key back out of the
  note rather than leaving an empty one behind.

## 1.19.1 — 2026-08-29

- *Add phase* and *Rename phase* work again. They asked with `window.prompt`,
  which Electron refuses outright, so the button appeared to do nothing at
  all. Both now open a proper little dialog — with a hint that `📅 2026-09-30`
  at the end sets the phase's target date.

## 1.19.0 — 2026-08-29

- Wikilinks in a project's next action are links again, not raw `[[brackets]]`
  — in Projects, Horizons and Calendar alike.

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
