/**
 * OPL Gateway Settings page: the deployment's account surface.
 *
 * The page owns no facts of its own. It reads one status from the Host's
 * account service, starts one sign-in (email and password, submitted once and
 * never echoed back), and can sign out; everything it renders — balance,
 * usage, endpoint, key readiness — arrives in that status.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GatewayAccountStatus, GatewaySignInResult } from '../../gateway/types.ts'
import settingsCss from '../SettingsSection.module.css'
import setupCss from '../SetupScreen.module.css'
const css = settingsCss

/** Registration-side face the section drives. */
export interface OplGatewaySectionInjected {
  openModels?: () => void
  setGroupActive?: (id: string, enabled: boolean) => Promise<GatewayAccountStatus>
  /** Read the current account status. */
  status: () => Promise<GatewayAccountStatus>
  /** Sign in and make the account's key this machine's inference credential. */
  signIn: (email: string, password: string) => Promise<GatewaySignInResult>
  /** Ask OPL to re-read the account from the gateway. */
  refresh: () => Promise<GatewayAccountStatus>
  /** End this machine's session and release the key it holds. */
  signOut: () => Promise<GatewayAccountStatus>
}

/** Full props assembled by the Settings slot renderer. */
export type OplGatewaySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.oplGateway'>
  & InjectFace<OplGatewaySectionInjected>

/** The page's locale seat, threaded into the formatters so every label stays dictionary-owned. */
type Translate = OplGatewaySectionProps['t']

/** Render a currency amount with its own currency and grouping, or a dash. */
function money(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return '—'
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

/** Render a token count, or a dash when unknown. */
function tokens(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '—' : amount.toLocaleString()
}

/**
 * Describe how old an observation is.
 *
 * The age is the fact a reader needs — "is this current?" — and an absolute
 * clock time makes them compute it. The exact instant stays available as the
 * element's title for anyone who needs it.
 * @param observedAt - ISO timestamp OPL recorded.
 * @param t - the page's locale seat, so the age reads in the active language.
 * @param now - current time in ms, injectable for tests.
 * @returns a short age label, or the original text if unparsable.
 */
export function observedAge(observedAt: string, t: Translate, now: number = Date.now()): string {
  const parsed = new Date(observedAt)
  if (Number.isNaN(parsed.getTime())) return observedAt
  const minutes = Math.max(0, Math.round((now - parsed.getTime()) / 60_000))
  if (minutes < 1) return t('age.now')
  if (minutes < 60) return t('age.ago', { t: t('age.minutes', { n: minutes }) })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('age.ago', { t: t('age.hours', { n: hours }) })
  return t('age.ago', { t: t('age.days', { n: Math.round(hours / 24) }) })
}

/**
 * Exact local timestamp, used as the age element's tooltip.
 * @param observedAt - ISO timestamp OPL recorded.
 * @returns a local, minute-precision label, or the original text if unparsable.
 */
export function observedLabel(observedAt: string): string {
  const parsed = new Date(observedAt)
  if (Number.isNaN(parsed.getTime())) return observedAt
  return parsed.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * One labelled fact.
 * @param props.label - localized field name.
 * @param props.value - rendered value.
 * @param props.wide - span the full grid row, for values that are copied verbatim.
 */
function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? css.wide : undefined}>
      <dt className={css.factLabel}>{label}</dt>
      <dd className={css.factValue}>{value}</dd>
    </div>
  )
}

