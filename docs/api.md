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
