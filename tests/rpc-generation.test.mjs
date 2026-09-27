import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateRpc } from '../scripts/generate-rpc.mjs'

const repository = resolve(import.meta.dirname, '..')
const source = (type = 'string') => `
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
export interface Snapshot { value: ${type} }
class ProbeService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'probe') }
  @Remote
  read(): Promise<Snapshot> { return Promise.resolve({ value: ${type === 'string' ? "'ready'" : '42'} }) }
}
export const Service = ProbeService
`

test('official generator derives source contracts, rejects drift, and preserves checked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opl-rpc-test-'))
  try {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'installer'))
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction')
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@opl/rpc-fixture',
        type: 'module',
        exports: { '.': './src/index.ts', './types': './src/index.ts' },
      }),
    )
    await writeFile(
      join(root, 'tsconfig.host.json'),
      JSON.stringify({
        ...JSON.parse(await readFile(join(repository, 'tsconfig.host.json'), 'utf8')),
        include: ['src/index.ts'],
      }),
    )
    await writeFile(join(root, 'src/index.ts'), source())
    await generateRpc({ root })
    const original = await readFile(join(root, 'src/generated/host.mjs'), 'utf8')
    assert.match(original, /probe\/read/)
    const { TYPERT } = await import(pathToFileURL(join(root, 'src/generated/host.mjs')).href)
    const invocation = TYPERT.invocations.find(
      (item) => item.namespace === 'probe' && item.method === 'read',
    )
    assert.deepEqual(invocation.result.create().parse({ value: 'ready' }), {
      value: 'ready',
    })
    assert.throws(() => invocation.result.create().parse({ value: 42 }))
    const map = JSON.parse(await readFile(join(root, 'src/generated/remote.d.mts.map'), 'utf8'))
    assert.equal(map.file, 'remote.d.mts')
    assert.deepEqual(map.sources, ['../index.ts'])
    await generateRpc({ root, check: true })
    await writeFile(join(root, 'src/index.ts'), source('number'))
    await assert.rejects(generateRpc({ root, check: true }), /RPC generation drift/)
    assert.equal(await readFile(join(root, 'src/generated/host.mjs'), 'utf8'), original)
    await generateRpc({ root })
    assert.notEqual(await readFile(join(root, 'src/generated/host.mjs'), 'utf8'), original)
    await generateRpc({ root, check: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
