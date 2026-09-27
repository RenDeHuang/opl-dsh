/** Serialized outbox transport and retry scheduler.
 * Receipt/task writes stay with TaskFeedbackService; the commit callback
 * arbitrates an acknowledgment arriving while a transport send is in flight.
 */
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { DeliveryRecordState } from './spec.ts'
import type { TaskFlushValue, WakeAdapter } from './types.ts'
import { composeWakeMessage } from './wake.ts'

export interface DeliveryPolicy {
  readonly autoDeliver: boolean
  readonly maxDeliveryAttempts: number
  readonly retryBaseMs: number
  readonly retryMaxMs: number
  readonly sendTimeoutMs: number
  readonly summaryMaxChars: number
}

export class DeliveryPump {
  private passes: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerDueMs: number | undefined
  private closed = false
  private readonly stopping = new AbortController()

  constructor(
    private readonly outbox: KvTable<string, DeliveryRecordState>,
    private readonly config: DeliveryPolicy,
    private adapter: WakeAdapter,
    private readonly beforePass: () => Promise<void>,
    private readonly commit: <T>(operation: () => Promise<T>) => Promise<T>,
    private readonly warn: (message: string, error: unknown) => void,
  ) {}

  setAdapter(adapter: WakeAdapter): void {
    this.adapter = adapter
    this.schedule(0)
  }

  async flush(): Promise<TaskFlushValue> {
    await this.beforePass()
    const { value, nextDueAt } = await this.serializePass(() => this.deliverDue())
    if (nextDueAt !== null) this.schedule(Math.max(0, nextDueAt - Date.now()))
    return value
  }

  private now(): string {
    return new Date().toISOString()
  }

  /**
   * Wait until no delivery pass is in flight.
   *
   * The scheduled pump runs from a timer, so a caller that must observe a
   * quiescent outbox — a test, or an orderly shutdown step — needs a point to
   * await rather than a delay to guess.
   * @returns nothing once the last started pass has settled.
   */
  async idle(): Promise<void> {
    while (true) {
      const current = this.passes
      await Promise.allSettled([current])
      if (current === this.passes) return
    }
  }

  /** Chain one pass onto the single delivery chain. */
  private serializePass<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.passes.then(operation, operation)
    this.passes = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Arm the single delivery wake-up.
   *
   * At most one timer exists: a nearer deadline replaces a later one, and a
   * later one never pushes an armed nearer one out. The timer is unref'd, so a
   * pending retry never keeps the process alive. Storage events arm this; no
   * Session listener ever waits on it.
   * @param delayMs - milliseconds until the next pass.
   */
  schedule(delayMs: number): void {
    if (this.closed || !this.config.autoDeliver) return
    const dueAt = Date.now() + delayMs
    if (this.timer !== undefined) {
      if (this.timerDueMs !== undefined && this.timerDueMs <= dueAt) return
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.timerDueMs = dueAt
    const timer = setTimeout(() => {
      this.timer = undefined
      this.timerDueMs = undefined
      void this.tick().catch((error: unknown) => {
        this.warn('task-feedback: delivery stopped', error)
      })
    }, delayMs)
    timer.unref()
    this.timer = timer
  }

  /** One scheduled pass, followed by the wake-up its result asks for. */
  private async tick(): Promise<void> {
    if (this.closed) return
    await this.beforePass()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can set `closed` while the pass is awaited.
    if (this.closed) return
    const { nextDueAt } = await this.serializePass(() => this.deliverDue())
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can set `closed` while the pass is awaited.
    if (this.closed || nextDueAt === null) return
    this.schedule(Math.max(0, nextDueAt - Date.now()))
  }

  /** Cancel the wake-up and wait for the pass already running. */
  async stop(): Promise<void> {
    this.closed = true
    this.stopping.abort()
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
      this.timerDueMs = undefined
    }
    await this.idle()
  }

