import { createInterface } from 'node:readline'
import { writeFile, readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
let sessionId = 'test-native',
  running
const approvals = new Map()
const send = (v) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...v }) + '\n')
const update = (u) => send({ method: 'session/update', params: { sessionId, update: u } })
const chunk = (t) =>
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } })
const answer = (id, r) => send({ id, result: r })
createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize')
    answer(m.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } })
  else if (m.method === 'session/new' || m.method === 'session/load') {
    await appendFile(join(process.cwd(), 'connections.txt'), m.method + '\n')
    sessionId = m.params.sessionId ?? 'test-native'
    await writeFile(
      join(process.cwd(), 'launch.json'),
      JSON.stringify({
        envKey: !!process.env.OPL_GATEWAY_GROK_API_KEY,
        hasCodex: !!process.env.OPL_GATEWAY_CODEX_API_KEY,
        home: process.env.GROK_HOME,
        args: process.argv.slice(2),
      }),
    )
    answer(m.id, { sessionId, models: { currentModelId: 'grok-4.7' } })
  } else if (m.method === 'session/prompt') {
    running = m.id
    await appendFile(join(process.cwd(), 'calls.txt'), m.params.prompt[0].text + '\n')
    const text = m.params.prompt[0].text
    if (text === 'wait') return
    if (text === 'allow-write' || text === 'deny-write') {
      approvals.set('permission-string', m.id)
      send({
        id: 'permission-string',
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { title: 'Write controlled.txt' },
          options: [
            { optionId: 'yes', kind: 'allow_once', name: 'Allow' },
            { optionId: 'no', kind: 'reject_once', name: 'Deny' },
          ],
        },
      })
    } else {
      const saved = await readFile(join(process.cwd(), 'memory.txt'), 'utf8').catch(() => '')
      chunk(text === 'recall' ? saved : 'result:' + text)
      if (text !== 'recall') await writeFile(join(process.cwd(), 'memory.txt'), text)
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'read1',
        title: 'Read file',
        kind: 'read',
        status: 'completed',
      })
      answer(m.id, { stopReason: 'end_turn' })
      running = undefined
    }
  } else if (m.method === 'session/cancel') {
    if (running) answer(running, { stopReason: 'cancelled' })
    running = undefined
  } else if (m.id === 'permission-string') {
    const id = approvals.get(m.id)
    if (m.result.outcome.optionId === 'yes') {
      await writeFile(join(process.cwd(), 'controlled.txt'), 'approved')
      chunk('written')
    } else chunk('denied')
    answer(id, { stopReason: 'end_turn' })
    running = undefined
  }
})
