import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { HarnessSession } from '../../contracts/sessions.ts'
import type { HarnessAdapter } from './types.ts'
export const dshAdapter: HarnessAdapter = {
  id: 'dsh',
  transport: 'dsh',
  matches: () => true,
  available: async () => ({ available: true }),
}
/** Adopt/create via the official session API; the host remains the agent-loop owner. */
export async function connectDsh(
  ctx: Context,
  record: HarnessSession,
  persist: () => Promise<void>,
): Promise<void> {
  const native = (method: string, request: object) =>
    ctx.typertGateway.invoke({ namespace: 'session', method, args: { request } })
  const id = record.acpSessionId || `session-${record.id}`,
    isNew = !record.acpSessionId
  const workspace = await ctx.workspaceRegistry.create(record.cwd)
  await native('create', { sessionId: id, workspaceId: workspace.id })
  record.acpSessionId = id
  await persist()
  await native('selectModel', { sessionId: id, ...record.modelRef })
  const session = ctx.sessions.get(id as SessionId)
  if (!session) throw Error('DSH 子会话未创建')
  setSandboxMode(session, record.sandbox === 'read-only' ? 'read-only' : 'workspace-write')
  setApprovalPolicy(session, 'ask')
  if (isNew) await native('rename', { sessionId: id, title: record.title + ' · 组合协作' })
}
