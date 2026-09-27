import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { feedbackSessionFacts } from '../../src/collaboration/host/feedback/session-facts.ts'
import { isReasoningTextProtocolFailure } from '../../src/collaboration/host/feedback/state.ts'

/** Events represent the durable official session log, without running a model. */
function fold(events: unknown[]) {
  return events.reduce<ReturnType<typeof feedbackSessionFacts.init>>(
    (state, event) => feedbackSessionFacts.apply(state, event as SessionEvent),
    feedbackSessionFacts.init(),
  )
}

describe('feedback session recovery facts', () => {
  it('binds an instruction queued between turns to the consuming turn and ignores duplicate request IDs', () => {
    const instruction = {
      type: 'user/message',
      seq: 12,
      data: { source: { kind: 'user', rpcId: 'task-feedback-resume:original:1' } },
    }
    const state = fold([
      instruction,
      { type: 'turn/start', seq: 13, data: { turn: 3 } },
      { ...instruction, seq: 14 },
      { type: 'turn/end', seq: 15, data: { turn: 3, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 16, data: { turn: 4 } },
    ])
    expect(state.instructions['task-feedback-resume:original:1']).toEqual({ seq: 12, turn: 3 })
    expect(state.pendingInstructions).toEqual([])
    expect(state.openTurn).toBe(4)
  })

  it('uses only the final assistant message for visible tool-syntax diagnostics', () => {
    const message = (seq: number, text: string) => ({
      type: 'assistant/message',
      seq,
      data: { turn: 2, message: { content: [{ type: 'text', text }] } },
    })
    const unexecuted = message(
      3,
      '<invoke name="search"><parameter name="q">example</parameter></invoke>',
    )
    expect(fold([unexecuted]).finalToolSyntax['2']).toEqual(['invoke-tag', 'parameter-tag'])
    expect(
      fold([unexecuted, message(8, 'Results verified from the tool output.')]).finalToolSyntax['2'],
    ).toEqual([])
  })

  it('admits only the exact provider protocol failure for automatic continuation', () => {
    const error = {
      code: 'INVALID_REQUEST',
      status: 400,
      message: 'reasoning_text must be passed back',
    }
    expect(isReasoningTextProtocolFailure({ kind: 'error', error } as never)).toBe(true)
    for (const changed of [
      { ...error, status: 503 },
      { ...error, code: 'UPSTREAM_ERROR' },
      { ...error, message: 'reasoning_text is mentioned here' },
    ])
      expect(isReasoningTextProtocolFailure({ kind: 'error', error: changed } as never)).toBe(false)
  })
})
