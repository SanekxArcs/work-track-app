import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import App from './App'
import { translator } from './lib/i18n'
import './styles.css'

interface CrashState {
  error: Error | null
}

/** A render failure shows a reload card instead of a blank, frameless window that can only be quit from the tray. */
class CrashGuard extends React.Component<React.PropsWithChildren, CrashState> {
  state: CrashState = { error: null }

  static getDerivedStateFromError(error: Error): CrashState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Renderer crashed', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    const t = translator(document.documentElement.lang === 'en' ? 'en' : 'uk')
    return (
      <main className="app-crash" role="alert">
        <h1>{t('appCrashed')}</h1>
        <p>{t('appCrashedBody')}</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>{t('reloadApp')}</button>
      </main>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CrashGuard>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </CrashGuard>
  </React.StrictMode>
)
