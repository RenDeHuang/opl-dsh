import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ModelCatalog, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  MenuSurface,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExecutionCatalog, CombinationDefinition } from '../coordination/catalog-types.ts'
import type { HarnessCatalog } from '../coordination/harness-types.ts'
import css from './CombinationSelect.module.css'

type Call = <T>(method: string, input?: unknown) => Promise<T>
type SelectionState = { current: ModelSelection | null; groups: ModelCatalog['groups']; combination?: string }
type Choice = { combination: CombinationDefinition; modelName: string; harnessName: string; source: string }
const measureStyle = { visibility: 'hidden', left: 0, top: 0 } as const

function sourceLabel(provider: string, fallback: string): string {
  if (provider === 'opl-gateway') return 'OPL Gateway'
  if (provider === 'deepseek-account' || provider === 'deepseek-official') return 'DeepSeek 官方'
  return fallback
}
function choiceLabel(choice: Choice): string { return `${choice.modelName} · ${choice.harnessName}` }

/** DSH 原生模型菜单的 OPL 组合投影：模型项代表“模型 + Harness”组合。 */
export function CombinationSelect({ call, sessionId, locked, openExternal, available }: {
  available: boolean
  call: Call
  sessionId: string
  locked: boolean
  openExternal: (id: string) => void
}) {
  const [selection, setSelection] = useState<SelectionState>({ current: null, groups: [] })
  const [catalog, setCatalog] = useState<ExecutionCatalog>()
  const [availability, setAvailability] = useState<HarnessCatalog>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>('root')
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const focusIntent = useRef<'model' | 'effort' | 'drill' | null>(null)
  const id = `opl-combination-${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`

  const load = async () => {
    try {
      const [nextCatalog, nextAvailability, nextSelection] = await Promise.all([
        call<ExecutionCatalog>('catalog'), call<HarnessCatalog>('list'), call<SelectionState>('model-selection', { sessionId }),
      ])
      setCatalog(nextCatalog); setAvailability(nextAvailability); setSelection(nextSelection)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取组合') }
  }
  useEffect(() => { if (available) void load() }, [available, sessionId])

  const modelFor = (combination: CombinationDefinition) => catalog?.models.find(model =>
    model.ref.provider === combination.modelRef.provider && model.ref.model === combination.modelRef.model)
  const harnessFor = (combination: CombinationDefinition) => catalog?.harnesses.find(harness => harness.id === combination.harnessRef)
  const visibleChoices = useMemo<Choice[]>(() => {
    if (!catalog) return []
    const seen = new Set<string>()
    return catalog.combinations.filter(combination => combination.enabled).filter(combination => {
      const status = availability?.combinations.find(item => item.id === combination.id)
      return status?.available === true || combination.id === selection.combination
    }).sort((left, right) => Number(!left.isDefault) - Number(!right.isDefault) || left.name.localeCompare(right.name)).filter(combination => {
      const model = modelFor(combination); const harness = harnessFor(combination)
      const label = `${sourceLabel(combination.modelRef.provider, model?.source ?? combination.modelRef.provider)} · ${model?.name ?? combination.modelRef.model} · ${harness?.name ?? combination.harnessRef}`
      if (seen.has(label)) return false
      seen.add(label); return true
    }).map(combination => {
      const model = modelFor(combination); const harness = harnessFor(combination)
      return { combination, modelName: model?.name ?? combination.modelRef.model, harnessName: harness?.name ?? combination.harnessRef, source: sourceLabel(combination.modelRef.provider, model?.source ?? combination.modelRef.provider) }
    })
  }, [availability, catalog, selection.combination])

  const selected = visibleChoices.find(choice => choice.combination.id === selection.combination) ?? visibleChoices.find(choice => selection.current
    && choice.combination.harnessRef === 'dsh' && choice.combination.modelRef.provider === selection.current.provider && choice.combination.modelRef.model === selection.current.model) ?? visibleChoices.find(choice => choice.combination.isDefault) ?? visibleChoices[0]
  const currentModel = selection.current ? selection.groups.find(group => group.id === selection.current?.provider)?.models.find(model => model.id === selection.current?.model) : undefined
  const reasoning = currentModel?.reasoning
  const effectiveEffort = selection.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = effectiveEffort === undefined ? undefined : reasoning?.efforts.find(effort => effort.id === effectiveEffort)?.name ?? effectiveEffort
  const modelLabel = selected ? choiceLabel(selected) : currentModel?.name ?? selection.current?.model ?? '请选择模型'
  const effortChoices = reasoning === undefined ? [] : [...(reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: '默认' }] : []), ...reasoning.efforts.map(effort => ({ key: `effort:${effort.id}`, effort: effort.id, label: effort.name }))]

  const close = (restoreFocus = false) => { setOpen(false); setPane('root'); if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus()) }
  const show = () => {
    if (open) { close(true); return }
    focusIntent.current = selection.current === null ? 'drill' : null; setPane(selection.current === null ? 'model' : 'root'); setOpen(true); setError(''); void load()
  }
  const drill = (next: 'model' | 'effort') => { focusIntent.current = 'drill'; setPane(next) }
  const back = (from: 'model' | 'effort') => { focusIntent.current = from; setPane('root') }

  const selectChoice = async (choice: Choice) => {
    if (busy) return
    if (choice.combination.id === selection.combination) { close(true); return }
    setBusy(true); setError('')
    try {
      const result = await call<{ kind: string; sessionId: string }>('select-combination', { sessionId, combination: choice.combination.id })
      if (result.kind === 'external') { setSelection(current => ({ ...current, combination: choice.combination.id })); close(true); openExternal(result.sessionId) }
      else { setSelection(await call<SelectionState>('model-selection', { sessionId })); close(true) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '选择失败') } finally { setBusy(false) }
  }
  const selectEffort = async (effort: string | undefined) => {
    if (!selection.current || busy) return
    if (effectiveEffort === effort) { close(true); return }
    setBusy(true); setError('')
    try {
      const { reasoningEffort: _ignored, ...base } = selection.current
      await call('select-effort', { sessionId, ...base, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
      setSelection(await call<SelectionState>('model-selection', { sessionId })); close(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '切换推理强度失败') } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => { if (rootRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) return; close() }
    document.addEventListener('mousedown', onPointerDown); return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])
  useEffect(() => {
    if (!open || focusIntent.current === null) return
    const intent = focusIntent.current; focusIntent.current = null
    if (intent === 'drill') { (menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])') as HTMLElement | null ?? itemRefs.current.find(item => item !== null && !item.disabled) ?? triggerRef.current)?.focus(); return }
    const target = itemRefs.current[intent === 'effort' ? 1 : 0]; (target !== null && target !== undefined && !target.disabled ? target : triggerRef.current)?.focus()
  }, [open, pane])
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
    const place = () => { const rect = triggerRef.current?.getBoundingClientRect(); if (!rect) return; const width = menuRef.current?.offsetWidth ?? 0; const height = menuRef.current?.offsetHeight ?? 0; setMenuPos({ left: Math.min(Math.max(rect.right - width, 12), window.innerWidth - width - 12), top: Math.min(Math.max(rect.top - 8 - height, 12), window.innerHeight - height - 12) }) }
    place(); window.addEventListener('scroll', place, true); window.addEventListener('resize', place); return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, pane, visibleChoices.length, error])

  const moveFocus = (offset: number) => { const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null && !item.disabled); if (items.length === 0) return; const currentIndex = items.findIndex(item => item === document.activeElement); items[currentIndex < 0 ? offset > 0 ? 0 : items.length - 1 : (currentIndex + offset + items.length) % items.length]?.focus() }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.key === 'Escape') { event.preventDefault(); if (pane !== 'root' && selection.current !== null) back(pane); else close(true); return }
    if (event.key === 'Tab') { event.preventDefault(); if (event.shiftKey) { if (pane !== 'root' && selection.current !== null) back(pane); else close(true); return }; const focused = document.activeElement; if (focused instanceof HTMLButtonElement && itemRefs.current.includes(focused)) focused.click(); else (menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])') as HTMLElement | null ?? itemRefs.current.find(item => item !== null && !item.disabled))?.focus(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveFocus(event.key === 'ArrowDown' ? 1 : -1) }
  }

  if (!available) return null
  itemRefs.current = []; let itemIndex = 0; const itemRef = () => { const index = itemIndex++; return (node: HTMLButtonElement | null) => { itemRefs.current[index] = node } }
  const grouped = new Map<string, Choice[]>(); for (const choice of visibleChoices) grouped.set(choice.source, [...(grouped.get(choice.source) ?? []), choice])

  return <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
    <button ref={triggerRef} type='button' className={css.trigger} aria-label={`选择模型，当前 ${modelLabel}${effortLabel ? `，推理强度 ${effortLabel}` : ''}`} aria-haspopup='menu' aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} title={modelLabel} aria-busy={busy} disabled={locked} onClick={show}>
      <span className={css.triggerLabel}>{modelLabel}</span>{effortLabel && <span className={css.triggerEffort}>{effortLabel}</span>}{busy ? <StateDot state='ongoing' /> : <IconChevronDownOutlineRegular className={`${css.chevron} ${open ? css.chevronOpen : ''}`} />}
    </button>
    {open && createPortal(<MenuSurface ref={menuRef} id={`${id}-menu`} className={css.menu} style={menuPos ?? measureStyle} role='menu' aria-label='模型与推理强度'>
      {pane === 'root' && <><button ref={itemRef()} type='button' role='menuitem' className={css.cell} onClick={() => drill('model')}><span className={css.cellLabel}>模型</span><span className={css.cellValue}>{modelLabel}</span><IconChevronRightOutlineRegular className={css.cellChevron} /></button>{reasoning !== undefined && <button ref={itemRef()} type='button' role='menuitem' className={css.cell} onClick={() => drill('effort')}><span className={css.cellLabel}>推理强度</span><span className={css.cellValue}>{effortLabel ?? '默认'}</span><IconChevronRightOutlineRegular className={css.cellChevron} /></button>}</>}
      {pane === 'model' && <>{error && <div className={css.error} role='alert'>{error}</div>}<div className={`${css.groups} scrollable`}>{[...grouped].map(([source, choices]) => <section key={source} className={css.group} role='group' aria-label={source}><div className={css.groupTitle}>{source}</div>{choices.map(choice => { const selectedChoice = selected?.combination.id === choice.combination.id; const status = availability?.combinations.find(item => item.id === choice.combination.id); return <button key={choice.combination.id} ref={itemRef()} type='button' role='menuitemradio' aria-checked={selectedChoice} className={`${css.option} ${selectedChoice ? css.selected : ''}`} disabled={busy || status?.available === false && choice.combination.id !== selection.combination} title={`${source} · ${choiceLabel(choice)}`} onClick={() => void selectChoice(choice)}><span className={css.optionCopy}><span className={css.modelName}>{choiceLabel(choice)}</span></span><span className={css.check}>{busy && selection.combination === choice.combination.id ? <StateDot state='ongoing' /> : selectedChoice ? <IconCheckOutlineRegular /> : null}</span></button> })}</section>)}{visibleChoices.length === 0 && <div className={css.empty}>当前没有可用的模型组合</div>}</div></>}
      {pane === 'effort' && <>{error && <div className={css.error} role='alert'>{error}</div>}{effortChoices.length === 0 ? <div className={css.empty}>当前模型未提供推理强度</div> : effortChoices.map(level => { const checked = effectiveEffort === level.effort; return <button key={level.key} ref={itemRef()} type='button' role='menuitemradio' aria-checked={checked} className={`${css.option} ${checked ? css.selected : ''}`} disabled={busy} onClick={() => void selectEffort(level.effort)}><span className={css.optionCopy}><span className={css.modelName}>{level.label}</span></span><span className={css.check}>{checked ? <IconCheckOutlineRegular /> : null}</span></button> })}</>}
    </MenuSurface>, document.body)}
    {error && !open && <span role='alert' className={css.errorInline}>{error}</span>}
  </div>
}
