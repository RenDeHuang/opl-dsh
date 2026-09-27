import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CombinationSelect } from './CombinationSelect.tsx'
import { HarnessSettings } from './HarnessSettings.tsx'
import { ExecutionCatalogSection } from './ExecutionCatalogSection.tsx'
import { remoteCall } from '../../shared/client/remote-call.ts'
export const inject = ['slots', 'sessions', 'remote.oplExecution']
export function apply(ctx: Context): void {
  const call = remoteCall(ctx.remote.oplExecution)
  ctx.slots.inject('conversation.input.model', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.model',
        priority: -10,
        inject: (sessionId) => ({
          call,
          sessionId,
          available: ctx.sessions.subagentAddress(sessionId as SessionId) === undefined,
        }),
      },
      CombinationSelect,
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
