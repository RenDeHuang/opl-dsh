import { useEffect, useState } from 'react'
import { IconEllipsisOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SetupStatus } from '../setup-types.ts'
import css from './AccountLauncher.module.css'

/** The official settings shell owns navigation; this launcher chooses the account. */
export function AccountLauncher({ wide, settingsOpen, settingsShortcut, openSettings, openOnboarding, readSetup, bindModelNavigation, t }:
  PropsRuntime<'settings.launcher'> & PropsLocale<'settings.oplGateway'> & { readSetup: () => Promise<SetupStatus>; bindModelNavigation: (navigate: (() => void) | undefined) => void }) {
  useEffect(() => { bindModelNavigation(() => openOnboarding('opl-model-navigation')); return () => bindModelNavigation(undefined) }, [bindModelNavigation, openOnboarding])
  const [open, setOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let active = true
    void readSetup().then(status => { if (active) setConnected(status.gatewayReady || !!status.officialProvider) }).catch(() => {})
    return () => { active = false }
  }, [readSetup, settingsOpen, open])
  return <Menu open={open} side='top' portal autoFocus className={css.root}
    anchor={<button type='button' className={css.trigger} data-collapsed={!wide} aria-label={t('accountMenu')} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
      {connected ? <IconUserOutlineMedium size={16} /> : <IconEllipsisOutlineMedium size={14} />}
      {wide && <span>{t(connected ? 'accountTitle' : 'accountMore')}</span>}
    </button>}
    items={[
      { id: 'settings', label: t('accountSettings'), icon: <IconSettingsOutlineMedium size={16} />, ...(settingsShortcut ? { shortcut: settingsShortcut } : {}) },
      { id: 'account', label: t(connected ? 'accountTitle' : 'signIn'), icon: <IconUserOutlineMedium size={16} /> },
    ]}
    onClose={() => setOpen(false)}
    onSelect={id => { setOpen(false); if (id === 'settings') openSettings(); else openOnboarding('opl-account') }} />
}
