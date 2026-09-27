/** Public, browser-safe vocabulary shared by generated Remote consumers. */
export type * from '../gateway/contracts/account.ts'
export type * from '../gateway/contracts/models.ts'
export type * from '../execution/contracts/sessions.ts'
export type * from '../execution/contracts/catalog.ts'
export type * from '../execution/contracts/installations.ts'
export type * from '../execution/contracts/views.ts'
export type * from '../collaboration/host/feedback/types.ts'
export type * from '../setup/contracts.ts'
export interface GatewayModelEdit {
  group: string
  revision: number
  models: import('../gateway/contracts/models.ts').ModelDraft[]
  api?: string
}
export interface HarnessSelection {
  current: import('@deepseek-ai/dsh-api-session-controller/types').ModelSelection | null
  groups: import('@deepseek-ai/dsh-api-session-controller/types').ModelCatalog['groups']
  combination?: string
}
export interface SessionRequest {
  sessionId: string
}
export interface HarnessStartRequest {
  combination: string
  cwd: string
  existingSessionId?: string
  taskId?: string
  origin?: import('../execution/contracts/sessions.ts').HarnessOrigin
  sandbox?: 'read-only' | 'workspace'
}
export interface HarnessPromptRequest {
  sessionId: string
  text: string
  operationId: string
}
export interface CooperationSettings {
  autoReview: boolean
  maxRevisions: number
  externalCodex: boolean
}
export interface DelegateRequest {
  cwd?: string
  origin: import('../execution/contracts/sessions.ts').HarnessOrigin
  combination?: string
  task: string
  taskId: string
  operationId: string
  sessionId?: string
  acceptance?: string
  wait?: boolean
}
export interface ReviewRequest {
  origin: import('../execution/contracts/sessions.ts').HarnessOrigin
  sessionId: string
  operationId: string
  decision: 'accepted' | 'changes_requested'
  note: string
}
export interface ReportRequest {
  origin: import('../execution/contracts/sessions.ts').HarnessOrigin
  summary: string
  artifacts: string[]
  checks: string[]
  remaining: string[]
}
export interface WakeSettings {
  wakeTransport: 'unconnected' | 'codex-queue'
  wakeExecution: 'native' | 'wsl'
  wakeExecutable: string
  wakeDistro: string
}
export interface CoordinationStatus extends WakeSettings {
  installed: boolean
  autoStart: boolean
  version: string
  enhancementVersion: string
  update: { state?: string; checkedAt?: string; message?: string; checkTrigger: string }
  paths: { suiteRoot: string; profileHome: string; skillDir: string }
}
