# Convex sync setup

Work Buddy keeps SQLite as the primary database. It uploads a complete work-data snapshot every 12 hours by default (6 or 24 hours are also available). This is one-way publishing: other apps can read the cloud copy; their edits are not imported into Work Buddy.

## Connected development deployment

The backend has been deployed to `clear-parrot-65` in Europe (Ireland).

- Cloud URL: `https://clear-parrot-65.eu-west-1.convex.cloud`
- HTTP Actions URL for Work Buddy: `https://clear-parrot-65.eu-west-1.convex.site`
- [Convex dashboard](https://dashboard.convex.dev/t/oleksandr-dzisiak-gmail-com/work/clear-parrot-65)

This is a development deployment. Backend deployment, access-key setup, the first upload, and authenticated read-back are complete. Work Buddy is configured for uploads every 12 hours; restart the updated app to load the saved connection. Use separate generated read/write keys for the endpoints, not the Convex deployment key. No deployment key is embedded in the app or installer.

Local integration settings are saved in `.env.workbuddy-reader` (read-only credentials for a trusted consumer) and `.env.workbuddy-sync` (private uploader configuration). Both files are ignored by Git and excluded from the installer. The uploader key in the desktop SQLite secrets table is encrypted by Windows secure storage. Keep the reader configuration in a server or trusted local app; do not expose it in a public browser bundle.

## Create another Convex project

1. Run `npx convex dev --once` from this repository, sign in, and choose **Create a new project**. This deploys the `convex/` backend and records your deployment in `.env.local`.
2. Generate two different random secrets of at least 32 characters using your password manager. In the Convex dashboard, open **Settings → Environment Variables** and add `WORK_BUDDY_WRITE_KEY` and `WORK_BUDDY_READ_KEY`. Use different values. Both are required; requests fail closed until they are configured.
3. Copy the deployment's **HTTP Actions URL**, which ends in `.convex.site`. Do not use the `.convex.cloud` client URL.
4. In Work Buddy → Settings → Convex sync, paste the site URL and write key, enable automatic upload, select the interval, and click **Sync now**.
5. Copy the **Source ID** shown there. Give other trusted apps the site URL, source ID, and read key. Keep the write key only in Work Buddy.

For a production deployment, run `npx convex deploy`, then configure the two keys on the production deployment and use its `.convex.site` URL in Work Buddy. Creating/deploying the project requires your own Convex login; no project is created by building the installer.

## Reading from another app

Call this from your app's server or a trusted local app. A public browser bundle cannot keep a shared read key private; use your own authenticated server endpoint for browser clients. CORS is intentionally not enabled for direct public-browser access.

```js
const url = new URL('/work-buddy/snapshot', process.env.WORK_BUDDY_SITE_URL)
url.searchParams.set('sourceId', process.env.WORK_BUDDY_SOURCE_ID)
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.WORK_BUDDY_READ_KEY}` },
})
if (!response.ok) throw new Error(`Work Buddy returned ${response.status}`)
const { syncedAt, data } = await response.json()
// data.projects, data.plannedTasks, data.tasks (including time intervals),
// data.workdays, data.rests, data.projectStatuses, data.projectTypes,
// data.overtimeRedeemedDates, data.exportedAt, data.sourceId, data.schemaVersion
```

`GET /work-buddy/snapshot?sourceId=...` requires the read key. `PUT /work-buddy/snapshot` requires the write key. A read key cannot upload. Keys cover this personal deployment's sources; this is not a multi-user authorization system. Rotate a key in Convex environment variables and update its consumers if access should be revoked. Do not give consumers a Convex deploy/admin key.

## Timing and behavior

- Uploads happen while the desktop app is running, including in the tray. A closed app cannot upload. Sleep/offline time can delay an upload; overdue sync is attempted on startup or within a minute after waking.
- Last success and attempt times survive restart. Network/server failures retry after 30 minutes. **Sync now** permits an immediate manual retry. Closing the app cancels an in-flight upload.
- A new upload atomically replaces the previous snapshot for this installation's source ID; deletions are reflected in the next snapshot. Each installation has its own source ID, so two computers do not overwrite each other. This does not merge their data.
- Read responses include `syncedAt` (server receipt time) and `data.exportedAt` (the captured data time). Show this time in other apps. Running intervals have `endedAt: null`: cap calculations at `exportedAt` until the next upload, rather than assuming the timer kept running in the meantime.
- The server stores a small indexed metadata document in `workBuddySnapshots` and a private JSON file in Convex storage, avoiding the per-document size limit. It retains the latest snapshot per source, not a backup history. Snapshot size is limited to 10 MB; exceeding it shows an error and preserves the last good cloud copy.
- Uploaded data includes task/project names, notes, tags, planned tasks, intervals, workdays, breaks, project labels, and redeemed overtime dates. AI keys, extension access keys, sync credentials, local file paths, and device settings are excluded. The desktop write key uses Windows secure storage and is excluded from backup exports.
- Disabling automatic upload stops publishing; it does not delete the existing cloud copy. To remove cloud data, delete the source's `workBuddySnapshots` record and its referenced storage file in the Convex dashboard.
- The Chrome extension continues to use the desktop app's local connection. Its changes are included in the next desktop upload.

## Validation

`npx tsc -p convex/tsconfig.json` checks backend types without a deployment. `npm test` covers interval/restart/retry behavior, credential separation, payload filtering, concurrent upload handling, and shutdown. A successful local build does not confirm a live cloud deployment; after setup, use **Sync now** and make an authenticated GET request from a consumer to check it end to end.

Official references: [HTTP actions](https://docs.convex.dev/functions/http-actions), [storing files](https://docs.convex.dev/file-storage/store-files).
