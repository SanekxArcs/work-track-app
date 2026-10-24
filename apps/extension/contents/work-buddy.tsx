import type { PlasmoCSConfig } from "plasmo"
import cssText from "data-text:~style.css"
import { useEffect, useMemo, useRef, useState } from "react"
import App from "../renderer/App"
import { browserLocale, translator, type Translator } from "../renderer/lib/i18n"
import type { Locale, WorkBuddyApi } from "../shared/types"
import { accessKeyName, clearAccessKey, getAccessKey, getServerHealth, remoteApi } from "../lib/remote-api"

declare global {
  interface Window {
    workBuddy: WorkBuddyApi
  }
}

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

// A closed shadow root keeps the panel out of reach of page scripts: they can
// neither read what it shows nor synthesise clicks inside it.
export const createShadowRoot = (host: HTMLElement): ShadowRoot => host.attachShadow({ mode: "closed" })

export const getStyle = (): HTMLStyleElement => {
  const style = document.createElement("style")
  // The desktop stylesheet is shared verbatim. In a Plasmo Shadow DOM the
  // extension host replaces :root as the appropriate variables scope.
  style.textContent = cssText.replaceAll(":root", ":host")
  return style
}

type Position = { x: number; y: number }
const positionKey = "workBuddyFloatingButtonPosition"
const localeKey = "workBuddyLocale"
const buttonSize = 30
const edgeGap = 8

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => chrome.storage.local.get(key, (value) => resolve(value[key] as T | undefined)))
}

function storageSet(value: Record<string, Position | Locale>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve))
}

/** Keeps the floating button reachable when the saved spot is off-screen in this window. */
function clampPosition(position: Position): Position {
  const maxX = Math.max(edgeGap, window.innerWidth - buttonSize - edgeGap)
  const maxY = Math.max(edgeGap, window.innerHeight - buttonSize - edgeGap)
  return {
    x: Math.min(Math.max(edgeGap, Number(position.x) || 0), maxX),
    y: Math.min(Math.max(edgeGap, Number(position.y) || 0), maxY)
  }
}

// Keys typed in the panel must not reach the host page's shortcuts
// (YouTube "k", GitHub "/"). React handles the events inside first.
const stopPropagation = (event: React.SyntheticEvent): void => event.stopPropagation()

function PairingCard({ t, expired }: { t: Translator; expired: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking")

  useEffect(() => {
    void getServerHealth().then(() => setStatus("online")).catch(() => setStatus("offline"))
  }, [])

  // The key is never typed into a web page. Pairing happens in the toolbar
  // popup, which no site can observe; this card only explains where to go.
  return <section className="extension-pairing-card">
    <div className="brand-mark"><span /></div>
    <p className="eyebrow">{t("pairingEyebrow")}</p>
    <h2>{status === "offline" ? t("pairingOfflineTitle") : t("pairingTitle")}</h2>
    <p>{status === "offline" ? t("pairingOfflineBody") : t("pairingPopupBody")}</p>
    {expired && status !== "offline" && <small className="extension-pairing-notice">{t("pairingExpired")}</small>}
    <small className={`extension-pairing-status extension-pairing-status--${status}`}><i />{status === "checking" ? t("pairingChecking") : status === "online" ? t("pairingOnline") : t("pairingOffline")}</small>
  </section>
}

export default function WorkBuddyContent(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [paired, setPaired] = useState<boolean | null>(null)
  const [pairingExpired, setPairingExpired] = useState(false)
  const [locale, setLocale] = useState<Locale>(browserLocale)
  const [position, setPosition] = useState<Position>(() => clampPosition({ x: window.innerWidth - 46, y: Math.round(window.innerHeight * .42) }))
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: Position; last: Position; moved: boolean } | null>(null)
  const t = useMemo(() => translator(locale), [locale])

  useEffect(() => {
    window.workBuddy = remoteApi
    void getAccessKey().then((key) => setPaired(Boolean(key))).catch(() => setPaired(false))
    void storageGet<Position>(positionKey).then((stored) => {
      if (stored) setPosition(clampPosition(stored))
    }).catch(() => undefined)
    void storageGet<Locale>(localeKey).then((stored) => {
      if (stored === "uk" || stored === "en") setLocale(stored)
    }).catch(() => undefined)
    const hide = (): void => setOpen(false)
    const keepOnScreen = (): void => setPosition((current) => clampPosition(current))
    // Pairing and unpairing happen in the popup; open pages follow the stored key.
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== "local" || !(accessKeyName in changes)) return
      const next = Boolean(changes[accessKeyName].newValue)
      setPaired(next)
      if (next) setPairingExpired(false)
    }
    window.addEventListener("work-buddy-extension-hide", hide)
    window.addEventListener("resize", keepOnScreen)
    chrome.storage.onChanged.addListener(onStorage)
    return () => {
      window.removeEventListener("work-buddy-extension-hide", hide)
      window.removeEventListener("resize", keepOnScreen)
      chrome.storage.onChanged.removeListener(onStorage)
    }
  }, [])

  const rememberLocale = (next: Locale): void => {
    setLocale(next)
    void storageSet({ [localeKey]: next }).catch(() => undefined)
  }

  const unpair = (): void => {
    setPairingExpired(true)
    void clearAccessKey().catch(() => undefined).finally(() => setPaired(false))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position, last: position, moved: false }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) active.moved = true
    if (!active.moved) return
    const next = clampPosition({ x: active.origin.x + dx, y: active.origin.y + dy })
    active.last = next
    setPosition(next)
  }

  const onPointerUp = (): void => {
    const active = drag.current
    drag.current = null
    if (!active) return
    if (active.moved) void storageSet({ [positionKey]: active.last }).catch(() => undefined)
    else setOpen((shown) => !shown)
  }

  return <div
    className="work-buddy-extension-root"
    onKeyDown={stopPropagation}
    onKeyUp={stopPropagation}
    onKeyPress={stopPropagation}
    onInput={stopPropagation}
    onPaste={stopPropagation}
    onCopy={stopPropagation}
    onCut={stopPropagation}>
    <button
      className={`work-buddy-float ${open ? "work-buddy-float--open" : ""}`}
      style={{ left: position.x, top: position.y }}
      aria-label={t("openWorkBuddy")}
      title="Work Buddy"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}>
      <span />
    </button>
    {open && <aside className="work-buddy-drawer" aria-label="Work Buddy">
      {paired
        ? <App onUnpaired={unpair} onLocale={rememberLocale} />
        : <PairingCard t={t} expired={pairingExpired} />}
    </aside>}
  </div>
}