/** The OPL Gateway account page. */
export function OplGatewaySection(props: OplGatewaySectionProps & { onboarding?: boolean; onReady?: () => Promise<void>; onBusyChange?: (busy: boolean) => void }) {
  const css = props.onboarding ? { ...settingsCss, ...setupCss } : settingsCss
  const { t, status: readStatus, signIn, refresh, signOut } = props
  const [state, setState] = useState<GatewayAccountStatus | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'idle' | 'loading' | 'signing-in' | 'signing-out'>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (reload = false): Promise<void> => {
    setBusy('loading')
    try {
      // A plain open reads what OPL already recorded; the refresh button asks
      // OPL to go and re-read it from the gateway.
      setState(reload ? await refresh() : await readStatus())
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('idle')
    }
  }, [readStatus, refresh])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (): Promise<void> => {
    setBusy('signing-in')
    props.onBusyChange?.(true)
    setNotice(null)
    setError(null)
    try {
      const result = await signIn(email, password)
      setState(result.status)
      setNotice(result.createdKey ? t('createdKey') : t('reusedKey'))
      // The password has done its work; keeping it in renderer state would
      // leave a live credential in a component nobody is looking at.
      setPassword('')
      if (result.status.keyReady && props.onReady) await props.onReady()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('idle')
      props.onBusyChange?.(false)
    }
  }, [email, password, signIn, t, props.onReady, props.onBusyChange])

  const leave = useCallback(async (): Promise<void> => {
    setBusy('signing-out')
    setNotice(null)
    setError(null)
    try {
      setState(await signOut())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('idle')
    }
  }, [signOut])

  const account = state?.account
  const phase = state?.phase ?? 'signed-out'

  const connected = phase === 'connected'
  return <div className={`${css.section} ${props.onboarding && !connected ? setupCss.loginSection : ''}`}>
    <header className={css.header}>
      <div className={css.identity}>
        <h2 className={css.title}>{t(connected ? 'nav' : 'loginTitle')}</h2>
        <p className={css.intro}>{connected ? (account?.email ?? t('connected')) : t('intro')}</p>
      </div>
      {connected && <Button variant='outline' disabled={busy !== 'idle'} onClick={() => { void load(true) }}>{busy === 'loading' ? t('refreshing') : t('refresh')}</Button>}
    </header>
    {error && <p className={`${css.notice} ${css.error}`} role='alert'>{t('failure', { message: error })}</p>}
    {notice && !props.onboarding && <p className={css.notice} role='status'>{notice}</p>}
    {!state ? <p className={css.muted}>{t('loading')}</p> : <>
      <div className={connected ? css.card : css.loginCard}>
        {connected && <div className={css.identity}>
          <span className={css.name}>{t('connected')}</span>
          <span className={css.muted}>{state.groups?.some(group => group.state === 'ready') ? '可用分组已同步' : '请检查分组权限'}</span>
        </div>}
        {connected && account && <dl className={css.metrics}>
          <Fact label={t('balance')} value={money(account.balanceAmount, account.balanceCurrency)} />
          <Fact label={t('todayCost')} value={money(account.todayCost, account.usageCurrency)} />
        </dl>}
        {!connected && <form className={css.form} onSubmit={event => { event.preventDefault(); void submit() }}>
          <label className={css.field}><span className={css.label}>{t('email')}</span>
            <input className={css.input} required disabled={busy !== 'idle'} data-modal-autofocus type='email' autoComplete='username' placeholder={t('emailPlaceholder')} value={email} onChange={event => setEmail(event.target.value)} />
          </label>
          <label className={css.field}><span className={css.label}>{t('password')}</span>
            <input className={css.input} required disabled={busy !== 'idle'} type='password' autoComplete='current-password' placeholder={t('passwordPlaceholder')} value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          <Button variant='primary' className={props.onboarding ? setupCss.primaryButton : undefined} type='submit' disabled={busy !== 'idle' || !email.trim() || !password}>{busy === 'signing-in' ? t('signingIn') : t('signIn')}</Button>
        </form>}
      </div>
      {connected && props.onboarding && <Button className={css.primaryButton} disabled={busy !== 'idle'} onClick={() => { void props.onReady?.().catch(() => setError(t('setupFailed'))) }}>{t('saveAndEnter')}</Button>}
      {connected && !props.onboarding && <details className={css.details}>
        <summary>{t('usageDetails')}</summary>
        <dl className={css.facts}>
          <Fact label={t('todayTokens')} value={tokens(account?.todayTokens)} />
          <Fact label={t('totalTokens')} value={tokens(account?.totalTokens)} />
          <Fact label={t('totalCost')} value={money(account?.totalCost, account?.usageCurrency ?? '')} />
          {account?.observedAt && <Fact label={t('updated')} value={observedLabel(account.observedAt)} />}
        </dl>
      </details>}
      {!props.onboarding && connected && <div className={css.detailsBody}>
        <div className={css.header}><h3>可用分组</h3>{props.openModels&&<Button variant="outline" onClick={props.openModels}>选择模型</Button>}</div>
        <p className={css.muted}>选择在此 DSH 中使用的分组。密钥自动管理，模型在“模型”页选择。停用会保留模型配置和已有对话。分组倍率相同不代表模型单价相同。</p>
        <div className={css.modelRows}>{state.groups?.map(group=><div key={group.id} className={css.modelRow}>
          <div><strong>{group.name}</strong><p className={css.muted}>{group.authorized===false||group.state==='unauthorized'?'账号未开放':group.authorized===true?'账号可用':'权限待刷新'}{group.rateMultiplier!==undefined?` · 分组倍率 ${group.rateMultiplier}×`:''}{group.enabled!==false&&group.state==='ready'?' · 凭据已同步':''}</p>{group.error&&group.state==='error'&&<p className={css.error}>{group.error}</p>}</div>
          <label className={css.row}><input type="checkbox" role="switch" aria-label={`在此 DSH 激活 ${group.name}`} checked={group.enabled!==false} disabled={busy!=='idle'||group.authorized===false||group.state==='unauthorized'||!props.setGroupActive} onChange={event=>{const enabled=event.target.checked;setBusy('loading');setError(null);void props.setGroupActive?.(group.id,enabled).then(setState).catch(e=>setError(e instanceof Error?e.message:'分组设置失败')).finally(()=>setBusy('idle'))}}/>{group.enabled!==false?'已激活':'未激活'}</label>
        </div>)}</div>
        {state.source === 'session' && <Button variant='outline' disabled={busy !== 'idle'} onClick={() => { void leave() }}>{busy === 'signing-out' ? t('signingOut') : t('signOut')}</Button>}
      </div>}
    </>}
  </div>
}
