import { installSkill, verifySkill } from './skill-install.mjs'
/** Install OPL-owned files into the official DSH profile, then launch the official app. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync, spawn } from 'node:child_process'
const [app, root, payload, ...flags] = process.argv.slice(2)
// The official desktop resolves the same default when DSH_HOME is unset.
const home = process.env.OPL_DSH_HOME?.trim() || join(homedir(), '.dsh')
const executable =
  process.platform === 'win32'
    ? join(app, 'DeepSeek Harness.exe')
    : join(app, 'Contents/MacOS/DeepSeek Harness')
const bindingPath = join(home, 'profiles/desktop/control.json')
const previousInstallation = existsSync(join(root, 'installation.json'))
  ? JSON.parse(readFileSync(join(root, 'installation.json'), 'utf8'))
  : undefined
const codexHome =
  process.env.OPL_CODEX_HOME ??
  process.env.CODEX_HOME ??
  (previousInstallation?.skillDir
    ? dirname(dirname(previousInstallation.skillDir))
    : join(homedir(), '.codex'))
// Refuse a modified or foreign Skill before changing the official profile.
verifySkill(join(codexHome, 'skills/opl-dsh-official'))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('安装步骤失败，未启动应用')
}
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
if (existsSync(bindingPath) && alive(JSON.parse(readFileSync(bindingPath, 'utf8')).pid))
  throw new Error('请先退出 DeepSeek Harness，再重新运行安装器。')
const artifact = JSON.parse(readFileSync(join(payload, 'artifact.json'), 'utf8'))
if (!/^opl-dsh-enhancements-[a-zA-Z0-9.-]+\.tgz$/.test(artifact.name))
  throw new Error('安装清单无效')
const bytes = readFileSync(join(payload, artifact.name))
if (digest(bytes) !== artifact.sha256) throw new Error('增强包校验失败')
if (
  !artifact.payloadFiles ||
  digest(JSON.stringify(artifact.payloadFiles)) !== artifact.suiteSha256
)
  throw new Error('套件安装清单无效')
for (const [file, expected] of Object.entries(artifact.payloadFiles)) {
  if (
    file.startsWith('/') ||
    file.split('/').some((part) => !part || part === '..' || part === '.')
  )
    throw new Error('套件路径无效')
  if (digest(readFileSync(join(payload, file))) !== expected)
    throw new Error('套件文件校验失败：' + file)
}
const release = join(root, 'releases', artifact.suiteSha256)
if (existsSync(release)) {
  for (const [file, expected] of Object.entries(artifact.payloadFiles))
    if (digest(readFileSync(join(release, file))) !== expected)
      throw new Error('已有安装文件被修改，已保留：' + file)
} else {
  mkdirSync(release, { recursive: true, mode: 0o700 })
  cpSync(payload, release, { recursive: true })
}
// Import legacy data before creating the new official profile. The old source is preserved.
run(executable, [join(release, 'migrate.cjs'), app, home, root], { ELECTRON_RUN_AS_NODE: '1' })
const patch = join(home, 'profiles/desktop/cordis.patch.yml')
mkdirSync(dirname(patch), { recursive: true, mode: 0o700 })
if (!existsSync(patch))
  writeFileSync(
    patch,
    '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n    compression: gzip\n    compressionLevel: 1\n    compressionThresholdBytes: 1024\n',
    { mode: 0o600, flag: 'wx' },
  )
run(executable, [join(release, 'profile.cjs'), app, home, join(release, artifact.name)], {
  ELECTRON_RUN_AS_NODE: '1',
})
const compatibilityLauncher = join(
  root,
  process.platform === 'win32' ? 'launch.vbs' : 'launch.command',
)
// A compatibility launcher remains available to the Skill. It is not the user-facing entry point.
const launcher = process.env.OPL_DESKTOP_LAUNCHER ?? compatibilityLauncher
if (!process.env.OPL_DESKTOP_LAUNCHER) {
  if (process.platform === 'win32') {
    const quoteVbs = (value) => '"' + value.replaceAll('"', '""') + '"'
    const command =
      executable +
      ' "' +
      join(release, 'setup.mjs') +
      '" "' +
      home +
      '" "' +
      root +
      '" "' +
      app +
      '"'
    writeFileSync(
      compatibilityLauncher,
      'Set shell = CreateObject("WScript.Shell")\r\nshell.Environment("Process")("ELECTRON_RUN_AS_NODE") = "1"\r\nshell.Run ' +
        quoteVbs(command) +
        ', 0, False\r\n',
    )
    const script =
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'OPL DSH.lnk')); $s.TargetPath = 'wscript.exe'; $s.Arguments = [char]34 + $env:OPL_SHORTCUT_SCRIPT + [char]34; $s.IconLocation = $env:OPL_SHORTCUT_ICON; $s.Save()"
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      OPL_SHORTCUT_SCRIPT: compatibilityLauncher,
      OPL_SHORTCUT_ICON: executable,
    })
  } else {
    writeFileSync(
      compatibilityLauncher,
      '#!/bin/bash\nset -euo pipefail\nexport NODE_USE_SYSTEM_CA=1\nexport ELECTRON_RUN_AS_NODE=1\nexec ' +
        quote(executable) +
        ' ' +
        quote(join(release, 'setup.mjs')) +
        ' ' +
        quote(home) +
        ' ' +
        quote(root) +
        ' ' +
        quote(app) +
        '\n',
      { mode: 0o700 },
    )
  }
}
const skillDir = installSkill({ executable, home, launcher, root, release, codexHome })
const officialVersion = JSON.parse(
  readFileSync(
    join(
      app,
      process.platform === 'win32' ? 'resources' : 'Contents/Resources',
      'app.asar/package.json',
    ),
    'utf8',
  ),
).version
const ledgerDir = JSON.parse(readFileSync(join(skillDir, 'config.json'), 'utf8')).ledger
const installation = {
  version: 3,
  suiteRoot: root,
  profileHome: home,
  ledgerDir,
  previousRelease:
    previousInstallation?.release !== release
      ? previousInstallation?.release
      : previousInstallation?.previousRelease,
  suiteVersion: artifact.enhancementVersion ?? artifact.version,
  officialVersion,
  app,
  home,
  release,
  enhancementSha256: artifact.sha256,
  suiteSha256: artifact.suiteSha256,
  launcher,
  compatibilityLauncher,
  skillDir,
  installedAt: new Date().toISOString(),
}
mkdirSync(join(home, 'opl-dsh'), { recursive: true, mode: 0o700 })
writeFileSync(join(root, 'installation.json'), JSON.stringify(installation, null, 2) + '\n', {
  mode: 0o600,
})
writeFileSync(
  join(home, 'opl-dsh', 'installation.json'),
  JSON.stringify(installation, null, 2) + '\n',
  { mode: 0o600 },
)
console.log('官方桌面和 OPL 增强已安装。Codex Skill：opl-dsh-official。')
if (!flags.includes('--no-launch')) {
  const env = { ...process.env, DSH_HOME: home }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [], { env, detached: true, stdio: 'ignore' })
  child.unref()
}
