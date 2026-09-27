/** ACP transport projection over the installed official Codex/Claude harnesses.
 * This file owns no agent loop, model requests, tool execution or session format.
 */
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {randomUUID} from 'node:crypto'
import {realpath} from 'node:fs/promises'
import {dirname,resolve,sep} from 'node:path'
import {query, type Query, type McpServerConfig} from '@anthropic-ai/claude-agent-sdk'
const kind=process.env.OPL_NATIVE_HARNESS!, command=process.env.OPL_NATIVE_COMMAND!
const model=process.env.OPL_NATIVE_MODEL!, cwd=process.cwd(), readonly=process.env.OPL_NATIVE_PERMISSION!=='workspace'
const send=(value:object)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n')
const emit=(update:object)=>send({method:'session/update',params:{sessionId,update}})
let sessionId='',hasHistory=false,cancelled=false,claude:Query|undefined,turnId=''
let servers:Record<string,McpServerConfig>={}
let seq=0
const asks=new Map<string,(allowed:boolean)=>void>()
function permission(title:string):Promise<boolean>{
 const id='permission-'+ ++seq
 return new Promise(resolve=>{asks.set(id,resolve);send({id,method:'session/request_permission',params:{sessionId,toolCall:{title},options:[{optionId:'allow',name:'允许本次',kind:'allow_once'},{optionId:'deny',name:'拒绝',kind:'reject_once'}]}})})
}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
let child:ReturnType<typeof spawn>|undefined
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>()
let resolveTurn:((value:unknown)=>void)|undefined,rejectTurn:((e:Error)=>void)|undefined
function codexRequest(method:string,params:object):Promise<any>{
 const id=++seq
 return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child!.stdin!.write(JSON.stringify({id,method,params})+'\n')})
}
async function openCodex(){
 child=spawn(command,['app-server','--stdio'],{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true})
 child.stderr!.resume()
 const fail=()=>{for(const p of pending.values())p.reject(Error('Codex 进程退出'));pending.clear();rejectTurn?.(Error('Codex 进程退出'))}
 child.on('error',fail);child.on('exit',fail)
 createInterface({input:child.stdout!}).on('line',line=>{void (async()=>{
  let m:any;try{m=JSON.parse(line)}catch{return}
  if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error('Codex 请求失败（'+m.error.code+'）')):p.resolve(m.result)}return}
  const p=m.params??{}
  if(m.id!==undefined){
   let result:object
   if(m.method==='item/commandExecution/requestApproval'||m.method==='item/fileChange/requestApproval'){
    // Approval may not enlarge the saved filesystem boundary.
    const allowed=false // Requests to escape the saved sandbox cannot be approved by this bridge.
    result={decision:allowed?'accept':'decline'}
   }else if(m.method==='item/tool/requestUserInput')result={answers:{}}
   else {child!.stdin!.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Unsupported client request'}})+'\n');return}
   child!.stdin!.write(JSON.stringify({id:m.id,result})+'\n');return
  }
  if(p.threadId!==sessionId)return
  if(m.method==='item/agentMessage/delta')emit({sessionUpdate:'agent_message_chunk',content:{type:'text',text:p.delta}})
  if(m.method==='item/started'||m.method==='item/completed'){
   const item=p.item??{}
   if(!['agentMessage','userMessage','reasoning'].includes(item.type))emit({sessionUpdate:m.method==='item/started'?'tool_call':'tool_call_update',toolCallId:item.id,title:item.command??item.type,status:m.method==='item/started'?'in_progress':item.status==='failed'?'failed':'completed',kind:'other'})
  }
  if(m.method==='turn/completed'){
   turnId=''
   if(p.turn.status==='failed')rejectTurn?.(Error('Codex 执行失败'))
   else resolveTurn?.({stopReason:p.turn.status==='interrupted'?'cancelled':'end_turn'})
   resolveTurn=undefined;rejectTurn=undefined
  }
 })().catch(()=>rejectTurn?.(Error('Codex 消息处理失败')))})
 await codexRequest('initialize',{clientInfo:{name:'opl-dsh',version:'0.2.4'},capabilities:{experimentalApi:true}})
 child.stdin!.write(JSON.stringify({method:'initialized',params:{}})+'\n')
}
async function pathInProject(path:unknown):Promise<boolean>{
 if(typeof path!=='string')return false
 const target=resolve(cwd,path)
 let probe=target
 for(;;){try{const actual=await realpath(probe);return actual===cwd||actual.startsWith(cwd+sep)}catch{const parent=dirname(probe);if(parent===probe)return false;probe=parent}}
}
async function claudePrompt(text:string){
 cancelled=false
 const disallowed=readonly?['Bash','Write','Edit','NotebookEdit','Agent','Task']:['Agent','Task']
 claude=query({prompt:text,options:{
  cwd,model,pathToClaudeCodeExecutable:command,env,settingSources:[],strictMcpConfig:true,mcpServers:servers,
  ...(hasHistory?{resume:sessionId}:{sessionId}),permissionMode:'default',includePartialMessages:true,
  disallowedTools:disallowed,
  sandbox:{enabled:true,failIfUnavailable:true,autoAllowBashIfSandboxed:false,allowUnsandboxedCommands:false,filesystem:{allowWrite:readonly?[]:[cwd]},credentials:{envVars:[{name:'ANTHROPIC_API_KEY',mode:'deny'},{name:'OPL_NATIVE_API_KEY',mode:'deny'}]}},
  canUseTool:async(name,input)=>{
   if(cancelled)return {behavior:'deny',message:'任务已取消'}
   if(name.startsWith('mcp__opl-harness__'))return {behavior:'allow',updatedInput:input}
   if(['Read','Glob','Grep','LS','TodoWrite'].includes(name))return {behavior:'allow',updatedInput:input}
   if(readonly)return {behavior:'deny',message:'此组合只允许读取'}
   if(['Write','Edit','NotebookEdit'].includes(name)&&!await pathInProject(input.file_path??input.notebook_path))return {behavior:'deny',message:'不能写入项目目录之外'}
   if(name==='Bash'&&input.dangerouslyDisableSandbox)return {behavior:'deny',message:'不能退出组合的沙箱'}
   return await permission('Claude Code · '+name+'\n'+JSON.stringify(input).slice(0,2000))?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'用户未授权此操作'}
  },
 }})
 let result:any
 try{
  for await(const event of claude){
   hasHistory=true
   if(event.type==='stream_event'){
    const e=event.event
    if(e.type==='content_block_delta'&&e.delta.type==='text_delta')emit({sessionUpdate:'agent_message_chunk',content:{type:'text',text:e.delta.text}})
   }
   if(event.type==='assistant')for(const block of event.message.content)if(block.type==='tool_use')emit({sessionUpdate:'tool_call',toolCallId:block.id,title:block.name,status:'in_progress',kind:'other'})
   if(event.type==='user'&&Array.isArray(event.message.content))for(const block of event.message.content)if(block.type==='tool_result')emit({sessionUpdate:'tool_call_update',toolCallId:block.tool_use_id,status:block.is_error?'failed':'completed',kind:'other'})
   if(event.type==='result')result=event
  }
 }finally{claude.close();claude=undefined}
 if(cancelled)return {stopReason:'cancelled'}
 if(!result||result.is_error||result.subtype!=='success')throw Error('Claude Code 执行失败')
 return {stopReason:'end_turn'}
}
async function invoke(method:string,p:any){
 if(method==='initialize'){
  if(kind==='codex')await openCodex()
  return {protocolVersion:1,agentCapabilities:{loadSession:true},agentInfo:{name:kind,version:'native'}}
 }
 if(method==='session/new'||method==='session/load'){
  if(p.cwd!==cwd)throw Error('不能改变已绑定项目')
  servers=Object.fromEntries((p.mcpServers??[]).map((s:any)=>[s.name,{command:s.command,args:s.args,env:Object.fromEntries(s.env.map((e:any)=>[e.name,e.value]))}]))
  if(kind==='codex'){
   const config={model_provider:'opl-gateway',model_providers:{'opl-gateway':{name:'OPL Gateway',base_url:process.env.OPL_NATIVE_BASE_URL,env_key:'OPL_NATIVE_API_KEY',wire_api:'responses',requires_openai_auth:false}},mcp_servers:Object.fromEntries(Object.entries(servers).map(([k,v])=>[k,{...v,enabled:true,default_tools_approval_mode:'approve',tool_timeout_sec:600}])),shell_environment_policy:{inherit:'core',exclude:['OPL_*','ANTHROPIC_*','DSH_*']},forced_login_method:'api'}
   const params={model,modelProvider:'opl-gateway',cwd,sandbox:readonly?'read-only':'workspace-write',approvalPolicy:'never',config}
   const r=await codexRequest(method==='session/load'?'thread/resume':'thread/start',{...params,...(p.sessionId?{threadId:p.sessionId}:{})})
   sessionId=r.thread.id
   if(r.model&&r.model!==model)throw Error('Codex 返回不同模型')
  }else{sessionId=p.sessionId??randomUUID();hasHistory=!!p.sessionId}
  return {sessionId,models:{currentModelId:model}}
 }
 if(p.sessionId!==sessionId)throw Error('会话身份不匹配')
 if(method==='session/cancel'){
  cancelled=true;for(const resolve of asks.values())resolve(false);asks.clear()
  if(kind==='codex'&&turnId)await codexRequest('turn/interrupt',{threadId:sessionId,turnId})
  if(claude)await claude.interrupt()
  return {}
 }
 if(method==='session/prompt'){
  const text=p.prompt.filter((v:any)=>v.type==='text').map((v:any)=>v.text).join('\n')
  if(kind==='claude')return claudePrompt(text)
  const done=new Promise((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject})
  // Mark the promise handled before awaiting turn/start, which can itself fail.
  void done.catch(()=>{})
  try {const r=await codexRequest('turn/start',{threadId:sessionId,input:[{type:'text',text,text_elements:[]}],model});turnId=r.turn.id;return await done}
  finally{resolveTurn=undefined;rejectTurn=undefined;turnId=''}
 }
 throw Error('不支持的调用')
}
createInterface({input:process.stdin}).on('line',line=>{void(async()=>{
 let m:any;try{m=JSON.parse(line)}catch{return}
 if(!m.method){const answer=asks.get(m.id);if(answer){asks.delete(m.id);answer(m.result?.outcome?.optionId==='allow')}return}
 try{const result=await invoke(m.method,m.params??{});if(m.id!==undefined)send({id:m.id,result})}
 catch(error){if(process.env.OPL_NATIVE_DIAGNOSTICS==='1')process.stderr.write(JSON.stringify({method:m.method,error:String(error instanceof Error?error.message:'failure').replaceAll(process.env.OPL_NATIVE_API_KEY??'__none__','[REDACTED]')})+'\n');if(m.id!==undefined)send({id:m.id,error:{code:-32000,message:'官方 Harness 调用未完成，请检查凭据、模型或安装状态'}})}
})()})
const stop=()=>{claude?.close();child?.kill('SIGTERM');process.exit()}
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdin.on('end',stop)
