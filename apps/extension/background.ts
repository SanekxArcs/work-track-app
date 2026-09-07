import { breakStreakStartedAt, dueRestTypes } from "./shared/rest"
import type { AppSnapshot, RestType } from "./shared/types"

const baseUrl = "http://127.0.0.1:49837"
const accessKeyName = "workBuddyExtensionAccessKey"
const restReminderAlarm = "workBuddyRestReminder"
const notifiedRestsKey = "workBuddyNotifiedRests"

const allowedMethods = new Set([
  "getAppVersion", "getSnapshot", "getHistory", "getDaySnapshot", "getOvertimeOverview", "setOvertimeRedeemed",
  "startWorkday", "endWorkday", "startTask", "pauseTask", "resumeTask", "stopTask", "pauseAllTasks", "stopAllTasks",
  "startRest", "pauseRest", "resumeRest", "completeRest", "skipRest", "updateRestStart", "setRestAlarmMuted",
  "updateTask", "mergeTasks", "deleteTask", "createPlannedTask", "updatePlannedTask", "deletePlannedTask",
  "createProject", "updateProject", "updateSettings", "saveAiKey", "exportBackup", "chooseBackupImport",
  "applyBackupImport", "exportDayCalendar", "suggestTask", "interpretVoiceTask", "transcribeVoice", "summarizeDay",
  "notify", "chooseNotificationSound", "getCustomSoundData"
])

type BridgeMessage = { scope: "work-buddy"; kind: "health" } | { scope: "work-buddy"; kind: "invoke"; method: string; args: unknown[] }

async function accessKey(): Promise<string> {
  const data = await chrome.storage.local.get(accessKeyName)
  return typeof data[accessKeyName] === "string" ? data[accessKeyName] : ""
}

async function handle(message: BridgeMessage): Promise<unknown> {
  if (message.kind === "health") {
    const response = await fetch(`${baseUrl}/health`, { cache: "no-store" })
    if (!response.ok) throw new Error("Work Buddy is not running")
    return response.json()
  }
  if (!allowedMethods.has(message.method)) throw new Error("Unsupported Work Buddy action")
  const key = await accessKey()
  if (!key) throw new Error("Pair this extension with Work Buddy first")
  const response = await fetch(`${baseUrl}/api`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Work-Buddy-Key": key,
      "X-Work-Buddy-Client": chrome.runtime.id
    },
    body: JSON.stringify({ method: message.method, args: message.args })
  })
  const body = await response.json() as { result?: unknown; error?: string }
  if (!response.ok) throw new Error(body.error ?? "Work Buddy request failed")
  return body.result
}

function notificationCopy(type: RestType, snapshot: AppSnapshot): { title: string; message: string } {
  const uk = snapshot.settings.locale === "uk"
  if (type === "lunch") return uk
    ? { title: "Друже, час поїсти 🍜", message: `Забирай свої ${snapshot.settings.lunch.durationMinutes} хвилин на обід.` }
    : { title: "Buddy, food time 🍜", message: `Take your ${snapshot.settings.lunch.durationMinutes}-minute lunch.` }
  return uk
    ? { title: "Гей, видихни трохи 👋", message: `Відлипни від екрана хоча б на ${snapshot.settings.breaks.durationMinutes} хв.` }
    : { title: "Hey, take a breather 👋", message: `Step away from the screen for at least ${snapshot.settings.breaks.durationMinutes} minutes.` }
}

function restNoticeKey(type: RestType, snapshot: AppSnapshot): string | null {
  const workday = snapshot.workday
  if (!workday) return null
  if (type === "lunch") return `lunch:${workday.id}`
  return `break:${workday.id}:${breakStreakStartedAt(workday, snapshot.rests)}`
}

async function checkRestReminders(): Promise<void> {
  const key = await accessKey()
  if (!key) return
  const snapshot = await handle({ scope: "work-buddy", kind: "invoke", method: "getSnapshot", args: [] }) as AppSnapshot
  const due = dueRestTypes(snapshot.settings, snapshot.workday, snapshot.rests, snapshot.tasks, snapshot.now)
  const stored = await chrome.storage.local.get(notifiedRestsKey)
  const notified = typeof stored[notifiedRestsKey] === "object" && stored[notifiedRestsKey] !== null
    ? stored[notifiedRestsKey] as Record<string, number>
    : {}
  const now = snapshot.now
  const recent = Object.fromEntries(Object.entries(notified).filter(([, notifiedAt]) => typeof notifiedAt === "number" && now - notifiedAt < 48 * 60 * 60 * 1000)) as Record<string, number>

  for (const type of due) {
    const noticeKey = restNoticeKey(type, snapshot)
    if (!noticeKey || recent[noticeKey]) continue
    const copy = notificationCopy(type, snapshot)
    await chrome.notifications.create(`work-buddy-${noticeKey}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL(chrome.runtime.getManifest().icons?.["128"] ?? ""),
      title: copy.title,
      message: copy.message,
      priority: 2
    })
    recent[noticeKey] = now
  }

  await chrome.storage.local.set({ [notifiedRestsKey]: recent })
}

function scheduleRestReminders(): void {
  chrome.alarms.create(restReminderAlarm, { periodInMinutes: 1 })
  void checkRestReminders().catch(() => undefined)
}

chrome.runtime.onInstalled.addListener(scheduleRestReminders)
chrome.runtime.onStartup.addListener(scheduleRestReminders)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === restReminderAlarm) void checkRestReminders().catch(() => undefined)
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[accessKeyName]) void checkRestReminders().catch(() => undefined)
})
scheduleRestReminders()

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || typeof message !== "object" || message === null) return
  const candidate = message as Partial<BridgeMessage>
  if (candidate.scope !== "work-buddy" || (candidate.kind !== "health" && candidate.kind !== "invoke")) return
  void handle(candidate as BridgeMessage).then(
    (result) => sendResponse({ ok: true, result }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Work Buddy request failed" })
  )
  return true
})
