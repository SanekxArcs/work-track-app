import "~style.css"
import { useEffect, useMemo, useState } from "react"
import { browserLocale, translator } from "./renderer/lib/i18n"
import type { Locale } from "./shared/types"
import { clearAccessKey, getAccessKey, getServerHealth, pairWithKey, remoteErrorCode } from "./lib/remote-api"

// Pairing lives in the toolbar popup, an extension page no website can read
// or script. Web pages only ever see the floating panel, never the key.
const popupStyle = `
  html, body, #__plasmo { width: 340px; min-height: 380px; overflow: auto; background: var(--bg); color: var(--text); }
  .extension-pairing-card { min-height: 380px; }
  .extension-pairing-card .secondary-button { width: 100%; margin-top: 20px; color: var(--text); background: rgba(255,255,255,.07); }
  .extension-pairing-card .secondary-button:hover { background: rgba(255,255,255,.11); }
`
const localeKey = "workBuddyLocale"

type Health = "checking" | "online" | "offline"

export default function Popup(): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(browserLocale)
  const [paired, setPaired] = useState<boolean | null>(null)
  const [health, setHealth] = useState<Health>("checking")
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const t = useMemo(() => translator(locale), [locale])

  useEffect(() => {
    chrome.storage.local.get(localeKey, (value) => {
      const stored = value[localeKey]
      if (stored === "uk" || stored === "en") setLocale(stored)
    })
    void getAccessKey().then((stored) => setPaired(Boolean(stored))).catch(() => setPaired(false))
    void getServerHealth().then(() => setHealth("online")).catch(() => setHealth("offline"))
  }, [])

  const pair = async (): Promise<void> => {
    setError("")
    setNotice("")
    setBusy(true)
    try {
      await pairWithKey(key)
      setKey("")
      setPaired(true)
      setHealth("online")
    } catch (reason) {
      const code = remoteErrorCode(reason)
      if (code === "unauthorized") setError(t("pairingInvalidKey"))
      else if (code === "offline") {
        setHealth("offline")
        setError(t("extensionOffline"))
      } else setError(reason instanceof Error && reason.message ? reason.message : t("pairingFailed"))
    } finally {
      setBusy(false)
    }
  }

  const unpair = async (): Promise<void> => {
    setError("")
    await clearAccessKey().catch(() => undefined)
    setPaired(false)
    setNotice(t("pairingUnpaired"))
  }

  const title = health === "offline" ? t("pairingOfflineTitle") : paired ? t("pairingPairedTitle") : t("pairingTitle")
  const body = health === "offline" ? t("pairingOfflineBody") : paired ? t("pairingPaired") : t("pairingBody")

  return <>
    <style>{popupStyle}</style>
    <section className="extension-pairing-card">
      <div className="brand-mark"><span /></div>
      <p className="eyebrow">{t("pairingEyebrow")}</p>
      <h2>{title}</h2>
      <p>{body}</p>
      {notice && <small className="extension-pairing-notice">{notice}</small>}
      {paired === false && health !== "offline" && <>
        <input
          autoFocus
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && key.trim() && !busy) void pair() }}
          placeholder={t("pairingKey")}
          aria-label={t("pairingKey")} />
        <button className="primary-button" disabled={!key.trim() || busy} onClick={() => void pair()}>{t("pairingConnect")}</button>
      </>}
      {paired && <button className="secondary-button" disabled={busy} onClick={() => void unpair()}>{t("pairingUnpair")}</button>}
      {error && <small className="extension-pairing-error">{error}</small>}
      <small className={`extension-pairing-status extension-pairing-status--${health}`}><i />{health === "checking" ? t("pairingChecking") : health === "online" ? t("pairingOnline") : t("pairingOffline")}</small>
    </section>
  </>
}
