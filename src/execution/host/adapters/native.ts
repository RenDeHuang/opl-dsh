import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveGatewayExecution } from '../../../gateway/host/execution-access.ts'
import { executablePath } from '../harness-registry.ts'
import type { HarnessSession } from '../../contracts/sessions.ts'
import type { AdapterOptions, AdapterLaunch } from './types.ts'
import { systemEnvironment } from './environment.ts'
export async function nativeAvailable(name: string, id: string, options: AdapterOptions) {
  return (await executablePath(options.command || id))
    ? { available: true }
    : { available: false, reason: `未找到官方 ${name}，请在 Harness 页检查安装` }
}
export async function prepareNative(
  ctx: Context,
  record: HarnessSession,
  options: AdapterOptions,
  environment: (home: string, base: string, key: string) => NodeJS.ProcessEnv,
): Promise<AdapterLaunch> {
  const route = await resolveGatewayExecution(ctx, record.modelRef)
  const command = await executablePath(options.command || record.harnessRef)
  if (!command) throw Error('未找到官方 Harness 程序')
  const key = route.apiKey
  const home = join(options.home, 'harnesses', record.harnessRef, record.id)
  await mkdir(home, { recursive: true, mode: 0o700 })
  const base = route.baseURL
  return {
    home,
    command: process.execPath,
    args: [options.nativeBridgePath],
    env: {
      ...systemEnvironment(),
      ELECTRON_RUN_AS_NODE: '1',
      OPL_NATIVE_HARNESS: record.harnessRef,
      OPL_NATIVE_COMMAND: command,
      OPL_NATIVE_MODEL: route.model,
      OPL_NATIVE_PERMISSION: record.sandbox,
      OPL_NATIVE_BASE_URL: base,
      OPL_NATIVE_API_KEY: key,
      ...environment(home, base, key),
    },
  }
}
