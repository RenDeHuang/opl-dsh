import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  renameSync,
  rmSync,
  lstatSync,
} from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function installSkill({
  executable,
  home,
  profileHome = home,
  launcher,
  root,
  suiteRoot = root,
  ledgerDir,
  release,
  codexHome = process.env.OPL_CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'),
}) {
  const skillDir = join(codexHome, 'skills/opl-dsh-official')
  verifySkill(skillDir)
  const previousConfig = existsSync(join(skillDir, 'config.json'))
    ? JSON.parse(readFileSync(join(skillDir, 'config.json'), 'utf8'))
    : undefined
  // Keep the existing operation ledger, even when an older repair placed it in
  // the profile directory. Moving it would lose idempotency for in-flight tasks.
  const ledger = previousConfig?.ledger ?? ledgerDir ?? join(suiteRoot, 'codex-ledger')
  if (!isAbsolute(ledger)) throw new Error('Skill 账本路径无效，已保留原配置')
  const skillStage = skillDir + '.stage-' + process.pid
  mkdirSync(skillStage, { recursive: true, mode: 0o700 })
  cpSync(join(release, 'skill'), skillStage, { recursive: true })
  writeFileSync(
    join(skillStage, 'config.json'),
    JSON.stringify(
      {
        ...previousConfig,
        executable,
        home: profileHome,
        launcher,
        ledger,
        autoStart: previousConfig?.autoStart ?? true,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  )
  const files = Object.fromEntries(
    ['SKILL.md', 'control.mjs', 'harness-mcp.mjs', 'config.json'].map((file) => [
      file,
      digest(readFileSync(join(skillStage, file))),
    ]),
  )
  writeFileSync(
    join(skillStage, '.opl-install.json'),
    JSON.stringify({ owner: 'opl-dsh-suite', files }) + '\n',
    { mode: 0o600 },
  )
  if (
    existsSync(skillDir) &&
    Object.entries(files).every(
      ([file, hash]) => digest(readFileSync(join(skillDir, file))) === hash,
    )
  ) {
    rmSync(skillStage, { recursive: true })
  } else {
    if (existsSync(skillDir)) renameSync(skillDir, skillDir + '.backup-' + Date.now())
    renameSync(skillStage, skillDir)
  }
  return skillDir
}

export function verifySkill(skillDir) {
  const skillManifest = join(skillDir, '.opl-install.json')
  if (existsSync(skillDir)) {
    if (lstatSync(skillDir).isSymbolicLink() || !existsSync(skillManifest))
      throw new Error('已有非本安装器管理的 opl-dsh-official Skill，已保留')
    const previous = JSON.parse(readFileSync(skillManifest, 'utf8'))
    if (
      previous.owner !== 'opl-dsh-suite' ||
      readdirSync(skillDir).some(
        (file) => file !== '.opl-install.json' && !Object.hasOwn(previous.files, file),
      ) ||
      Object.entries(previous.files).some(
        ([file, hash]) =>
          !existsSync(join(skillDir, file)) || digest(readFileSync(join(skillDir, file))) !== hash,
      )
    )
      throw new Error('Codex Skill 已被手动修改，已保留；请先备份并移走该目录再更新')
  }
}
