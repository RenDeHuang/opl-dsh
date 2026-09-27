import { useEffect, useState } from 'react'
import type { HarnessOrigin } from '../../contracts/types.ts'
import type { HarnessTaskSummary } from '../../execution/contracts/views.ts'
import type { ExecutionCall } from '../../shared/client/remote-call.ts'
import { sessionIsActive } from '../../execution/client/use-harness-panel.ts'
export function useCollaborationTasks(call: ExecutionCall, origin: HarnessOrigin) {
  const [tasks, setTasks] = useState<HarnessTaskSummary[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>
    setTasks([])
    setError('')
    const tick = async () => {
      let active = false
      if (document.hidden) {
        timer = setTimeout(() => void tick(), 5000)
        return
      }
      try {
        const next = await call('task-summaries', { origin })
        if (live) {
          setTasks(next)
          setError('')
          active = next.some((task) => sessionIsActive(task.state))
        }
      } catch {
        if (live) setError('协作任务暂时无法读取')
      } finally {
        if (live) timer = setTimeout(() => void tick(), active ? 2000 : 5000)
      }
    }
    void tick()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [call, origin.kind, origin.sessionId])
  return { tasks, error }
}
