import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { editGatewayModels, syncGatewayModels } from '../../src/gateway/host/model-settings.ts'
function fixture() {
  const state: any = {
    'opl-suite': {
      gateway: { models: [{ id: 'deepseek-flash', name: 'DeepSeek' }] },
      gatewayCatalogHashes: {},
    },
    'llm-pi-ai': {
      providers: { 'opl-gateway-openai': { api: 'openai-responses', models: [{ id: 'gpt-5' }] } },
    },
  }
  const users: any = { 'opl-suite': {}, 'llm-pi-ai': {} }
  const revisions: Record<string, number> = { 'opl-suite': 0, 'llm-pi-ai': 0 }
  const set = (root: any, path: readonly string[], value: unknown) => {
    for (const key of path.slice(0, -1)) root = root[key] ??= {}
    root[path.at(-1)!] = structuredClone(value)
  }
  const settings = {
    describe: () =>
      Object.entries(state).map(([ns, value]) => ({
        ns,
        value,
        user: users[ns],
        revision: revisions[ns],
      })),
    mutate: vi.fn(async (ns: string, ops: any[], revision?: number) => {
      if (revision !== undefined && revision !== revisions[ns]) throw Error('conflict')
      for (const op of ops) {
        set(state[ns], op.path, op.value)
        set(users[ns], op.path, op.value)
      }
      revisions[ns]++
    }),
  }
  const discover = vi.fn(async () => [{ id: 'gpt-new' }])
  const credentials = {
    resolve: async (ref: string) =>
      ref === 'OPL_GATEWAY_CODEX_API_KEY' ? { value: 'fixture' } : undefined,
  }
  const account = { status: async () => ({ groups: [{ id: 'codex', state: 'ready' }] }) }
  const ctx = {
    settings,
    credentials,
    llm: {
      listConfigurableProviders: () => [{ settingsNs: 'llm-pi-ai' }],
      discoverModels: discover,
    },
    get: (name: string) =>
      name === 'settings' ? settings : name === 'oplGatewayAccount' ? account : undefined,
    logger: { warn: vi.fn() },
  } as unknown as Context
  return { ctx, state, users, revisions, settings, discover }
}
describe('native model settings authority', () => {
  it('writes DeepSeek edits to the actual adapter config and keeps an explicitly empty list', async () => {
    const f = fixture()
    await editGatewayModels(f.ctx, { group: 'deepseek', revision: 0, models: [] })
    expect(f.state['opl-suite'].gateway.models).toEqual([])
    expect(f.state['llm-pi-ai'].providers['opl-gateway']).toBeUndefined()
  })
  it('writes Codex edits into the official protocol provider without changing credentials', async () => {
    const f = fixture()
    await editGatewayModels(f.ctx, {
      group: 'codex',
      revision: 0,
      api: 'openai-completions',
      models: [{ id: 'same-id' }],
    })
    expect(f.state['llm-pi-ai'].providers['opl-gateway-openai']).toMatchObject({
      models: [{ id: 'same-id' }],
      api: 'openai-completions',
    })
  })
  it('rejects stale edits and duplicate identities', async () => {
    const f = fixture()
    await expect(
      editGatewayModels(f.ctx, { group: 'deepseek', revision: 9, models: [] }),
    ).rejects.toThrow('conflict')
    await expect(
      editGatewayModels(f.ctx, {
        group: 'codex',
        revision: 0,
        api: 'openai-responses',
        models: [{ id: 'a' }, { id: 'a' }],
      }),
    ).rejects.toThrow('重复')
  })
  it('refreshes automatic imports but preserves a later manual model list', async () => {
    const f = fixture()
    await syncGatewayModels(f.ctx)
    expect(f.state['llm-pi-ai'].providers['opl-gateway-openai'].models).toEqual([{ id: 'gpt-new' }])
    f.discover.mockResolvedValue([{ id: 'gpt-next' }])
    await syncGatewayModels(f.ctx)
    expect(f.state['llm-pi-ai'].providers['opl-gateway-openai'].models).toEqual([
      { id: 'gpt-next' },
    ])
    await editGatewayModels(f.ctx, {
      group: 'codex',
      revision: f.revisions['llm-pi-ai'],
      api: 'openai-responses',
      models: [{ id: 'chosen' }],
    })
    await syncGatewayModels(f.ctx)
    expect(f.state['llm-pi-ai'].providers['opl-gateway-openai'].models).toEqual([{ id: 'chosen' }])
    expect(f.discover).toHaveBeenCalledTimes(2)
  })

  it('does not auto-import DeepSeek Flash into the optional OpenAI protocol route', async () => {
    const f = fixture()
    f.discover.mockResolvedValue([{ id: 'deepseek-flash' }, { id: 'gpt-new' }])
    await syncGatewayModels(f.ctx)
    expect(f.state['llm-pi-ai'].providers['opl-gateway-openai'].models).toEqual([{ id: 'gpt-new' }])
  })
})

describe('Gateway discovery presentation', () => {
  it('prefers the configured general ID over an unselected version ID without rewriting saved identities', async () => {
    const { gatewayModelChoices } = await import('../../src/gateway/shared/model-choices.ts')
    const version = { id: 'deepseek-v4.1-flash' },
      current = { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }
    expect(gatewayModelChoices([version, current], [current])).toEqual([current])
    expect(gatewayModelChoices([version], [])).toEqual([version])
    expect(gatewayModelChoices([version, current], [version])).toEqual([version, current])
  })
})
