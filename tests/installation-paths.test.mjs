import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installationPaths } from '../installer/installation-paths.mjs'
import { installSkill } from '../installer/skill-install.mjs'

test('legacy profile receipts resolve update state to the Suite directory', () => {
  const base = join(tmpdir(), 'installation-layout')
  const suite = join(base, 'suite'),
    home = join(base, 'profile')
  const legacy = {
    home,
    release: join(suite, 'releases', 'abc'),
    skillDir: join(base, 'codex', 'skills', 'opl-dsh-official'),
  }
  const result = installationPaths(legacy, { profileHome: home })
  assert.equal(result.suiteRoot, suite)
  assert.equal(result.profileHome, home)
  assert.equal(result.skillDir, legacy.skillDir)
  assert.throws(() => installationPaths(legacy, { profileHome: suite }), /profile 不匹配/)
  assert.throws(
    () => installationPaths({ ...legacy, suiteRoot: suite, profileHome: suite }),
    /路径冲突/,
  )
  assert.throws(
    () => installationPaths({ ...legacy, release: join(base, 'unknown') }),
    /缺少 Suite 路径/,
  )
})

test('Skill repair retains a legacy ledger and refuses user changes without overwriting', () => {
  const base = mkdtempSync(join(tmpdir(), 'opl-skill-paths-'))
  try {
    const release = join(base, 'release'),
      home = join(base, 'profile'),
      root = join(base, 'suite'),
      codexHome = join(base, 'codex')
    mkdirSync(join(release, 'skill'), { recursive: true })
    for (const file of ['SKILL.md', 'control.mjs', 'harness-mcp.mjs'])
      writeFileSync(join(release, 'skill', file), 'fixture\n')
    const options = {
      executable: join(base, 'app'),
      home,
      launcher: join(root, 'launch.command'),
      root,
      release,
      codexHome,
    }
    const legacyLedger = join(home, 'opl-dsh', 'codex-ledger')
    const skillDir = installSkill({ ...options, ledgerDir: legacyLedger })
    mkdirSync(legacyLedger, { recursive: true })
    writeFileSync(join(legacyLedger, 'pending.json'), '{"operation":"existing"}\n')
    installSkill({ ...options, ledgerDir: join(root, 'codex-ledger') })
    assert.equal(JSON.parse(readFileSync(join(skillDir, 'config.json'))).ledger, legacyLedger)
    assert.equal(
      readFileSync(join(legacyLedger, 'pending.json'), 'utf8'),
      '{"operation":"existing"}\n',
    )
    writeFileSync(join(skillDir, 'SKILL.md'), 'user customizations\n')
    assert.throws(() => installSkill(options), /手动修改/)
    assert.equal(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'), 'user customizations\n')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
