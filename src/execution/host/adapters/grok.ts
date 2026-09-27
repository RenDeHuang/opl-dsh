import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GROK_API_KEY_REF } from '../../../gateway/host/config.ts'
import { OPL_GATEWAY_INFERENCE_BASE_URL } from '../../../gateway/host/opl-credentials.ts'
import { resolveGatewayExecution } from '../../../gateway/host/execution-access.ts'
import { executablePath } from '../harness-registry.ts'
import { systemEnvironment } from './environment.ts'
import type { HarnessAdapter } from './types.ts'
/** GROK_CONFIG drops the model table. Use the documented independent GROK_HOME. */
export function grokConfiguration(baseURL = OPL_GATEWAY_INFERENCE_BASE_URL): string {
  return `[cli]\nauto_update = false\n[models]\ndefault = "grok-4.7"\nweb_search = "grok-4.7"\n[model."grok-4.7"]\nmodel = "grok-4.7"\nname = "Grok 4.7"\nbase_url = ${JSON.stringify(baseURL)}\nenv_key = "${GROK_API_KEY_REF}"\napi_backend = "responses"\ncontext_window = 500000\nsupports_reasoning_effort = true\n[shell_environment_policy]\nexclude = ["OPL_GATEWAY_*", "DSH_*", "GROK_CONFIG*"]\n[compat.claude]\nskills = false\nrules = false\nmcps = false\nhooks = false\nsessions = false\n[compat.cursor]\nskills = false\nrules = false\nmcps = false\nhooks = false\n`
}

export const grokAdapter: HarnessAdapter = {
  id: 'grok-build',
  transport: 'acp',
  matches: (ref) => ref.provider === 'opl-gateway' && ref.model === 'grok::grok-4.7',
  async available(ctx, options) {
    if (!(await executablePath(options.command || options.grokCommand)))
      return { available: false, reason: '未找到官方 Grok Build CLI' }
    try {
      await resolveGatewayExecution(
        ctx,
        { provider: 'opl-gateway', model: 'grok::grok-4.7' },
        options.resolveKey,
      )
      return { available: true }
    } catch {
      return { available: false, reason: 'Grok 分组凭据未就绪或已停用' }
    }
  },
  async prepare(ctx, record, options) {
    const route = await resolveGatewayExecution(ctx, record.modelRef, options.resolveKey)
    const key = route.apiKey
    const home = join(options.home, 'harnesses', 'grok-build')
    await mkdir(home, { recursive: true, mode: 0o700 })
    const config = join(home, 'config.toml'),
      bytes = grokConfiguration(route.baseURL)
    const current = await readFile(config, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (current !== undefined && current !== bytes)
      throw Error('套件的 Grok 配置已被修改，已保留，请核对后再启动')
    if (current === undefined) await writeFile(config, bytes, { mode: 0o600, flag: 'wx' })
    return {
      home,
      command: options.command || options.grokCommand,
      args: [
        ...(options.prefix ?? []),
        '--cwd',
        record.cwd,
        '--model',
        'grok-4.7',
        '--sandbox',
        record.sandbox,
        '--permission-mode',
        'default',
        'agent',
        '--no-leader',
        'stdio',
      ],
      env: {
        ...systemEnvironment(),
        GROK_HOME: home,
        [GROK_API_KEY_REF]: key,
        GROK_DEFAULT_SELECTED_PERMISSION: 'allow_once',
      },
    }
  },
}
