import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newer, refreshEnhancements } from '../installer/update.mjs'
import { validateReleaseManifest } from '../installer/release-manifest.mjs'

test('stable release manifest binds the official desktop and OPL asset', () => {
  const manifest = {
    schemaVersion: 1,
    channel: 'stable',
    releaseVersion: '0.2.16',
    tagName: 'opl-dsh-v0.2.16',
    official: { product: 'DeepSeek Harness', version: '0.2.0-rc.2' },
    enhancement: {
      product: 'OPL DSH Enhancements',
      version: '0.2.16',
      asset: 'OPL-DSH-Enhancements.zip',
      sha256: 'sha256:' + 'a'.repeat(64),
      size: 10,
    },
  }
  assert.equal(
    validateReleaseManifest(manifest, { tagName: manifest.tagName }).releaseVersion,
    '0.2.16',
  )
  assert.throws(
    () =>
      validateReleaseManifest(
        { ...manifest, tagName: 'dsh-v0.2.0-rc.2-opl.16' },
        { tagName: manifest.tagName },
      ),
    /联合版本|tag/,
  )
})

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
            tag_name: 'opl-dsh-v0.2.0',
            assets: [
              {
                name: 'OPL-DSH-Enhancements.zip',
                size: 3,
                digest: 'sha256:' + '0'.repeat(64),
                browser_download_url:
                  'https://github.com/gaofeng21cn/opl-dsh/releases/download/opl-dsh-v0.2.0/OPL-DSH-Enhancements.zip',
              },
              {
                name: 'release-manifest.json',
                size: 3,
                digest: 'sha256:' + '0'.repeat(64),
                browser_download_url:
                  'https://github.com/gaofeng21cn/opl-dsh/releases/download/opl-dsh-v0.2.0/release-manifest.json',
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
