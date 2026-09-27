/** OPL projections over native Harness sessions. No provider secrets cross this face. */
export const GROK_COMBINATION = 'grok-build/grok-4.7'
export const DSH_COMBINATION = 'dsh/deepseek-flash'
export type HarnessState =
  | 'idle'
  | 'queued'
  | 'waiting_child'
  | 'running'
  | 'waiting_approval'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
export type HarnessOrigin = { kind: 'codex' | 'dsh' | 'harness' | 'desktop'; sessionId: string }
export interface HarnessApproval {
  id: string
  title: string
  options: { optionId: string; name: string; kind: string }[]
}
export interface HarnessTurn {
  operationId: string
  fingerprint: string
  prompt: string
  reasoningEffort?: string
  text: string
  state: HarnessState
  stopReason?: string
  error?: string
  report?: CollaborationReport
  review?: CollaborationReview
  delivery?: CollaborationDelivery
  tools: { id: string; title: string; status: string; kind: string }[]
}
export interface HarnessSession {
  id: string
  combination: string
  harnessRef: string
  modelRef: import('./catalog.ts').ModelRef
  cwd: string
  acpSessionId: string
  autoWakePaused?: boolean
  assignment?: CollaborationAssignment
  origin: HarnessOrigin
  title: string
  sandbox: 'read-only' | 'workspace'
  createdAt: string
  updatedAt: string
  turns: HarnessTurn[]
}
export interface HarnessSnapshot extends HarnessSession {
  connected: boolean
  state: HarnessState
  approvals: HarnessApproval[]
}
export interface HarnessCatalog {
  combinations: {
    id: string
    name: string
    model: string
    modelId: string
    harness: string
    source: string
    available: boolean
    reason?: string
  }[]
  sessions: HarnessSnapshot[]
}

/** Task and delivery state live with the existing OPL session record. */
export interface CollaborationAssignment {
  taskId: string
  objective: string
  acceptance: string
  autoReview: boolean
  maxRevisions: number
  revisions: number
  createdAt: string
}
export interface CollaborationReport {
  summary: string
  artifacts: string[]
  checks: string[]
  remaining: string[]
}
export interface CollaborationReview {
  decision: 'pending' | 'accepted' | 'changes_requested'
  note?: string
  reviewedAt?: string
}
export interface CollaborationDelivery {
  id: string
  state: 'pending' | 'delivering' | 'delivered' | 'blocked'
  attempt: number
  error?: string
}
