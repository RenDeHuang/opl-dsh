/** One bounded compatibility reader for pre-modular UI automation. New clients use Remote. */
import type { Context } from '@deepseek-ai/cordis'
import { invokeExecutionRpc } from './execution-rpc.ts'
const gatewayMethods: Record<string, string> = {
  'gateway-models': 'read',
  'edit-gateway-models': 'edit',
  'discover-gateway-models': 'discover',
  'gateway-group-activation': 'activate',
}
export function installLegacyHarnessChannel(ctx: Context): void {
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/oplSetup/harness',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const message = (await request.json()) as {
          type?: string
          rpcId?: string
          method?: string
          payload?: { method?: string; input?: unknown }
        }
        if (
          message.type !== 'client-request' ||
          typeof message.rpcId !== 'string' ||
          message.method !== 'oplSetup/harness' ||
          typeof message.payload?.method !== 'string'
        )
          return new Response('Invalid request', { status: 400 })
        let result
        try {
          const { method, input } = message.payload
          const mapped = gatewayMethods[method]
          const value = mapped
            ? await ctx.typertGateway.invoke({
                namespace: 'oplGatewayModels',
                method: mapped,
                args: mapped === 'read' ? {} : { request: input },
              })
            : await invokeExecutionRpc(ctx, method, input, request.signal)
          result = { ok: true, value }
        } catch {
          result = {
            ok: false,
            error: {
              code: 'operation-failed',
              message: '操作未完成，请重新读取状态。',
              details: {},
            },
          }
        }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
      },
    }),
  )
}
