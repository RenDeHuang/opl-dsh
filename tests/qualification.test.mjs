import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertIsolatedRoot,
  verifyPayload,
  safeBinding,
  sha256,
} from '../scripts/qualification-support.mjs'

test('qualification accepts only a real temporary acceptance tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opl-dsh-accept-test-'))
  const other = await mkdtemp(join(tmpdir(), 'opl-other-'))
  try {
    assert.equal(
      await assertIsolatedRoot(root),
      await import('node:fs/promises').then((fs) => fs.realpath(root)),
    )
    await assert.rejects(assertIsolatedRoot(other), /隔离目录/)
    const nested = join(other, 'opl-dsh-accept-not-a-root')
    await mkdir(nested)
    await assert.rejects(assertIsolatedRoot(nested), /隔离目录/)
    if (process.platform !== 'win32') {
      await symlink(other, join(root, 'escape'))
      await assert.rejects(assertIsolatedRoot(join(root, 'escape')), /隔离目录/)
    }
  } finally {
    await rm(root, { recursive: true })
    await rm(other, { recursive: true })
  }
})

test('qualification refuses remote control endpoint or missing process owner', () => {
  const binding = { endpoint: 'http://127.0.0.1:2345/control', token: 'fixture', pid: 123 }
  assert.deepEqual(safeBinding(binding), binding)
  assert.throws(() => safeBinding({ ...binding, endpoint: 'http://example.com/control' }), /无效/)
  assert.throws(() => safeBinding({ ...binding, pid: 0 }), /无效/)
})

test('qualification binds evidence to every shipped byte and rejects traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opl-qualification-payload-'))
  try {
    const name = 'opl-dsh-enhancements-1.0.0.tgz'
    const bytes = Buffer.from('fixture')
    await writeFile(join(root, name), bytes)
    const payloadFiles = { [name]: sha256(bytes) }
    const manifest = {
      name,
      sha256: sha256(bytes),
      payloadFiles,
      suiteSha256: sha256(JSON.stringify(payloadFiles)),
    }
    await writeFile(join(root, 'artifact.json'), JSON.stringify(manifest))
    assert.equal((await verifyPayload(root)).sha256, sha256(bytes))
    await writeFile(join(root, name), 'tampered')
    await assert.rejects(verifyPayload(root), /摘要不匹配/)
    const badFiles = { '../outside': sha256(bytes) }
    await writeFile(
      join(root, 'artifact.json'),
      JSON.stringify({
        ...manifest,
        payloadFiles: badFiles,
        suiteSha256: sha256(JSON.stringify(badFiles)),
      }),
    )
    await assert.rejects(verifyPayload(root), /路径无效/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('desktop CDP uses only its child pipe and matches fragmented responses', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  const { DesktopPipe } = await import('../scripts/qualification-client.mjs')
  const child = new EventEmitter()
  child.stdio = [null, null, null, new PassThrough(), new PassThrough()]
  const pipe = new DesktopPipe(child)
  child.stdio[3].once('data', (bytes) => {
    const request = JSON.parse(bytes.toString().replace(/\0$/, ''))
    assert.equal(request.sessionId, 'isolated-session')
    const response = JSON.stringify({ id: request.id, result: { result: { value: true } } }) + '\0'
    child.stdio[4].write(response.slice(0, 7))
    child.stdio[4].write(response.slice(7))
  })
  assert.equal(await pipe.evaluate('isolated-session', 'true'), true)
  const pending = pipe.command('Page.enable')
  child.emit('exit', 0)
  await assert.rejects(pending, /CDP 已关闭/)
})
