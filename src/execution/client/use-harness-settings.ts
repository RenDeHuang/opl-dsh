import { useCallback, useEffect, useRef, useState } from 'react'
import type { HarnessInstallation } from '../../contracts/types.ts'
import type { ExecutionCall } from '../../shared/client/remote-call.ts'
/** Detection, maintenance polling and catalog edits share one busy/error owner. */
export function useHarnessSettings(call: ExecutionCall) {
  const [draft, setDraft] = useState({ name: '', command: '' })
  const [items, setItems] = useState<HarnessInstallation[]>([])
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(true)
  const running = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const refresh = useCallback(async () => {
    const result = await call('harness-installations')
    if (mounted.current) setItems(result)
  }, [call])
  const act = useCallback(async (operation: () => Promise<unknown>) => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
      return true
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '操作未完成，请重试')
      return false
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])
  const load = useCallback(() => act(refresh), [act, refresh])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!items.some((item) => item.maintenance?.state === 'running')) return
    const timer = setTimeout(() => {
      void load()
    }, 3000)
    return () => clearTimeout(timer)
  }, [items, load])
  const update = (id: string) =>
    act(async () => {
      await call('harness-update', { id })
      await refresh()
    })
  const savePath = (id: string, command: string) =>
    act(async () => {
      const catalog = await call('catalog')
      await call('save-catalog', {
        catalog: {
          ...catalog,
          harnesses: catalog.harnesses.map((item) =>
            item.id === id ? { ...item, command } : item,
          ),
        },
      })
      await refresh()
    })
  const register = async () => {
    let saved = false
    await act(async () => {
      const catalog = await call('catalog')
      await call('save-catalog', {
        catalog: {
          ...catalog,
          harnesses: [
            ...catalog.harnesses,
            {
              id: 'custom-' + crypto.randomUUID(),
              name: draft.name.trim(),
              kind: 'acp',
              command: draft.command.trim(),
            },
          ],
        },
      })
      saved = true
      await refresh().catch(() => {
        throw new Error('Harness 已登记；检测状态未刷新，请重新检测。')
      })
    })
    if (saved && mounted.current) setDraft({ name: '', command: '' })
  }
  return { draft, setDraft, items, busy, error, load, update, savePath, register }
}
