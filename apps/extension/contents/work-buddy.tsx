import type { PlasmoCSConfig } from "plasmo"
import cssText from "data-text:~style.css"
import { useEffect, useMemo, useRef, useState } from "react"
import App from "../renderer/App"
import { browserLocale, translator, type Translator } from "../renderer/lib/i18n"
import type { Locale, WorkBuddyApi } from "../shared/types"
import { clearAccessKey, getAccessKey, getServerHealth, pairWithKey, remoteApi, remoteErrorCode } from "../lib/remote-api"

declare global {
  interface Window {
    workBuddy: WorkBuddyApi
  }
}

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

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

function PairingCard({ t, expired, onPaired }: { t: Translator; expired: boolean; onPaired: () => void }): React.JSX.Element {
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void getServerHealth().then(() => setStatus("online")).catch(() => setStatus("offline"))
  }, [])

  const pair = async (): Promise<void> => {
    setError("")
    setBusy(true)
    try {
      await pairWithKey(key)
      onPaired()
    } catch (reason) {
      const code = remoteErrorCode(reason)
      if (code === "unauthorized") setError(t("pairingInvalidKey"))
      else if (code === "offline") {
        setStatus("offline")
        setError(t("extensionOffline"))
      } else if (code === "invalidated") setError(t("extensionReloaded"))
      else setError(reason instanceof Error && reason.message ? reason.message : t("pairingFailed"))
    } finally {
      setBusy(false)
    }
  }

  return <section className="extension-pairing-card">
    <div className="brand-mark"><span /></div>
    <p className="eyebrow">{t("pairingEyebrow")}</p>
    <h2>{status === "offline" ? t("pairingOfflineTitle") : t("pairingTitle")}</h2>
    <p>{status === "offline" ? t("pairingOfflineBody") : t("pairingBody")}</p>
    {expired && status !== "offline" && <small className="extension-pairing-notice">{t("pairingExpired")}</small>}
    {status !== "offline" && <>
      <input autoFocus value={key} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && key.trim() && !busy) void pair() }} placeholder={t("pairingKey")} aria-label={t("pairingKey")} />
      <button className="primary-button" disabled={!key.trim() || busy} onClick={() => void pair()}>{t("pairingConnect")}</button>
    </>}
    {error && <small className="extension-pairing-error">{error}</small>}
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
    window.addEventListener("work-buddy-extension-hide", hide)
    window.addEventListener("resize", keepOnScreen)
    return () => {
      window.removeEventListener("work-buddy-extension-hide", hide)
      window.removeEventListener("resize", keepOnScreen)
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
        : <PairingCard t={t} expired={pairingExpired} onPaired={() => { setPairingExpired(false); setPaired(true) }} />}
    </aside>}
  </div>
}
