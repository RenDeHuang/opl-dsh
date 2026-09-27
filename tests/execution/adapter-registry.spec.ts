import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adapterFor, defaultHarness } from '../../src/execution/host/adapters/index.ts'
import type { HarnessSession } from '../../src/execution/contracts/sessions.ts'
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('official Harness adapter registry', () => {
  it('matches supported model and executable pairs without falling back to a different runtime', () => {
    const gpt = { provider: 'opl-gateway', model: 'codex::gpt-current' }
    const claude = { provider: 'opl-gateway', model: 'aws::claude-sonnet-current' }
    expect(adapterFor('codex', gpt)?.id).toBe('codex')
    expect(adapterFor('codex', claude)).toBeUndefined()
    expect(adapterFor('antigravity', gpt)).toBeUndefined()
    expect(defaultHarness(gpt)).toBe('codex')
    expect(defaultHarness(claude)).toBe('claude')
    expect(defaultHarness({ provider: 'custom', model: 'gpt-current' })).toBe('dsh')
  })

  it('keeps selected-channel credentials and per-session homes inside the chosen native process', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opl-adapter-'))
    roots.push(home)
    vi.stubEnv('OPENAI_API_KEY', 'must-not-inherit')
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-inherit')
    vi.stubEnv('OPL_GATEWAY_GROK_API_KEY', 'must-not-inherit')
    const resolve = vi.fn(async (ref: string) => ({ value: `test-${ref}` }))
    const ctx = { get: () => undefined, credentials: { resolve } } as unknown as Context
    const options = {
      home,
      command: process.execPath,
      grokCommand: process.execPath,
      nativeBridgePath: '/owned/native-harness-bridge.mjs',
    }
    const record = {
      id: 'one',
      cwd: home,
      sandbox: 'read-only',
      harnessRef: 'codex',
      modelRef: { provider: 'opl-gateway', model: 'codex::gpt-current' },
    } as HarnessSession
    const codex = await adapterFor('codex', record.modelRef)!.prepare!(ctx, record, options)
    expect(codex.command).toBe(process.execPath)
    expect(codex.args).toEqual([options.nativeBridgePath])
    expect(codex.env.OPL_NATIVE_COMMAND).toBe(process.execPath)
    expect(codex.env.OPL_NATIVE_PERMISSION).toBe('read-only')
    expect(codex.env.CODEX_HOME).toBe(join(home, 'harnesses/codex/one'))
    expect(codex.env.OPENAI_API_KEY).toBeUndefined()
    expect(codex.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(codex.env.OPL_GATEWAY_GROK_API_KEY).toBeUndefined()
    expect(resolve).toHaveBeenLastCalledWith('OPL_GATEWAY_CODEX_API_KEY')
    const claudeRecord = {
      ...record,
      harnessRef: 'claude',
      modelRef: { provider: 'opl-gateway', model: 'aws::claude-sonnet-current' },
    }
    const claude = await adapterFor('claude', claudeRecord.modelRef)!.prepare!(
      ctx,
      claudeRecord,
      options,
    )
    expect(resolve).toHaveBeenLastCalledWith('OPL_GATEWAY_AWS_API_KEY')
    expect(claude.env.CLAUDE_CONFIG_DIR).toBe(join(home, 'harnesses/claude/one'))
    expect(claude.env.ANTHROPIC_API_KEY).toBe(claude.env.OPL_NATIVE_API_KEY)
    expect(claude.env.CODEX_HOME).toBeUndefined()
    expect(claude.env.ANTHROPIC_BASE_URL).not.toMatch(/\/v1\/?$/)
  })
})
