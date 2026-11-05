import { useState } from 'react'
import { Bug, Code2, HeartHandshake, Info, UserRound } from 'lucide-react'
import { ABOUT_LINKS } from '@shared/about'
import type { Translator } from '../lib/i18n'
import { Collapse } from './Animated'
import { SettingsSection } from './SettingsSection'

interface AboutSectionProps {
  t: Translator
  appVersion: string
}

/** The About card: what the app is, who made it, where the source lives and how to support the work. */
export function AboutSection({ t, appVersion }: AboutSectionProps): React.JSX.Element {
  const [error, setError] = useState('')
  const open = (url: string): void => {
    setError('')
    window.workBuddy.openExternal(url).catch(() => setError(t('aboutLinkError')))
  }
  return <SettingsSection id="about" icon={<Info size={17} />} title={t('aboutTitle')} body={t('aboutBody')} className="settings-section--about">
    <p className="about-text">{t('aboutAuthor')}</p>
    <p className="about-text">{t('aboutOpenSource')}</p>
    <div className="about-links">
      <button type="button" className="secondary-button" onClick={() => open(ABOUT_LINKS.repository)}><Code2 size={14} />{t('aboutSourceCode')}</button>
      <button type="button" className="secondary-button" onClick={() => open(ABOUT_LINKS.author)}><UserRound size={14} />{t('aboutAuthorProfile')}</button>
      <button type="button" className="secondary-button" onClick={() => open(ABOUT_LINKS.issues)}><Bug size={14} />{t('aboutReportIssue')}</button>
    </div>
    <div className="about-support">
      <p className="about-text">{t('aboutSupportBody')}</p>
      <button type="button" className="primary-button about-support__button" onClick={() => open(ABOUT_LINKS.support)}><HeartHandshake size={15} />{t('aboutSupport')}</button>
    </div>
    <Collapse open={Boolean(error)}><p className="form-error">{error}</p></Collapse>
    <div className="about-version"><span>{t('appVersion')}</span><strong>{appVersion ? `v${appVersion}` : '…'}</strong></div>
  </SettingsSection>
}
