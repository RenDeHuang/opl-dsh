/** Official CLI updaters only. The plugin never accepts an arbitrary shell command. */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { promisify } from 'node:util'
import type { HarnessInstallation } from '../contracts/installations.ts'
import { harnessSearchPath } from './harness-registry.ts'
const exec = promisify(execFile)
export function maintenanceEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'SYSTEMROOT',
      'TEMP',
      'TMP',
      'TMPDIR',
      'LANG',
      'LC_ALL',
      'CODEX_HOME',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'https_proxy',
      'http_proxy',
      'all_proxy',
      'no_proxy',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
      'NODE_EXTRA_CA_CERTS',
      'NODE_USE_SYSTEM_CA',
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  ) as NodeJS.ProcessEnv
  env.PATH = [harnessSearchPath(), env.PATH].filter(Boolean).join(delimiter)
  return env
}
export interface MaintenancePlan {
  command: string
  args: string[]
}
export function maintenancePlan(item: HarnessInstallation): MaintenancePlan {
  if (!item.maintenanceAction) throw Error('请使用此 Harness 的官方安装与更新入口')
  if (
    item.maintenanceAction === 'update' &&
    ['codex', 'claude', 'grok-build', 'antigravity'].includes(item.id) &&
    item.path
  )
    return { command: item.path, args: ['update'] }
  if (item.maintenanceAction === 'install' && item.id === 'codex')
    return process.platform === 'win32'
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
          // Finder-launched desktop processes often miss nvm/volta/mise PATH entries.
          // A fixed login-shell command lets the user's official Node installation
          // resolve npm without accepting any shell text from the user.
          command: process.env.SHELL?.startsWith('/') ? process.env.SHELL : '/bin/sh',
          args: ['-lc', 'exec npm install --global @openai/codex@latest'],
        }
  if (item.maintenanceAction === 'install' && item.id === 'claude')
    return process.platform === 'win32'
      ? {
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            "& ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://claude.ai/install.ps1')))",
          ],
        }
      : {
          command: '/bin/sh',
          args: [
            '-c',
            'set -eu; tmp="$(mktemp)"; trap \'rm -f "$tmp"\' EXIT; curl --fail --silent --show-error --location https://claude.ai/install.sh -o "$tmp"; sh "$tmp"',
          ],
        }
  throw Error('此 Harness 没有自动更新入口')
}
function safeOutput(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/(Bearer\s+|(?:token|api[_-]?key|password)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s]+/g, '[链接]')
    .trim()
    .slice(-1800)
}
/** Use the existing installation's official updater. */
export async function maintainHarness(
  item: HarnessInstallation,
): Promise<{ message: string; command: string; expectedVersion?: string }> {
  const plan = maintenancePlan(item),
    env = maintenanceEnvironment()
  const installedCommand = item.path ?? ''
  if (item.path) env.PATH = [dirname(item.path), env.PATH].join(delimiter)
  const windowsScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(plan.command)
  if (windowsScript) env.OPL_MAINTENANCE_COMMAND = plan.command
  try {
    const { stdout, stderr } = await exec(
      windowsScript ? 'powershell.exe' : plan.command,
      windowsScript
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '& $env:OPL_MAINTENANCE_COMMAND update; exit $LASTEXITCODE',
          ]
        : plan.args,
      {
        env,
        cwd: homedir(),
        timeout: 600000,
        maxBuffer: 1024 * 1024,
      },
    )
    const expectedVersion =
      item.id === 'claude'
        ? stdout.match(/Successfully updated from \S+ to version (\d+\.\d+\.\d+)/)?.[1]
        : undefined
    return {
      command: installedCommand || plan.command,
      message: safeOutput(stdout + '\n' + stderr) || '官方更新器执行完成',
      ...(expectedVersion ? { expectedVersion } : {}),
    }
  } catch (error) {
    const detail = error as {
      code?: string | number
      stdout?: string
      stderr?: string
      killed?: boolean
    }
    throw Error(
      detail.killed
        ? '更新器超时，请重新检测版本后再操作'
        : `官方更新器未完成（${detail.code ?? '启动失败'}）：${safeOutput((detail.stderr ?? '') + '\n' + (detail.stdout ?? ''))}`,
    )
  }
}
