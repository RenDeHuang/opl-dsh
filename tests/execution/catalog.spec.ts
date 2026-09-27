import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultExecutionCatalog,
  ExecutionCatalogStore,
  normalizeCatalog,
} from '../../src/execution/host/catalog.ts'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function root() {
  const dir = await mkdtemp(join(tmpdir(), 'opl-catalog-'))
  roots.push(dir)
  return dir
}
describe('combination authority', () => {
  it('persists references without a second model catalog', async () => {
    const dir = await root(),
      store = new ExecutionCatalogStore(dir),
      catalog = await store.get()
    catalog.models = [
      { ref: { provider: 'custom', model: 'a' }, name: 'A', source: 'custom', available: true },
    ]
    await store.set(catalog)
    const saved = JSON.parse(await readFile(store.filename, 'utf8'))
    expect(saved.models).toBeUndefined()
    expect(saved.connections).toBeUndefined()
    expect(saved.combinations[0]).not.toHaveProperty('connectionId')
  })
  it('migrates old same-model group references and preserves the original bytes', async () => {
    const dir = await root(),
      file = join(dir, 'profiles/desktop/execution-catalog.json')
    await mkdir(join(dir, 'profiles/desktop'), { recursive: true })
    const old = JSON.stringify({
      connections: [{ id: 'opl-gateway' }],
      models: [
        { id: 'ds', connectionId: 'opl-gateway', modelId: 'deepseek-flash', routeId: 'codex' },
      ],
      harnesses: [{ id: 'dsh', kind: 'dsh', name: 'DSH' }],
      combinations: [
        {
          id: 'custom',
          name: 'Custom',
          modelId: 'ds',
          connectionId: 'opl-gateway',
          harnessId: 'dsh',
          sandbox: 'read-only',
          isDefault: true,
          enabled: true,
        },
      ],
    })
    await writeFile(file, old)
    const catalog = await new ExecutionCatalogStore(dir).get()
    expect(catalog.combinations[0]?.modelRef).toEqual({
      provider: 'opl-gateway',
      model: 'codex::deepseek-flash',
    })
    expect(await readFile(file + '.v1.backup', 'utf8')).toBe(old)
  })
  it('allows defaults per model but rejects competing defaults for the same model', () => {
    const catalog = defaultExecutionCatalog()
    expect(normalizeCatalog(catalog).combinations).toHaveLength(2)
    catalog.combinations.push({ ...catalog.combinations[0]!, id: 'duplicate' })
    expect(() => normalizeCatalog(catalog)).toThrow('默认组合')
  })
  it('refuses removal of the native Harness', () => {
    const catalog = defaultExecutionCatalog()
    catalog.harnesses = []
    expect(() => normalizeCatalog(catalog)).toThrow('内置 DSH')
  })
})

describe('user model choices', () => {
  it('excludes unconfigured providers and preserves explicit same-model channels', async () => {
    const { selectableModels } = await import('../../src/execution/contracts/catalog.ts')
    const model = (provider: string, id: string, available = true) => ({
      ref: { provider, model: id },
      name: id,
      source: provider,
      available,
    })
    const all = [
      model('deepseek-official', 'deepseek-flash', false),
      model('opl-gateway', 'codex::deepseek-flash'),
      model('opl-gateway', 'deepseek-flash'),
      model('opl-gateway', 'codex::gpt-current'),
      model('opl-gateway', 'grok::grok-4.7'),
    ]
    expect(selectableModels(all).map((m) => m.ref.model)).toEqual([
      'codex::deepseek-flash',
      'deepseek-flash',
      'codex::gpt-current',
      'grok::grok-4.7',
    ])
    expect(all).toHaveLength(5)
    expect(selectableModels([all[1]!])[0]?.ref.model).toBe('codex::deepseek-flash')
  })
  it('retains identical model names across independently configured providers', async () => {
    const { selectableModels } = await import('../../src/execution/contracts/catalog.ts')
    expect(
      selectableModels(
        ['official', 'custom'].map((provider) => ({
          ref: { provider, model: 'same' },
          name: 'Same',
          source: provider,
          available: true,
        })),
      ),
    ).toHaveLength(2)
  })
})
