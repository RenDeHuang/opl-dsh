const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const stableVersion = /^\d+\.\d+\.\d+$/

export function validateReleaseManifest(manifest, { tagName, assetName } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.channel !== 'stable')
    throw new Error('发布清单不是稳定版清单')
  if (!stableVersion.test(manifest.releaseVersion)) throw new Error('发布版本无效')
  if (manifest.tagName !== `opl-dsh-v${manifest.releaseVersion}`)
    throw new Error('清单 tag 与版本不符')
  if (tagName && tagName !== `opl-dsh-v${manifest.releaseVersion}`)
    throw new Error('发布 tag 与清单版本不符')
  if (!manifest.official || !semver.test(manifest.official.version))
    throw new Error('官方 DSH 版本无效')
  if (!manifest.enhancement || !stableVersion.test(manifest.enhancement.version))
    throw new Error('OPL 增强版本无效')
  if (manifest.enhancement.version !== manifest.releaseVersion)
    throw new Error('联合版本与增强版本不符')
  if (assetName && manifest.enhancement.asset !== assetName) throw new Error('增强资产与清单不符')
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.enhancement.sha256))
    throw new Error('增强资产摘要无效')
  if (!Number.isSafeInteger(manifest.enhancement.size) || manifest.enhancement.size <= 0)
    throw new Error('增强资产大小无效')
  return manifest
}
