# Work Buddy

Work Buddy is a friendly, local-first desktop time tracker for real workdays: parallel tasks, manual breaks, lunch, history, planned work, and gentle reminders — all in a compact always-on-top widget.

The interface is available in Ukrainian and English.

## Highlights

- Parallel task timers with quick Play/Pause controls and projects
- Workday, lunch, and manual-break tracking with actual-duration summaries
- Six-month GitHub-style history map and editable daily timeline
- Planned-task backlog that can be attached to a tracked task
- Gemini-powered task refinement and optional voice input
- Optional Google Calendar export to a separate Work Buddy calendar
- Portable `.workbuddy.json` backups with Merge or Replace restore modes
- Per-day `.ics` calendar export for a manual Google Calendar import
- Tray controls, autostart, reminders, custom sounds, and desktop-transparent UI
- Local SQLite storage; the tracker works offline

## Tech stack

- Electron 43
- React 19 + TypeScript + Vite
- Tailwind CSS 4 and Motion
- SQLite via Electron's built-in `node:sqlite`

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer
- npm (bundled with Node.js)
- Git

To produce a distributable app, run the platform-specific command on the same operating system you are targeting. This is the most reliable way to package native Electron dependencies and installers.

| Target | Recommended build host | Output |
| --- | --- | --- |
| Windows | Windows 10/11 | NSIS `.exe` installer |
| macOS | macOS | `.dmg` and `.zip` |
| Linux | Linux | `.AppImage` and `.deb` |

## Quick start

```bash
git clone <your-repository-url>
cd work-track-app
npm ci
npm run dev
```

`npm ci` installs the exact dependency versions from `package-lock.json`. Use `npm install` instead if you intentionally need to update the lockfile.

## Development commands

```bash
# TypeScript checks for Electron and the renderer
npm run typecheck

# Production build without creating an installer
npm run build

# Run the packaged application locally
npm run preview

# Regenerate the app icon assets after changing the icon script
npm run generate:icons
```

## Build installers

All release files are written to `release-v<version>/`, where `<version>` comes from `package.json`.

### Windows

Run this on Windows:

```powershell
npm ci
npm run dist:win
```

The installer will be similar to:

```text
release-v0.8.10/Work Buddy Setup 0.8.10.exe
```

### macOS

Run this on macOS:

```bash
npm ci
npm run dist:mac
```

This produces a `.dmg` for normal installation and a `.zip` archive in the release folder.

For a public macOS release, configure an Apple Developer ID certificate and notarization credentials in the build environment. Without them, macOS may show a Gatekeeper warning for the unsigned development build.

### Linux

Run this on Linux:

```bash
npm ci
npm run dist:linux
```

This produces both an `.AppImage` and a Debian/Ubuntu `.deb` package. To run an AppImage after downloading it:

```bash
chmod +x "Work Buddy-<version>.AppImage"
./"Work Buddy-<version>.AppImage"
```

For a Debian-based system, install the `.deb` with:

```bash
sudo apt install ./work-buddy_<version>_amd64.deb
```

## Configuration

### Gemini

Gemini features are opt-in. In **Settings → AI sidekick**, enter your own Gemini API key and choose a model. The key is stored using Electron `safeStorage` where the operating system supports it.

Voice input is push-to-record: Work Buddy asks for microphone permission only after you press the microphone button. The recorded short command is sent to Gemini solely to transcribe and structure that command; it is not saved by Work Buddy.

### Google Calendar

Google Calendar sync is optional. Create a Google OAuth client of type **Desktop app**, enable the Calendar API, paste the client ID under **Settings → Google Calendar**, and connect your account. Work Buddy creates and writes only to its own separate calendar.

For a one-off daily export without connecting Google, open **Day**, select a day from history, and choose **Export `.ics`**. Import that file manually in Google Calendar.

### Sanity Cloud Sync

Sanity sync is optional and keeps one cloud snapshot of tracker data. Press **Settings → Sanity Cloud Sync → Sync with Sanity** to merge the cloud snapshot with the local history, then save the merged result back to Sanity. Gemini, Google OAuth, and Sanity credentials are excluded from both cloud data and portable backups.

For development, place these values in a local `.env` file (it is gitignored):

```text
NEXT_PUBLIC_SANITY_PROJECT_ID=...
NEXT_PUBLIC_SANITY_DATASET=...
NEXT_PUBLIC_SANITY_API_VERSION=2026-08-21
NEXT_PUBLIC_SANITY_API_TOKEN_FULL_CONTROL=...
```

For an installed build, use **Choose Sanity .env** once in Settings. The token is then encrypted through the operating system’s secure storage and the `.env` file is not copied into the app. Prefer a dedicated Sanity project robot token with only Content Lake read/write access over a personal or full-control token.

### Backups

In **Settings → Backup**, export a portable `.workbuddy.json` file. Imports offer two modes: **Merge** adds the backup data to the current local database; **Replace** replaces the local tracker data and regular settings. Gemini API keys, Google OAuth tokens, and Gemini/Google integration settings are never written to backups.

## Project structure

```text
src/
  main/       Electron lifecycle, SQLite, reminders, Gemini, Google Calendar
  preload/    Secure typed IPC bridge
  renderer/   React interface, styles, interactions
  shared/     Shared types, IPC channels, and time/rest helpers
build/        Application icon assets
scripts/      Asset-generation scripts
```

## Data and privacy

The core tracker is local-first: projects, tasks, intervals, planned tasks, settings, and history are stored in a local SQLite database. No screenshots or window contents are collected.

Gemini and Google Calendar are opt-in integrations. Only data needed for the requested AI command or calendar export leaves the app.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| Dependencies fail to install | Confirm `node --version` is 22 or newer, then remove `node_modules` and run `npm ci` again. |
| Voice input does not start | Allow microphone permission for Work Buddy in your operating-system privacy settings. |
| macOS blocks the app | This is expected for an unsigned local build. Use an Apple Developer certificate/notarization for public distribution. |
| Linux AppImage does not open | Make it executable with `chmod +x`; some distributions also require FUSE support. |
