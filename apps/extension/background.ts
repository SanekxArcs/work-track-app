const baseUrl = "http://127.0.0.1:49837"
const accessKeyName = "workBuddyExtensionAccessKey"

// Break and lunch reminders are shown natively by the desktop app. The
// extension only works while that app runs, so it does not repeat them.

const allowedMethods = new Set([
  "getAppVersion", "getSnapshot", "getHistory", "getDaySnapshot", "getOvertimeOverview", "setOvertimeRedeemed",
  "startWorkday", "endWorkday", "startTask", "pauseTask", "resumeTask", "stopTask", "pauseAllTasks", "stopAllTasks",
  "startRest", "pauseRest", "resumeRest", "completeRest", "skipRest", "updateRestStart", "setRestAlarmMuted",
  "updateTask", "mergeTasks", "deleteTask", "createPlannedTask", "updatePlannedTask", "deletePlannedTask",
  "createProject", "updateProject", "updateSettings", "saveAiKey", "exportBackup", "chooseBackupImport",
  "applyBackupImport", "exportDayCalendar", "suggestTask", "interpretVoiceTask", "transcribeVoice", "summarizeDay",
  "notify", "chooseNotificationSound", "getCustomSoundData"
])

type BridgeMessage =
  | { scope: "work-buddy"; kind: "health" }
  | { scope: "work-buddy"; kind: "invoke"; method: string; args: unknown[] }
  | { scope: "work-buddy"; kind: "pair"; key: string }
type BridgeErrorCode = "offline" | "unauthorized"

class BridgeError extends Error {
  constructor(message: string, readonly code: BridgeErrorCode) {
    super(message)
  }
}

async function accessKey(): Promise<string> {
  const data = await chrome.storage.local.get(accessKeyName)
  return typeof data[accessKeyName] === "string" ? data[accessKeyName] : ""
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, { cache: "no-store", ...init })
  } catch {
    throw new BridgeError("Work Buddy is not running", "offline")
  }
}

async function readBody(response: Response): Promise<{ result?: unknown; error?: string }> {
  try {
    return await response.json() as { result?: unknown; error?: string }
  } catch {
    return {}
  }
}

async function callApi(key: string, method: string, args: unknown[]): Promise<unknown> {
  if (!key) throw new BridgeError("Pair this extension with Work Buddy first", "unauthorized")
  const response = await request("/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Work-Buddy-Key": key,
      "X-Work-Buddy-Client": chrome.runtime.id
    },
    body: JSON.stringify({ method, args })
  })
  const body = await readBody(response)
  if (response.status === 401) throw new BridgeError(body.error ?? "Pair this extension with Work Buddy first", "unauthorized")
  if (!response.ok) throw new Error(body.error ?? "Work Buddy request failed")
  return body.result
}

async function handle(message: BridgeMessage): Promise<unknown> {
  if (message.kind === "health") {
    const response = await request("/health")
    if (!response.ok) throw new BridgeError("Work Buddy is not running", "offline")
    return response.json()
  }
  if (message.kind === "pair") {
    // Store the key only once the desktop app has accepted it, so a mistyped
    // key never counts as a successful pairing.
    const key = message.key.trim()
    await callApi(key, "getSnapshot", [])
    await chrome.storage.local.set({ [accessKeyName]: key })
    return null
  }
  if (!allowedMethods.has(message.method)) throw new Error("Unsupported Work Buddy action")
  return callApi(await accessKey(), message.method, message.args)
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || typeof message !== "object" || message === null) return
  const candidate = message as Partial<BridgeMessage>
  if (candidate.scope !== "work-buddy" || (candidate.kind !== "health" && candidate.kind !== "invoke" && candidate.kind !== "pair")) return
  if (candidate.kind === "pair" && typeof candidate.key !== "string") return
  void handle(candidate as BridgeMessage).then(
    (result) => sendResponse({ ok: true, result }),
    (error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Work Buddy request failed",
      code: error instanceof BridgeError ? error.code : undefined
    })
  )
  return true
})
