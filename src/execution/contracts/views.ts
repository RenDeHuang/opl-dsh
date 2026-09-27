import type { HarnessSnapshot, CollaborationReview, CollaborationDelivery } from './sessions.ts'
export type HarnessSessionSummary = Omit<HarnessSnapshot, 'turns' | 'approvals'> & {
  turnCount: number
  lastReviewDecision?: CollaborationReview['decision']
  lastDeliveryState?: CollaborationDelivery['state']
}
export interface HarnessSessionsRequest {
  cursor?: string
  limit?: number
  revision?: string
}
export interface HarnessSessionsPage {
  items: HarnessSessionSummary[]
  revision: string
  unchanged: boolean
  nextCursor?: string
}
export interface HarnessDetailRequest {
  sessionId: string
  revision?: string
  beforeTurn?: number
  limit?: number
}
export interface HarnessDetailPage {
  revision: string
  unchanged: boolean
  session?: HarnessSnapshot
  totalTurns: number
  beforeTurn: number
}

export type HarnessTaskSummary = HarnessSessionSummary & {
  latestTurn?: {
    operationId: string
    review?: CollaborationReview
    delivery?: CollaborationDelivery
  }
}
