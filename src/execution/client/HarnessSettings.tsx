import { useHarnessSettings } from './use-harness-settings.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../../shared/client/SettingsSection.module.css'
import type { ExecutionCall as Call } from '../../shared/client/remote-call.ts'
export function HarnessSettings({ call }: { call: Call }) {
  const { draft, setDraft, items, error, busy, load, update, savePath, register } =
    useHarnessSettings(call)
  return (
    <div className={css.section} data-opl-panel="execution-settings" aria-busy={busy}>
      <div className={css.header}>
        <h2 className={css.title}>Harness</h2>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? '检测中…' : '重新检测'}
        </Button>
      </div>
      <p className={css.intro}>
        查看本机已安装的执行程序、版本和官方更新入口。可用的模型 + Harness
        组合在“运行配置”页中管理。
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && !items.length && (
        <p className={css.muted} role="status">
          正在检测本机执行程序…
        </p>
      )}
      {items.map((item) => (
        <div className={css.card} key={item.id}>
          <div className={css.header}>
            <span className={css.identity}>
              <strong>{item.name}</strong>
              <span className={css.muted}>
                {item.version ?? (item.installed ? '版本未检测' : '尚未安装')}
              </span>
            </span>
            <span>{item.installed ? '已安装' : '未安装'}</span>
          </div>
          {item.error && <p className={css.muted}>{item.error}</p>}
          {item.installed && (
            <p className={css.muted}>
              {item.runnable ? '可用于对话组合' : '可在本机终端使用；暂不能用于对话组合'}
            </p>
          )}
          {item.path && (
            <p className={css.muted}>
              检测路径：{item.path}
              {item.detectedBy === 'known-path'
                ? '（已从常见安装目录发现）'
                : item.detectedBy === 'shell-path'
                  ? '（来自登录 Shell PATH）'
                  : item.detectedBy === 'configured-path'
                    ? '（来自运行配置）'
                    : ''}
            </p>
          )}
          {item.website && (
            <a href={item.website} target="_blank" rel="noreferrer">
              官方安装与更新
            </a>
          )}
          {item.maintenanceAction && (
            <Button
              variant="outline"
              disabled={busy || item.maintenance?.state === 'running'}
              onClick={() => void update(item.id)}
            >
              {item.maintenance?.state === 'running'
                ? '正在安装或更新…'
                : item.maintenanceAction === 'install'
                  ? '安装最新版'
                  : '检查并更新'}
            </Button>
          )}
          {item.maintenance && (
            <div role="status">
              <p>
                {item.maintenance.state === 'running'
                  ? '正在使用官方更新器，请保持应用运行。'
                  : item.maintenance.state === 'completed'
                    ? '已完成，版本已重新检测。'
                    : '未完成，可重新检测或重试。'}
              </p>
              <details>
                <summary>更新详情</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.maintenance.message}
                </pre>
              </details>
            </div>
          )}
          {item.id !== 'dsh' && (
            <details>
              <summary>可执行文件路径</summary>
              <input
                className={css.input}
                defaultValue={item.path ?? ''}
                placeholder="绝对路径或 PATH 中的命令"
                disabled={busy}
                onBlur={(e) => {
                  const command = e.target.value.trim()
                  if (command !== item.path) void savePath(item.id, command)
                }}
              />
            </details>
          )}
        </div>
      ))}
      <details className={css.details}>
        <summary>登记其他 Harness</summary>
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
            可执行文件
            <input
              className={css.input}
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            />
          </label>
          <p className={css.muted}>
            可登记并检测本机程序。登记仅用于发现程序和查看路径，不会自动增加对话执行能力。
          </p>
          <Button
            disabled={busy || !draft.name.trim() || !draft.command.trim()}
            onClick={() => void register()}
          >
            登记 Harness
          </Button>
        </div>
      </details>
    </div>
  )
}
