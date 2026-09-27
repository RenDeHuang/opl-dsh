import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, copyFile, constants } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { DSH_COMBINATION, GROK_COMBINATION, type HarnessCatalog } from '../contracts/sessions.ts'
import {
  displayModelSource,
  modelRefKey,
  type ExecutionCatalog,
  type ModelRef,
} from '../contracts/catalog.ts'
export type { ExecutionCatalog } from '../contracts/catalog.ts'
export const defaultExecutionCatalog = (): ExecutionCatalog => ({
  version: 2,
  models: [],
  harnesses: [
    { id: 'dsh', name: 'DSH', kind: 'dsh', adapter: 'native-session' },
    { id: 'codex', name: 'Codex CLI', kind: 'acp', command: 'codex' },
    { id: 'claude', name: 'Claude Code', kind: 'acp', command: 'claude' },
    { id: 'grok-build', name: 'Grok Build', kind: 'grok-build', adapter: 'acp-v1' },
    { id: 'antigravity', name: 'Antigravity CLI', kind: 'acp', command: 'agy' },
  ],
  combinations: [
    {
      id: DSH_COMBINATION,
      name: 'DeepSeek-V4.1-Flash + DSH',
      modelRef: { provider: 'opl-gateway', model: 'deepseek-flash' },
      harnessRef: 'dsh',
      permissionPolicy: 'workspace',
      isDefault: true,
      enabled: true,
    },
    {
      id: GROK_COMBINATION,
      name: 'Grok + Grok Build',
      modelRef: { provider: 'opl-gateway', model: 'grok::grok-4.7' },
      harnessRef: 'grok-build',
      permissionPolicy: 'workspace',
      isDefault: true,
      enabled: true,
    },
  ],
})
const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw Error(`${field} 无效`)
  return value.trim()
}
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
/** Retain legacy choices while removing the competing connection reference. */
export function normalizeCatalog(value: unknown): ExecutionCatalog {
  const input = record(value)
  if (!Array.isArray(input.harnesses) || !Array.isArray(input.combinations))
    throw Error('组合目录格式无效')
  const harnesses = input.harnesses.map((raw) => {
    const x = record(raw)
    if (x.kind === 'dsh' && x.id !== 'dsh') throw Error('内置 DSH 的身份不能修改')
    if (!['dsh', 'grok-build', 'acp'].includes(x.kind)) throw Error('Harness 类型无效')
    return {
      id: text(x.id, 'Harness ID'),
      name: text(x.name, 'Harness 名称'),
      kind: x.kind,
      ...(x.command ? { command: text(x.command, '可执行文件') } : {}),
      ...(x.adapter ? { adapter: text(x.adapter, '适配器') } : {}),
    }
  })
  if (!harnesses.some((x) => x.id === 'dsh' && x.kind === 'dsh')) throw Error('不能移除内置 DSH')
  for (const builtin of defaultExecutionCatalog().harnesses)
    if (!harnesses.some((item) => item.id === builtin.id)) harnesses.push(builtin)
  const harnessOrder = new Map(
    defaultExecutionCatalog().harnesses.map((item, index) => [item.id, index]),
  )
  harnesses.sort(
    (left, right) =>
      (harnessOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (harnessOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  )
  const combinations = input.combinations
    .filter((raw: any) => raw.generated !== true)
    .map((raw) => {
      const x = record(raw)
      let modelRef: ModelRef
      if (input.version === 2)
        modelRef = {
          provider: text(x.modelRef?.provider, '模型来源'),
          model: text(x.modelRef?.model, '模型 ID'),
        }
      else {
        const model = input.models?.find((model: any) => model.id === x.modelId)
        if (!model) throw Error('组合引用不存在的模型')
        if (x.connectionId && x.connectionId !== model.connectionId)
          throw Error('旧组合的模型和连接不一致，原文件已保留，请先处理冲突')
        modelRef = {
          provider: model.connectionId,
          model:
            model.connectionId === 'opl-gateway' && model.routeId && model.routeId !== 'deepseek'
              ? `${model.routeId}::${model.modelId}`
              : model.modelId,
        }
      }
      const harnessRef = text(x.harnessRef ?? x.harnessId, 'Harness 引用'),
        permissionPolicy = x.permissionPolicy ?? x.sandbox
      if (!harnesses.some((h) => h.id === harnessRef)) throw Error('组合引用不存在的 Harness')
      if (!['read-only', 'workspace'].includes(permissionPolicy)) throw Error('组合权限无效')
      return {
        id: text(x.id, '组合 ID'),
        name: text(x.name, '组合名称'),
        modelRef,
        harnessRef,
        permissionPolicy,
        isDefault: x.isDefault === true,
        enabled: x.enabled !== false,
      }
    })
  if (input.version !== 2)
    for (const item of combinations)
      if (
        item.enabled &&
        !combinations.some(
          (other) =>
            other.enabled &&
            other.isDefault &&
            modelRefKey(other.modelRef) === modelRefKey(item.modelRef),
        )
      )
        item.isDefault = true
  for (const items of [harnesses, combinations])
    if (new Set(items.map((x) => x.id)).size !== items.length) throw Error('目录 ID 重复')
  const defaults = combinations
    .filter((x) => x.isDefault && x.enabled)
    .map((x) => modelRefKey(x.modelRef))
  if (new Set(defaults).size !== defaults.length) throw Error('每个模型只能有一个默认组合')
  return { version: 2, models: [], harnesses, combinations }
}
export class ExecutionCatalogStore {
  readonly filename: string
  private value = defaultExecutionCatalog()
  private ready: Promise<void>
  private queue: Promise<void> = Promise.resolve()
  constructor(home = dshHomePath()) {
    this.filename = join(home, 'profiles/desktop/execution-catalog.json')
    this.ready = this.load()
  }
  private async load() {
    let raw: string
    try {
      raw = await readFile(this.filename, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    const parsed = JSON.parse(raw)
    this.value = normalizeCatalog(parsed)
    const harnessOrderChanged =
      Array.isArray(parsed.harnesses) &&
      parsed.harnesses.map((item: any) => item?.id).join('\0') !==
        this.value.harnesses.map((item) => item.id).join('\0')
    if (parsed.version !== 2 || harnessOrderChanged) {
      if (parsed.version !== 2)
        await copyFile(this.filename, this.filename + '.v1.backup', constants.COPYFILE_EXCL).catch(
          (e: NodeJS.ErrnoException) => {
            if (e.code !== 'EEXIST') throw e
          },
        )
      // Preserve old model declarations in the backup; live models now come from DSH.
      await this.persist(this.value)
    }
  }
  private async persist(value: ExecutionCatalog) {
    const { models: _, ...saved } = value
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    const temp = this.filename + '.' + randomUUID()
    await writeFile(temp, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 })
    await rename(temp, this.filename)
  }
  async get() {
    await this.ready
    return structuredClone(this.value)
  }
  async set(input: unknown) {
    await this.ready
    const value = normalizeCatalog(input)
    const write = this.queue.then(async () => {
      await this.persist(value)
      this.value = value
    })
    this.queue = write.catch(() => {})
    await write
    return structuredClone(value)
  }
  async dispose() {
    await this.queue
  }
}
export function catalogView(
  catalog: ExecutionCatalog,
  availability: Map<string, { available: boolean; reason?: string }>,
): HarnessCatalog['combinations'] {
  return catalog.combinations
    .filter((x) => x.enabled)
    .map((x) => {
      const model = catalog.models.find((m) => modelRefKey(m.ref) === modelRefKey(x.modelRef)),
        harness = catalog.harnesses.find((h) => h.id === x.harnessRef)!
      const status = availability.get(x.id) ?? {
        available: false,
        reason: '尚未安装对应 Harness 适配器',
      }
      return {
        id: x.id,
        name: x.name,
        model: model?.name ?? x.modelRef.model,
        modelId: x.modelRef.model,
        harness: harness.name,
        source: displayModelSource(x.modelRef, model?.source),
        ...status,
      }
    })
}
