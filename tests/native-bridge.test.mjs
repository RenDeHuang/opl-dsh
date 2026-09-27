import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
test(
  'packaged bridge resumes native Codex identity and refuses sandbox escalation',
  async () => {
    const cwd = await realpath('.'),
      output = []
    const child = spawn(process.execPath, [resolve('dist/package/lib/native-harness-bridge.mjs')], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OPL_NATIVE_HARNESS: 'codex',
        OPL_NATIVE_COMMAND: resolve('tests/fixtures/codex-app-server.mjs'),
        OPL_NATIVE_MODEL: 'gpt-6-luna',
        OPL_NATIVE_PERMISSION: 'read-only',
        OPL_NATIVE_API_KEY: 'fixture',
        OPL_NATIVE_BASE_URL: 'http://127.0.0.1:1/v1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr.resume()
    let seq = 0
    const pending = new Map()
    createInterface({ input: child.stdout }).on('line', (line) => {
      const m = JSON.parse(line)
      if (m.method === 'session/update') output.push(m.params.update.content.text)
      else {
        const p = pending.get(m.id)
        if (p) {
          pending.delete(m.id)
          m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result)
        }
      }
    })
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    try {
      await call('initialize')
      const session = await call('session/load', {
        cwd,
        sessionId: 'existing-native-id',
        mcpServers: [],
      })
      assert.equal(session.sessionId, 'existing-native-id')
      assert.deepEqual(
        await call('session/prompt', {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'test' }],
          _meta: { reasoningEffort: 'high' },
        }),
        { stopReason: 'end_turn' },
      )
      assert.equal(output.join(''), 'boundary preserved')
    } finally {
      child.kill()
    }
  },
  { timeout: 10000 },
)
