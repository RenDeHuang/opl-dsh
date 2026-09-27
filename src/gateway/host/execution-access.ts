/** Host-only Gateway access: executors never inspect account storage or provider settings. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { GATEWAY_GROUPS } from '../contracts/groups.ts'
import { gatewayGroupEnabled } from './group-settings.ts'
import { OPL_GATEWAY_INFERENCE_BASE_URL } from './opl-credentials.ts'

export { gatewayModelSettings } from './model-settings.ts'
export { internalGatewayProvider } from '../contracts/groups.ts'

export async function resolveGatewayExecution(
  ctx: Context,
  ref: { provider: string; model: string },
  resolveKey?: () => Promise<string | undefined>,
): Promise<{ baseURL: string; model: string; apiKey: string; credential: string }> {
  if (ref.provider !== 'opl-gateway') throw Error('模型不属于 OPL Gateway')
  const separator = ref.model.indexOf('::')
  const id = separator < 0 ? 'deepseek' : ref.model.slice(0, separator)
  const group = GATEWAY_GROUPS.find((item) => item.id === id)
  if (!group || !gatewayGroupEnabled(ctx, group.id)) throw Error('此分组已停用，请在账号页激活')
  const key = resolveKey
    ? await resolveKey()
    : (await ctx.credentials.resolve(credentialRef(group.credential)))?.value
  if (!key) throw Error('所选渠道凭据未就绪，请在 OPL Gateway 页面刷新账号')
  const settings = ctx.get('settings')?.describe()
  const suite = settings?.find((item) => item.ns === 'opl-suite')?.value as
    | { gateway?: { baseURL?: string } }
    | undefined
  const providers = settings?.find((item) => item.ns === 'llm-pi-ai')?.value as
    | { providers?: Record<string, { baseURL?: string }> }
    | undefined
  const baseURL =
    (group.id === 'deepseek'
      ? suite?.gateway?.baseURL
      : providers?.providers?.[group.provider]?.baseURL) ?? OPL_GATEWAY_INFERENCE_BASE_URL
  return {
    baseURL,
    model: separator < 0 ? ref.model : ref.model.slice(separator + 2),
    apiKey: key,
    credential: group.credential,
  }
}
