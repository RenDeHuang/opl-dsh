import type { ModelRef } from '../../contracts/catalog.ts'
import { dshAdapter } from './dsh.ts'
import { grokAdapter } from './grok.ts'
import { codexAdapter } from './codex.ts'
import { claudeAdapter } from './claude.ts'
import type { HarnessAdapter } from './types.ts'
export const harnessAdapters: readonly HarnessAdapter[] = [
  codexAdapter,
  claudeAdapter,
  grokAdapter,
  dshAdapter,
]
export function adapterFor(id: string, ref: ModelRef): HarnessAdapter | undefined {
  return harnessAdapters.find((adapter) => adapter.id === id && adapter.matches(ref))
}
export function nativeHarnessMatches(id: string, ref: ModelRef): boolean {
  return (id === 'codex' || id === 'claude') && adapterFor(id, ref) !== undefined
}
export function defaultHarness(ref: ModelRef): string {
  return (
    harnessAdapters.find(
      (adapter) => (adapter.id === 'codex' || adapter.id === 'claude') && adapter.matches(ref),
    )?.id ?? 'dsh'
  )
}
