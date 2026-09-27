import type { Context } from '@deepseek-ai/cordis'
import { CoordinationSection } from './CoordinationSection.tsx'
import { remoteCall, optionalRemote } from '../../shared/client/remote-call.ts'
export const inject = ['slots', 'remote.oplCoordination']
export function apply(ctx: Context): void {
  const call = remoteCall(ctx.remote.oplCoordination)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'opl-codex',
        order: 13,
        label: () => '协作与自动化',
        inject: () => {
          // Optional execution settings must not block Skill/install settings.
          const execution = optionalRemote(ctx, 'oplExecution')
          return { call, ...(execution ? { executionCall: remoteCall(execution) } : {}) }
        },
      },
      CoordinationSection,
    ),
  )
}
