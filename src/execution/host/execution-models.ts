/** Owns live model/combination projection; persisted catalog stores references only. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  internalGatewayProvider,
  gatewayModelSettings,
} from '../../gateway/host/execution-access.ts'
import { DSH_COMBINATION } from '../contracts/sessions.ts'
import { displayModelName, isRetiredModel, modelRefKey } from '../contracts/catalog.ts'
import { ExecutionCatalogStore, type ExecutionCatalog } from './catalog.ts'
import { defaultHarness } from './adapters/index.ts'
export class ExecutionModelResolver {
  constructor(
    private readonly ctx: Context,
    private readonly store: ExecutionCatalogStore,
  ) {}
  async resolve(): Promise<ExecutionCatalog> {
    const catalog = await this.store.get()
    // Remove combinations from old releases before projecting the live model
    // registry. The write is idempotent and keeps the on-disk catalog clean so
    // retired entries cannot return after a restart.
    const retired = catalog.combinations.filter((item) => isRetiredModel(item.modelRef))
    const legacyDefault = catalog.combinations.find(
      (item) => item.id === DSH_COMBINATION && item.name === 'DeepSeek + DSH',
    )
    if (retired.length || legacyDefault) {
      catalog.combinations = catalog.combinations
        .filter((item) => !isRetiredModel(item.modelRef))
        .map((item) =>
          item.id === DSH_COMBINATION && item.name === 'DeepSeek + DSH'
            ? { ...item, name: 'DeepSeek-V4.1-Flash + DSH' }
            : item,
        )
      await this.store.set(catalog)
    }
    for (const provider of this.ctx.llm?.listProviders() ?? []) {
      if (internalGatewayProvider(provider.id)) continue
      const directory = this.ctx.llm
        .listConfigurableProviders()
        .find((item) => item.provider === provider.id)
      let configured = true
      if (directory && provider.id !== 'opl-gateway') {
        let profile = this.ctx
          .get('settings')
          ?.describe()
          .find((item) => item.ns === directory.settingsNs)?.value as any
        for (const key of directory.settingsPath) profile = profile?.[key]
        if (profile?.apiKeyEnv)
          configured = !!(
            await this.ctx.get('credentials')?.resolve(credentialRef(profile.apiKeyEnv))
          )?.value
      }
      // The official DeepSeek adapter always exposes its built-in catalog, but
      // that catalog is not a usable connection until a key is configured.
      // A missing descriptor therefore means "not configured", rather than a
      // reason to populate the combination picker with empty models.
      if ((provider.id === 'deepseek-official' || provider.id === 'deepseek') && !directory)
        configured = false
      if (provider.id === 'deepseek-account') {
        try {
          configured =
            (
              (await this.ctx.typertGateway.invoke({
                namespace: 'account',
                method: 'getState',
                args: {},
              })) as { status: string }
            ).status === 'credential-stored'
        } catch {
          configured = false
        }
      }
      try {
        for (const model of await this.ctx.llm.listModels(provider.id)) {
          const ref = { provider: provider.id, model: model.id }
          if (isRetiredModel(ref)) continue
          const source =
            provider.id === 'deepseek-account'
              ? 'DeepSeek 官方'
              : provider.id === 'opl-gateway'
                ? 'OPL Gateway'
                : provider.name
          catalog.models.push({
            ref,
            name: displayModelName(ref, model.name),
            source,
            available: configured,
            ...(!configured ? { reason: '凭据未配置' } : {}),
          })
        }
      } catch {
        /* Keep saved references visible as unavailable below. */
      }
    }
    if (this.ctx.get('settings')) {
      const configured = await gatewayModelSettings(this.ctx)
      for (const group of configured.groups)
        for (const model of group.models) {
          const ref = {
            provider: 'opl-gateway',
            model: group.id === 'deepseek' ? model.id : group.id + '::' + model.id,
          }
          if (isRetiredModel(ref)) continue
          if (!catalog.models.some((item) => modelRefKey(item.ref) === modelRefKey(ref)))
            catalog.models.push({
              ref,
              name: displayModelName(ref, model.name),
              source: 'OPL Gateway',
              available: false,
              reason: '分组凭据未就绪',
            })
        }
    }
    for (const combination of catalog.combinations)
      if (
        !isRetiredModel(combination.modelRef) &&
        !catalog.models.some(
          (model) => modelRefKey(model.ref) === modelRefKey(combination.modelRef),
        )
      )
        catalog.models.push({
          ref: combination.modelRef,
          name: displayModelName(combination.modelRef),
          source: combination.modelRef.provider,
          available: false,
          reason: '模型未配置或分组未授权',
        })
    for (const model of catalog.models) {
      const hasDefault = catalog.combinations.some(
        (item) =>
          !isRetiredModel(item.modelRef) &&
          (item.id === 'auto:' + modelRefKey(model.ref) ||
            (item.enabled &&
              item.isDefault &&
              modelRefKey(item.modelRef) === modelRefKey(model.ref))),
      )
      if (!isRetiredModel(model.ref) && model.available && !hasDefault) {
        const harnessRef = defaultHarness(model.ref),
          harnessName = catalog.harnesses.find((h) => h.id === harnessRef)?.name ?? 'DSH'
        catalog.combinations.push({
          id: 'auto:' + modelRefKey(model.ref),
          name: displayModelName(model.ref, model.name) + ' + ' + harnessName,
          modelRef: model.ref,
          harnessRef,
          permissionPolicy: 'read-only',
          isDefault: true,
          enabled: true,
          generated: true,
        })
      }
    }
    return catalog
  }
}
