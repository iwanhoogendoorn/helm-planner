# Branch `iwanhoogendoorn/iphone-api` — what it is and how it was checked

Fourteen commits on top of `5e7b368` (the 1.34.0 changelog), 47 files, +4,348 / −306. Built so
the Helm iPhone app can reach every feature the plugin has, over Tailscale, through the same
mutations the buttons use. Three things in it matter to every Helm user, app or no app: the
index performance fix, the security hardening of the local API, and the Tailscale bind. This
file is the pull-request description; it stays in the repo so the reasoning survives the PR.

## What changed, and why

**Index performance (`ebfbe58`).** `HelmIndex.link()` re-parsed every task's wikilinks once
per drawing to attach drawings to tasks — 451 drawings × 8,500 tasks ≈ four million regex
parses on every index update, and the index updates on every vault modify event, so a large
vault paid about two seconds of CPU per save inside Obsidian. The links are now parsed once
per pass into a map keyed by lower-cased target; both attachment passes look targets up in it;
the per-item phase-id scans use one Set. Same attachments, locked by `tests/data/linkMap.test.ts`
and the existing attachment tests. This was found by the smoke test, not by design.

**Security hardening (`3a285f6`).** The review found two blockers reachable once the API is on
Tailscale: a habit's `iconImage` could name a path outside the vault and `GET /habits/:id/icon`
would serve it (Obsidian's `normalizePath` keeps `..`); an attachment `folder` could name a
path outside the vault and the plugin's `mkdirp` would create it. Fixed in three layers: the API
validates every caller-named path with `src/core/paths.ts`; the two path builders in
`Mutations` refuse an unsafe folder, so the UI is covered too; `ObsidianVault` refuses an
escaping path on read, readBinary, write, writeBinary, createFolder, trash and rename. With it:
control characters refused in every string field, YAML scalars escaped (no frontmatter
injection), unparseable dates/times/effort a 400 instead of silently clearing a field, HH:MM a
real clock time, `/files/binary` serves only index-known icons and drawings, `apiBind: all`
warns. Regression tests in `tests/api/security.test.ts`.

**Tailscale bind (`5d9e37f`).** `apiBind: loopback | tailscale | all`, default `loopback` so
nothing changes for existing users. The Tailscale address is found in `100.64.0.0/10`; no
address → loopback with a logged error and a Notice. Settings show the URL the phone uses.

**API v2 (`30be701` … `0f307b7`, `3a931ff`, `1346979`).** Serialisers in `src/api/json.ts`;
v1 routes untouched; the routes in `docs/api.md` under “API v2”. Every route calls the existing
planner / stats / report / search / habits / conflicts / ai modules or a `Mutations` method.
Six pieces of logic that lived only in the UI moved to `src/data` and are called from both
sides: the Today tab's habit rows, the wrap-up selection, the review checklist, capture's
fields and destination, the selection bar's bulk walk, Fit-the-day's request and proposal
writes. The dev server (`9240ca3`, `npm run serve:dev`) serves the same API over a folder
through `src/data/fsVault.ts`, for developing clients without Obsidian; it refuses a vault
without a `.helm-dev-vault` marker.

## Verification

```
npm test          57 files / 573 tests (baseline 49 / 440), typecheck clean, build clean
security probes   traversal iconImage → 400; icon → 404, 0 bytes; traversal folder → 400,
                  nothing created; YAML newline → 400; /files/binary traversal → 404;
                  invalid date → 400, field kept   (verified independently by the coordinator)
smoke, real copy  184 calls over every route, reads and writes, on a markdown-only copy of the
                  real vault (29,290 files, 8,525 tasks, 56 projects, 451 drawings):
                  148×200, 30×201, 5×404 (deliberate), 1×501 (report.pdf, by design);
                  no 5xx, no throw, nothing over 1 MB; no legitimate payload refused by the
                  new validation
reads             max 79 ms (report?scope=week); everything else under 40 ms
writes            median 36 ms; 92 of 95 under 300 ms (before the index fix: 1.2–20 s each)
index, in-process index.update 1,975 → 33 ms · addTask 1,961 → 39 · setStatus 2,436 → 33 ·
                  deleteTask 1,622 → 31 · addTask on a day 1,598 → 44
inbox payload     3.5 MB → 251 KB after the tab-style cap
```

## Deviations from the contract (all recorded in `docs/API-CONTRACT.md` §15 on the app side)

A mirror line's `ref` is its own key (`tsk-x@date`); `display` is null when identical to
`task`; `planDay` always syncs habits; wrap-up accepts `keep`; habit `pending` and `missed` both
clear the tick and read back `missed`; pause/resume are `active` toggles; `parentId` is refused
on task and project PATCH; phase delete carries tasks rather than removing them; a phase rename
changes its slug; health and phase counts include subtasks; setting `time` does not move a line
between sections; a follow-up on a task with subtasks is Helm's own 500; capture does not apply
the default capture time and refuses an unknown `@Project`; `DELETE /notes` and
`DELETE /drawings` only remove attached files; fit speaks the day row's ref with `sourceRef`
beside it; `POST /report.pdf` is 501.

## Consciously deferred

- **Archive and delete of a project rebuild the whole index** (4.4 s and 1.3 s on the copy).
  Decision: leave it. Rare, destructive operations where correctness beats latency; an
  incremental update of moved files is a separate change with its own tests.
- **`POST /maintenance/rebuild` is a full parse** (6.9 s on the copy). That is what it is for.
- **Real-vault data facts**, not code: the yearly and quarterly notes have an empty `## Goals`
  section (so the API's goals are empty, correctly); five `HELM-T01` duplicate task ids exist
  across daily notes (`tsk-zlecjp`, `tsk-4i2c8o` ×2, `tsk-fa07ry` ×2). Both are visible in
  `GET /diagnostics`.
- **A second “Unreleased” heading sits at CHANGELOG line ~144**, between released versions. It is
  on `main` already (line 116 there) and predates this branch; left alone on purpose.
- Not in the plugin: the per-feature file split on the app side.

## Is it safe to install into a real vault today?

My judgement: yes, with the defaults — and with three things a human should check first.

Why yes. The defaults change nothing for an existing user: the API stays off, and when on stays
on loopback. The one change every user runs whether or not the API is on is the index fix, and
it is the change with the strongest evidence: identical attachments on every existing test plus
a new one that locks the mapping, and a 184-call smoke against a copy of the real vault with
the same statuses before and after. The security work only narrows what is accepted, and the
smoke shows nothing that used to be accepted is now refused.

What I would want a human to check first.

1. **Attachments on the real vault, once, by eye.** Open two or three projects and a couple of
   tasks that have drawings or notes attached and confirm the same attachments show as before.
   The tests say they will; the real vault has shapes the fixture does not, and this is the
   one behaviour the performance fix touches.
2. **The three settings that name folders** — `drawingsFolder`, `notesFolder`, `archiveFolder` —
   must be plain vault-relative folders. A value with `..`, a leading slash or an empty segment
   used to be written to; it is now refused with an error. Anyone who never set them is fine.
3. **A backup or a git commit of the vault before the first run**, as for any release that
   touches the index and the writes. Nothing in this branch writes anywhere on its own, but
   that is the cheap insurance.

Not required, but worth knowing: turning `apiBind` to Tailscale exposes the API to every device
on the tailnet holding the token; `all` exposes it to every network the machine is on and now
says so. The token is in the plugin's `data.json`, as before.

## Not done on purpose

Not pushed, no pull request, not merged. The repository is a published plugin; releasing is
Iwan's call. The branch is local at `1346979` plus this file.
