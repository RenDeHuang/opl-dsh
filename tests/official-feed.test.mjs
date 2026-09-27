import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const parser = new URL('../installer/official-feed.awk', import.meta.url).pathname
const parse = (input) =>
  execFileSync('awk', ['-f', parser], { input, encoding: 'utf8' }).trim().split('\n')
test('official desktop feed supports a future version and folded scalars, independently of GitHub source releases', () => {
  const version = '0.2.0-rc.1',
    url = `https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-${version}-mac-arm64.zip`,
    hash = 'a'.repeat(86) + '=='
  assert.deepEqual(
    parse(
      `version: ${version}\nfiles:\n  - url: ignore-nested\n    sha512: ignore-nested\npath: >-\n  ${url}\nsha512: >-\n  ${hash}\n`,
    ),
    [version, url, hash],
  )
  assert.deepEqual(parse(`version: ${version}\npath: ${url}\nsha512: ${hash}\n`), [
    version,
    url,
    hash,
  ])
  assert.throws(() => parse('version: 0.2.0\npath: something\n'))
  assert.throws(() => parse('version: 0.2.0\nversion: 0.3.0\npath: something\nsha512: hash\n'))
})
