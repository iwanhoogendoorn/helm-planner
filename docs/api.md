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
