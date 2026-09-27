import { nativeAvailable, prepareNative } from './native.ts'
import type { HarnessAdapter } from './types.ts'
export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  transport: 'acp',
  matches: (ref) => ref.provider === 'opl-gateway' && ref.model.startsWith('codex::gpt-'),
  available: (_ctx, options) => nativeAvailable('Codex CLI', 'codex', options),
  prepare: (ctx, record, options) =>
    prepareNative(ctx, record, options, (home) => ({ CODEX_HOME: home })),
}
