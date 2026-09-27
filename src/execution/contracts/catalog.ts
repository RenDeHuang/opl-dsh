import type { ModelRef, ModelDefinition } from '../../shared/models.ts'
export * from '../../shared/models.ts'
export interface HarnessDefinition {
  id: string
  name: string
  kind: 'dsh' | 'grok-build' | 'acp'
  command?: string
  adapter?: string
}
export interface CombinationDefinition {
  id: string
  name: string
  modelRef: ModelRef
  harnessRef: string
  generated?: boolean
  permissionPolicy: 'read-only' | 'workspace'
  isDefault: boolean
  enabled: boolean
}
export interface ExecutionCatalog {
  version: 2
  models: ModelDefinition[]
  harnesses: HarnessDefinition[]
  combinations: CombinationDefinition[]
}
