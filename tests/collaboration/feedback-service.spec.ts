import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage, { type KvUnit, type StorageBackend } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TaskFeedbackService from '../../src/collaboration/host/feedback/index.ts'
import { feedbackSessionFacts } from '../../src/collaboration/host/feedback/session-facts.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length) await cleanups.pop()!()
})

/** Only the opaque media seam is substituted: real DomainFacility validates
 * reloads and updates its memory after successful writes, under its own queue.
 * The file is reread on every mount; no service/domain state survives restart.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opl-feedback-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  let failTable: string | undefined
  const file = join(root, 'domain.json')
  const backend: StorageBackend = {
    close: async () => {},
    kv: {
      async open(descriptor) {
        let data: Awaited<ReturnType<KvUnit['loadAll']>>
        try {
          data = JSON.parse(await readFile(file, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          data = {
            tables: Object.fromEntries(descriptor.tables.map((name) => [name, {}])),
            global: null,
          }
        }
        let closed = false
        async function persist(next: typeof data, table: string) {
          if (closed) throw new Error('closed')
          if (failTable === table) {
            failTable = undefined
            throw new Error(`injected ${table} write failure`)
          }
          await writeFile(file + '.tmp', JSON.stringify(next))
          await rename(file + '.tmp', file)
          data = next
        }
        return {
          loadAll: async () => structuredClone(data),
          putRecord: async (table, key, value) => {
            await persist(
              {
                ...data,
                tables: { ...data.tables, [table]: { ...data.tables[table], [key]: value } },
              },
              table,
            )
          },
          deleteRecord: async (table, key) => {
            const records = { ...data.tables[table] }
            delete records[key]
            await persist({ ...data, tables: { ...data.tables, [table]: records } }, table)
          },
          setGlobal: async (global) => {
            await persist({ ...data, global }, 'global')
          },
          close: async () => {
            closed = true
          },
        }
      },
    },
  }
  async function mount(autoDeliver = false) {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('fixture', backend)
    ctx.provide('storageDomain')
    ctx.set('storageDomain', new DomainFacility(ctx, { backend: 'fixture' }))
    const session = { id: 'source-session' as SessionId, seq: 0 } as Session
    ctx.provide('sessions')
    ctx.set('sessions', {
      get: (id: SessionId) => (id === session.id ? session : undefined),
    } as Context['sessions'])
    let facts = feedbackSessionFacts.init()
    ctx.provide('sessionProjections')
    ctx.set('sessionProjections', {
      register: () => {},
      stateOf: (_session: Session, key: string) =>
        key === 'taskFeedbackFacts' ? facts : undefined,
    } as unknown as Context['sessionProjections'])
    await ctx.plugin(TaskFeedbackService, { autoDeliver, claimLeaseMs: 10_000, retryBaseMs: 1 })
    cleanups.push(() => ctx.fiber.dispose())
    const service = ctx.taskFeedback
    async function complete(taskId = 'task') {
      await service.register({
        taskId,
        sessionId: session.id,
        turn: 1,
        target: { kind: 'codex-thread', threadId: 'target-thread' },
        acceptance: 'verified outcome',
      })
      const event = {
        type: 'turn/end',
        seq: 1,
        data: { turn: 1, reason: { kind: 'completed' } },
      } as SessionEvent
      facts = feedbackSessionFacts.apply(facts, event)
      ctx.emit('session/event', session, event)
      await service.settled()
      return service.deliveries()[0]!
    }
    return { ctx, service, complete }
  }
  return {
    mount,
    failNext: (table: string) => {
      failTable = table
    },
  }
}

const accepting = () => ({
  id: 'test-transport',
  probe: async () => ({ started: true, detail: 'test' }),
  send: vi.fn(async () => ({ accepted: true })),
})

describe('feedback service durable lifecycle', () => {
  it('repairs the task/outbox split write on restart without registering or executing work again', async () => {
    const disk = await fixture(),
      first = await disk.mount()
    disk.failNext('outbox')
    await expect(first.complete()).rejects.toThrow('injected outbox')
    expect(first.service.deliveries()).toEqual([])
    await first.ctx.fiber.dispose()
    const restarted = await disk.mount()
    expect(restarted.service.tasks()).toMatchObject([{ taskId: 'task', state: 'completed' }])
    expect(restarted.service.deliveries()).toMatchObject([
      { deliveryId: 'task@completed', stage: 'enqueued' },
    ])
    const transport = accepting()
    restarted.service.setWakeAdapter(transport)
    await restarted.service.flush()
    expect(transport.send).toHaveBeenCalledOnce()
  })

  it('serializes concurrent flushes and never resends an accepted handoff after restart', async () => {
    const disk = await fixture(),
      first = await disk.mount()
    await first.complete()
    const transport = accepting()
    first.service.setWakeAdapter(transport)
    await Promise.all([first.service.flush(), first.service.flush()])
    expect(transport.send).toHaveBeenCalledOnce()
    expect(first.service.deliveries()[0]).toMatchObject({
      stage: 'delivered',
      attempts: 1,
      acknowledged: false,
    })
    await first.ctx.fiber.dispose()
    const restarted = await disk.mount()
    restarted.service.setWakeAdapter(transport)
    expect(await restarted.service.flush()).toMatchObject({ attempted: 0, pending: 1 })
    expect(transport.send).toHaveBeenCalledOnce()
  })

  it('does not acknowledge a failed receipt write, and recovers a claim whose acknowledgment failed', async () => {
    const disk = await fixture(),
      first = await disk.mount()
    const delivery = await first.complete()
    const request = {
      taskId: delivery.taskId,
      deliveryId: delivery.deliveryId,
      consumerId: 'reviewer',
    }
    disk.failNext('receipts')
    await expect(first.service.receive(request)).rejects.toThrow('injected receipts')
    expect(first.service.receipts()).toEqual([])
    expect(first.service.deliveries()[0]?.acknowledged).toBe(false)
    disk.failNext('outbox')
    await expect(first.service.receive(request)).rejects.toThrow('injected outbox')
    expect(first.service.receipts()).toMatchObject([{ ownerId: 'reviewer', claimEpoch: 1 }])
    await first.ctx.fiber.dispose()
    const restarted = await disk.mount()
    expect(await restarted.service.receive(request)).toMatchObject({
      action: 'resume',
      receipt: { claimEpoch: 1 },
      delivery: { acknowledged: true },
    })
    expect(await restarted.service.receive({ ...request, consumerId: 'other' })).toMatchObject({
      action: 'busy',
    })
  })

  it('rejects a superseded consumer and persists consumption so duplicate notifications skip review', async () => {
    const disk = await fixture(),
      first = await disk.mount()
    await first.complete()
    const request = { taskId: 'task', deliveryId: 'task@completed' }
    const received = await first.service.receive({ ...request, consumerId: 'first' })
    const future = Date.parse(received.receipt.leaseExpiresAt!) + 1
    vi.spyOn(Date, 'now').mockReturnValue(future)
    const reclaimed = await first.service.receive({ ...request, consumerId: 'second' })
    expect(reclaimed).toMatchObject({
      action: 'resume',
      receipt: { claimEpoch: 2, ownerId: 'second' },
    })
    await expect(
      first.service.consume({ ...request, consumerId: 'first', claimEpoch: 1 }),
    ).rejects.toMatchObject({ code: 'task-feedback/stale-claim' })
    disk.failNext('receipts')
    await expect(
      first.service.consume({ ...request, consumerId: 'second', claimEpoch: 2 }),
    ).rejects.toThrow('injected receipts')
    expect(first.service.receipts()[0]?.status).toBe('received')
    await first.service.consume({ ...request, consumerId: 'second', claimEpoch: 2 })
    await first.ctx.fiber.dispose()
    const restarted = await disk.mount()
    expect(await restarted.service.receive({ ...request, consumerId: 'third' })).toMatchObject({
      action: 'skip',
      receipt: { status: 'consumed', claimEpoch: 2 },
    })
  })

  it('keeps a receiver acknowledgment that lands while the transport is still returning', async () => {
    const disk = await fixture(),
      first = await disk.mount()
    await first.complete()
    const entered = Promise.withResolvers<void>()
    const result = Promise.withResolvers<{ accepted: boolean }>()
    const transport = accepting()
    transport.send.mockImplementationOnce(async () => {
      entered.resolve()
      return result.promise
    })
    first.service.setWakeAdapter(transport)
    const flush = first.service.flush()
    await entered.promise
    await first.service.receive({
      taskId: 'task',
      deliveryId: 'task@completed',
      consumerId: 'receiver',
    })
    result.resolve({ accepted: true })
    await flush
    expect(first.service.deliveries()[0]).toMatchObject({
      stage: 'received',
      acknowledged: true,
      attempts: 1,
      nextAttemptAt: null,
    })
  })

  it('starts the automatic pump and aborts a hanging send before closing the domain', async () => {
    const disk = await fixture(),
      first = await disk.mount(true)
    const entered = Promise.withResolvers<AbortSignal>()
    first.service.setWakeAdapter({
      ...accepting(),
      send: async (_delivery, signal) => {
        entered.resolve(signal)
        return new Promise(() => {})
      },
    })
    await first.complete()
    const signal = await entered.promise
    await first.ctx.fiber.dispose()
    expect(signal.aborted).toBe(true)
    const restarted = await disk.mount()
    expect(restarted.service.deliveries()[0]).toMatchObject({
      stage: 'enqueued',
      attempts: 0,
      acknowledged: false,
    })
  })

  it('retries refused transport without changing the completed task', async () => {
    const disk = await fixture(),
      first = await disk.mount()
    await first.complete()
    const transport = accepting()
    transport.send.mockResolvedValueOnce({ accepted: false })
    first.service.setWakeAdapter(transport)
    expect(await first.service.flush()).toMatchObject({ attempted: 1, delivered: 0, pending: 1 })
    expect(first.service.task({ taskId: 'task' }).state).toBe('completed')
    vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse(first.service.deliveries()[0]!.nextAttemptAt!) + 1,
    )
    expect(await first.service.flush()).toMatchObject({ attempted: 1, delivered: 1 })
    expect(transport.send).toHaveBeenCalledTimes(2)
  })
})
