import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CollaborationTasks } from '../../collaboration/client/CollaborationTasks.tsx'
import { CombinationSelect } from './CombinationSelect.tsx'
import { HarnessPanel } from './HarnessPanel.tsx'
import { HarnessSettings } from './HarnessSettings.tsx'
import { ExecutionCatalogSection } from './ExecutionCatalogSection.tsx'
import { remoteCall } from '../../shared/client/remote-call.ts'
export const inject = ['slots', 'layout', 'sessions', 'remote.oplExecution']
export function apply(ctx: Context): void {
  const call = remoteCall(ctx.remote.oplExecution)
  let externalSession: string | undefined
  ctx.slots.inject('conversation.input.model', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.model',
        priority: -10,
        inject: (sessionId) => ({
          call,
          sessionId,
          available: ctx.sessions.subagentAddress(sessionId as SessionId) === undefined,
          openExternal: (id: string) => {
            externalSession = id
            ctx.layout.selectPanel('opl-harness' as MainPanelId)
          },
        }),
      },
      CombinationSelect,
    ),
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'opl-collaboration-tasks',
        inject: (sessionId) => ({
          call,
          origin: { kind: 'dsh' as const, sessionId },
          open: (id: string) => {
            externalSession = id
            ctx.layout.selectPanel('opl-harness' as MainPanelId)
          },
        }),
      },
      CollaborationTasks,
    ),
  )
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: 'opl-harness',
        inject: () => ({
          call,
          close: () => ctx.layout.selectPanel(null),
          ...(externalSession ? { initialSession: externalSession } : {}),
        }),
      },
      HarnessPanel,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'opl-harness-settings',
        order: 11,
        label: () => 'Harness',
        inject: () => ({ call }),
      },
      HarnessSettings,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'opl-execution',
        order: 12,
        label: () => '运行配置',
        inject: () => ({ call }),
      },
      ExecutionCatalogSection,
    ),
  )
}
