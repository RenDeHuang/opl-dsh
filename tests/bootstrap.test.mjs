import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

function bootstrap(mode) {
  const root = mkdtempSync(join(tmpdir(), 'opl-bootstrap-test-'))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const script = (name, body) =>
    writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o700 })
  script('uname', 'if [[ "$1" == -s ]]; then echo Darwin; else echo arm64; fi\n')
  script(
    'curl',
    `output=''; url=''
while [[ $# -gt 0 ]]; do
  case "$1" in -o) output="$2"; shift;; https://*) url="$1";; esac
  shift
done
case "$url" in
  */latest) echo 'https://github.com/gaofeng21cn/opl-dsh/releases/tag/${mode === 'bad-tag' ? '../wrong' : 'opl-dsh-v0.2.16'}';;
  */download/opl-dsh-v0.2.16/SHA256SUMS) echo '${createHash('sha256').update('fixture').digest('hex')}  OPL-DSH-Enhancements.zip' > "$output";;
  */download/opl-dsh-v0.2.16/OPL-DSH-Enhancements.zip) printf '%s' '${mode === 'corrupt' ? 'corrupt' : 'fixture'}' > "$output";;
  *) exit 42;;
esac
`,
  )
  script(
    'ditto',
    `mkdir -p "$4"
printf '%s\\n' '#!/bin/bash' 'echo "INSTALLER_CALLED:$*"' > "$4/install.command"
`,
  )
  try {
    return spawnSync(
      '/bin/bash',
      [new URL('../install.sh', import.meta.url).pathname, '--no-launch'],
      {
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: root, PATH: bin + ':' + process.env.PATH },
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
test('bootstrap pins both downloads to one release and forwards installer flags', () => {
  const result = bootstrap('valid')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /INSTALLER_CALLED:--no-launch/)
})
test('bootstrap rejects corrupt downloads before extraction or execution', () => {
  const result = bootstrap('corrupt')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /增强包校验失败/)
  assert.doesNotMatch(result.stdout, /INSTALLER_CALLED/)
})
test('bootstrap rejects unexpected release redirects', () => {
  const result = bootstrap('bad-tag')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /无法读取 OPL DSH 稳定发布版本/)
})

test('Mac installer reaches the download branch in a UTF-8 locale and propagates failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'opl-download-test-'))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'uname'),
    '#!/bin/bash\nif [[ "$1" == -s ]]; then echo Darwin; else echo arm64; fi\n',
    { mode: 0o700 },
  )
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/bash
if [[ "$*" == *nightly-mac.yml* ]]; then
  echo 'version: 0.1.7-rc.2'
  echo 'path: https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.1.7-rc.2-mac-arm64.zip'
  echo 'sha512: ${'A'.repeat(86)}=='
else
  echo 'EXPECTED_DOWNLOAD_FAILURE' >&2
  exit 23
fi
`,
    { mode: 0o700 },
  )
  try {
    const result = spawnSync(
      '/bin/bash',
      [new URL('../installer/install.command', import.meta.url).pathname],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          LC_ALL: 'en_US.UTF-8',
          PATH: bin + ':' + process.env.PATH,
          OPL_SUITE_ROOT: join(root, 'suite'),
          OPL_APPLICATIONS_DIR: join(root, 'apps'),
        },
      },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /正在下载官方 DeepSeek Harness 0.1.7-rc.2…/)
    assert.match(result.stderr, /EXPECTED_DOWNLOAD_FAILURE/)
    assert.doesNotMatch(result.stderr, /unbound variable/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