  /**
   * Attempt every due delivery once and report the next deadline.
   *
   * Runs only inside the serialized chain. A refused attempt is retried with a
   * capped exponential delay until the attempt budget is spent; an exhausted
   * delivery stays pending and unacknowledged, so nothing is dropped silently,
   * and a refused attempt never touches the task record.
   * @returns the pass counts plus the earliest pending retry deadline.
   */
  private async deliverDue(): Promise<{ value: TaskFlushValue; nextDueAt: number | null }> {
    const outbox = this.outbox
    const now = Date.now()
    let attempted = 0
    let delivered = 0
    let exhausted = 0
    for (const [deliveryId, stored] of [...outbox.entries()]) {
      if (this.closed) break
      if (stored.acknowledged || stored.retired) continue
      // A successful transport handoff is terminal for the sender. The Codex
      // queue owns the message from here; retrying before its receiver claims
      // it appends duplicate wake-ups rather than recovering a failed send.
      if (stored.stage === 'delivered') continue
      if (stored.attempts >= this.config.maxDeliveryAttempts) {
        exhausted += 1
        continue
      }
      if (stored.nextAttemptAt !== null && Date.parse(stored.nextAttemptAt) > now) continue
      attempted += 1
      const result = await this.sendBounded(stored)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- disposal can set `closed` while the send is awaited.
      if (this.closed) break
      const attempts = stored.attempts + 1
      if (result.accepted) delivered += 1
      await this.commit(async () => {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the entry was read above and only the attempt below rewrites it.
        const latest = outbox.get(deliveryId)!
        await outbox.put(deliveryId, {
          ...latest,
          stage: latest.acknowledged ? latest.stage : result.accepted ? 'delivered' : latest.stage,
          attempts,
          nextAttemptAt:
            latest.acknowledged || result.accepted || attempts >= this.config.maxDeliveryAttempts
              ? null
              : new Date(Date.now() + this.retryDelayMs(attempts)).toISOString(),
          updatedAt: this.now(),
        })
      })
      if (!result.accepted && attempts >= this.config.maxDeliveryAttempts) exhausted += 1
    }
    let pending = 0
    let nextDueAt: number | null = null
    for (const [, record] of outbox.entries()) {
      if (record.acknowledged || record.retired) continue
      pending += 1
      if (record.stage === 'delivered') continue
      if (record.attempts >= this.config.maxDeliveryAttempts) continue
      const due = record.nextAttemptAt === null ? now : Date.parse(record.nextAttemptAt)
      if (nextDueAt === null || due < nextDueAt) nextDueAt = due
    }
    return { value: { attempted, delivered, pending, exhausted }, nextDueAt }
  }

  /** Bound transport errors and hung sends without changing task outcomes. */
  private async sendBounded(stored: DeliveryRecordState): Promise<{ accepted: boolean }> {
    const controller = new AbortController()
    const stop = (): void => {
      controller.abort()
    }
    this.stopping.signal.addEventListener('abort', stop, { once: true })
    if (this.stopping.signal.aborted) stop()
    const timer = setTimeout(stop, this.config.sendTimeoutMs)
    let cancel = (): void => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        reject(new Error('delivery timed out or stopped'))
      }
      controller.signal.addEventListener('abort', cancel, { once: true })
      if (controller.signal.aborted) cancel()
    })
    try {
      return await Promise.race([
        aborted,
        Promise.resolve().then(() =>
          this.adapter.send(
            {
              deliveryId: stored.deliveryId,
              threadId: stored.target.threadId,
              message: composeWakeMessage(
                stored.payload,
                stored.deliveryId,
                this.config.summaryMaxChars,
              ),
            },
            controller.signal,
          ),
        ),
      ])
    } catch (error) {
      if (!this.closed) this.warn('task-feedback: transport failed', error)
      return { accepted: false }
    } finally {
      clearTimeout(timer)
      this.stopping.signal.removeEventListener('abort', stop)
      controller.signal.removeEventListener('abort', cancel)
    }
  }

  /** The capped exponential delay before one retry. */
  private retryDelayMs(attempts: number): number {
    return Math.min(this.config.retryBaseMs * 2 ** (attempts - 1), this.config.retryMaxMs)
  }
}
