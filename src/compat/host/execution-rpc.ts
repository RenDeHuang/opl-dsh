/** Legacy carriers share the generated owner contract with the native Client. */
import type { Context } from '@deepseek-ai/cordis'
import { TYPERT_REMOTE } from '../../generated/remote.mjs'

export async function invokeExecutionRpc(
  ctx: Context,
  method: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const descriptor = TYPERT_REMOTE.descriptors.find(
    (item) => item.namespace === 'oplExecution' && item.method === method,
  )
  if (!descriptor) throw Error('不支持的执行操作')
  const args = Object.fromEntries(descriptor.parameters.map((parameter) => [parameter.wire, input]))
  const value = await ctx.typertGateway.invoke({
    namespace: 'oplExecution',
    method,
    args,
    ...(signal ? { signal } : {}),
  })
  // The official gateway validates inputs; non-Client carriers also validate results.
  if (descriptor.result.mode !== 'strict') throw Error('执行结果契约未生成')
  return descriptor.result.create().parse(value)
}
