import { access, constants, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, delimiter, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HarnessDefinition } from '../contracts/catalog.ts'
import type { HarnessInstallation } from '../contracts/installations.ts'
const exec = promisify(execFile)
const info: Record<
  string,
  { command: string; website: string; instructions: string; installable?: boolean }
> = {
  'grok-build': {
    command: join(homedir(), '.grok/bin/grok'),
    website: 'https://grok.com/build',
    instructions: '使用 Grok Build 官方安装器安装或更新；安装后重新检测。',
  },
  codex: {
    command: 'codex',
    website: 'https://developers.openai.com/codex/cli/',
    instructions: '已安装时使用官方 codex update；未安装时可一键使用官方 npm 安装器。',
    installable: true,
  },
  claude: {
    command: 'claude',
    website: 'https://code.claude.com/docs/en/setup',
    instructions: '已安装时使用官方 claude update；未安装时可一键使用 Claude 官方安装器。',
    installable: true,
  },
  antigravity: {
    command: 'agy',
    website: 'https://antigravity.google/docs',
    instructions: '使用 agy update 检查并更新 Antigravity CLI。',
  },
}
const knownRoots = (id: string): string[] => {
  const home = homedir()
  const roots = [
    join(home, '.local/bin'),
    join(home, '.npm-global/bin'),
    join(home, '.volta/bin'),
    join(home, '.asdf/shims'),
    join(home, '.local/share/mise/shims'),
    join(home, '.cargo/bin'),
    join(home, '.claude/local'),
    join(home, '.claude/local/bin'),
    process.env.npm_config_prefix ? join(process.env.npm_config_prefix, 'bin') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  if (id === 'codex')
    roots.push(
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS',
      join(
        home,
        'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS',
      ),
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs/codex')] : []),
    )
  if (id === 'claude' && process.env.LOCALAPPDATA)
    roots.push(join(process.env.LOCALAPPDATA, 'Programs/Claude Code'))
  return [...new Set(roots.filter(Boolean))]
}
function candidatePaths(
  command: string,
  id?: string,
): Array<{ path: string; detectedBy: NonNullable<HarnessInstallation['detectedBy']> }> {
  if (isAbsolute(command)) return [{ path: command, detectedBy: 'configured-path' }]
  const roots = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const known = id ? knownRoots(id) : []
  return [
    ...roots.map((root) => ({ path: join(root, command), detectedBy: 'shell-path' as const })),
    ...known.map((root) => ({ path: join(root, command), detectedBy: 'known-path' as const })),
    ...roots.flatMap((root) =>
      process.platform === 'win32'
        ? ['.exe', '.cmd', '.bat'].map((ext) => ({
            path: join(root, command + ext),
            detectedBy: 'shell-path' as const,
          }))
        : [],
    ),
    ...known.flatMap((root) =>
      process.platform === 'win32'
        ? ['.exe', '.cmd', '.bat'].map((ext) => ({
            path: join(root, command + ext),
            detectedBy: 'known-path' as const,
          }))
        : [],
    ),
  ]
}
async function shellResolved(command: string, id: string): Promise<string | undefined> {
  if (
    !['codex', 'claude'].includes(id) ||
    isAbsolute(command) ||
    !/^[A-Za-z0-9_.-]+$/.test(command)
  )
    return undefined
  const shell =
    process.platform === 'win32'
      ? 'where.exe'
      : process.env.SHELL?.startsWith('/')
        ? process.env.SHELL
        : '/bin/sh'
  try {
    const result =
      process.platform === 'win32'
        ? await exec(shell, [command], { timeout: 3000, maxBuffer: 4096 })
        : await exec(shell, ['-lc', `command -v ${command}`], { timeout: 3000, maxBuffer: 4096 })
    return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}
export function harnessSearchPath(): string {
  return [
    ...new Set(
      [process.env.PATH ?? '', ...knownRoots('codex'), ...knownRoots('claude')].filter(Boolean),
    ),
  ].join(delimiter)
}
export async function executablePath(command: string): Promise<string | undefined> {
  for (const { path } of candidatePaths(
    command,
    ['codex', 'claude'].includes(command) ? command : undefined,
  ))
    if (
      await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return path
  const resolved = await shellResolved(command, command)
  if (
    resolved &&
    (await access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK).then(
      () => true,
      () => false,
    ))
  )
    return resolved
  return undefined
}
export async function inspectHarness(
  harness: HarnessDefinition,
  home: string,
  grokCommand?: string,
): Promise<HarnessInstallation> {
  if (harness.kind === 'dsh') {
    const receipt = JSON.parse(
      await readFile(join(home, 'opl-dsh/installation.json'), 'utf8').catch(() => '{}'),
    )
    return {
      id: harness.id,
      name: harness.name,
      installed: true,
      runnable: true,
      version: process.env.OPL_OFFICIAL_VERSION ?? receipt.officialVersion ?? '由官方桌面提供',
      instructions: '内置于官方桌面，使用桌面的检查更新。',
      website: 'https://github.com/deepseek-ai/deepseek-harness/releases',
    }
  }
  const entry = info[harness.id],
    command =
      harness.command ?? (harness.kind === 'grok-build' ? grokCommand : undefined) ?? entry?.command
  const candidates = command ? candidatePaths(command, harness.id) : []
  let path: string | undefined
  let detectedBy: HarnessInstallation['detectedBy']
  for (const candidate of candidates) {
    const ok = await access(
      candidate.path,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK,
    ).then(
      () => true,
      () => false,
    )
    if (ok) {
      path = candidate.path
      detectedBy = candidate.detectedBy
      break
    }
  }
  if (!path && command) {
    const resolved = await shellResolved(command, harness.id)
    if (
      resolved &&
      (await access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK).then(
        () => true,
        () => false,
      ))
    ) {
      path = resolved
      detectedBy = 'shell-path'
    }
  }
  const maintenanceAction = ['codex', 'claude'].includes(harness.id)
    ? path
      ? 'update'
      : 'install'
    : path && ['grok-build', 'antigravity'].includes(harness.id)
      ? 'update'
      : undefined
  const base = {
    id: harness.id,
    name: harness.name,
    installed: !!path,
    runnable:
      !!path &&
      (harness.kind === 'grok-build' || harness.id === 'codex' || harness.id === 'claude'),
    instructions: entry?.instructions ?? '使用此 Harness 的官方安装与更新方式。',
    website: entry?.website ?? '',
    ...(entry?.installable ? { installable: true } : {}),
    ...(maintenanceAction ? { maintenanceAction: maintenanceAction as 'install' | 'update' } : {}),
  }
  if (!path) return { ...base, error: '未找到可执行文件；可使用一键安装或查看官方入口' }
  try {
    const script = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(path)
    const { stdout, stderr } = await exec(
      script ? 'powershell.exe' : path,
      script
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '& $env:OPL_HARNESS_EXECUTABLE --version; exit $LASTEXITCODE',
          ]
        : ['--version'],
      {
        timeout: 5000,
        maxBuffer: 4096,
        env: {
          ...Object.fromEntries(
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
            ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
          ),
          ...(script ? { OPL_HARNESS_EXECUTABLE: path } : {}),
        },
      },
    )
    const version = (stdout || stderr).trim().split(/\r?\n/)[0]?.slice(0, 150)
    return { ...base, path, ...(detectedBy ? { detectedBy } : {}), ...(version ? { version } : {}) }
  } catch {
    return {
      ...base,
      path,
      ...(detectedBy ? { detectedBy } : {}),
      error: '已发现可执行文件，版本检测未成功',
    }
  }
}
