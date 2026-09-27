import { describe, expect, it, vi } from 'vitest'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { GatewayModelAdapter } from '../../src/gateway/host/model-router.ts'
const request: GenerateOptions = {
  provider: 'opl-gateway',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}
class Adapter extends LlmAdapter {
  constructor(
    readonly run: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
    readonly models: string[],
  ) {
    super()
  }
  override async listModels(provider: string) {
    return this.models.map((id) => ({ provider, id, name: id }))
  }
  stream(options: GenerateOptions) {
    return this.run(options)
  }
}
async function collect(adapter: LlmAdapter, options = request) {
  const chunks = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}
function setup() {
  const deepseek = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const codex = vi.fn(async function* (_options: GenerateOptions): AsyncGenerator<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const adapter = new GatewayModelAdapter(
    [
      {
        group: 'deepseek',
        provider: 'opl-gateway',
        adapter: new Adapter(deepseek, ['deepseek-flash']),
        available: async () => true,
      },
      {
        group: 'codex',
        provider: 'opl-gateway-openai',
        adapter: new Adapter(codex, ['deepseek-flash', 'gpt-6-sol']),
        available: async () => true,
      },
    ],
    vi.fn(),
  )
  return { adapter, deepseek, codex }
}
describe('explicit group routing', () => {
  it('keeps two same-named models independently selectable', async () => {
    const { adapter, deepseek, codex } = setup()
    expect((await adapter.listModels('opl-gateway')).map((m) => m.id)).toEqual([
      'deepseek-flash',
      'codex::deepseek-flash',
      'codex::gpt-6-sol',
    ])
    await collect(adapter, { ...request, model: 'codex::deepseek-flash' })
    expect(deepseek).not.toHaveBeenCalled()
    expect(codex.mock.calls[0]?.[0]).toMatchObject({
      provider: 'opl-gateway-openai',
      model: 'deepseek-flash',
    })
  })
  it('uses Codex as the GPT primary route', async () => {
    const { adapter, codex } = setup()
    await collect(adapter, { ...request, model: 'codex::gpt-6-sol' })
    expect(codex).toHaveBeenCalledOnce()
  })
  it('exposes native Harness reasoning choices through the DSH model catalog', async () => {
    const { adapter } = setup()
    const model = await adapter.resolveModel('opl-gateway', 'codex::gpt-6-sol')
    expect(model.reasoning?.efforts.map((item) => item.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    const listed = (await adapter.listModels('opl-gateway')).find(
      (item) => item.id === 'codex::gpt-6-sol',
    )
    expect(listed?.reasoning?.efforts.map((item) => item.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })
  it('does not send an unknown model to an arbitrary group', async () => {
    const { adapter, codex } = setup()
    await expect(collect(adapter, { ...request, model: 'unknown' })).rejects.toMatchObject({
      code: 'UNKNOWN_MODEL',
    })
    expect(codex).not.toHaveBeenCalled()
  })
  it('does not retry failures in another group', async () => {
    const { adapter, deepseek, codex } = setup()
    deepseek.mockImplementation(async function* () {
      throw new LlmError('down', 'SERVER')
    })
    await expect(collect(adapter)).rejects.toMatchObject({ code: 'SERVER' })
    expect(codex).not.toHaveBeenCalled()
  })
  it('filters missing credentials and refuses direct dispatch', async () => {
    const adapter = new GatewayModelAdapter(
      [
        {
          group: 'deepseek',
          provider: 'opl-gateway',
          adapter: new Adapter(
            async function* () {
              throw Error('must not call')
            },
            ['deepseek-flash'],
          ),
          available: async () => false,
        },
      ],
      vi.fn(),
    )
    expect(await adapter.listModels('opl-gateway')).toEqual([])
    await expect(collect(adapter)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })
})
