import { coordinationAction } from './coordination/settings.ts'
/** First-run completion belongs to the Host; the desktop and browser share this channel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LoginChoice } from './setup-config.ts'
import type {} from './gateway/account-service.ts'

import type { SetupStatus } from './setup-types.ts'
export async function officialProvider(ctx: Context): Promise<string | undefined> {
  const account = await ctx.typertGateway.invoke({ namespace: 'account', method: 'getState', args: {} }) as { status?: string }
  if (account.status === 'credential-stored') return 'deepseek-account'
  const value = ctx.settings.describe().find(item => item.ns === 'llm-deepseek')?.value as { apiKeyEnv?: string } | undefined
  if (value?.apiKeyEnv && await ctx.credentials.resolve(credentialRef(value.apiKeyEnv))) return 'deepseek-official'
  return undefined
}
export async function setupStatus(ctx: Context): Promise<SetupStatus> {
  const settings = ctx.settings.describe().find(item => item.ns === 'opl-suite')?.value as { loginChoice?: LoginChoice; setupCompleted?: boolean } | undefined
  const gateway = await ctx.get('oplGatewayAccount')!.status()
  const account = await ctx.typertGateway.invoke({ namespace: 'account', method: 'getState', args: {} }) as { attempt?: { phase?: string } }
  const provider = await officialProvider(ctx)
  return { completed: settings?.setupCompleted === true, choice: settings?.loginChoice ?? 'undecided',
    gatewayReady: gateway.groups?.some(group => group.state === 'ready') ?? gateway.keyReady, ...(provider ? { officialProvider: provider } : {}),
    ...(account.attempt?.phase ? { officialPhase: account.attempt.phase } : {}) }
}
export async function finishSetup(ctx: Context, choice: Exclude<LoginChoice, 'undecided'>): Promise<void> {
  if (choice !== 'later') {
    const provider = choice === 'gateway' ? 'opl-gateway' : await officialProvider(ctx)
    if (!provider || (choice === 'gateway' && !(await setupStatus(ctx)).gatewayReady)) throw new Error('账户尚未就绪，请先完成登录。')
    const model = (await ctx.llm.listModels(provider))[0]
    if (!model) throw new Error('账户暂无可用模型，请稍后重试。')
    await ctx.agentDefaultModel.saveSelection({ provider, model: model.id })
  }
  await ctx.settings.update('opl-suite', { loginChoice: choice, setupCompleted: true })
}
/** Reuse the official authenticated Connection transport, without exposing the private control token. */
export function installSetupChannel(ctx: Context, harness?: (method: string, input: unknown) => Promise<unknown>): void {
  const handle = async (endpoint: string, payload: unknown) => {
    try {
      if (endpoint === 'harness' && harness && payload && typeof payload === 'object') {
        const p = payload as {method:string;input:unknown}
        return {ok:true,value:await harness(p.method,p.input)}
      }
      if (['coordination-status','skill-install','auto-start','wake-settings'].includes(endpoint)) return { ok: true, value: await coordinationAction(ctx, endpoint, payload) }
      if (endpoint === 'status') return { ok: true, value: await setupStatus(ctx) }
      if (endpoint === 'finish' && (payload === 'gateway' || payload === 'official' || payload === 'later')) {
        await finishSetup(ctx, payload); return { ok: true, value: null }
      }
      if (endpoint === 'official-start') {
        await ctx.typertGateway.invoke({ namespace: 'account', method: 'startSignIn', args: {
          client: { version: process.env.OPL_OFFICIAL_VERSION ?? '0.0.0', locale: 'zh', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 },
          callbackOrigin: `http://127.0.0.1:${ctx.webServer.port}`, loginSource: 'desktop',
        } })
        return { ok: true, value: null }
      }
      if (endpoint === 'official-cancel') {
        const account = await ctx.typertGateway.invoke({ namespace: 'account', method: 'getState', args: {} }) as { attempt?: { id?: string } }
        if (account.attempt?.id) await ctx.typertGateway.invoke({ namespace: 'account', method: 'cancelSignIn', args: { attemptId: account.attempt.id } })
        return { ok: true, value: null }
      }
      if (endpoint === 'official-key' && typeof payload === 'string' && payload.trim().length > 0 && payload.length <= 4096) {
        const value = ctx.settings.describe().find(item => item.ns === 'llm-deepseek')?.value as { apiKeyEnv?: string } | undefined
        if (!value?.apiKeyEnv) throw new Error('官方模型配置暂不可用。')
        await ctx.credentials.set(credentialRef(value.apiKeyEnv), payload.trim())
        await finishSetup(ctx, 'official')
        return { ok: true, value: null }
      }
      return { ok: false, error: { code: 'invalid', message: '无效的首次设置操作。', details: {} } }
    } catch (error) {
      if (endpoint === 'harness') return {ok:false,error:{code:'harness-failed',message:error instanceof Error?error.message:'组合操作失败',details:{}}}
      // Provider failures can contain credentials. Keep diagnostics out of the login surface.
      return { ok: false, error: { code: 'setup-failed', message: '未能完成设置，请检查连接后重试。', details: {} } }
    }
  }
  for (const endpoint of ['harness', 'status', 'finish', 'official-start', 'official-cancel', 'official-key','coordination-status','skill-install','auto-start','wake-settings']) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/oplSetup/' + endpoint, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        const message = await request.json() as { type?: string; rpcId?: string; method?: string; payload?: unknown }
        if (message.type !== 'client-request' || typeof message.rpcId !== 'string' || message.method !== 'oplSetup/' + endpoint) return new Response('Invalid setup request', { status: 400 })
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: await handle(endpoint, message.payload) })
      },
    }))
  }
}
