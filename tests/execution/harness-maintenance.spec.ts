import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  maintenancePlan,
  maintenanceEnvironment,
  maintainHarness,
} from '../../src/execution/host/harness-maintenance.ts'
import type { HarnessInstallation } from '../../src/execution/contracts/installations.ts'
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const installed = (path: string): HarnessInstallation => ({
  id: 'codex',
  name: 'Codex CLI',
  installed: true,
  path,
  runnable: false,
  instructions: '',
  website: '',
  maintenanceAction: 'update',
})
it('uses fixed official updater arguments and rejects custom Harness commands', () => {
  expect(maintenancePlan(installed('/some path/codex'))).toEqual({
    command: '/some path/codex',
    args: ['update'],
  })
  expect(() => maintenancePlan({ ...installed('/some path/custom'), id: 'custom' })).toThrow(
    '没有自动更新',
  )
  expect(() =>
    maintenancePlan({
      ...installed('/dsh'),
      id: 'dsh',
      maintenanceAction: undefined,
    } as unknown as HarnessInstallation),
  ).toThrow('官方安装')
})
it('provides fixed official install plans for missing Codex and Claude CLIs', () => {
  const missing = (id: 'codex' | 'claude'): HarnessInstallation => ({
    id,
    name: id === 'codex' ? 'Codex CLI' : 'Claude Code',
    installed: false,
    runnable: false,
    instructions: '',
    website: '',
    maintenanceAction: 'install',
  })
  expect(maintenancePlan(missing('codex'))).toEqual(
    process.platform === 'win32'
      ? {
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '& npm.cmd install --global @openai/codex@latest; exit $LASTEXITCODE',
          ],
        }
      : {
          command: process.env.SHELL?.startsWith('/') ? process.env.SHELL : '/bin/sh',
          args: ['-lc', 'exec npm install --global @openai/codex@latest'],
        },
  )
  const claude = maintenancePlan(missing('claude'))
  expect(claude.command).toBe(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')
  expect(claude.args.join(' ')).toContain('claude.ai/install.')
  expect(claude.args.join(' ')).not.toContain('item.path')
})
it('does not pass Gateway or model authentication into package updaters', () => {
  vi.stubEnv('OPL_GATEWAY_CODEX_API_KEY', 'test-sensitive')
  vi.stubEnv('OPENAI_API_KEY', 'test-sensitive')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-sensitive')
  const env = maintenanceEnvironment()
  expect(env.OPL_GATEWAY_CODEX_API_KEY).toBeUndefined()
  expect(env.OPENAI_API_KEY).toBeUndefined()
  expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  expect(env.HOME).toBe(process.env.HOME)
})
it.skipIf(process.platform === 'win32')(
  'runs the installed updater without shell interpolation and reports its real failure',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'opl-maintenance-'))
    roots.push(root)
    const command = join(root, 'codex with spaces')
    await writeFile(
      command,
      '#!/bin/sh\n[ "$1" = update ] || exit 7\nprintf "token=test-sensitive\\n" >&2\nexit 9\n',
      { mode: 0o700 },
    )
    await expect(maintainHarness(installed(command))).rejects.toThrow('9')
    try {
      await maintainHarness(installed(command))
    } catch (error) {
      expect(String(error)).not.toContain('test-sensitive')
      expect(String(error)).toContain('[REDACTED]')
    }
  },
)
