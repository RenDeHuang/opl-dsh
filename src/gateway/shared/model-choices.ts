import type { ModelDraft } from '../contracts/models.ts'
/** Simplify discovery only. Existing configured version IDs and wire identities stay intact. */
export function gatewayModelChoices(
  discovered: readonly ModelDraft[],
  configured: readonly ModelDraft[],
): ModelDraft[] {
  const choices = new Map(configured.map((model) => [model.id, model]))
  for (const model of discovered) if (!choices.has(model.id)) choices.set(model.id, model)
  if (
    choices.has('deepseek-flash') &&
    !configured.some((model) => model.id === 'deepseek-v4.1-flash')
  )
    choices.delete('deepseek-v4.1-flash')
  return [...choices.values()]
}
