/** Exercise the shipped helper against an authenticated Session API. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

test('a retry sends one prompt; changed content under the same operation is refused', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'opl-dispatch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let prompts = 0
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-only')
    let body = ''
    for await (const part of req) body += part
    const data = JSON.parse(body)
    if (data.method === 'prompt') prompts++
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        ok: true,
        value:
          data.method === 'create'
            ? { sessionId: data.args.request.sessionId }
            : data.method === 'prompt'
              ? { accepted: true }
              : data.method === 'register'
                ? { task: data.args.request }
                : {},
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await mkdir(join(root, 'profiles/desktop'), { recursive: true })
  await writeFile(
    join(root, 'profiles/desktop/control.json'),
    JSON.stringify({
      pid: process.pid,
      endpoint: `http://127.0.0.1:${server.address().port}`,
      token: 'test-only',
    }),
  )
  await cp(new URL('../installer/skill/control.mjs', import.meta.url), join(root, 'control.mjs'))
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({ home: root, ledger: join(root, 'ledger'), launcher: '/must-not-launch' }),
  )
  const prompt = join(root, 'prompt.txt')
  await writeFile(prompt, 'hello')
  const run = () =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          join(root, 'control.mjs'),
          'dispatch',
          '--task',
          'test',
          '--operation',
          'initial',
          '--cwd',
          root,
          '--prompt-file',
          prompt,
        ],
        { env: { ...process.env, CODEX_THREAD_ID: 'test-thread' } },
      )
      let stdout = '',
        stderr = ''
      child.stdout.on('data', (x) => (stdout += x))
      child.stderr.on('data', (x) => (stderr += x))
      child.on('exit', (code) => resolve({ code, stdout, stderr }))
    })
  assert.equal((await run()).code, 0)
  assert.equal(prompts, 1)
  const again = await run()
  assert.equal(again.code, 0)
  assert.equal(JSON.parse(again.stdout).idempotent, true)
  assert.equal(prompts, 1)
  await writeFile(prompt, 'different')
  const conflict = await run()
  assert.notEqual(conflict.code, 0)
  assert.match(conflict.stderr, /operation ID/)
  assert.equal(prompts, 1)
})

test('delegate-wait returns the persisted snapshot when the control deadline expires', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'opl-wait-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    const data = JSON.parse(body)
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify(
        data.method === 'wait'
          ? { ok: false, error: 'control call timed out' }
          : { ok: true, value: { id: 'harness-one', state: 'running' } },
      ),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await mkdir(join(root, 'profiles/desktop'), { recursive: true })
  await writeFile(
    join(root, 'profiles/desktop/control.json'),
    JSON.stringify({
      pid: process.pid,
      endpoint: `http://127.0.0.1:${server.address().port}`,
      token: 'test-only',
    }),
  )
  await cp(new URL('../installer/skill/control.mjs', import.meta.url), join(root, 'control.mjs'))
  await writeFile(join(root, 'config.json'), JSON.stringify({ home: root, autoStart: false }))
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      join(root, 'control.mjs'),
      'delegate-wait',
      '--session',
      'harness-one',
    ])
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (part) => (stdout += part))
    child.stderr.on('data', (part) => (stderr += part))
    child.on('exit', (code) => resolve({ code, stdout, stderr }))
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { id: 'harness-one', state: 'running' })
})
