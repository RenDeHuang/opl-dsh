/** Qualify real, unmodified official Desktop with a fresh disposable profile. */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { assertIsolatedRoot, verifyPayload, safeBinding, sha256 } from './qualification-support.mjs'
import { DesktopPipe, verifyDesktopClient } from './qualification-client.mjs'

const repo = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(name + ' 缺少参数')
  return args[index + 1]
}
if (args.includes('--help')) {
  console.log(
    'node scripts/qualify-official-runtime.mjs (--app <官方应用目录> | --download) [--payload <构建安装目录>] [--evidence <JSON 文件>] [--keep-profile]',
  )
  process.exit(0)
}
const payload = resolve(option('--payload', join(repo, 'dist/OPL DSH 一键安装')))
const evidenceFile = resolve(
  option('--evidence', join(repo, 'dist/qualification-' + process.platform + '.json')),
)
const suppliedApp = option('--app')
if (Boolean(suppliedApp) === args.includes('--download'))
  throw new Error('必须且只能指定 --app 或 --download')
if (!['darwin', 'win32'].includes(process.platform))
  throw new Error('官方桌面资格验证仅支持 macOS / Windows；本平台未验证')
if (
  args.includes('--download') &&
  process.platform === 'win32' &&
  (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted')
)
  throw new Error(
    'Windows 官方安装器会注册桌面应用；本机请用 --app，下载模式仅用于临时 GitHub runner',
  )
const artifact = await verifyPayload(payload)
const root = await assertIsolatedRoot(await mkdtemp(join(tmpdir(), 'opl-dsh-accept-')))
const suite = join(root, 'suite')
const evidence = {
  schemaVersion: 1,
  status: 'failed',
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  sourceCommit: artifact.sourceCommit,
  sourceTreeSha256: artifact.sourceTreeSha256,
  enhancementVersion: artifact.enhancementVersion,
  enhancementSha256: artifact.sha256,
  suiteSha256: artifact.suiteSha256,
  sourceDirty:
    execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length >
    0,
  protocolProbe: 'local-fixture',
  checks: {},
}
let desktop
let desktopPipe
let interrupted
const children = new Set()
function terminateOwned(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {}
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    interrupted = signal
    for (const child of [...children, desktop]) terminateOwned(child)
  })
let app = suppliedApp && resolve(suppliedApp)
const environment = {
  ...process.env,
  DSH_HOME: root,
  OPL_DSH_HOME: root,
  OPL_SUITE_ROOT: suite,
  OPL_CODEX_HOME: join(root, 'codex'),
  OPL_APPLICATIONS_DIR: join(root, 'applications'),
  OPL_INSTALL_NO_LAUNCH: '1',
  OPL_LEGACY_HOME: join(root, 'empty-legacy'),
  OPL_DESKTOP_LAUNCHER: join(root, 'qualification-launcher'),
  NODE_USE_SYSTEM_CA: '1',
}
delete environment.OPL_OFFICIAL_ARCHIVE
// The hosted Windows runner enters this script from PowerShell 7. Its PSModulePath
// points at Core-only modules, and an inherited value makes the Windows PowerShell
// 5.1 child resolve Microsoft.PowerShell.Security from there and fail to load the
// cmdlet. Drop the inherited variable in any casing so 5.1 derives its own path.
for (const key of Object.keys(environment))
  if (key.toLowerCase() === 'psmodulepath') delete environment[key]
// An inherited proxy credential or provider key is not needed by fixture qualification.
for (const key of Object.keys(environment))
  if (/API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD/i.test(key))
    delete environment[key]
