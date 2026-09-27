import { gatewayModelChoices } from '../shared/model-choices.ts'
import { gatewayGroupEnabled } from './group-settings.ts'
import { createHash } from 'node:crypto'
/** Models page operations. DSH profile settings are the only writable model catalog. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { GATEWAY_GROUPS } from '../contracts/groups.ts'
import { OPL_GATEWAY_INFERENCE_BASE_URL } from './opl-credentials.ts'
import { DEFAULT_MODELS } from './config.ts'
import type { ModelDraft, GatewayModelSettings } from '../contracts/models.ts'
import { isRetiredModel } from '../../shared/models.ts'
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
export async function gatewayModelSettings(ctx: Context): Promise<GatewayModelSettings> {
  const settings = ctx.settings.describe({ redactSecrets: true })
  const account = await ctx.get('oplGatewayAccount')?.status()
  return {
    groups: GATEWAY_GROUPS.map((group) => {
      const descriptor = settings.find(
        (item) => item.ns === (group.id === 'deepseek' ? 'opl-suite' : 'llm-pi-ai'),
      )
      const value = record(descriptor?.value)
      const profile = record(
        group.id === 'deepseek' ? value.gateway : record(value.providers)[group.provider],
      )
      const provider = group.id === 'deepseek' ? 'opl-gateway' : group.provider
      const rawModels = profile.models ?? (group.id === 'deepseek' ? DEFAULT_MODELS : [])
      const models = Array.isArray(rawModels)
        ? rawModels.filter(
            (model: any) => !isRetiredModel({ provider, model: String(model?.id ?? '') }),
          )
        : []
      const status = account?.groups?.find((item) => item.id === group.id)
      return {
        enabled: gatewayGroupEnabled(ctx, group.id),
        ...(status?.rateMultiplier !== undefined ? { rateMultiplier: status.rateMultiplier } : {}),
        id: group.id,
        name: group.name,
        api: String(profile.api ?? group.api),
        models,
        state: account?.groups?.find((item) => item.id === group.id)?.state ?? 'unconfigured',
        ready:
          gatewayGroupEnabled(ctx, group.id) &&
          (account?.groups?.some((item) => item.id === group.id && item.state === 'ready') ??
            false),
        revision: descriptor?.revision ?? 0,
      }
    }),
  }
}
export async function editGatewayModels(
  ctx: Context,
  input: unknown,
): Promise<GatewayModelSettings> {
  const args = record(input),
    group = GATEWAY_GROUPS.find((item) => item.id === args.group)
  if (!group || !Array.isArray(args.models) || !Number.isSafeInteger(args.revision))
    throw Error('模型配置无效，请重新打开模型页')
  const ids = new Set<string>()
  const models = args.models.map((value: unknown) => {
    const item = record(value)
    if (
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      item.id.includes('::') ||
      ids.has(item.id)
    )
      throw Error('模型 ID 为空、重复或包含保留分隔符')
    ids.add(item.id)
    if (
      item.contextWindow !== undefined &&
      (!Number.isSafeInteger(item.contextWindow) || item.contextWindow < 1)
    )
      throw Error('上下文长度必须为正整数')
    return item
  })
  const activeModels = models.filter(
    (model) =>
      !isRetiredModel({
        provider: group.id === 'deepseek' ? 'opl-gateway' : group.provider,
        model: String(model.id),
      }),
  )
  if (group.id === 'deepseek') {
    await ctx.settings.mutate(
      'opl-suite',
      [{ op: 'set', path: ['gateway', 'models'], value: activeModels }],
      args.revision,
    )
  } else {
    if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(args.api))
      throw Error('不支持的模型协议')
    const profile = record(
      record(ctx.settings.describe().find((item) => item.ns === 'llm-pi-ai')?.value).providers,
    )[group.provider]
    const ops: import('@deepseek-ai/dsh-settings').SettingsPathOp[] = profile
      ? [
          { op: 'set', path: ['providers', group.provider, 'models'], value: activeModels },
          { op: 'set', path: ['providers', group.provider, 'api'], value: args.api },
        ]
      : [
          {
            op: 'set',
            path: ['providers', group.provider],
            value: {
              displayName: `OPL Gateway · ${group.name}`,
              api: args.api,
              baseURL: OPL_GATEWAY_INFERENCE_BASE_URL,
              apiKeyEnv: group.credential,
              models: activeModels,
            },
          },
        ]
    await ctx.settings.mutate('llm-pi-ai', ops, args.revision)
  }
  return gatewayModelSettings(ctx)
}
export async function discoverGatewayModels(ctx: Context, input: unknown) {
  const group = GATEWAY_GROUPS.find((item) => item.id === record(input).group)
  if (!group) throw Error('未知分组')
  if (!gatewayGroupEnabled(ctx, group.id)) throw Error('请先在连接与账号中激活此分组')
  const key = (
    await ctx.credentials.resolve(
      group.credential as import('@deepseek-ai/dsh-credentials').CredentialRef,
    )
  )?.value
  if (!key) throw Error('请先登录 OPL Gateway 并同步此分组凭据')
  // Discovery only returns candidates. It never overwrites the user's catalog.
  const models = await ctx.llm.discoverModels(
    'llm-pi-ai',
    { baseURL: OPL_GATEWAY_INFERENCE_BASE_URL, api: 'openai-completions', apiKey: key },
    AbortSignal.timeout(15000),
  )
  const configured =
    (await gatewayModelSettings(ctx)).groups.find((item) => item.id === group.id)?.models ?? []
  const offered = new Set(models.map((model) => model.id))
  return gatewayModelChoices(
    models.map((model) => ({ ...model })),
    configured,
  ).filter(
    (model) =>
      offered.has(model.id) && !isRetiredModel({ provider: group.provider, model: model.id }),
  )
}

/** Refresh only catalogs whose user layer still equals the last automatic import. */
export async function syncGatewayModels(ctx: Context): Promise<void> {
  if (
    !ctx.get('settings') ||
    !ctx.llm.listConfigurableProviders().some((item) => item.settingsNs === 'llm-pi-ai')
  )
    return
  for (const group of GATEWAY_GROUPS) {
    if (!gatewayGroupEnabled(ctx, group.id)) continue
    if (
      !(
        await ctx.credentials.resolve(
          group.credential as import('@deepseek-ai/dsh-credentials').CredentialRef,
        )
      )?.value
    )
      continue
    try {
      const settings = ctx.settings.describe({ redactSecrets: true })
      const suite = settings.find((item) => item.ns === 'opl-suite')
      const ns = group.id === 'deepseek' ? suite : settings.find((item) => item.ns === 'llm-pi-ai')
      if (!suite || !ns) continue
      const savedProfile = record(
        group.id === 'deepseek'
          ? record(ns.user).gateway
          : record(record(ns.user).providers)[group.provider],
      )
      const savedModels = savedProfile.models
      const hashes = record(record(suite.value).gatewayCatalogHashes)
      // A pre-existing user model list is always preserved unless we can prove ownership.
      if (savedModels !== undefined && hashes[group.id] !== catalogFingerprint(savedModels))
        continue
      let candidates = await discoverGatewayModels(ctx, { group: group.id })
      // Do not make the default DeepSeek Flash route depend on the optional
      // OpenAI-protocol group. A user can still explicitly add this channel
      // from the model page, which is the durable opt-in boundary.
      if (group.id === 'codex' && savedModels === undefined)
        candidates = candidates.filter((model) => model.id !== 'deepseek-flash')
      if (!candidates.length) continue
      const snapshot = await gatewayModelSettings(ctx),
        current = snapshot.groups.find((item) => item.id === group.id)!
      const models = candidates.map((candidate) => {
        const known = current.models.find((model) => model.id === candidate.id)
        return { ...known, ...candidate, ...(known?.name ? { name: known.name } : {}) }
      })
      // The captured revision prevents a concurrent manual edit from being overwritten.
      await editGatewayModels(ctx, {
        group: group.id,
        models,
        api: current.api,
        revision: ns.revision,
      })
      const updated = ctx.settings
        .describe({ redactSecrets: true })
        .find((item) => item.ns === 'opl-suite')!
      await ctx.settings.mutate(
        'opl-suite',
        [
          {
            op: 'set',
            path: ['gatewayCatalogHashes', group.id],
            value: catalogFingerprint(models),
          },
        ],
        updated.revision,
      )
    } catch {
      ctx.logger.warn(
        `OPL Gateway ${group.name}: 模型目录未自动更新，保留已有配置，可在模型页重试获取`,
      )
    }
  }
}
function catalogFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
