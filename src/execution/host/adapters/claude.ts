import { nativeAvailable, prepareNative } from './native.ts'
import type { HarnessAdapter } from './types.ts'
export const claudeAdapter: HarnessAdapter = {
  id: 'claude',
  transport: 'acp',
  matches: (ref) => ref.provider === 'opl-gateway' && /^(aws|kiro)::claude-/.test(ref.model),
  available: (_ctx, options) => nativeAvailable('Claude Code', 'claude', options),
  prepare: (ctx, record, options) =>
    prepareNative(ctx, record, options, (home, base, key) => ({
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_API_KEY: key,
      ANTHROPIC_BASE_URL: base.replace(/\/v1\/?$/, ''),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    })),
}
