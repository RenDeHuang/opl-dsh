/** Durable consumption/ownership ledger. Calls are serialized by the service's commit queue.
 * It owns receipt writes only; task recovery and transport remain independent.
 */
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ReceiptRecordState, DeliveryRecordState } from './spec.ts'
import type { TaskConsumeRequest, TaskReceiptStatus } from './types.ts'

const RECEIPT_ORDER: readonly TaskReceiptStatus[] = ['received', 'review-started', 'consumed']

export class ReceiptLedger {
  constructor(
    private readonly table: KvTable<string, ReceiptRecordState>,
    private readonly claimLeaseMs: number,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Move one receipt to `consumed`, checking the claim generation the caller holds. */
  async markConsumed(request: TaskConsumeRequest): Promise<ReceiptRecordState> {
    const receipt = this.table.get(request.deliveryId)
    if (receipt === undefined || receipt.taskId !== request.taskId) {
      throw new RemoteError(
        'task-feedback/receipt-not-found',
        `no receipt ${JSON.stringify(request.deliveryId)} for task ${JSON.stringify(request.taskId)}`,
        { taskId: request.taskId, deliveryId: request.deliveryId },
      )
    }
    if (receipt.status === 'consumed') return receipt
    const stale =
      receipt.claimEpoch !== request.claimEpoch ||
      (request.consumerId !== undefined &&
        receipt.ownerId !== null &&
        receipt.ownerId !== request.consumerId)
    if (stale) {
      throw new RemoteError(
        'task-feedback/stale-claim',
        `claim ${String(request.claimEpoch)} for delivery ${JSON.stringify(request.deliveryId)} was superseded by ${String(receipt.claimEpoch)}`,
        { taskId: request.taskId, deliveryId: request.deliveryId, claimEpoch: request.claimEpoch },
      )
    }
    const next: ReceiptRecordState = { ...receipt, status: 'consumed', updatedAt: this.now() }
    await this.table.put(next.deliveryId, next)
    return next
  }

  /** Create the first receipt for one delivery, owned by this consumer. */
  async createClaim(
    stored: DeliveryRecordState,
    ownerId: string,
    now: number,
  ): Promise<ReceiptRecordState> {
    const receipt: ReceiptRecordState = {
      deliveryId: stored.deliveryId,
      taskId: stored.taskId,
      status: 'received',
      ownerId,
      claimEpoch: 1,
      leaseExpiresAt: this.leaseUntil(now),
      resumeAttempt: null,
      resumeRootTaskId: null,
      resumeRequestId: null,
      resumeTaskId: null,
      resumeFromSeq: null,
      resumeLastEndTurnAtRegistration: null,
      resumeSubmitted: false,
      claimedAt: this.now(),
      updatedAt: this.now(),
    }
    await this.table.put(receipt.deliveryId, receipt)
    return receipt
  }

  /** Extend the lease of a claim the same consumer still owns. */
  async refreshClaim(existing: ReceiptRecordState, now: number): Promise<ReceiptRecordState> {
    const next: ReceiptRecordState = {
      ...existing,
      leaseExpiresAt: this.leaseUntil(now),
      updatedAt: this.now(),
    }
    await this.table.put(next.deliveryId, next)
    return next
  }

  /** Take over an ownerless or expired claim with a new generation. */
  async reclaimClaim(
    existing: ReceiptRecordState,
    ownerId: string,
    now: number,
  ): Promise<ReceiptRecordState> {
    const next: ReceiptRecordState = {
      ...existing,
      ownerId,
      claimEpoch: existing.claimEpoch + 1,
      leaseExpiresAt: this.leaseUntil(now),
      updatedAt: this.now(),
    }
    await this.table.put(next.deliveryId, next)
    return next
  }

  /** The lease deadline for a claim taken at `now`. */
  private leaseUntil(now: number): string {
    return new Date(now + this.claimLeaseMs).toISOString()
  }

  /**
   * Create or advance one receipt, never moving it backwards.
   *
   * This is the lower-level `ack` path: it records consumption progress without
   * taking ownership, so a later `receive` adopts the claim.
   * @param taskId - the task the delivery belongs to.
   * @param deliveryId - the delivery being consumed.
   * @param status - the consumption status now observed.
   * @returns the receipt as stored.
   */
  async recordReceipt(
    taskId: string,
    deliveryId: string,
    status: TaskReceiptStatus,
  ): Promise<ReceiptRecordState> {
    const receipts = this.table
    const now = this.now()
    const existing = receipts.get(deliveryId)
    if (existing === undefined) {
      const created: ReceiptRecordState = {
        deliveryId,
        taskId,
        status,
        ownerId: null,
        claimEpoch: 0,
        leaseExpiresAt: null,
        resumeAttempt: null,
        resumeRootTaskId: null,
        resumeRequestId: null,
        resumeTaskId: null,
        resumeFromSeq: null,
        resumeLastEndTurnAtRegistration: null,
        resumeSubmitted: false,
        claimedAt: now,
        updatedAt: now,
      }
      await receipts.put(deliveryId, created)
      return created
    }
    if (RECEIPT_ORDER.indexOf(status) <= RECEIPT_ORDER.indexOf(existing.status)) return existing
    const next: ReceiptRecordState = { ...existing, status, updatedAt: now }
    await receipts.put(deliveryId, next)
    return next
  }
}
