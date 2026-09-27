import { installExternalCodex } from '../collaboration/host/external-codex.ts'
import { installLegacyHarnessChannel } from '../compat/host/legacy-channel.ts'
import { ExecutionService } from '../execution/host/service.ts'
/** Add waiting to the official Session RPC surface without replacing its controller. */
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { installSessionWaitProjection } from '../execution/host/session-wait.ts'
import { createHarnessService } from '../execution/host/harness.ts'
import { installCollaborationTools } from '../collaboration/host/tools.ts'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

export const inject = [
  'llm',
  'typertGateway',
  'sessions',
  'agents',
  'sessionProjections',
  'connection',
  'webServer',
  'settings',
  'credentials',
  'agentDefaultModel',
  'workspaceRegistry',
]
/** Keep admission, model selection, tools and permissions in the official Host.
 * @param ctx - Official Host context.
 */
export function apply(ctx: Context, _config: Record<string, never>): void {
  const harness = createHarnessService(ctx)
  ctx.on('llm/stream', (options, next) => harness.conversationStream(options, next))
  new ExecutionService(ctx, harness)
  ctx.effect(() => () => harness.dispose())
  installCollaborationTools(ctx, harness)
  installLegacyHarnessChannel(ctx)
  installSessionWaitProjection(ctx)
  installExternalCodex(ctx, harness)
}
