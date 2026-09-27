import { installExternalCodex } from './coordination/external-codex.ts'
import { installSetupChannel } from './setup-service.ts'
/** Add waiting to the official Session RPC surface without replacing its controller. */
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { installSessionWaitProjection } from './coordination/wait.ts'
import { createHarnessService } from './coordination/harness.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

export const inject = ['typertGateway', 'sessions', 'agents', 'sessionProjections', 'connection', 'webServer', 'settings', 'credentials', 'agentDefaultModel', 'oplGatewayAccount', 'workspaceRegistry']
/** Keep admission, model selection, tools and permissions in the official Host.
 * @param ctx - Official Host context.
 */
export function apply(ctx: Context, _config: Record<string, never>): void {
  const harness = createHarnessService(ctx)
  ctx.effect(() => () => harness.dispose())
  // Tools belong to each official Agent scope. Host startup must not wait on
  // an agent-scoped tool registry that does not exist until a conversation opens.
  const json = async (value:Promise<unknown>) => JSON.parse(JSON.stringify(await value))
  const install = (agent: import('@deepseek-ai/dsh-agent').Agent) => agent.ctx.inject(['tools'], scope => {
    const origin = {kind:'dsh' as const,sessionId:agent.id}
    const output = {schema:{type:'json' as const},render:(_args:unknown,value:unknown)=>[{type:'text' as const,text:JSON.stringify(value)}]}
    scope.tools.register(defineTool({name:'list_harness_combinations',description:'读取可用运行配置及精确 ID，再选择模型与 Harness。',parameters:{},output,execute:async()=> (await harness.list()).combinations}))
    scope.tools.register(defineTool({name:'delegate_to_harness',description:'在同项目创建或继续另一运行配置的子任务。默认等待结果；返回后核验实际产物并调用 review_harness_task。继续修改沿用 sessionId 和 taskId，新指令用新 operationId。权限等待时请用户处理，不要重派。',parameters:{
      combination:{type:'string'},task:{type:'string',required:true},taskId:{type:'string',required:true},operationId:{type:'string',required:true},sessionId:{type:'string'},acceptance:{type:'string'},wait:{type:'boolean'},
    },output,execute:(args,exec)=>json(harness.delegateFrom(origin,args,exec.signal))}))
    scope.tools.register(defineTool({name:'harness_result',description:'读取或等待当前对话委派的任务；执行完成与验收通过独立。',parameters:{sessionId:{type:'string',required:true},operationId:{type:'string'},wait:{type:'boolean'}},output,execute:(args,exec)=>json(harness.resultFor(origin,args,exec.signal))}))
    scope.tools.register(defineTool({name:'list_harness_tasks',description:'列出当前对话委派的子任务及交付、验收状态。',parameters:{},output,execute:()=>json(harness.tasksFor(origin))}))
    scope.tools.register(defineTool({name:'report_harness_task',description:'子任务提交交付摘要、产物路径、实际检查和遗留问题。不代替父对话验收。',parameters:{summary:{type:'string',required:true},artifacts:{type:'array',items:{type:'string'}},checks:{type:'array',items:{type:'string'}},remaining:{type:'array',items:{type:'string'}}},output,execute:args=>harness.submitReport(origin,args)}))
    scope.tools.register(defineTool({name:'review_harness_task',description:'sessionId 使用返回的 harness- 开头的 ID，不用原生 acpSessionId 或 taskId。父对话核验实际产物后登记 accepted 或 changes_requested 和具体依据。要求修改后继续同一个子对话。',parameters:{sessionId:{type:'string',required:true},operationId:{type:'string',required:true},decision:{type:'string',required:true},note:{type:'string',required:true}},output,execute:args=>json(harness.reviewTask(origin,args))}))
    scope.tools.register(defineTool({name:'cancel_harness_task',description:'取消当前对话委派的子任务及其后代。',parameters:{sessionId:{type:'string',required:true}},output,execute:args=>json(harness.cancelTask(origin,args.sessionId))}))
  })
  ctx.on('agent/created', ({agent}) => { install(agent) })
  for (const agent of ctx.agents.list()) install(agent)
  installSetupChannel(ctx, (method, input) => harness.invoke(method, input))
  installSessionWaitProjection(ctx)
  installExternalCodex(ctx,harness)
}
