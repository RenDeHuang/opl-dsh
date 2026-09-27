import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executablePath, inspectHarness } from '../../src/execution/host/harness-registry.ts'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Harness executable discovery', () => {
  it.skipIf(process.platform === 'win32')('uses the same discovered CLI in execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opl-harness-registry-'))
    roots.push(root)
    const command = join(root, 'codex')
    await writeFile(command, '#!/bin/sh\nprintf "codex-cli 9.9.9\\n"\n', { mode: 0o700 })
    vi.stubEnv('PATH', root)
    expect(await executablePath('codex')).toBe(command)
    const item = await inspectHarness({ id: 'codex', name: 'Codex CLI', kind: 'acp' }, root)
    expect(item.path).toBe(command)
  })
  it('reads a version printed on stderr and records a configured absolute path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opl-harness-registry-'))
    roots.push(root)
    const command = join(root, 'codex')
    await writeFile(command, '#!/bin/sh\nprintf "codex-cli 9.9.9\\n" >&2\n')
    await chmod(command, 0o700)
    const item = await inspectHarness(
      { id: 'codex', name: 'Codex CLI', kind: 'acp', command },
      root,
    )
    expect(item).toMatchObject({
      installed: true,
      runnable: true,
      path: command,
      detectedBy: 'configured-path',
      version: 'codex-cli 9.9.9',
      maintenanceAction: 'update',
    })
  })

  it('offers install when a built-in CLI is absent', async () => {
    vi.stubEnv('PATH', '')
    const root = await mkdtemp(join(tmpdir(), 'opl-harness-missing-'))
    roots.push(root)
    const item = await inspectHarness(
      { id: 'claude', name: 'Claude Code', kind: 'acp', command: '/definitely/missing/claude' },
      root,
    )
    expect(item).toMatchObject({
      installed: false,
      installable: true,
      maintenanceAction: 'install',
    })
  })
})
