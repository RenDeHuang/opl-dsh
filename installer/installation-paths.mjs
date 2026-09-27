/** The installation receipt owns Suite/profile/Skill paths, including legacy layouts. */
import { dirname, basename, isAbsolute, join, resolve } from 'node:path'

export function installationPaths(receipt, { profileHome, suiteRoot } = {}) {
  if (!receipt || typeof receipt !== 'object') throw new Error('安装回执无效')
  const profile = receipt.profileHome ?? receipt.home
  if (typeof profile !== 'string' || !isAbsolute(profile))
    throw new Error('安装回执缺少 profile 路径')
  if (receipt.home && resolve(receipt.home) !== resolve(profile))
    throw new Error('安装回执的 profile 路径冲突')
  if (profileHome && resolve(profileHome) !== resolve(profile))
    throw new Error('安装信息与当前 profile 不匹配')
  // Old profile-side receipts have no suiteRoot. Their immutable release remains
  // under <suiteRoot>/releases/<digest>; never mistake <profile>/opl-dsh for it.
  const releaseRoot =
    typeof receipt.release === 'string' && basename(dirname(receipt.release)) === 'releases'
      ? dirname(dirname(receipt.release))
      : undefined
  const root = receipt.suiteRoot ?? suiteRoot ?? releaseRoot
  if (typeof root !== 'string' || !isAbsolute(root))
    throw new Error('安装回执缺少 Suite 路径，请重新运行安装器')
  if (suiteRoot && resolve(suiteRoot) !== resolve(root))
    throw new Error('安装信息与当前 Suite 不匹配')
  if (
    receipt.skillDir !== undefined &&
    (typeof receipt.skillDir !== 'string' || !isAbsolute(receipt.skillDir))
  )
    throw new Error('安装回执的 Skill 路径无效')
  return {
    ...receipt,
    home: resolve(profile),
    profileHome: resolve(profile),
    suiteRoot: resolve(root),
    ledgerDir: receipt.ledgerDir ?? join(root, 'codex-ledger'),
  }
}
