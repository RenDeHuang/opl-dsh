/** OPL observer results over official DSH Session events. */
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface SessionWaitRequest {
  readonly sessionId: SessionId
  /** Exact turn to await; omission waits on the turn that is open when the call arrives. */
  readonly turn?: number
}

/** Why a wait stopped waiting. Closed union. */
export type SessionWaitOutcome =
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly message: string; readonly code?: string }
  | { readonly kind: 'cancelled'; readonly cause: string }
  | { readonly kind: 'needs-input'; readonly request: SessionInputRequest }

/** The interactive request that a `needs-input` outcome reports. */
export interface SessionInputRequest {
  readonly sessionId: SessionId
  /** Pending approval identity, when the pause is a tool approval. */
  readonly approvalId?: string
  /** Tool whose operation is awaiting a decision. */
  readonly toolName?: string
}

/** One settled wait: the outcome and the turn it belongs to. */
export interface SessionWaitValue {
  readonly turn: number
  readonly outcome: SessionWaitOutcome
}
