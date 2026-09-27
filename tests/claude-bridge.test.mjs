import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const command = process.env.OPL_TEST_CLAUDE_COMMAND

test(
  'Claude bridge starts an empty saved session and resumes after a completed turn',
  { skip: !command, timeout: 90000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'opl-claude-bridge-'))
    const cwd = await realpath(home)
    const requests = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      if (!body || !req.url?.includes('/v1/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }
      requests.push({ path: req.url, model: JSON.parse(body).model })
      const reply = (value) => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      reply({
        type: 'message_start',
        message: {
          id: 'msg_fixture',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 3, output_tokens: 0 },
        },
      })
      reply({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      reply({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
      reply({ type: 'content_block_stop', index: 0 })
      reply({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1 },
      })
      reply({ type: 'message_stop' })
      res.end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const child = spawn(process.execPath, [resolve('dist/package/lib/native-harness-bridge.mjs')], {
      cwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: home,
        ANTHROPIC_API_KEY: 'fixture',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        OPL_NATIVE_HARNESS: 'claude',
        OPL_NATIVE_COMMAND: command,
        OPL_NATIVE_MODEL: 'claude-opus-5-5',
        OPL_NATIVE_PERMISSION: 'read-only',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr.resume()
    const pending = new Map()
    const chunks = []
    createInterface({ input: child.stdout }).on('line', (line) => {
      const message = JSON.parse(line)
      if (message.method === 'session/update') {
        if (message.params.update.sessionUpdate === 'agent_message_chunk')
          chunks.push(message.params.update.content.text)
      } else if (pending.has(message.id)) {
        const finish = pending.get(message.id)
        pending.delete(message.id)
        message.error ? finish.reject(Error(message.error.code)) : finish.resolve(message.result)
      }
    })
    let id = 0
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const key = ++id
        pending.set(key, { resolve, reject })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n')
      })
    try {
      await call('initialize')
      const sessionId = '17c19314-288f-41fa-a5cf-6bd3db7c35a1'
      await call('session/load', { cwd, sessionId, mcpServers: [] })
      for (let turn = 0; turn < 2; turn++) {
        assert.deepEqual(
          await call('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: 'Reply ok.' }],
          }),
          { stopReason: 'end_turn' },
        )
      }
      assert.equal(chunks.join(''), 'okok')
      assert.equal(requests.length, 2)
      assert.ok(requests.every((item) => item.path?.includes('/v1/messages')))
    } finally {
      child.kill()
      await new Promise((resolve) => server.close(resolve))
      await rm(home, { recursive: true, force: true })
    }
  },
)
