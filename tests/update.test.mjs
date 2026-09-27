import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newer, refreshEnhancements } from '../installer/update.mjs'

test('stable versions advance numerically without downgrades or prereleases', () => {
  assert.equal(newer('0.10.0', '0.2.0'), true)
  assert.equal(newer('0.2.5', '0.2.4'), true)
  for (const value of ['0.2.0', '0.1.9', '0.3.0-rc.1', 'bad'])
    assert.equal(newer(value, '0.2.0'), false)
})
test('updates preserve the installed release while running, offline, or on checksum mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opl-update-')),
    home = join(root, 'data')
  const originalFetch = globalThis.fetch
  try {
    await mkdir(join(home, 'profiles/desktop'), { recursive: true })
    const installation = JSON.stringify({ home, suiteVersion: '0.1.0', release: join(root, 'old') })
    await writeFile(join(root, 'installation.json'), installation)
    await writeFile(
      join(home, 'profiles/desktop/control.json'),
      JSON.stringify({ pid: process.pid }),
    )
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      throw Error('offline')
    }
    await refreshEnhancements(root, 'unused')
    assert.equal(calls, 0)
    await rm(join(home, 'profiles/desktop/control.json'))
    await refreshEnhancements(root, 'unused')
    assert.equal(calls, 1)
    assert.equal(
      JSON.parse(await readFile(join(root, 'enhancement-update.json'))).state,
      'deferred',
    )
    assert.equal(
      JSON.parse(await readFile(join(root, 'enhancement-update.json'))).trigger,
      'maintenance-launcher',
    )
    await rm(join(root, 'enhancement-update.json'))
    globalThis.fetch = async (url) =>
      String(url).includes('api.github.com')
        ? Response.json({
            tag_name: 'v0.2.0',
            assets: [
              {
                name: 'OPL-DSH-Enhancements.zip',
                size: 3,
                digest: 'sha256:' + '0'.repeat(64),
                browser_download_url:
                  'https://github.com/gaofeng21cn/opl-dsh/releases/download/v0.2.0/OPL-DSH-Enhancements.zip',
              },
            ],
          })
        : new Response('bad')
    await refreshEnhancements(root, 'unused')
    assert.equal(
      JSON.parse(await readFile(join(root, 'enhancement-update.json'))).state,
      'deferred',
    )
    assert.equal(await readFile(join(root, 'installation.json'), 'utf8'), installation)
    await assert.rejects(readFile(join(root, 'enhancement-update.lock')), { code: 'ENOENT' })
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})
