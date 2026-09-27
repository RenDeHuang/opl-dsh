import { GatewayModels } from './GatewayModels.tsx'
import { internalGatewayProvider, GATEWAY_GROUPS } from '../../gateway/groups.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
/**
 * OPL Gateway Settings page, browser half.
 *
 * The page is the account surface for the `llm-opl-gateway` adapter family:
 * signing in here is what makes that route's credential resolve, so the card
 * and the adapter are two halves of one feature rather than a settings form
 * and an unrelated integration.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `ctx.remote` Context merge plus the account namespace
// this page calls. The wire vocabulary comes from the Host package's public
// type subpath, never from its implementation module.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '../../generated/gateway-remote.mjs'
import { OplGatewaySection, type OplGatewaySectionInjected } from './OplGatewaySection.tsx'
import { en, zh, type OplGatewayLocaleKey } from './locales.ts'

export type { OplGatewaySectionInjected, OplGatewaySectionProps } from './OplGatewaySection.tsx'
export type { OplGatewayLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** OPL Gateway page copy. */
    'settings.oplGateway': OplGatewayLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.oplGateway'

/** Services this plugin needs: the slot ledger, dictionaries, and the account Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.oplGatewayAccount']

/** Contribute the OPL Gateway page to Settings. */
export function apply(ctx: ClientContext, navigation: { openModels?: () => void } = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-opl-gateway: dictionaries')

  // The OpenAI route is the internal Codex-group route for the same Gateway
  // account. The official model-selection package has no provider-group
  // filtering slot, so keep that route routable while removing only its
  // duplicate provider row from the user's picker.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.oplGatewayPresentation = 'internal-route'
    style.textContent = [
      ...GATEWAY_GROUPS.filter(group => group.id !== 'deepseek').map(group => `section[aria-labelledby$="-${group.provider}"]{display:none!important}`),
      // The official Models page keeps its own account-first ordering. OPL
      // Gateway is the product's first managed provider, so promote its row
      // ahead of the official and user-added providers without replacing the
      // native page or maintaining a second model editor.
      'section[aria-labelledby$="-opl-gateway"],li:has(section[aria-labelledby$="-opl-gateway"]){order:-2}',
      'section[aria-labelledby$="-deepseek-official"],li:has(section[aria-labelledby$="-deepseek-official"]){order:-1}',
      '.opl-gateway-managed-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}',
      'li:has([data-opl-managed-models]){order:-2}',
      'li:has([data-opl-managed-models]) > div:first-child [role="img"]{display:none}',
      'li:has([data-opl-managed-models]) > div:first-child > span:last-child{display:none}',
      'li:has([data-opl-internal-provider]){display:none!important}',

    ].join('')
    document.head.append(style)
    return () => style.remove()
  }, 'ui-settings-opl-gateway: hide internal Codex route')

  const t = ctx.locale.bind(NS)
  const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    // The code is a support handle, not copy: the page shows the sentence.
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const injected = (): OplGatewaySectionInjected => ({
    ...(navigation.openModels ? { openModels: navigation.openModels } : {}),
    setGroupActive: (id,enabled) => modelCall('gateway-group-activation',{id,enabled}),
    status: async () => unwrap(await ctx.remote.oplGatewayAccount.status()),
    signIn: async (email, password) => unwrap(await ctx.remote.oplGatewayAccount.signIn(email, password)),
    refresh: async () => unwrap(await ctx.remote.oplGatewayAccount.refresh()),
    signOut: async () => unwrap(await ctx.remote.oplGatewayAccount.signOut()),
  })

  // Keep the managed Codex route available to DSH dispatch,
  // while its ordinary key editor stays out of the account settings flow.
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'llm-pi-ai',
  }, ({ provider }) => internalGatewayProvider(provider.provider) ? <span hidden data-opl-internal-provider /> : null))

  const modelCall = async <T,>(method: string, input: unknown = {}): Promise<T> => {
    const result = await (ctx.get('connection') as ConnectionHandle).rpc.call('/api','oplSetup/harness',{method,input})
    if (!result.ok) throw Error(result.error.message)
    return result.value as T
  }
  // The native Models page remains the only model editor. This extension tells
  // the user why the OPL Gateway credential is already available there and
  // sends them to the account page for sign-in or group-key repair.
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'opl-suite',
  }, ({ provider }) => provider.provider === 'opl-gateway'
    ? <GatewayModels call={modelCall} />
    : null))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'opl-gateway',
    order: 9,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, OplGatewaySection))
}
