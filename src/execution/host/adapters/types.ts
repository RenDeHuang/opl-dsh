import type { Context } from '@deepseek-ai/cordis'
import type { HarnessSession } from '../../contracts/sessions.ts'
import type { ModelRef } from '../../contracts/catalog.ts'
export interface AdapterOptions {
  home: string
  command?: string
  prefix?: string[]
  resolveKey?: () => Promise<string | undefined>
  grokCommand: string
  nativeBridgePath: string
}
export interface AdapterLaunch {
  home: string
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}
export interface HarnessAdapter {
  id: string
  transport: 'dsh' | 'acp'
  matches(ref: ModelRef): boolean
  available(ctx: Context, options: AdapterOptions): Promise<{ available: boolean; reason?: string }>
  prepare?(ctx: Context, record: HarnessSession, options: AdapterOptions): Promise<AdapterLaunch>
}
