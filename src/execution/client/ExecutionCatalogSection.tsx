import { useExecutionCatalog } from './use-execution-catalog.ts'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { displayModelSource, selectableModels, modelRefKey } from '../contracts/catalog.ts'
import css from '../../shared/client/SettingsSection.module.css'
import type { ExecutionCall as Call } from '../../shared/client/remote-call.ts'
export function ExecutionCatalogSection({ call }: { call: Call }) {
  const { catalog, availability, busy, notice, draft, setDraft, editing, setEditing, update, add } =
    useExecutionCatalog(call)
  return (
    <div className={css.section} data-opl-panel="catalog" aria-busy={busy || (!catalog && !notice)}>
      <h2 className={css.title}>运行配置</h2>
      <p className={css.intro}>
        保存模型、渠道、Harness 与权限的搭配。原生 DSH 组合会出现在官方会话输入框；外部 Harness
        组合由当前对话的委派工具使用，任务和交付由后台保存。模型在“模型”页管理，账号与凭据在“OPL
        Gateway”中管理。
      </p>
      {!catalog && !notice && (
        <p className={css.muted} role="status">
          正在加载组合…
        </p>
      )}
      {notice && (
        <p role={catalog ? 'status' : 'alert'} className={css.notice}>
          {notice}
        </p>
      )}
      {catalog && (
        <details className={css.details}>
          <summary>添加运行配置</summary>
          <div className={css.detailsBody}>
            <label className={css.field}>
              名称
              <input
                className={css.input}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className={css.field}>
              模型
              <select
                className={css.input}
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              >
                <option value="">选择模型</option>
                {selectableModels(catalog.models).map((model) => (
                  <option key={modelRefKey(model.ref)} value={modelRefKey(model.ref)}>
                    {displayModelSource(model.ref, model.source)} · {model.name}
                    {model.available ? '' : ' · 未就绪'}
                  </option>
                ))}
              </select>
            </label>
            <label className={css.field}>
              Harness
              <select
                className={css.input}
                value={draft.harness}
                onChange={(e) => setDraft({ ...draft, harness: e.target.value })}
              >
                {catalog.harnesses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy || !draft.name.trim() || !draft.model}
              onClick={() => void add()}
            >
              保存运行配置
            </Button>
          </div>
        </details>
      )}
      {catalog?.combinations.map((item) => {
        const model = catalog.models.find((x) => modelRefKey(x.ref) === modelRefKey(item.modelRef)),
          harness = catalog.harnesses.find((x) => x.id === item.harnessRef)
        const status = availability.find((c) => c.id === item.id)
        return (
          <details
            className={css.card}
            key={item.id}
            open={editing === item.id}
            onToggle={(event) => {
              const open = event.currentTarget.open
              setEditing((current) => (open ? item.id : current === item.id ? undefined : current))
            }}
          >
            <summary className={css.header}>
              <span className={css.identity}>
                <strong>{item.name}</strong>
                {item.isDefault && item.enabled && (
                  <span className={css.muted}>此模型的默认运行配置</span>
                )}
                <span className={css.muted}>
                  {displayModelSource(item.modelRef, model?.source)} ·{' '}
                  {model?.name ?? item.modelRef.model} · {harness?.name ?? item.harnessRef}
                </span>
              </span>
              <span className={css.row}>
                <span className={css.muted}>
                  {!item.enabled
                    ? '已停用'
                    : status?.available
                      ? '可执行'
                      : (status?.reason ?? model?.reason ?? '尚未验证')}
                </span>
                <Switch
                  label={`启用 ${item.name}`}
                  disabled={busy}
                  checked={item.enabled}
                  onChange={(enabled) => update(item.id, { enabled })}
                />
              </span>
            </summary>
            <div className={css.detailsBody}>
              <label className={css.field}>
                配置名称
                <input
                  className={css.input}
                  defaultValue={item.name}
                  disabled={busy}
                  onBlur={(e) => {
                    if (e.target.value !== item.name) update(item.id, { name: e.target.value })
                  }}
                />
              </label>
              <div className={css.row}>
                <Switch
                  label="作为此模型的默认运行配置"
                  disabled={busy || !item.enabled}
                  checked={item.isDefault}
                  onChange={(isDefault) => update(item.id, { isDefault })}
                />
                <span className={css.muted}>默认运行配置</span>
              </div>
              <label className={css.field}>
                权限
                <select
                  className={css.input}
                  value={item.permissionPolicy}
                  disabled={busy}
                  onChange={(e) =>
                    update(item.id, {
                      permissionPolicy: e.target.value as 'workspace' | 'read-only',
                    })
                  }
                >
                  <option value="read-only">只读</option>
                  <option value="workspace">工作区内修改（仍需 Harness 授权）</option>
                </select>
              </label>
            </div>
          </details>
        )
      })}
    </div>
  )
}
