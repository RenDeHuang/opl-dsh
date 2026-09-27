/** One browser package, independently mounted feature lifecycles. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import remote from '../generated/remote.mjs'
import * as gateway from '../gateway/client/index.tsx'
import * as execution from '../execution/client/index.tsx'
import * as collaboration from '../collaboration/client/index.tsx'
import * as setup from '../setup/client/index.tsx'
export const inject = ['remote', 'slots', 'locale']
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(remote)
  ctx.effect(() => dispose)
  let openModels: (() => void) | undefined
  ctx.plugin(gateway, { openModels: () => openModels?.() })
  ctx.plugin(execution)
  ctx.plugin(collaboration)
  ctx.plugin(setup, {
    bindModelNavigation: (navigate: (() => void) | undefined) => {
      openModels = navigate
    },
  })
}
