# PC activity and browser integration

Work Buddy now has a **PC activity** tab (monitor icon). It combines observed Windows activity, Nested Tab Manager browser observations, and manual task intervals. It does not automatically create or alter task timers.

## First-time setup

1. Install the fresh Work Buddy installer and open **PC activity → settings**.
2. Choose **Import .env.workbuddy-sync** and select the connection file already stored in either repository. This imports the private server connection and the paired PC ID. Keys are encrypted with Windows secure storage. Nothing is embedded in the installer.
3. Choose whether to include window titles, review exclusions and retention, and click **Save settings**. Click **Start recording**. Recording starts paused on a new installation; window titles start disabled.
4. Reload **Nested Tab Manager** in `chrome://extensions`, reopen its panel, and go to **Tracker → Options → Work Buddy connection**. Import the same `.env.workbuddy-sync`, then click **Connect and allow server access**. Allow the requested access to your Convex server. Its write key is stored in this browser profile, excluded from builds and backups. Its read key is not imported.
5. Enable **Automatic tracking** in the browser tracker if it is paused. Review its domain exclusions, address detail and retention. Click **Sync now**. In Work Buddy, click the activity refresh button.
6. Also reload the separate **Work Buddy** Chrome companion in `chrome://extensions` after its build/version update.

Both apps must use the same **paired PC ID** for this computer. Each collector has a separate persistent source ID, so it cannot replace another collector's day. Use a different paired PC ID for a different computer. Browser Chrome profile identities remain distinct.

The activity endpoints and daily retention cleanup are deployed to the existing `clear-parrot-65` development backend. Existing manual-work snapshot sync remains separate and keeps its existing schedule. Activity sync runs roughly once a minute while each producer is running. Work Buddy fetches browser activity when its activity page is opened/refreshed and every minute while that page remains open.

## What is recorded

- Windows: foreground process name; optional window title; observed active, idle, and locked intervals. A hidden persistent Windows PowerShell helper reads window metadata every two seconds. It stops with Work Buddy and uses no screenshots or input hooks. No keyboard contents or full executable paths are collected.
- Browser: existing tracker intervals with cleaned URL, page title, domain, workspace/folder or project labels. Query strings, fragments, and URL credentials are always removed before cloud upload, even if local browser history uses full URLs. Browser privacy settings apply again to historical rows before each upload. Incognito, background browser windows and idle behavior follow the existing tracker.
- Manual work: existing task intervals, project names and notes are read for comparison. Activity data is kept in `activity.sqlite`, separate from the existing manual work database.

A foreground app is evidence of what was open, not proof of completed work or attention. Idle can include reading, calls, or watching a presentation. Gaps indicate missing observations; sleep/crash gaps are not filled in. Closing a producer stops its collection. After a crash, the last short uncheckpointed interval may be missing.

## Review and learning

Daily totals show observed active time, manual timer coverage, active time outside timers, and idle/locked time. Windows/browser overlap is counted once: browser detail enriches a Windows browser interval; a Windows non-browser or idle observation wins over a delayed browser checkpoint. Browser-only coverage remains useful when the desktop collector is off. Manual parallel timers are unioned rather than summed.

Switch the breakdown between apps/sites and projects. Click an observation to assign a Work Buddy project, add a note, or exclude it from the review. Exclusions can be restored. Optionally remember a rule for the browser project, domain, or desktop app; rules are explicit local preferences, not model training. Rules and corrections currently live in Work Buddy and are not written back into the browser's project structure.

If AI is enabled in Work Buddy settings, choose **Review data for AI recap**, inspect the exact snapshot, then choose **Send and generate recap**. Only that reviewed snapshot goes to your configured Gemini model. The recap is saved locally with its original evidence references. Changes to privacy/corrections invalidate saved recaps, and removed browser evidence invalidates them after the next cloud refresh. AI is advisory; it never changes task timers. No automatic daily AI call is scheduled.

**Export daily evidence** downloads a JSON review for later inspection. Ordinary Work Buddy manual-work backups do not yet include the separate activity database. Activity recaps/corrections are local to this installation.

## Privacy, retention and deletion

Windows exclusions affect recording and the next Windows cloud upload. Existing local titles are retained when title recording is turned off; excluded rows are filtered out of reviews and uploads. Browser privacy controls remain in Nested Tab Manager. Pausing recording does not disable sync of already recorded data. Turning off cloud sync leaves the last cloud copy.

Windows retention is 7, 30 or 90 calendar days. Browser cloud retention follows its 7/30/90-day setting; unlimited local history is capped at 90 days in the cloud. Expired sources are hidden on read and removed by a daily Convex cleanup. Physical expiry follows the scheduled job and timezone boundaries, so removal can lag the calendar cutoff.

Deleting a Windows day removes local Windows observations and its saved recap, then queues an empty cloud replacement for that source/day. Delete browser observations inside Nested Tab Manager; its next successful sync replaces those cloud rows with an empty day. Offline deletions stay pending. Other collectors and manual task records are preserved. Local exclusions from a review do not delete raw source history.

Connection keys cover this existing personal deployment, including its sources; this is not multi-user account authorization. Keep the connection file private. No Convex deploy/admin credential is included in either app. Use the Convex dashboard to revoke keys or remove a source immediately when a producer will not reconnect.

## Validation completed

- Unit tests cover overlap precedence, source validation, URL cleanup, idle/sleep gaps, opt-in titles, exclusions, durable queue/restart, retries, deletions, corrections and remembered project rules.
- Built Electron UI verified at a 380-pixel window width with an isolated profile; real Windows foreground capture succeeded. AI preview, explicit send and persisted evidence verified with a fixture response, not a live Gemini call.
- Built extension verified in isolated Chromium: connection-file import, optional host permission, sanitized upload, deletion and compact connection layout. Existing foreground/browser activity regression also passed.
- Live Convex verification used synthetic observations only: matching environment files, desktop/browser sources on a shared PC ID, read/write key separation, cleaned readback, and browser-origin uploads/deletions. Test observations were emptied afterward.

Still needs ordinary use: full-day coverage, actual lock/sleep/resume across this machine's Windows configuration, and real AI summary quality. Future stages can add editable activity splits/merges, bidirectional project mapping, suggestion acceptance into manual work entries, and measured optional automatic recording of work.
