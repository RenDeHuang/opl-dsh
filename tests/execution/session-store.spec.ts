import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessSessionStore } from '../../src/execution/host/session-store.ts'
import type { HarnessSession } from '../../src/execution/contracts/sessions.ts'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opl-session-store-'))
  roots.push(root)
  const store = new HarnessSessionStore(root)
  await mkdir(join(root, 'profiles/desktop'), { recursive: true })
  return { root, store }
}
const record = (id: string): HarnessSession => ({
  id,
  combination: 'dsh/deepseek-flash',
  harnessRef: 'dsh',
  modelRef: { provider: 'opl-gateway', model: 'deepseek-flash' },
  cwd: '/tmp',
  acpSessionId: 'native-' + id,
  origin: { kind: 'desktop', sessionId: 'manual' },
  title: id,
  sandbox: 'read-only',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  turns: [],
})

describe('per-session durable storage', () => {
  it('preserves legacy bytes and unknown fields while migrating once', async () => {
    const { root, store } = await fixture()
    const legacy = [{ ...record('one'), futureExtension: { owner: 'retain-me' } }]
    const bytes = JSON.stringify(legacy, null, 2)
    await writeFile(store.legacyFilename, bytes)
    expect(await store.load()).toMatchObject(legacy)
    expect(await readFile(store.legacyFilename, 'utf8')).toBe(bytes)
    // A retained legacy file is not a second live owner after migration.
    await writeFile(store.legacyFilename, 'not a live database anymore')
    expect(await new HarnessSessionStore(root).load()).toMatchObject(legacy)
  })

  it('resumes an interrupted migration and preserves newer migrated records', async () => {
    const { root, store } = await fixture()
    await writeFile(store.legacyFilename, JSON.stringify([record('first'), record('second')]))
    await mkdir(store.directory, { recursive: true })
    await writeFile(
      store.filename('first'),
      JSON.stringify({ ...record('first'), title: 'newer committed title', future: true }),
    )
    const loaded = await store.load()
    expect(loaded).toMatchObject([
      { id: 'first', title: 'newer committed title', future: true },
      { id: 'second' },
    ])
    expect(await new HarnessSessionStore(root).load()).toEqual(expect.arrayContaining(loaded))
  })

  it('writes only changed sessions and snapshots concurrent writes at admission', async () => {
    const { root, store } = await fixture()
    await store.load()
    const one = record('one'),
      two = record('two')
    expect(await store.saveChanged([one, two])).toEqual(['one', 'two'])
    const untouched = await stat(store.filename('two'))
    one.title = 'first update'
    const first = store.saveChanged([one, two])
    one.title = 'second update'
    const second = store.saveChanged([one, two])
    expect(await first).toEqual(['one'])
    expect(await second).toEqual(['one'])
    expect(await store.saveChanged([one, two])).toEqual([])
    expect((await stat(store.filename('two'))).ino).toBe(untouched.ino)
    expect(await new HarnessSessionStore(root).load()).toContainEqual(one)
  })

  it.each([
    { sandbox: 'full-access' },
    { origin: { kind: 'unknown', sessionId: 'parent' } },
    { modelRef: { provider: 'opl-gateway' } },
    {
      turns: [
        { operationId: 'op', state: 'unknown', prompt: '', text: '', fingerprint: '', tools: [] },
      ],
    },
  ])('rejects corrupted permission, origin, model, or turn boundaries: %j', async (invalid) => {
    const { store } = await fixture()
    const bytes = JSON.stringify([{ ...record('bad'), ...invalid }])
    await writeFile(store.legacyFilename, bytes)
    await expect(store.load()).rejects.toThrow('原文件已保留')
    expect(await readFile(store.legacyFilename, 'utf8')).toBe(bytes)
  })

  it('refuses invalid persisted records without overwriting the source', async () => {
    const { store } = await fixture()
    const bytes = JSON.stringify([{ ...record('broken'), turns: { unexpected: true } }])
    await writeFile(store.legacyFilename, bytes)
    await expect(store.load()).rejects.toThrow('轮次损坏')
    expect(await readFile(store.legacyFilename, 'utf8')).toBe(bytes)
    await expect(readFile(join(store.directory, 'migration-complete.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
