import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { finishSetup, setupStatus } from '../../src/setup/host/state.ts'
function fixture({ ready = false, official = false, failSelection = false } = {}) {
  let saved = { loginChoice: 'undecided', setupCompleted: false }
  const select = failSelection
    ? vi.fn().mockRejectedValue(Error('failed'))
    : vi.fn().mockResolvedValue(undefined)
  const ctx = {
    get: () => ({ status: async () => ({ keyReady: ready, codexKeyReady: false }) }),
    typertGateway: {
      invoke: async () => ({ status: official ? 'credential-stored' : 'signed-out' }),
    },
    settings: {
      describe: () => [{ ns: 'opl-suite', value: saved }],
      update: async (_ns: string, value: typeof saved) => {
        saved = { ...saved, ...value }
      },
    },
    credentials: { resolve: async () => undefined },
    llm: { listModels: async () => [{ id: 'deepseek-flash' }] },
    agentDefaultModel: { saveSelection: select },
  } as unknown as Context
  return { ctx, select, saved: () => saved }
}
describe('first-run completion', () => {
  it('persists later without selecting a model or manufacturing a credential', async () => {
    const f = fixture()
    await finishSetup(f.ctx, 'later')
    expect(await setupStatus(f.ctx)).toMatchObject({
      completed: true,
      choice: 'later',
      gatewayReady: false,
    })
    expect(f.select).not.toHaveBeenCalled()
  })
  it('refuses an unconnected gateway without completing setup', async () => {
    const f = fixture()
    await expect(finishSetup(f.ctx, 'gateway')).rejects.toThrow()
    expect(f.saved().setupCompleted).toBe(false)
    expect(f.select).not.toHaveBeenCalled()
  })
  it('does not block a usable primary channel on an unavailable backup', async () => {
    const f = fixture({ ready: true })
    await finishSetup(f.ctx, 'gateway')
    expect(f.select).toHaveBeenCalledWith({ provider: 'opl-gateway', model: 'deepseek-flash' })
    expect(f.saved().setupCompleted).toBe(true)
  })
  it('saves the official account route when explicitly selected', async () => {
    const f = fixture({ official: true })
    await finishSetup(f.ctx, 'official')
    expect(f.select).toHaveBeenCalledWith({ provider: 'deepseek-account', model: 'deepseek-flash' })
  })
  it('keeps setup incomplete when model persistence fails', async () => {
    const f = fixture({ ready: true, failSelection: true })
    await expect(finishSetup(f.ctx, 'gateway')).rejects.toThrow()
    expect(f.saved().setupCompleted).toBe(false)
  })
})