function run(command, argv, options = {}) {
  return new Promise((accept, reject) => {
    if (interrupted) {
      reject(new Error('资格验证已中断：' + interrupted))
      return
    }
    const child = spawn(command, argv, {
      cwd: repo,
      env: environment,
      windowsHide: true,
      detached: process.platform !== 'win32',
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.add(child)
    let output = ''
    let error = ''
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-1024 * 1024)
    })
    child.stderr.on('data', (chunk) => {
      error = (error + chunk).slice(-16384)
    })
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      if (!child.pid) return
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          })
        } catch {}
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (failure) {
          if (failure.code !== 'ESRCH') child.kill('SIGKILL')
        }
      }
    }, options.timeout ?? 300000)
    child.once('error', (failure) => {
      children.delete(child)
      clearTimeout(timeout)
      reject(failure)
    })
    child.once('close', (code) => {
      children.delete(child)
      clearTimeout(timeout)
      code === 0 && !timedOut
        ? accept(output)
        : reject(
            new Error(
              '步骤失败：' +
                command +
                ' (exit ' +
                code +
                (timedOut ? ', timeout' : '') +
                ')\n' +
                error.slice(-4096),
            ),
          )
    })
  })
}
async function verifyOfficial() {
  if (process.platform === 'darwin') {
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    await run('/usr/bin/codesign', [
      '-v',
      '-R=anchor apple generic and certificate leaf[subject.OU] = "NAN929V4UM" and identifier "com.deepseek.dsh"',
      app,
    ])
    evidence.officialVersion = (
      await run('/usr/libexec/PlistBuddy', [
        '-c',
        'Print CFBundleShortVersionString',
        join(app, 'Contents/Info.plist'),
      ])
    ).trim()
    evidence.officialIdentity = {
      bundleId: 'com.deepseek.dsh',
      teamId: 'NAN929V4UM',
      signatureVerified: true,
    }
  } else {
    const script = `$e=Join-Path $env:OPL_QUALIFY_APP 'DeepSeek Harness.exe'; $verified=$false; $s=Get-AuthenticodeSignature -LiteralPath $e -ErrorAction SilentlyContinue; if($s.Status -eq 'Valid'){$verified=$true}; if(-not $verified){$cu=Get-Command certutil.exe -ErrorAction SilentlyContinue; if($cu){& $cu.Source -verify $e *> $null; $verified=$LASTEXITCODE -eq 0}}; if(-not $verified){throw 'DeepSeek official signature failed'}; (Get-Item -LiteralPath $e).VersionInfo.FileVersion`
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    )
    evidence.officialVersion = (
      await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...environment, OPL_QUALIFY_APP: app },
      })
    ).trim()
    evidence.officialIdentity = {
      publisher: 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.',
      signatureVerified: true,
    }
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(evidence.officialVersion))
    throw new Error('官方应用版本无效')
  const archive = join(
    app,
    process.platform === 'darwin' ? 'Contents/Resources' : 'resources',
    'app.asar',
  )
  evidence.officialAppSha256 = sha256(await readFile(archive))
}
function executable() {
  return join(
    app,
    process.platform === 'darwin' ? 'Contents/MacOS/DeepSeek Harness' : 'DeepSeek Harness.exe',
  )
}
async function startDesktop() {
  await rm(join(root, 'profiles/desktop/control.json'), { force: true })
  const env = { ...environment }
  delete env.ELECTRON_RUN_AS_NODE
  desktop = spawn(
    executable(),
    ['--user-data-dir=' + join(root, 'electron'), '--remote-debugging-pipe'],
    {
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  desktopPipe = new DesktopPipe(desktop)
  let spawnError
  desktop.once('error', (error) => {
    spawnError = error
  })
  for (let attempt = 0; attempt < 180; attempt++) {
    if (interrupted) throw new Error('资格验证已中断：' + interrupted)
    if (spawnError) throw spawnError
    if (desktop.exitCode !== null) throw new Error('隔离桌面提前退出：' + desktop.exitCode)
    try {
      const binding = safeBinding(
        JSON.parse(await readFile(join(root, 'profiles/desktop/control.json'), 'utf8')),
      )
      const result = await fetch(binding.endpoint, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + binding.token, 'content-type': 'application/json' },
        body: JSON.stringify({ namespace: 'oplSuite', method: 'setupUrl', args: {} }),
        signal: AbortSignal.timeout(2000),
      })
      if ((await result.json()).ok) return
    } catch {}
    await delay(500)
  }
  throw new Error('隔离桌面未在 90 秒内就绪')
}
async function stopDesktop() {
  if (!desktop) return
  if (desktop.exitCode !== null || desktop.signalCode !== null) {
    desktop = undefined
    return
  }
  const owned = desktop
  if (process.platform === 'win32')
    await run('taskkill.exe', ['/PID', String(owned.pid), '/T', '/F'])
  else {
    try {
      process.kill(-owned.pid, 'SIGTERM')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    for (
      let attempt = 0;
      owned.exitCode === null && owned.signalCode === null && attempt < 40;
      attempt++
    )
      await delay(100)
    // Only the process group created by this runner is eligible for cleanup.
    try {
      process.kill(-owned.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  desktop = undefined
}
try {
  // An existing empty migration source takes precedence over every user legacy path.
  await mkdir(environment.OPL_LEGACY_HOME, { recursive: true })
  await writeFile(environment.OPL_DESKTOP_LAUNCHER, 'Qualification owns launch and cleanup.\n', {
    mode: 0o600,
  })
  if (args.includes('--download')) {
    if (process.platform === 'darwin') {
      await run('/bin/bash', [join(payload, 'install.command')], { timeout: 1200000 })
      app = join(environment.OPL_APPLICATIONS_DIR, 'DeepSeek Harness.app')
    } else {
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(payload, 'install.ps1'),
          '-Root',
          suite,
          '-Payload',
          payload,
          '-NoLaunch',
        ],
        { timeout: 1200000 },
      )
      app = JSON.parse(await readFile(join(suite, 'installation.json'), 'utf8')).app
    }
    evidence.checks.downloadIntegrity = { sha512: true, owner: 'official installer' }
  }
  await verifyOfficial()
  const profile = join(root, 'profiles/desktop')
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(profile, 'cordis.patch.yml'),
    '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n',
    { mode: 0o600 },
  )
  if (suppliedApp)
    await run(executable(), [join(payload, 'install.mjs'), app, suite, payload, '--no-launch'], {
      env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
    })
  evidence.checks.isolatedInstallation = true
  await startDesktop()
  await mkdir(resolve(evidenceFile, '..'), { recursive: true })
  evidence.checks.client = await verifyDesktopClient(
    desktopPipe,
    evidenceFile.replace(/\.json$/, '') + '-client',
    (progress) => {
      evidence.checks.client = progress
    },
  )
  evidence.checks.runtime = JSON.parse(
    await run(process.execPath, [join(repo, 'scripts/verify-official-runtime.mjs'), root]),
  )
  await stopDesktop()
  await startDesktop()
  evidence.checks.restart = JSON.parse(
    await run(process.execPath, [
      join(repo, 'scripts/verify-official-runtime.mjs'),
      root,
      '--readback-selections',
    ]),
  )
  await stopDesktop()
  const originalHash = evidence.officialAppSha256
  await verifyOfficial()
  if (evidence.officialAppSha256 !== originalHash) throw new Error('官方应用内容在验收期间发生变化')
  evidence.checks.officialUnmodified = true
  evidence.status = 'passed'
} catch (error) {
  // Keep output free of control bearer tokens and provider credentials.
  evidence.failure = String(error.message).replace(/Bearer\s+[^\s"']+/g, 'Bearer [REDACTED]')
  process.exitCode = 1
} finally {
  try {
    await stopDesktop()
  } catch (error) {
    evidence.cleanupFailure = String(error.message)
    evidence.status = 'failed'
    process.exitCode = 1
  }
  evidence.finishedAt = new Date().toISOString()
  if (args.includes('--keep-profile')) evidence.isolatedProfile = root
  else if (!desktop) {
    // Windows can hold a handle on the disposable Electron profile (leveldb) briefly
    // after the process exits. Scratch cleanup must never discard the evidence file,
    // so retry and record a residual failure instead of throwing out of `finally`.
    for (let attempt = 0; ; attempt++) {
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= 4) {
          evidence.scratchCleanupFailure = String(error.message)
          break
        }
        await delay(500)
      }
    }
  }
  await mkdir(resolve(evidenceFile, '..'), { recursive: true })
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
  console.log(
    JSON.stringify({
      status: evidence.status,
      evidence: evidenceFile,
      officialVersion: evidence.officialVersion,
    }),
  )
}
