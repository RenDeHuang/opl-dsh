import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessService } from '../../src/execution/host/harness.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanup.length) await cleanup.pop()!()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opl-pages-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'profiles/desktop'), { recursive: true })
  const records = ['one', 'two', 'three'].map((id, index) => ({
    id,
    combination: 'dsh/deepseek-flash',
    harnessRef: 'dsh',
    modelRef: { provider: 'custom', model: 'test' },
    cwd: root,
    acpSessionId: 'native-' + id,
    origin: { kind: 'desktop', sessionId: 'manual' },
    assignment: {
      taskId: id,
      objective: 'check',
      acceptance: 'verified',
      autoReview: false,
      maxRevisions: 2,
      revisions: 0,
      createdAt: '2026-01-01T00:00:00Z',
    },
    title: id,
    sandbox: 'read-only',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: `2026-01-0${3 - index}T00:00:00Z`,
    unknownExtension: 'preserved',
    turns: Array.from({ length: 65 }, (_, turn) => ({
      operationId: `${id}:${turn}`,
      fingerprint: 'fingerprint',
      prompt: 'private original prompt',
      text: 'long historical output'.repeat(100),
      state: turn === 64 && id === 'one' ? 'running' : 'completed',
      tools: [],
      futureTurnData: { keep: true },
    })),
  }))
  await writeFile(join(root, 'profiles/desktop/harness-sessions.json'), JSON.stringify(records))
  const ctx = { get: () => undefined, agents: { get: () => undefined } } as unknown as Context
  function mount() {
    const service = new HarnessService(ctx, { home: root })
    cleanup.push(() => service.dispose())
    return service
  }
  return { mount }
}

describe('bounded execution history APIs', () => {
  it('returns summaries without history, with cursor and conditional polling', async () => {
    const { mount } = await fixture(),
      service = mount()
    const first = await service.sessions({ limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['one', 'two'])
    expect(first.items[0]).toMatchObject({ turnCount: 65, state: 'interrupted' })
    expect(JSON.stringify(first)).not.toContain('private original prompt')
    expect(first.items[0]).not.toHaveProperty('turns')
    expect(first.items[0]).not.toHaveProperty('approvals')
    expect(await service.sessions({ limit: 2, revision: first.revision })).toEqual({
      items: [],
      revision: first.revision,
      unchanged: true,
    })
    expect(
      (await service.sessions({ limit: 2, cursor: first.nextCursor })).items.map((item) => item.id),
    ).toEqual(['three'])
    await expect(service.sessions({ limit: 1000 })).rejects.toThrow('分页条数')
  })

  it('keeps parent task polling bounded and omits prompts, output, and tool history', async () => {
    const { mount } = await fixture(),
      service = mount()
    const tasks = await service.taskSummaries({ kind: 'desktop', sessionId: 'manual' })
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({ turnCount: 65, latestTurn: { operationId: 'one:64' } })
    expect(tasks[0]).not.toHaveProperty('turns')
    expect(JSON.stringify(tasks)).not.toContain('long historical output')
    expect(JSON.stringify(tasks)).not.toContain('private original prompt')
    expect(await service.taskSummaries({ kind: 'desktop', sessionId: 'different-parent' })).toEqual(
      [],
    )
  })

  it('serializes only the changed session and advances revisions even within the same timestamp', async () => {
    const { mount } = await fixture(),
      service = mount()
    const original = await service.detail({ sessionId: 'two' })
    const serialized: string[] = []
    const stringify = JSON.stringify
    vi.spyOn(JSON, 'stringify').mockImplementation(((value: any, ...args: any[]) => {
      if (
        value &&
        typeof value === 'object' &&
        typeof value.id === 'string' &&
        Array.isArray(value.turns)
      )
        serialized.push(value.id)
      return (stringify as any)(value, ...args)
    }) as typeof JSON.stringify)
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-27T00:00:00.000Z')
    const origin = { kind: 'desktop' as const, sessionId: 'manual' }
    await service.reviewTask(origin, {
      sessionId: 'two',
      operationId: 'two:64',
      decision: 'accepted',
      note: 'verified second task',
    })
    expect(serialized).toEqual(['two'])
    const second = await service.detail({ sessionId: 'two', revision: original.revision })
    expect(second.unchanged).toBe(false)
    await service.reviewTask(origin, {
      sessionId: 'three',
      operationId: 'three:64',
      decision: 'accepted',
      note: 'verified third task',
    })
    expect(serialized).toEqual(['two', 'three'])
    expect(
      (await service.sessions()).items
        .filter((item) => item.id !== 'one')
        .map((item) => item.updatedAt),
    ).toEqual(['2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'])
    expect((await service.detail({ sessionId: 'two', revision: second.revision })).unchanged).toBe(
      false,
    )
  })

  it('loads recent and earlier turns without returning unchanged history, and invalidates on restart', async () => {
    const { mount } = await fixture(),
      service = mount()
    const latest = await service.detail({ sessionId: 'one' })
    expect(latest).toMatchObject({ totalTurns: 65, beforeTurn: 35, unchanged: false })
    expect(latest.session?.turns.map((turn) => turn.operationId)).toEqual(
      Array.from({ length: 30 }, (_, i) => `one:${35 + i}`),
    )
    expect(latest.session?.turns.at(-1)).toMatchObject({
      state: 'interrupted',
      futureTurnData: { keep: true },
    })
    const unchanged = await service.detail({ sessionId: 'one', revision: latest.revision })
    expect(unchanged).toMatchObject({ unchanged: true, totalTurns: 65, beforeTurn: 35 })
    expect(unchanged).not.toHaveProperty('session')
    const earlier = await service.detail({ sessionId: 'one', beforeTurn: latest.beforeTurn })
    expect(earlier).toMatchObject({ beforeTurn: 5 })
    expect(earlier.session?.turns[0]?.operationId).toBe('one:5')
    expect((await service.detail({ sessionId: 'one', beforeTurn: 5 })).beforeTurn).toBe(0)
    await service.dispose()
    const restarted = mount()
    expect(await restarted.detail({ sessionId: 'one', revision: latest.revision })).toMatchObject({
      unchanged: false,
    })
    expect((await restarted.snapshot({ sessionId: 'one' })).turns).toHaveLength(65)
  })
})
