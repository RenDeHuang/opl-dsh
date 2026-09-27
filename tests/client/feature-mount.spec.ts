/** Real Cordis fibers enforce required service access; only rendering/transport are stubs. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { CoordinationCall, ExecutionCall } from '../../src/shared/client/remote-call.ts'
import type { SetupActions } from '../../src/setup/client/SetupScreen.tsx'
import type { OplGatewaySectionInjected } from '../../src/gateway/client/OplGatewaySection.tsx'

vi.mock('../../src/collaboration/client/CoordinationSection.tsx', () => ({
  CoordinationSection: () => null,
}))
vi.mock('../../src/setup/client/SetupScreen.tsx', () => ({ SetupScreen: () => null }))
vi.mock('../../src/setup/client/AccountLauncher.tsx', () => ({ AccountLauncher: () => null }))
vi.mock('../../src/gateway/client/OplGatewaySection.tsx', () => ({ OplGatewaySection: () => null }))
vi.mock('../../src/gateway/client/GatewayModels.tsx', () => ({ GatewayModels: () => null }))
vi.mock('../../src/compat/client/gateway-models.ts', () => ({
  installGatewayModelPresentation: () => () => {},
}))
import * as collaboration from '../../src/collaboration/client/index.tsx'
import * as setup from '../../src/setup/client/index.tsx'
import * as gateway from '../../src/gateway/client/index.tsx'

type Registration = { name: string; id?: string; inject?: () => unknown }
class Slots extends Service {
  readonly registrations: Registration[] = []
  constructor(ctx: Context) {
    super(ctx, 'slots')
  }
  inject(_name: string, callback: () => unknown) {
    return callback()
  }
  register(registration: Registration) {
    this.registrations.push(registration)
    return this.ctx.effect(() => () => {
      const index = this.registrations.indexOf(registration)
      if (index >= 0) this.registrations.splice(index, 1)
    })
  }
}
class StubService extends Service {
  constructor(ctx: Context, name: string, methods: object = {}) {
    super(ctx, name)
    Object.assign(this, methods)
  }
}
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})
const ok = <T>(value: T) => ({ ok: true as const, value })
async function fixture(namespaces: Record<string, object>) {
  const ctx = new Context()
  contexts.push(ctx)
  let slots!: Slots
  // Each service lives in a sibling provider fiber, exactly as desktop services
  // do. Providing mocks in the tested plugin's ancestry would bypass inject.
  await ctx.plugin({
    name: 'fixture-services',
    apply(provider: Context) {
      slots = new Slots(provider)
      new StubService(provider, 'remote')
      new StubService(provider, 'locale', {
        register: () => () => {},
        bind: () => (key: string) => key,
      })
      // Declare absent names as undefined too: the traced remote parent then
      // enforces access to that namespace instead of silently returning undefined.
      for (const name of [
        'oplCoordination',
        'oplExecution',
        'oplSetup',
        'oplGatewayAccount',
        'oplGatewayModels',
      ]) {
        if (namespaces[name]) new StubService(provider, 'remote.' + name, namespaces[name])
        else provider.provide('remote.' + name, undefined)
      }
    },
  })
  let client!: Context
  // Match the suite entry's declared parent services without granting any
  // sibling Remote namespace to the feature under test.
  await ctx.plugin({
    name: 'suite-client',
    inject: ['remote', 'slots', 'locale'],
    apply(scope: Context) {
      client = scope
    },
  })
  const props = (id: string): unknown => {
    const slot = slots.registrations.find((item) => item.id === id)
    expect(slot, `${id} must remain registered`).toBeDefined()
    return slot!.inject?.()
  }
  return { ctx: client, slots, props }
}

describe('Client feature service boundaries', () => {
  it('enforces Cordis namespace inject rules even when the parent remote is injected', async () => {
    const f = await fixture({ oplExecution: { status: async () => ok(null) } })
    await expect(
      f.ctx.plugin({
        apply(ctx: Context) {
          void ctx.remote.oplExecution
        },
      }),
    ).rejects.toThrow('without inject')
  })
  it('keeps Skill settings mounted without execution and exposes execution settings when available', async () => {
    for (const executionAvailable of [false, true]) {
      const status = vi.fn(async () => ok({ installed: true }))
      const cooperation = vi.fn(async () =>
        ok({ autoReview: true, maxRevisions: 2, externalCodex: false }),
      )
      const f = await fixture({
        oplCoordination: { 'coordination-status': status },
        ...(executionAvailable ? { oplExecution: { 'cooperation-settings': cooperation } } : {}),
      })
      await f.ctx.plugin(collaboration)
      const props = f.props('opl-codex') as {
        call: CoordinationCall
        executionCall?: ExecutionCall
      }
      expect(await props.call('coordination-status')).toEqual({ installed: true })
      if (executionAvailable) {
        expect(await props.executionCall!('cooperation-settings')).toEqual({
          autoReview: true,
          maxRevisions: 2,
          externalCodex: false,
        })
        expect(cooperation).toHaveBeenCalledOnce()
      } else expect(props.executionCall).toBeUndefined()
    }
  })

  it('registers and runs official setup without Gateway while rejecting Gateway actions explicitly', async () => {
    const start = vi.fn(async () => ok(null)),
      finish = vi.fn(async () => ok(null))
    const f = await fixture({
      oplSetup: {
        status: async () => ok({ completed: false, choice: 'undecided', gatewayReady: false }),
        'official-start': start,
        finish,
      },
    })
    await f.ctx.plugin(setup, { bindModelNavigation: () => {} })
    const actions = f.props('opl-setup') as SetupActions & OplGatewaySectionInjected
    expect(f.slots.registrations.some((item) => item.id === 'opl-account')).toBe(true)
    expect(await actions.readSetup()).toMatchObject({ completed: false })
    await actions.startOfficial()
    await actions.finish('official')
    expect(start).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledWith('official')
    for (const action of [
      () => actions.status(),
      () => actions.signIn('fixture@example.test', 'fixture-password'),
      () => actions.refresh(),
      () => actions.signOut(),
    ]) {
      expect(action).toThrow('OPL Gateway 暂不可用，可选择官方账户或稍后设置。')
    }
  })

  it('uses an optional Gateway account from official setup without undeclared-service access', async () => {
    const status = vi.fn(async () => ok({ phase: 'signed-out' }))
    const f = await fixture({
      oplSetup: { status: async () => ok({ completed: true }) },
      oplGatewayAccount: { status },
    })
    await f.ctx.plugin(setup, { bindModelNavigation: () => {} })
    const actions = f.props('opl-setup') as SetupActions & OplGatewaySectionInjected
    expect(await actions.status()).toEqual({ phase: 'signed-out' })
    expect(status).toHaveBeenCalledOnce()
  })

  it('keeps account settings available independently of the optional model service', async () => {
    for (const modelsAvailable of [false, true]) {
      const accountStatus = { phase: 'signed-out', keyReady: false }
      const activate = vi.fn(async () => ok(accountStatus))
      const f = await fixture({
        oplGatewayAccount: { status: async () => ok(accountStatus) },
        ...(modelsAvailable ? { oplGatewayModels: { activate } } : {}),
      })
      await f.ctx.plugin(gateway)
      await vi.waitFor(() =>
        expect(f.slots.registrations.some((item) => item.id === 'opl-gateway')).toBe(true),
      )
      const actions = f.props('opl-gateway') as OplGatewaySectionInjected
      expect(await actions.status()).toEqual(accountStatus)
      if (modelsAvailable) {
        expect(await actions.setGroupActive!('deepseek', true)).toEqual(accountStatus)
        expect(activate).toHaveBeenCalledWith({ id: 'deepseek', enabled: true })
      } else expect(actions.setGroupActive).toBeUndefined()
    }
  })
})
