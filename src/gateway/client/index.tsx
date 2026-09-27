/** Gateway account and model settings mount independently of execution. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { internalGatewayProvider } from '../contracts/groups.ts'
import { GatewayModels } from './GatewayModels.tsx'
import { OplGatewaySection, type OplGatewaySectionInjected } from './OplGatewaySection.tsx'
import { en, zh, type OplGatewayLocaleKey } from './locales.ts'
import { remoteCall, optionalRemote } from '../../shared/client/remote-call.ts'
import { installGatewayModelPresentation } from '../../compat/client/gateway-models.ts'
export type { OplGatewaySectionInjected, OplGatewaySectionProps } from './OplGatewaySection.tsx'
export type { OplGatewayLocaleKey } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oplGateway': OplGatewayLocaleKey
  }
}
const NS = 'settings.oplGateway'
export const inject = ['slots', 'locale', 'remote']
export function apply(ctx: Context, navigation: { openModels?: () => void } = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-opl-gateway: dictionaries')
  ctx.inject(['remote.oplGatewayModels'], (ctx) => {
    const call = remoteCall(ctx.remote.oplGatewayModels)
    ctx.effect(installGatewayModelPresentation)
    ctx.slots.inject('settings.models.provider-card', () =>
      ctx.slots.register(
        {
          name: 'settings.models.provider-card',
          key: 'llm-pi-ai',
        },
        ({ provider }) =>
          internalGatewayProvider(provider.provider) ? (
            <span hidden data-opl-internal-provider />
          ) : null,
      ),
    )
    ctx.slots.inject('settings.models.provider-card', () =>
      ctx.slots.register(
        {
          name: 'settings.models.provider-card',
          key: 'opl-suite',
        },
        ({ provider }) =>
          provider.provider === 'opl-gateway' ? <GatewayModels call={call} /> : null,
      ),
    )
  })
  ctx.inject(['remote.oplGatewayAccount'], (ctx) => {
    const call = remoteCall(ctx.remote.oplGatewayAccount)
    const injected = (): OplGatewaySectionInjected => {
      const models = optionalRemote(ctx, 'oplGatewayModels')
      return {
        ...(navigation.openModels ? { openModels: navigation.openModels } : {}),
        ...(models
          ? {
              setGroupActive: (id: string, enabled: boolean) =>
                remoteCall(models)('activate', { id, enabled }),
            }
          : {}),
        status: () => call('status'),
        signIn: (email, password) => call('signIn', email, password),
        refresh: () => call('refresh'),
        signOut: () => call('signOut'),
      }
    }
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'opl-gateway',
          order: 9,
          label: () => ctx.locale.bind(NS)('nav'),
          locale: NS,
          inject: injected,
        },
        OplGatewaySection,
      ),
    )
  })
}
