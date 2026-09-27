/** The release must carry only OPL code and explicit official runtime peers. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const output = new URL('../dist/', import.meta.url)
test('tarball checksum and contents bind the installer to an external plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('artifact.json', output), 'utf8'))
  const bytes = await readFile(new URL(manifest.name, output))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  const files = execFileSync('tar', ['-tzf', new URL(manifest.name, output).pathname], {
    encoding: 'utf8',
  })
  assert.doesNotMatch(files, /node_modules|app\.asar|credentials|\/\.env/)
  const pkg = JSON.parse(await readFile(new URL('package/package.json', output), 'utf8'))
  assert.equal(pkg.name, '@one-person-lab/dsh-opl')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-llm'], '*')
  assert.equal(manifest.version, manifest.officialVersion)
  assert.equal(manifest.enhancementVersion, pkg.version)
  const code = await readFile(new URL('package/lib/index.js', output), 'utf8')
  assert.match(code, /from "@deepseek-ai\/dsh-llm-deepseek"/)
  assert.doesNotMatch(
    code,
    /class LlmRuntime|class AgentLoop|resolveProfiles|credentialStoreFrom|authContextFrom/,
  )
})
