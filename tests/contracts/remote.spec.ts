import { describe, expect, it } from 'vitest'
import { TYPERT } from '../../src/generated/host.mjs'
import { TYPERT_REMOTE } from '../../src/generated/remote.mjs'

describe('generated product RPC contracts', () => {
  it('rejects malformed execution commands before they reach an executor', () => {
    const command = TYPERT.invocations.find(
      (item) => item.namespace === 'oplExecution' && item.method === 'start',
    )!
    const codec = command.parameters[0]!.codec!.create()
    expect(() => codec.parse({ combination: 'example', cwd: 42 })).toThrow()
    expect(() =>
      codec.parse({ combination: 'example', cwd: '/project', sandbox: 'unrestricted' }),
    ).toThrow()
    expect(
      codec.parse({ combination: 'example', cwd: '/project', sandbox: 'read-only' }),
    ).toMatchObject({ sandbox: 'read-only' })
  })

  it('preserves nested provider-specific model configuration through both codecs', () => {
    const model = {
      id: 'custom-model',
      name: 'Custom',
      contextWindow: 2048,
      input: ['text', 'image'],
      reasoningEfforts: { high: 'high', off: null },
      cost: { input: 1, output: 2 },
    }
    const host = TYPERT.invocations.find(
      (item) => item.namespace === 'oplGatewayModels' && item.method === 'edit',
    )!
    const request = host.parameters[0]!.codec!.create().parse({
      group: 'codex',
      revision: 2,
      models: [model],
      api: 'openai-responses',
    })
    expect(request.models[0]).toEqual(model)
    const client = TYPERT_REMOTE.descriptors.find(
      (item) => item.namespace === 'oplGatewayModels' && item.method === 'read',
    )!
    const response = client.result.create().parse({
      groups: [
        {
          id: 'codex',
          name: 'Codex',
          api: 'openai-responses',
          models: [model],
          state: 'ready',
          ready: true,
          revision: 2,
        },
      ],
    })
    expect(response.groups[0].models[0]).toEqual(model)
  })

  it('session summaries do not disclose full prompt or response histories', () => {
    const descriptor = TYPERT_REMOTE.descriptors.find(
      (item) => item.namespace === 'oplExecution' && item.method === 'sessions',
    )!
    const parsed = descriptor.result.create().parse({
      items: [
        {
          id: 'a',
          combination: 'c',
          harnessRef: 'dsh',
          modelRef: { provider: 'p', model: 'm' },
          cwd: '/project',
          acpSessionId: 'native',
          origin: { kind: 'desktop', sessionId: 'panel' },
          title: 'A',
          sandbox: 'read-only',
          createdAt: 'now',
          updatedAt: 'now',
          connected: false,
          state: 'idle',
          turnCount: 1,
          turns: [{ prompt: 'private history' }],
          approvals: [],
        },
      ],
      revision: 'one',
      unchanged: false,
    })
    expect(parsed.items[0]).not.toHaveProperty('turns')
    expect(parsed.items[0]).not.toHaveProperty('approvals')
  })
})
