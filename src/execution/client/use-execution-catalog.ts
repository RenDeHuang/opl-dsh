import { useEffect, useRef, useState } from 'react'
import { modelRefKey } from '../contracts/catalog.ts'
import type {
  ExecutionCatalog,
  CombinationDefinition,
  HarnessCatalog,
} from '../../contracts/types.ts'
import type { ExecutionCall } from '../../shared/client/remote-call.ts'
export function useExecutionCatalog(call: ExecutionCall) {
  const [catalog, setCatalog] = useState<ExecutionCatalog>()
  const [availability, setAvailability] = useState<HarnessCatalog['combinations']>([])
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)
  const [draft, setDraft] = useState({ name: '', model: '', harness: 'dsh' })
  const [editing, setEditing] = useState<string>()
  const running = useRef(false),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const [next, combinations] = await Promise.all([call('catalog'), call('combinations')])
          if (!cancelled) {
            setCatalog(next)
            setAvailability(combinations)
            setNotice('')
          }
          return
        } catch {
          if (attempt === 2) {
            if (!cancelled) setNotice('无法读取组合目录')
          } else {
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
          }
        }
      }
    })()
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [call, loadRevision])
  const save = async (next: ExecutionCatalog) => {
    if (running.current) return false
    running.current = true
    setBusy(true)
    setNotice('')
    try {
      const saved = await call('save-catalog', { catalog: next })
      if (mounted.current) setCatalog(saved)
      try {
        const combinations = await call('combinations')
        if (mounted.current) {
          setAvailability(combinations)
          setNotice('已保存，新的选择使用此配置。')
        }
      } catch {
        if (mounted.current) setNotice('配置已保存；可用状态未刷新，请重新打开此页。')
      }
      return true
    } catch (cause) {
      if (mounted.current) setNotice(cause instanceof Error ? cause.message : '保存失败')
      return false
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const update = (id: string, patch: Partial<CombinationDefinition>) => {
    if (!catalog) return
    const target = catalog.combinations.find((item) => item.id === id)
    if (!target) return
    void save({
      ...catalog,
      combinations: catalog.combinations.map((item) =>
        item.id === id
          ? { ...item, ...patch, generated: false }
          : patch.isDefault && modelRefKey(item.modelRef) === modelRefKey(target.modelRef)
            ? { ...item, isDefault: false }
            : item,
      ),
    })
  }
  const add = async () => {
    if (!catalog) return
    const model = catalog.models.find((item) => modelRefKey(item.ref) === draft.model)
    if (!model) return
    const saved = await save({
      ...catalog,
      combinations: [
        ...catalog.combinations,
        {
          id: crypto.randomUUID(),
          name: draft.name.trim(),
          modelRef: model.ref,
          harnessRef: draft.harness,
          permissionPolicy: 'read-only',
          isDefault: false,
          enabled: true,
        },
      ],
    })
    if (saved && mounted.current) setDraft({ name: '', model: '', harness: 'dsh' })
  }
  return {
    catalog,
    availability,
    busy,
    notice,
    retry: () => {
      setNotice('')
      setLoadRevision((value) => value + 1)
    },
    draft,
    setDraft,
    editing,
    setEditing,
    update,
    add,
  }
}
