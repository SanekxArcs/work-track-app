import type { PlasmoCSConfig } from "plasmo"
import cssText from "data-text:~style.css"
import { useEffect, useRef, useState } from "react"
import App from "../renderer/App"
import type { WorkBuddyApi } from "../shared/types"
import { getAccessKey, getServerHealth, remoteApi, saveAccessKey } from "../lib/remote-api"

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

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => chrome.storage.local.get(key, (value) => resolve(value[key] as T | undefined)))
}

function storageSet(value: Record<string, Position>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve))
}

function PairingCard({ onPaired }: { onPaired: () => void }): React.JSX.Element {
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking")
  const [error, setError] = useState("")

  useEffect(() => {
    void getServerHealth().then(() => setStatus("online")).catch(() => setStatus("offline"))
  }, [])

  const pair = async (): Promise<void> => {
    setError("")
    try {
      await saveAccessKey(key)
      await remoteApi.getSnapshot()
      onPaired()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося підключитися")
    }
  }

  return <section className="extension-pairing-card">
    <div className="brand-mark"><span /></div>
    <p className="eyebrow">Work Buddy у браузері</p>
    <h2>{status === "online" ? "Підключи extension" : "Work Buddy зараз недоступний"}</h2>
    <p>{status === "online" ? "У Windows-додатку відкрий Налаштування → Chrome extension, скопіюй ключ і встав його сюди один раз." : "Запусти Work Buddy. Він має працювати на цьому комп’ютері."}</p>
    {status !== "offline" && <>
      <input autoFocus value={key} onChange={(event) => setKey(event.target.value)} placeholder="Ключ підключення" aria-label="Ключ підключення" />
      <button className="primary-button" disabled={!key.trim()} onClick={() => void pair()}>Підключити Work Buddy</button>
    </>}
    {error && <small className="extension-pairing-error">{error}</small>}
    <small className={`extension-pairing-status extension-pairing-status--${status}`}><i />{status === "checking" ? "Перевіряю сервер…" : status === "online" ? "Сервер Work Buddy увімкнено" : "Немає з’єднання з локальним сервером"}</small>
  </section>
}

export default function WorkBuddyContent(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [paired, setPaired] = useState<boolean | null>(null)
  const [position, setPosition] = useState<Position>({ x: Math.max(12, window.innerWidth - 46), y: Math.round(window.innerHeight * .42) })
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: Position; last: Position; moved: boolean } | null>(null)

  useEffect(() => {
    window.workBuddy = remoteApi
    void getAccessKey().then((key) => setPaired(Boolean(key)))
    void storageGet<Position>(positionKey).then((stored) => {
      if (stored) setPosition(stored)
    })
    const hide = (): void => setOpen(false)
    window.addEventListener("work-buddy-extension-hide", hide)
    return () => window.removeEventListener("work-buddy-extension-hide", hide)
  }, [])

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
    const next = {
      x: Math.min(Math.max(8, active.origin.x + dx), window.innerWidth - 38),
      y: Math.min(Math.max(8, active.origin.y + dy), window.innerHeight - 38)
    }
    active.last = next
    setPosition(next)
  }

  const onPointerUp = (): void => {
    const active = drag.current
    drag.current = null
    if (!active) return
    if (active.moved) void storageSet({ [positionKey]: active.last })
    else setOpen((shown) => !shown)
  }

  return <div className="work-buddy-extension-root">
    <button
      className={`work-buddy-float ${open ? "work-buddy-float--open" : ""}`}
      style={{ left: position.x, top: position.y }}
      aria-label="Відкрити Work Buddy"
      title="Work Buddy"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}>
      <span />
    </button>
    {open && <aside className="work-buddy-drawer" aria-label="Work Buddy">
      {paired ? <App /> : <PairingCard onPaired={() => setPaired(true)} />}
    </aside>}
  </div>
}
