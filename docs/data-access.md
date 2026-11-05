# Data access for other apps

Work Buddy is a manual time tracker. Other local apps, such as an activity collector or an MCP server, read and write its data through two paths. Both are local first; the cloud is a backup copy.

## Local bridge (primary)

Work Buddy runs an HTTP server on `http://127.0.0.1:49837` while the app is open. The key is shown in **Settings → Data connections**. Send it as the `X-Work-Buddy-Key: <key>` header.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness check, no key needed. |
| `GET /events` | Server-sent events; a message arrives whenever tracked data changes. |
| `POST /api` | JSON body `{ "method": "...", "args": [...] }`; returns `{ "result": ... }` or `{ "error": "..." }`. |

Read methods: `getSnapshot` (projects, tasks, intervals, workday, rests, settings), `getHistory`, `getDaySnapshot(day)`, `getOvertimeOverview`.

Write method for collectors: `importTasks(day, entries)`. Each entry is `{ key, intervals: [{ start, end }], projectId, notes }`. `key` is a stable 64-character hex string chosen by the producer; sending the same key again is idempotent. Ranges must be closed, inside the given local day, in the past, and must not overlap tracked tasks or breaks. The result is `{ snapshot, taskIds, created }`. Imports never start a timer or a workday.

All other task, project, rest and workday methods used by the Chrome extension are also available; they change data, so call them deliberately.

## Convex backup (secondary)

When cloud sync is enabled, the same snapshot is uploaded to `/work-buddy/snapshot` on the configured Convex deployment and can be read back with the read key. See [convex-sync.md](convex-sync.md). Use it when Work Buddy is not running; it lags the local bridge by the configured sync interval.

## What is not here

PC and browser activity collection no longer lives in Work Buddy. The activity endpoints on Convex (`/work-buddy/activity`, `/work-buddy/projects`, `/work-buddy/project-link`) remain deployed for the separate collector and Nested Tab Manager. The old local `activity.sqlite` file is not opened anymore and can be deleted.
