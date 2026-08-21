# Work Buddy product direction

## Product promise

Work Buddy is a friendly floating sidekick that keeps time visible, supports genuinely parallel work, and helps the user maintain a healthier work rhythm without sounding corporate or judgmental.

## Core model

`Workday → Tasks → Time intervals`

Tasks may have overlapping intervals. Reports must therefore keep these metrics distinct:

- workday span;
- real active coverage, calculated as the union of intervals;
- summed task time, which may exceed the workday span;
- overlapping/parallel time;
- context switches.

## Current scope

The v0.2 implementation includes the complete local tracking loop, projects and tags, bilingual friendly UI, configurable breaks and lunch, wellness prompts, tray/autostart behavior, a daily branch-style timeline, instant timer creation, an adaptive compact timer bar, and end-of-day naming review.

## Retained roadmap

Nothing from the original product discussion is discarded. The following features are intentionally staged after the stable local core.

### Reporting and editing

- Manual interval creation and correction
- Search and full historical browser
- Weekly and monthly reports
- Project/category breakdowns and goals
- CSV and JSON export
- Local backup and restore
- Optional Pomodoro mode

### AI assistant

The AI layer should be provider-agnostic, with Gemini available through a user-supplied API key.

- Suggest names for unnamed tasks from notes and known context
- Normalize inconsistent task names
- Infer a project and tags from the user's task history
- Merge or link similar tasks
- Produce a friendly end-of-day status summary
- Detect unusually fragmented periods and excessive switching
- Surface repeated work that may be automated
- Draft stand-up/status-update text
- Suggest calendar event titles and descriptions

AI must remain optional. The app should show exactly what text will be sent, avoid screenshots by default, and keep tracking functional offline.

### Calendar and integrations

- Google Calendar synchronization
- Optional calendar block creation from tracked intervals
- GitHub, Jira, Linear, Todoist, and similar task sources
- Cross-device synchronization

### Balance and smarter reminders

- Acknowledge, snooze, skip, or complete reminders directly from an in-app banner
- Track completed wellness actions without gamification pressure
- Adapt break timing around meetings, active calls, and recent idle time
- Offer water, stretching, push-ups, eye rest, or custom actions at suitable breaks
- Review yesterday's unfinished tasks when starting a new day

## Tone principles

- Speak like a supportive friend, not HR software.
- Nudge; do not shame.
- Keep messages short and varied.
- Respect focus mode and allow every reminder category to be disabled.
- Ukrainian and English copy should be authored naturally, not translated word-for-word.
