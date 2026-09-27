import { useEffect, useRef, useState } from 'react'
import type { CooperationSettings } from '../../contracts/types.ts'
import type { ExecutionCall } from '../../shared/client/remote-call.ts'
export function useCooperationSettings(call?: ExecutionCall) {
  const [value, setValue] = useState<CooperationSettings>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const running = useRef(false)
  useEffect(() => {
    let live = true
    if (call)
      void call('cooperation-settings')
        .then((next) => {
          if (live) {
            setValue(next)
            setError('')
          }
        })
        .catch(() => {
          if (live) setError('项目协作设置暂时无法读取')
        })
    return () => {
      live = false
    }
  }, [call])
  const save = async (next: CooperationSettings) => {
    if (!call || running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      setValue(await call('save-cooperation-settings', next))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '协作设置未保存，请重试')
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { cooperation: value, error, busy, loading: !!call && !value && !error, save }
}
