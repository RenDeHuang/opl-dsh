import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessSessionStore } from '../../src/execution/host/session-store.ts'
import {
  HarnessService,
  GROK_COMBINATION,
  grokConfiguration,
} from '../../src/execution/host/harness.ts'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'opl-acp-test-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const options = {
    home: join(root, 'state'),
    command: process.execPath,
    prefix: [resolve('tests/fixtures/acp-agent.mjs')],
    resolveKey: async () => 'test-grok-key',
  }
  const ctx = { get: () => undefined, agents: { get: () => undefined } } as unknown as Context
  const service = new HarnessService(ctx, options)
  cleanups.push(() => service.dispose())
  return { root, options, ctx, service }
}
const start = (s: HarnessService, cwd: string, taskId = 'task') =>
  s.start({
    combination: GROK_COMBINATION,
    cwd,
    taskId,
    origin: { kind: 'codex', sessionId: 'parent' },
  })
const wait = (s: HarnessService, id: string) => s.wait({ sessionId: id }, AbortSignal.timeout(8000))
async function nativeSetup(
  models = [
    { id: 'codex::test-model', name: 'Test Model' },
    { id: 'deepseek-flash', name: 'DeepSeek' },
  ],
  providers = [{ id: 'opl-gateway', name: 'OPL Gateway' }],
) {
  const { root, options } = await setup()
  let current = { provider: 'opl-gateway', model: 'codex::test-model' }
  const session = { id: 'native-session', append: vi.fn() }
  const ctx = {
    get: () => undefined,
    agents: { get: () => undefined },
    sessions: { get: () => session },
    llm: {
      listProviders: () => providers,
      listConfigurableProviders: () => [],
      listModels: async () => models,
    },
    sessionProjections: { snapshot: () => ({ values: { modelSelection: { next: current } } }) },
    typertGateway: {
      invoke: async ({ method, args }: any) => {
        if (method === 'modelCatalog') return { default: current, groups: [] }
        if (method === 'selectModel') {
          const { provider, model } = args.request
          current = { provider, model }
        }
      },
    },
  } as unknown as Context
  const service = new HarnessService(ctx, options)
  cleanups.push(() => service.dispose())
  return {
    root,
    options,
    ctx,
    service,
    session,
    changeModel: () => {
      current = { provider: 'opl-gateway', model: 'deepseek-flash' }
    },
  }
}
describe('native conversation combinations', () => {
  it('retries a failed final session write on graceful shutdown', async () => {
    const { service, root, options } = await setup()
    const session = await start(service, root)
    const original = HarnessSessionStore.prototype.saveChanged
    let failed = false
    const spy = vi
      .spyOn(HarnessSessionStore.prototype, 'saveChanged')
      .mockImplementation(function (records) {
        const values = [...records]
        if (!failed && values.some((record) => record.turns.at(-1)?.state === 'completed')) {
          failed = true
          return Promise.reject(Error('temporary disk failure'))
        }
        return original.call(this, values)
      })
    try {
      await service.prompt({ sessionId: session.id, text: 'persist', operationId: 'one' })
      await vi.waitFor(async () => {
        expect((await service.snapshot({ sessionId: session.id })).turns.at(-1)?.error).toContain(
          '结果未能持久保存',
        )
      })
      await service.dispose()
      const records = await new HarnessSessionStore(options.home).load()
      expect(records.find((record) => record.id === session.id)?.turns.at(-1)).toMatchObject({
        state: 'failed',
        error: '结果未能持久保存，请检查磁盘后重试读取',
      })
    } finally {
      spy.mockRestore()
    }
  })
  it('filters retired provider models and combinations from the live catalog', async () => {
    const { service } = await nativeSetup([
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'codex::gpt-5', name: 'GPT-5' },
      { id: 'codex::gpt-5-mini', name: 'GPT-5 Mini' },
      { id: 'deepseek-flash', name: 'DeepSeek' },
    ])
    const catalog = await service.executionCatalog()
    expect(catalog.models.map((item) => item.ref.model)).not.toEqual(
      expect.arrayContaining(['deepseek-v4-pro', 'codex::gpt-5', 'codex::gpt-5-mini']),
    )
    expect(catalog.combinations.map((item) => item.modelRef.model)).not.toEqual(
      expect.arrayContaining(['deepseek-v4-pro', 'codex::gpt-5', 'codex::gpt-5-mini']),
    )
  })
  it('does not expose the built-in DeepSeek catalog without its own credential', async () => {
    const { service } = await nativeSetup(
      [
        { id: 'deepseek-flash', name: 'DeepSeek' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
      [{ id: 'deepseek-official', name: 'DeepSeek 官方' }],
    )
    const catalog = await service.executionCatalog()
    expect(
      catalog.models.filter((item) => item.ref.provider === 'deepseek-official'),
    ).toMatchObject([{ available: false, reason: '凭据未配置' }])
    expect(
      catalog.combinations.filter((item) => item.modelRef.provider === 'deepseek-official'),
    ).toEqual([])
  })
  it('creates independently named combinations for explicit Gateway channels', async () => {
    const { service } = await nativeSetup([
      { id: 'deepseek-flash', name: 'DeepSeek' },
      { id: 'codex::deepseek-flash', name: 'DeepSeek' },
    ])
    const catalog = await service.executionCatalog()
    expect(
      catalog.combinations.filter(
        (item) => item.harnessRef === 'dsh' && item.modelRef.model.includes('deepseek-flash'),
      ),
    ).toHaveLength(2)
    expect(catalog.models.filter((item) => item.available).map((item) => item.source)).toEqual([
      'OPL Gateway',
      'OPL Gateway',
    ])
  })
  it('restores the chosen combination among bindings to the same model without elevating permissions', async () => {
    const { service, ctx, options, session, changeModel } = await nativeSetup()
    const catalog = await service.executionCatalog()
    const modelRef = { provider: 'opl-gateway', model: 'codex::test-model' }
    catalog.combinations.push(
      {
        id: 'review',
        name: 'Review',
        modelRef,
        harnessRef: 'dsh',
        permissionPolicy: 'read-only',
        isDefault: false,
        enabled: true,
      },
      {
        id: 'work',
        name: 'Work',
        modelRef,
        harnessRef: 'dsh',
        permissionPolicy: 'workspace',
        isDefault: false,
        enabled: true,
      },
    )
    await service.saveExecutionCatalog(catalog)
    await service.selectCombination({ sessionId: session.id, combination: 'review' })
    expect(session.append).toHaveBeenCalledExactlyOnceWith('sandbox/mode', { mode: 'read-only' })
    await service.selectCombination({ sessionId: session.id, combination: 'work' })
    expect(session.append).toHaveBeenCalledTimes(1)
    await service.dispose()
    const restored = new HarnessService(ctx, options)
    cleanups.push(() => restored.dispose())
    expect((await restored.modelSelection(session.id)).combination).toBe('work')
    changeModel()
    expect((await restored.modelSelection(session.id)).combination).toBeUndefined()
  })
  it('preserves a disabled automatic combination instead of generating a duplicate', async () => {
    const { service } = await nativeSetup(),
      catalog = await service.executionCatalog()
    const automatic = catalog.combinations.find(
      (item) => item.generated && item.modelRef.model === 'codex::test-model',
    )!
    automatic.generated = false
    automatic.enabled = false
    const saved = await service.saveExecutionCatalog(catalog)
    expect(saved.combinations.filter((item) => item.id === automatic.id)).toHaveLength(1)
    expect(saved.combinations.find((item) => item.id === automatic.id)?.enabled).toBe(false)
  })
  it('does not mark an external combination ready when its model is absent', async () => {
    const { service } = await nativeSetup()
    expect(
      (await service.list()).combinations.find((item) => item.id === GROK_COMBINATION),
    ).toMatchObject({ available: false, reason: '模型未配置或凭据未就绪' })
  })
})
describe('external Harness production transport', () => {
  it('parses ACP envelopes, deduplicates task/operation, preserves results and restores native sessions', async () => {
    const { root, service, ctx, options } = await setup()
    const [a, b] = await Promise.all([start(service, root), start(service, root)])
    expect(a.id).toBe(b.id)
    await service.prompt({ sessionId: a.id, text: 'remember-721', operationId: 'one' })
    const first = await wait(service, a.id)
    expect(first.turns[0]).toMatchObject({ state: 'completed', text: 'result:remember-721' })
    expect(first.turns[0]?.tools).toHaveLength(1)
    await service.prompt({ sessionId: a.id, text: 'remember-721', operationId: 'one' })
    await expect(
      service.prompt({ sessionId: a.id, text: 'changed', operationId: 'one' }),
    ).rejects.toThrow('operation')
    expect((await readFile(join(root, 'calls.txt'), 'utf8')).trim().split('\n')).toHaveLength(1)
    await service.dispose()
    const resumed = new HarnessService(ctx, options)
    cleanups.push(() => resumed.dispose())
    await resumed.start({ combination: GROK_COMBINATION, cwd: root, existingSessionId: a.id })
    await resumed.prompt({ sessionId: a.id, text: 'recall', operationId: 'two' })
    expect((await wait(resumed, a.id)).turns[1]?.text).toBe('remember-721')
    const launch = JSON.parse(await readFile(join(root, 'launch.json'), 'utf8'))
    expect(launch).toMatchObject({ envKey: true, hasCodex: false })
    expect(
      await readFile(join(options.home, 'harnesses/grok-build/config.toml'), 'utf8'),
    ).not.toContain('test-grok-key')
  })
  it('holds permission until explicit choice and denies without file writes', async () => {
    const { root, service } = await setup()
    const a = await start(service, root)
    await service.prompt({ sessionId: a.id, text: 'deny-write', operationId: 'deny' })
    const pending = await wait(service, a.id)
    expect(pending.state).toBe('waiting_approval')
    expect(
      await access(join(root, 'controlled.txt')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    const ask = pending.approvals[0]!
    await expect(
      service.answer({ sessionId: a.id, approvalId: ask.id, optionId: 'invalid' }),
    ).rejects.toThrow()
    await service.answer({ sessionId: a.id, approvalId: ask.id, optionId: 'no' })
    expect((await wait(service, a.id)).turns[0]?.text).toBe('denied')
    expect(
      await access(join(root, 'controlled.txt')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    await service.prompt({ sessionId: a.id, text: 'allow-write', operationId: 'allow' })
    const approval = (await wait(service, a.id)).approvals[0]!
    await service.answer({ sessionId: a.id, approvalId: approval.id, optionId: 'yes' })
    await wait(service, a.id)
    expect(await readFile(join(root, 'controlled.txt'), 'utf8')).toBe('approved')
  })
  it('cancels with a notification and rejects parallel prompts and mismatched resumes', async () => {
    const { root, service } = await setup()
    const a = await start(service, root)
    await service.prompt({ sessionId: a.id, text: 'wait', operationId: 'one' })
    await expect(
      service.prompt({ sessionId: a.id, text: 'again', operationId: 'two' }),
    ).rejects.toThrow('执行')
    expect((await service.cancel({ sessionId: a.id })).state).toBe('cancelled')
    await expect(service.start({ combination: 'fake', cwd: root })).rejects.toThrow()
    await expect(
      service.start({ combination: GROK_COMBINATION, cwd: root, existingSessionId: 'missing' }),
    ).rejects.toThrow('不存在')
    await expect(
      service.start({ combination: GROK_COMBINATION, cwd: tmpdir(), existingSessionId: a.id }),
    ).rejects.toThrow('不一致')
  })
  it('fails closed without a Grok key and never falls back to machine credentials', async () => {
    const { root, ctx, options } = await setup()
    const service = new HarnessService(ctx, { ...options, resolveKey: async () => undefined })
    cleanups.push(() => service.dispose())
    await expect(start(service, root)).rejects.toThrow('渠道凭据')
    expect(grokConfiguration()).toContain('env_key = "OPL_GATEWAY_GROK_API_KEY"')
  })
  it('shares one cold connection across concurrent retries after restart', async () => {
    const { root, service, ctx, options } = await setup()
    const a = await start(service, root)
    await service.dispose()
    const resumed = new HarnessService(ctx, options)
    cleanups.push(() => resumed.dispose())
    const request = { sessionId: a.id, text: 'wait', operationId: 'retry' }
    await Promise.all([resumed.prompt(request), resumed.prompt(request)])
    expect((await readFile(join(root, 'connections.txt'), 'utf8')).trim().split('\n')).toEqual([
      'session/new',
      'session/load',
    ])
    expect((await readFile(join(root, 'calls.txt'), 'utf8')).trim().split('\n')).toEqual(['wait'])
    expect((await resumed.cancel({ sessionId: a.id })).state).toBe('cancelled')
  })
  it('inherits project permissions and cancels child work with its parent', async () => {
    const { root, service } = await setup()
    const a = await start(service, root)
    const narrow = await service.start({
      combination: GROK_COMBINATION,
      cwd: root,
      origin: { kind: 'harness', sessionId: a.id },
      sandbox: 'read-only',
    })
    expect(narrow.sandbox).toBe('read-only')
    await expect(
      service.start({
        combination: GROK_COMBINATION,
        cwd: root,
        origin: { kind: 'harness', sessionId: narrow.id },
        sandbox: 'workspace',
      }),
    ).rejects.toThrow('权限边界')
    const child = await service.start({
      combination: GROK_COMBINATION,
      cwd: root,
      origin: { kind: 'harness', sessionId: a.id },
    })
    await service.prompt({ sessionId: a.id, text: 'wait', operationId: 'parent' })
    await service.prompt({ sessionId: child.id, text: 'wait', operationId: 'child' })
    await service.cancel({ sessionId: a.id })
    expect((await service.snapshot({ sessionId: child.id })).state).toBe('cancelled')
  })
})

describe('shared collaboration owner', () => {
  it('separates delivery from acceptance, binds the parent and continues the same task', async () => {
    const { root, service } = await setup(),
      parent = await start(service, root, 'parent')
    const origin = { kind: 'harness' as const, sessionId: parent.id }
    const input = {
      combination: GROK_COMBINATION,
      task: 'deliver-one',
      taskId: 'child',
      operationId: 'one',
    }
    const first = await service.delegateFrom(origin, input)
    expect(first.turns[0]).toMatchObject({
      state: 'completed',
      review: { decision: 'pending' },
      delivery: { state: 'delivered' },
    })
    expect((await service.delegateFrom(origin, input)).id).toBe(first.id)
    expect(await service.tasksFor(origin)).toHaveLength(1)
    await expect(
      service.reviewTask(
        { kind: 'codex', sessionId: 'other' },
        { sessionId: first.id, operationId: 'one', decision: 'accepted', note: 'fake' },
      ),
    ).rejects.toThrow('当前对话')
    await service.reviewTask(origin, {
      sessionId: first.id,
      operationId: 'one',
      decision: 'changes_requested',
      note: '需要补充',
    })
    const second = await service.delegateFrom(origin, {
      ...input,
      sessionId: first.id,
      task: 'deliver-two',
      operationId: 'two',
    })
    expect(second.id).toBe(first.id)
    expect(second.assignment?.revisions).toBe(1)
    await expect(
      service.reviewTask(origin, {
        sessionId: first.id,
        operationId: 'one',
        decision: 'accepted',
        note: 'stale',
      }),
    ).rejects.toThrow('已变化')
    const accepted = await service.reviewTask(origin, {
      sessionId: first.id,
      operationId: 'two',
      decision: 'accepted',
      note: '已核对',
    })
    expect(accepted.turns.at(-1)?.review?.decision).toBe('accepted')
    expect(
      (
        await service.reviewTask(origin, {
          sessionId: first.id,
          operationId: 'two',
          decision: 'accepted',
          note: '已核对',
        })
      ).turns,
    ).toHaveLength(2)
  })
  it('queues writers and cancels queued descendants without executing them', async () => {
    const { root, service } = await setup(),
      parent = await start(service, root, 'parent')
    await service.prompt({ sessionId: parent.id, text: 'wait', operationId: 'hold' })
    const child = await service.delegateFrom(
      { kind: 'harness', sessionId: parent.id },
      {
        combination: GROK_COMBINATION,
        task: 'must-not-execute',
        taskId: 'child',
        operationId: 'one',
        wait: false,
      },
    )
    expect(child.state).toBe('queued')
    await service.cancel({ sessionId: parent.id })
    expect((await service.snapshot({ sessionId: child.id })).state).toBe('cancelled')
    expect(await readFile(join(root, 'calls.txt'), 'utf8')).not.toContain('must-not-execute')
  })
  it('releases a waiting parent, reports approval and resumes without redispatch', async () => {
    const { root, service } = await setup(),
      parent = await start(service, root, 'parent'),
      origin = { kind: 'harness' as const, sessionId: parent.id }
    await service.prompt({ sessionId: parent.id, text: 'wait', operationId: 'hold' })
    const child = await service.delegateFrom(origin, {
      combination: GROK_COMBINATION,
      task: 'deny-write',
      taskId: 'permission',
      operationId: 'one',
    })
    expect(child.state).toBe('waiting_approval')
    const ask = child.approvals[0]!
    await service.answer({ sessionId: child.id, approvalId: ask.id, optionId: 'no' })
    const result = await service.resultFor(origin, { sessionId: child.id, wait: true })
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]?.text).toBe('denied')
    await service.cancel({ sessionId: parent.id })
  })
  it('freezes the model binding across configuration edits and restart', async () => {
    const { root, service, ctx, options } = await setup(),
      parent = await start(service, root, 'parent'),
      origin = { kind: 'harness' as const, sessionId: parent.id }
    const child = await service.delegateFrom(origin, {
      combination: GROK_COMBINATION,
      task: 'first',
      taskId: 'child',
      operationId: 'one',
    })
    const catalog = await service.executionCatalog()
    catalog.combinations = catalog.combinations.filter((c) => c.id !== GROK_COMBINATION)
    await service.saveExecutionCatalog(catalog)
    await service.dispose()
    const restored = new HarnessService(ctx, options)
    cleanups.push(() => restored.dispose())
    const continued = await restored.delegateFrom(origin, {
      sessionId: child.id,
      task: 'second',
      taskId: 'child',
      operationId: 'two',
    })
    expect(continued.modelRef).toEqual(child.modelRef)
    expect(continued.turns).toHaveLength(2)
  })
})

describe('durable collaboration delivery', () => {
  it('delivers an asynchronous result once and preserves the receipt after restart', async () => {
    const { root, service, ctx, options } = await setup(),
      parent = await start(service, root, 'parent'),
      origin = { kind: 'harness' as const, sessionId: parent.id }
    const child = await service.delegateFrom(origin, {
      combination: GROK_COMBINATION,
      task: 'async-result',
      taskId: 'async',
      operationId: 'one',
      wait: false,
    })
    await vi.waitFor(async () =>
      expect((await service.snapshot({ sessionId: parent.id })).turns).toHaveLength(1),
    )
    await wait(service, parent.id)
    expect((await service.snapshot({ sessionId: child.id })).turns[0]?.delivery?.state).toBe(
      'delivered',
    )
    await service.dispose()
    const restored = new HarnessService(ctx, options)
    cleanups.push(() => restored.dispose())
    expect((await restored.snapshot({ sessionId: parent.id })).turns).toHaveLength(1)
    expect((await restored.snapshot({ sessionId: child.id })).turns[0]?.delivery?.state).toBe(
      'delivered',
    )
  })
  it('does not serialize independent read-only work behind a writer', async () => {
    const { root, service } = await setup(),
      writer = await start(service, root, 'writer')
    await service.prompt({ sessionId: writer.id, text: 'wait', operationId: 'hold' })
    const reader = await service.start({
      combination: GROK_COMBINATION,
      cwd: root,
      taskId: 'reader',
      sandbox: 'read-only',
    })
    await service.prompt({ sessionId: reader.id, text: 'read-result', operationId: 'one' })
    expect((await wait(service, reader.id)).state).toBe('completed')
    await service.cancel({ sessionId: writer.id })
  })
})

describe('restart and cancellation boundaries', () => {
  it('marks unfinished operations interrupted without issuing the task again', async () => {
    const { root, service, ctx, options } = await setup(),
      parent = await start(service, root, 'parent')
    await service.prompt({ sessionId: parent.id, text: 'wait', operationId: 'in-flight' })
    const filename = new HarnessSessionStore(options.home).filename(parent.id),
      before = await readFile(filename, 'utf8')
    await service.dispose()
    await writeFile(filename, before)
    const restored = new HarnessService(ctx, options)
    cleanups.push(() => restored.dispose())
    expect((await restored.snapshot({ sessionId: parent.id })).state).toBe('interrupted')
    expect((await readFile(join(root, 'calls.txt'), 'utf8')).trim().split('\n')).toEqual(['wait'])
  })
  it('does not automatically wake a parent after the user cancels it', async () => {
    const { root, service } = await setup(),
      parent = await start(service, root, 'parent')
    await service.prompt({ sessionId: parent.id, text: 'wait', operationId: 'hold' })
    const child = await service.delegateFrom(
      { kind: 'harness', sessionId: parent.id },
      {
        combination: GROK_COMBINATION,
        task: 'queued',
        taskId: 'child',
        operationId: 'one',
        wait: false,
      },
    )
    await service.cancel({ sessionId: parent.id })
    await vi.waitFor(async () =>
      expect((await service.snapshot({ sessionId: child.id })).turns[0]?.delivery?.state).toBe(
        'blocked',
      ),
    )
    expect((await service.snapshot({ sessionId: parent.id })).turns).toHaveLength(1)
  })
})
