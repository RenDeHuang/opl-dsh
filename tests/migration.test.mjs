import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import YAML from 'yaml'

test('legacy import preserves source, excludes unrelated credentials, and refuses V5 history', async () => {
  const base = await mkdtemp(join(tmpdir(), 'opl-migrate-'))
  try {
    const app = join(base, 'app'),
      runtime = join(
        app,
        process.platform === 'win32' ? 'resources' : 'Contents/Resources',
        'app.asar/dsh',
      )
    await mkdir(runtime, { recursive: true })
    await writeFile(join(runtime, 'package.json'), '{}')
    await symlink(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(runtime, 'node_modules'),
      'junction',
    )
    for (const version of [3, 5]) {
      const root = join(base, 'suite' + version),
        home = join(root, 'data'),
        legacy = join(base, 'legacy' + version)
      await mkdir(home, { recursive: true })
      await mkdir(join(legacy, 'sessions/work/session'), { recursive: true })
      const record = join(legacy, 'sessions/work/session', `session.v${version}.jsonl.zstd`)
      await writeFile(record, 'opaque-session-bytes')
      await writeFile(join(legacy, 'sessions/work/session/session.lock'), 'old-lock')
      await writeFile(
        join(legacy, '.credentials.yaml'),
        YAML.stringify({
          version: 1,
          refs: { OPL_GATEWAY_DEEPSEEK_API_KEY: 'test-only-key', OTHER: 'unrelated' },
          records: { 'browser/token': 'never-copy' },
        }),
      )
      const run = () =>
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL('../installer/migrate.cjs', import.meta.url)), app, home, root],
          { env: { ...process.env, OPL_LEGACY_HOME: legacy }, encoding: 'utf8' },
        )
      run()
      run()
      assert.equal(await readFile(record, 'utf8'), 'opaque-session-bytes')
      const creds = YAML.parse(await readFile(join(home, '.credentials.yaml'), 'utf8'))
      assert.deepEqual(creds.refs, { OPL_GATEWAY_DEEPSEEK_API_KEY: 'test-only-key' })
      assert.deepEqual(creds.records, {})
      const marker = JSON.parse(await readFile(join(root, 'legacy-import.json')))
      if (version === 3) {
        assert.ok(marker.imported.includes('sessions'))
        await assert.rejects(readFile(join(home, 'sessions/work/session/session.lock')), {
          code: 'ENOENT',
        })
      } else {
        assert.equal(marker.historySkipped, 'unsupported-session-format')
        await assert.rejects(readFile(join(home, 'sessions/work/session/session.v5.jsonl.zstd')), {
          code: 'ENOENT',
        })
      }
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
