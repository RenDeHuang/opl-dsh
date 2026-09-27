import { useCallback, useEffect, useRef, useState } from 'react'
import { GROK_COMBINATION } from '../contracts/sessions.ts'
import type { HarnessSnapshot, HarnessCatalog } from '../../contracts/types.ts'
import type { HarnessSessionSummary } from '../contracts/views.ts'
import type { ExecutionCall } from '../../shared/client/remote-call.ts'
const activeStates = new Set([
  'queued',
  'running',
  'waiting_child',
  'waiting_approval',
  'waiting_input',
])
export const sessionIsActive = (state: string) => activeStates.has(state)
/** Session lists contain summaries only; detail polling transfers changed recent turns. */
export function useHarnessPanel(call: ExecutionCall, initialSession?: string) {
  const [combinations, setCombinations] = useState<HarnessCatalog['combinations']>([])
  const [listReady, setListReady] = useState(false),
    [combinationsReady, setCombinationsReady] = useState(false)
  const [sessions, setSessions] = useState<HarnessSessionSummary[]>([])
  const [selected, setSelected] = useState(initialSession ?? '')
  const [session, setSession] = useState<HarnessSnapshot>()
  const [cwd, setCwd] = useState(''),
    [combination, setCombination] = useState(GROK_COMBINATION)
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [source, setSource] = useState<HarnessSnapshot>()
  const [nextCursor, setNextCursor] = useState<string>(),
    [beforeTurn, setBeforeTurn] = useState(0)
  const mounted = useRef(true),
    operationRunning = useRef(false)
  const selectedRef = useRef(selected),
    pages = useRef(1),
    listRevision = useRef<string>(),
    detailRevision = useRef<string>()
  const activeRef = useRef(false),
    loadedSession = useRef(''),
    listRequest = useRef(0),
    detailRequest = useRef(0)
  selectedRef.current = selected
  activeRef.current = session ? sessionIsActive(session.state) : false
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const loadList = useCallback(
    async (force = false) => {
      const request = ++listRequest.current
      const result = await call('sessions', {
        limit: 50,
        ...(!force && listRevision.current ? { revision: listRevision.current } : {}),
      })
      if (!mounted.current || request !== listRequest.current || result.unchanged) return
      const items = [...result.items]
      let cursor = result.nextCursor
      for (let page = 1; page < pages.current && cursor; page++) {
        const next = await call('sessions', { limit: 50, cursor })
        items.push(...next.items)
        cursor = next.nextCursor
      }
      if (!mounted.current || request !== listRequest.current) return
      listRevision.current = result.revision
      setSessions([...new Map(items.map((item) => [item.id, item])).values()])
      setNextCursor(cursor)
      setListReady(true)
    },
    [call],
  )
  const loadDetail = useCallback(
    async (force = false) => {
      const id = selectedRef.current
      if (!id) return
      const request = ++detailRequest.current
      const result = await call('detail', {
        sessionId: id,
        limit: 30,
        ...(!force && detailRevision.current ? { revision: detailRevision.current } : {}),
      })
      if (
        !mounted.current ||
        request !== detailRequest.current ||
        selectedRef.current !== id ||
        result.unchanged ||
        !result.session
      )
        return
      detailRevision.current = result.revision
      const latest = result.session
      const firstPage = loadedSession.current !== id
      loadedSession.current = id
      setSession((previous) => {
        if (!previous || previous.id !== id) return latest
        const turns = new Map(previous.turns.map((turn) => [turn.operationId, turn]))
        for (const turn of latest.turns) turns.set(turn.operationId, turn)
        return { ...latest, turns: [...turns.values()] }
      })
      setBeforeTurn((previous) =>
        firstPage ? result.beforeTurn : Math.min(previous, result.beforeTurn),
      )
    },
    [call],
  )
  const refresh = useCallback(async () => {
    await Promise.all([loadList(true), loadDetail(true)])
  }, [loadList, loadDetail])
  useEffect(() => {
    let live = true
    void call('combinations')
      .then((result) => {
        if (live) {
          setCombinations(result)
          setCombinationsReady(true)
        }
      })
      .catch(() => {
        if (live) setError('无法读取执行组合')
      })
    return () => {
      live = false
    }
  }, [call])
  useEffect(() => {
    if (initialSession) setSelected(initialSession)
  }, [initialSession])
  useEffect(() => {
    detailRequest.current++
    detailRevision.current = undefined
    loadedSession.current = ''
    setSession(undefined)
    setBeforeTurn(0)
    if (selected)
      void loadDetail(true).catch((cause) => {
        if (mounted.current && selectedRef.current === selected)
          setError(cause instanceof Error ? cause.message : '对话读取失败')
      })
  }, [selected, loadDetail])
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (document.hidden) {
        timer = setTimeout(() => void tick(), 5000)
        return
      }
      try {
        await Promise.all([loadList(), loadDetail()])
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : '状态读取失败')
      } finally {
        if (live) timer = setTimeout(() => void tick(), activeRef.current ? 1200 : 5000)
      }
    }
    void tick()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [loadList, loadDetail])
  const act = async (operation: () => Promise<unknown>, reload = true) => {
    if (operationRunning.current) return
    operationRunning.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
      if (reload) await refresh()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      operationRunning.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const loadMore = () =>
    act(async () => {
      pages.current++
      await loadList(true)
    }, false)
  const loadEarlier = () =>
    act(async () => {
      const id = selectedRef.current
      if (!id || beforeTurn === 0) return
      const result = await call('detail', { sessionId: id, beforeTurn, limit: 30 })
      if (!mounted.current || selectedRef.current !== id || !result.session) return
      const earlier = result.session
      setSession((previous) => {
        if (!previous || previous.id !== id) return earlier
        return {
          ...previous,
          turns: [
            ...new Map(
              [...earlier.turns, ...previous.turns].map((turn) => [turn.operationId, turn]),
            ).values(),
          ],
        }
      })
      setBeforeTurn(result.beforeTurn)
    }, false)
  const submit = () =>
    act(async () => {
      let id = selectedRef.current
      if (!id && source) {
        const delegated = await call('delegate', {
          origin: { kind: 'harness', sessionId: source.id },
          combination,
          task: text,
          taskId: crypto.randomUUID(),
          operationId: crypto.randomUUID(),
          wait: false,
        })
        selectedRef.current = delegated.id
        setSelected(delegated.id)
        setText('')
        setSource(undefined)
        return
      }
      if (!id) {
        const created = await call('start', {
          combination,
          cwd,
          taskId: crypto.randomUUID(),
          origin: source
            ? { kind: 'harness', sessionId: source.id }
            : { kind: 'desktop', sessionId: 'panel' },
          ...(source ? { sandbox: source.sandbox } : {}),
        })
        id = created.id
        selectedRef.current = id
        setSelected(id)
      }
      await call('prompt', { sessionId: id, text, operationId: crypto.randomUUID() })
      if (mounted.current) {
        setText('')
        setSource(undefined)
      }
    })
  return {
    loading: !error && (!listReady || !combinationsReady || (!!selected && !session)),
    combinations,
    sessions,
    selected,
    setSelected,
    session,
    cwd,
    setCwd,
    combination,
    setCombination,
    text,
    setText,
    busy,
    error,
    source,
    setSource,
    act,
    refresh,
    submit,
    nextCursor,
    loadMore,
    beforeTurn,
    loadEarlier,
  }
}
