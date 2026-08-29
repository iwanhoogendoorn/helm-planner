# Helm's local API

Helm can serve JSON on this machine so other tools — scripts, shortcuts, an AI agent — can read and
change your tasks **through Helm** rather than by editing markdown behind its back. Every call runs the
same code the buttons run, so ids, daily-note mirrors, the Helm region, subtasks travelling with their
task and every other rule stay intact.

## Switching it on

Settings → **Local API**:

1. Turn on **Serve the API**. A token is generated the first time.
2. Copy the token. Change the port if 27125 is taken.

It listens on `127.0.0.1` only — never a network interface — and Obsidian has to be running.

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
`project`, `phase`, `scheduled`, `due`, `part`, `time`, `effortMinutes`, `priority`, `tags`, `links`,
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
  "text": "New wording", "due": null, "effortMinutes": 45, "priority": "normal" }
```

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

## Why not the Local REST API plugin?

That plugin serves *files*: it can read and write the markdown, which is enough to see your tasks but
not to change them safely. Scheduling a task is not "add `⏳ 2026-08-31` to a line" — Helm also mirrors
it into the daily note, keeps the Helm region in order, moves the subtasks with it and gives the line an
id if it needs one. Bytes in, bytes out cannot do that. Use the Local REST API for reading notes, and
this API for anything that changes a task.
