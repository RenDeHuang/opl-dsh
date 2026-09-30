/** Update only the enhancement payload, before starting the official desktop. */
import { readFile, writeFile, mkdir, open, unlink, rm } from 'node:fs/promises'
import { installationPaths } from './installation-paths.mjs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { validateReleaseManifest } from './release-manifest.mjs'
const api = 'https://api.github.com/repos/gaofeng21cn/opl-dsh/releases/latest'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function newer(candidate, current) {
  const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null)
  const a = parse(candidate),
    b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code !== 'ESRCH'
  }
}
export async function refreshEnhancements(root, application) {
  const installationFile = join(root, 'installation.json')
  let current
  try {
    current = installationPaths(JSON.parse(await readFile(installationFile, 'utf8')), {
      suiteRoot: root,
    })
  } catch {
    return
  }
  // Never change a profile used by an existing app, even if its task looks idle.
  try {
    const b = JSON.parse(
      await readFile(join(current.home, 'profiles/desktop/control.json'), 'utf8'),
    )
    if (alive(b.pid)) return
  } catch {}
  let lock
  const lockPath = join(root, 'enhancement-update.lock')
  try {
    lock = await open(lockPath, 'wx', 0o600)
    await lock.writeFile(String(process.pid))
  } catch {
    try {
      const pid = Number(await readFile(lockPath, 'utf8'))
      if (Number.isSafeInteger(pid) && pid > 0 && !alive(pid)) await unlink(lockPath)
    } catch {}
    return
  }
  const statusFile = join(root, 'enhancement-update.json')
  const status = async (value) =>
    writeFile(
      statusFile,
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        trigger: 'maintenance-launcher',
        ...value,
      }) + '\n',
      { mode: 0o600 },
    )
  try {
    const last = JSON.parse(await readFile(statusFile, 'utf8').catch(() => '{}'))
    if (Date.now() - Date.parse(last.checkedAt ?? '') < 3600000) return
    const result = await fetch(api, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(6000),
    })
    if (result.status === 404) {
      await status({ state: 'current' })
      return
    }
    if (!result.ok) throw Error('update unavailable')
    const release = await result.json()
    if (release.draft || release.prerelease) {
      await status({ state: 'current' })
      return
    }
    const asset = release.assets.find((a) => a.name === 'OPL-DSH-Enhancements.zip')
    const manifestAsset = release.assets.find((a) => a.name === 'release-manifest.json')
    const downloadPrefix = 'https://github.com/gaofeng21cn/opl-dsh/releases/download/'
    if (
      !asset ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
      !manifestAsset ||
      !/^sha256:[a-f0-9]{64}$/.test(manifestAsset.digest) ||
      !asset.browser_download_url.startsWith(downloadPrefix) ||
      !manifestAsset.browser_download_url.startsWith(downloadPrefix)
    )
      throw Error('invalid release')
    if (asset.size > 32 * 1024 * 1024) throw Error('invalid package size')
    const manifestResponse = await fetch(manifestAsset.browser_download_url, {
      signal: AbortSignal.timeout(30000),
    })
    if (!manifestResponse.ok) throw Error('release manifest download failed')
    const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer())
    if ('sha256:' + digest(manifestBytes) !== manifestAsset.digest)
      throw Error('manifest checksum failed')
    const releaseManifest = JSON.parse(manifestBytes.toString('utf8'))
    validateReleaseManifest(releaseManifest, {
      tagName: release.tag_name,
      assetName: asset.name,
    })
    if (
      releaseManifest.enhancement.sha256 !== asset.digest ||
      releaseManifest.enhancement.size !== asset.size
    )
      throw Error('release manifest asset mismatch')
    const response = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(120000),
    })
    if (!response.ok) throw Error('download failed')
    const bytes = Buffer.from(await response.arrayBuffer())
    if ('sha256:' + digest(bytes) !== asset.digest) throw Error('checksum failed')
    const stage = join(root, 'updates', digest(bytes))
    await mkdir(stage, { recursive: true, mode: 0o700 })
    const archive = join(stage, 'payload.zip')
    await writeFile(archive, bytes, { mode: 0o600 })
    const payload = join(stage, 'payload')
    await mkdir(payload, { recursive: true, mode: 0o700 })
    const extract =
      process.platform === 'win32'
        ? spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Expand-Archive -LiteralPath $env:OPL_UPDATE_ZIP -DestinationPath $env:OPL_UPDATE_DEST -Force',
            ],
            {
              env: { ...process.env, OPL_UPDATE_ZIP: archive, OPL_UPDATE_DEST: payload },
              windowsHide: true,
            },
          )
        : spawnSync('/usr/bin/ditto', ['-x', '-k', archive, payload])
    if (extract.status !== 0) throw Error('extract failed')
    const manifest = JSON.parse(await readFile(join(payload, 'artifact.json'), 'utf8'))
    const version = manifest.enhancementVersion ?? manifest.version
    if (
      !manifest.officialVersion ||
      manifest.officialVersion !== releaseManifest.official.version ||
      version !== releaseManifest.enhancement.version ||
      manifest.suiteSha256 !== digest(JSON.stringify(manifest.payloadFiles))
    )
      throw Error('invalid manifest')
    if (!newer(version, current.suiteVersion ?? '0.1.0')) {
      await status({
        state: 'current',
        officialVersion: releaseManifest.official.version,
        releaseVersion: releaseManifest.releaseVersion,
      })
      return
    }
    // Verify every executable byte before invoking a newly downloaded installer.
    for (const [path, hash] of Object.entries(manifest.payloadFiles)) {
      if (
        path.startsWith('/') ||
        path.includes('\\') ||
        path.split('/').some((s) => !s || s === '.' || s === '..') ||
        digest(await readFile(join(payload, path))) !== hash
      )
        throw Error('invalid payload')
    }
    for (const required of [
      'install.mjs',
      'profile.cjs',
      'setup.mjs',
      'update.mjs',
      'skill-install.mjs',
      'migrate.cjs',
      manifest.name,
    ])
      if (!Object.hasOwn(manifest.payloadFiles, required)) throw Error('incomplete payload')
    const exe =
      process.platform === 'win32'
        ? join(application, 'DeepSeek Harness.exe')
        : join(application, 'Contents/MacOS/DeepSeek Harness')
    // The existing installer verifies again, uses the official plugin manager,
    // and preserves credentials, sessions, custom Skill edits and the old payload.
    const installArgs = [join(payload, 'install.mjs'), application, root, payload, '--no-launch']
    const install = spawnSync(exe, installArgs, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_USE_SYSTEM_CA: '1',
        OPL_DSH_HOME: current.profileHome,
        OPL_CODEX_HOME: dirname(dirname(current.skillDir)),
      },
      stdio: 'ignore',
      windowsHide: true,
      timeout: 180000,
    })
    if (install.status !== 0) {
      spawnSync(
        exe,
        [join(current.release, 'install.mjs'), application, root, current.release, '--no-launch'],
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            NODE_USE_SYSTEM_CA: '1',
            OPL_DSH_HOME: current.profileHome,
            OPL_CODEX_HOME: dirname(dirname(current.skillDir)),
          },
          stdio: 'ignore',
          windowsHide: true,
          timeout: 180000,
        },
      )
      throw Error('installation failed')
    }
    const installed = JSON.parse(await readFile(installationFile, 'utf8'))
    if (installed.suiteVersion !== version) throw Error('version not confirmed')
    await status({
      state: 'updated',
      version,
      officialVersion: releaseManifest.official.version,
      releaseVersion: releaseManifest.releaseVersion,
    })
  } catch {
    // Keep the installed release usable when offline or an update is refused.
    await status({ state: 'deferred', message: '本次增强更新未完成，继续使用已安装版本。' }).catch(
      () => {},
    )
  } finally {
    await lock.close()
    await unlink(lockPath).catch(() => {})
  }
}
