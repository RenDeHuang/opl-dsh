/** Models are read-only projections of DSH's model registry. */
export interface ModelRef {
  provider: string
  model: string
}
export interface ModelDefinition {
  ref: ModelRef
  name: string
  source: string
  available: boolean
  reason?: string
}
export const modelRefKey = (ref: ModelRef) => JSON.stringify([ref.provider, ref.model])

/**
 * Models that were advertised by an older provider catalog but are no longer
 * part of the OPL product surface. Keep this decision in one place so the
 * model list, automatic combinations and persisted legacy combinations agree.
 */
export function isRetiredModel(ref: ModelRef): boolean {
  const id = ref.model.includes('::') ? ref.model.slice(ref.model.lastIndexOf('::') + 2) : ref.model
  const provider = ref.provider.toLowerCase()
  if (
    id === 'deepseek-v4-pro' &&
    (provider.includes('deepseek') || provider.includes('opl-gateway'))
  )
    return true
  if (
    (id === 'gpt-5' || id === 'gpt-5-mini') &&
    (provider.includes('opl-gateway') || provider.includes('codex'))
  )
    return true
  return false
}

/** Stable product names for IDs whose upstream display text changed. */
export function displayModelName(ref: ModelRef, name?: string): string {
  const id = ref.model.includes('::') ? ref.model.slice(ref.model.lastIndexOf('::') + 2) : ref.model
  if (id === 'deepseek-v4.1-flash') return 'DeepSeek-V4.1-Flash（固定版本）'
  if (id === 'deepseek-flash')
    return ref.model.startsWith('codex::')
      ? 'DeepSeek-V4.1-Flash · OpenAI 协议'
      : 'DeepSeek-V4.1-Flash'
  const route = ref.provider === 'opl-gateway' ? ref.model.split('::')[0] : ''
  const suffix = route === 'aws' ? 'AWS' : route === 'kiro' ? 'Kiro' : ''
  const label = id === 'claude-opus-5-5' ? 'Claude Opus 5.5' : name?.trim() || id
  return suffix && !label.endsWith(' · ' + suffix) ? label + ' · ' + suffix : label
}

export function displayModelSource(ref: ModelRef, source?: string): string {
  if (ref.provider === 'opl-gateway') return 'OPL Gateway'
  if (ref.provider === 'deepseek-account' || ref.provider === 'deepseek-official')
    return 'DeepSeek 官方'
  return source?.trim() || ref.provider
}

/** User-facing choices: credential-ready models, with one preferred route per Gateway model.
 * Preserve the full catalog and saved refs for diagnostics and existing combinations.
 */
export function selectableModels(models: readonly ModelDefinition[]): ModelDefinition[] {
  const choices = new Map<string, ModelDefinition>()
  for (const model of models) {
    if (!model.available || isRetiredModel(model.ref)) continue
    const key =
      model.ref.provider === 'opl-gateway'
        ? gatewayChoiceKey(model.ref.model)
        : modelRefKey(model.ref)
    const previous = choices.get(key)
    if (!previous) choices.set(key, model)
  }
  return [...choices.values()]
}

/** Paid channels remain distinct even when they serve the same model. */
export function gatewayChoiceKey(model: string): string {
  return model
}
