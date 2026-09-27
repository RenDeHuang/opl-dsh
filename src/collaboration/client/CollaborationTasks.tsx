import { useRef, useState } from 'react'
import { useCollaborationTasks } from './use-collaboration-tasks.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HarnessOrigin, HarnessSnapshot } from '../../execution/contracts/sessions.ts'
import css from '../../shared/client/SettingsSection.module.css'
import type { ExecutionCall as Call } from '../../shared/client/remote-call.ts'
export const taskState: Record<string, string> = {
  idle: '未开始',
  queued: '排队中',
  running: '执行中',
  waiting_child: '等待子任务',
  waiting_approval: '等待授权',
  waiting_input: '等待回答',
  completed: '待验收',
  failed: '执行失败',
  cancelled: '已取消',
  interrupted: '已中断',
}
export function CollaborationTasks({
  call,
  origin,
  open,
}: {
  call: Call
  origin: HarnessOrigin
  open: (id: string) => void
}) {
  const { tasks, error } = useCollaborationTasks(call, origin)
  if (!tasks.length) return error ? <p role="alert">{error}</p> : null
  return (
    <details className={css.details} open>
      <summary>协作任务 · {tasks.length}</summary>
      <div className={css.detailsBody}>
        {tasks.map((task) => {
          const turn = task.latestTurn
          const label =
            turn?.review?.decision === 'accepted'
              ? '验收通过'
              : turn?.review?.decision === 'changes_requested'
                ? '需要修改'
                : taskState[task.state]
          return (
            <div className={css.taskRow} key={task.id}>
              <div>
                <strong className={css.taskTitle}>{task.assignment?.objective}</strong>
                <p className={css.muted}>
                  {label} · {task.modelRef.model.split('::').at(-1)} · {task.harnessRef}
                  {turn?.delivery?.state === 'blocked' ? ' · 回传未完成' : ''}
                </p>
              </div>
              <Button variant="outline" onClick={() => open(task.id)}>
                查看任务
              </Button>
            </div>
          )
        })}
      </div>
    </details>
  )
}
export function TaskReview({
  call,
  session,
  reload,
}: {
  call: Call
  session: HarnessSnapshot
  reload: () => Promise<unknown>
}) {
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const turn = session.turns.at(-1)
  const running = useRef(false)
  if (!session.assignment || !turn) return null
  const act = async (operation: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
      await reload()
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className={css.card}>
      <h3 className={css.name}>任务交付</h3>
      <p>{session.assignment.acceptance}</p>
      {turn.report && (
        <>
          <p>{turn.report.summary}</p>
          {[
            ['产物', turn.report.artifacts],
            ['检查', turn.report.checks],
            ['遗留问题', turn.report.remaining],
          ].map(
            ([label, items]) =>
              Array.isArray(items) &&
              items.length > 0 && (
                <details key={String(label)}>
                  <summary>{label}</summary>
                  <ul>
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              ),
          )}
        </>
      )}
      <p className={css.muted}>
        {turn.review?.decision === 'accepted'
          ? '验收通过'
          : turn.review?.decision === 'changes_requested'
            ? '需要修改'
            : taskState[turn.state]}
        {turn.review?.note ? ' · ' + turn.review.note : ''}
      </p>
      {turn.state === 'completed' && (!turn.review || turn.review.decision === 'pending') && (
        <>
          <label className={css.field}>
            验收依据
            <input
              className={css.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="核对了哪些产物，或需要修改什么"
            />
          </label>
          <div className={css.row}>
            {(['accepted', 'changes_requested'] as const).map((decision) => (
              <Button
                key={decision}
                variant="outline"
                disabled={busy || !note.trim()}
                onClick={() =>
                  void act(() =>
                    call('review', {
                      origin: session.origin,
                      sessionId: session.id,
                      operationId: turn.operationId,
                      decision,
                      note,
                    }),
                  )
                }
              >
                {decision === 'accepted' ? '验收通过' : '要求修改'}
              </Button>
            ))}
          </div>
        </>
      )}
      {turn.review?.decision === 'changes_requested' && (
        <p className={css.muted}>在下方发送修改要求，将继续此子对话。</p>
      )}
      {turn.delivery?.state === 'blocked' && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act(() => call('retry-delivery', { sessionId: session.id }))}
        >
          重试回传
        </Button>
      )}
      {turn.state === 'interrupted' && (
        <p className={css.muted}>任务未自动重发。核对已有产物后，可在下方继续原对话。</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
