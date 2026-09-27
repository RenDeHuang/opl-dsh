import {createServer} from 'node:http'
import {readFile, realpath, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,sep} from 'node:path'
// Run against an already booted, isolated official Desktop. Never target a user's profile.
const root=await realpath(process.argv[2]??'')
const temp=await realpath(tmpdir())
if(!root.startsWith(temp+sep) || !root.includes('opl-dsh-accept-'))throw Error('必须提供临时 opl-dsh-accept- 隔离目录')
const binding=JSON.parse(await readFile(join(root,'profiles/desktop/control.json'),'utf8'))
async function rpc(namespace,method,args={}) {
 const response=await fetch(binding.endpoint,{method:'POST',headers:{authorization:'Bearer '+binding.token,'content-type':'application/json'},body:JSON.stringify({namespace,method,args}),signal:AbortSignal.timeout(30000)})
 const out=await response.json();if(!out.ok)throw Error(out.error);return out.value
}
const url=await rpc('oplSuite','setupUrl')
const response=await fetch(url,{redirect:'manual'})
const cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),origin=new URL(url).origin
async function request(method,payload) {
 const response=await fetch(origin+'/api/'+method,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload}),signal:AbortSignal.timeout(30000)})
 const out=await response.json();if(!out.result?.ok)throw Error(out.result?.error?.message??'调用失败');return out.result.value
}
const wire=(method,args={})=>request(method,{args})
const harness=(method,input={})=>request('oplSetup/harness',{method,input})
if(process.argv.includes('--readback-selections')){
 const selections=JSON.parse(await readFile(join(root,'profiles/desktop/combination-selection.json'),'utf8'))
 if(!Object.keys(selections).length)throw Error('没有可验收的组合选择记录')
 for(const [sessionId,combination] of Object.entries(selections))assert.equal((await harness('model-selection',{sessionId})).combination,combination)
 console.log(JSON.stringify({selectionRestore:true,sessions:Object.keys(selections).length}))
 process.exit(0)
}
const project=join(root,'test-project');await mkdir(project,{recursive:true})
import assert from 'node:assert/strict'
const requests=[]
const server=createServer(async(req,res)=>{
 try{
  let bytes='';for await(const chunk of req)bytes+=chunk
  const body=JSON.parse(bytes),isMessages=req.url.includes('/messages')
  const usedTool=body.messages.some(m=>m.role==='tool'||Array.isArray(m.content)&&m.content.some(b=>b.type==='tool_result'))
  const toolName='list_harness_combinations'
  const hasTool=body.tools?.some(t=>(t.name??t.function?.name)===toolName)
  requests.push({path:req.url,model:body.model,key:req.headers['x-api-key']??req.headers.authorization,usedTool,hasTool})
  res.writeHead(200,{'content-type':'text/event-stream'})
  if(isMessages){
   const send=x=>res.write(`event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`)
   send({type:'message_start',message:{id:'msg_fixture',model:body.model,role:'assistant',type:'message',content:[],usage:{input_tokens:3,output_tokens:0}}})
   if(!usedTool&&hasTool){send({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'fixture_tool',name:toolName,input:{}}});send({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{}'}})}
   else{send({type:'content_block_start',index:0,content_block:{type:'text',text:''}});send({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'runtime verified'}})}
   send({type:'content_block_stop',index:0});send({type:'message_delta',delta:{stop_reason:!usedTool&&hasTool?'tool_use':'end_turn'},usage:{output_tokens:4}});send({type:'message_stop'})
  }else{
   const send=delta=>res.write('data: '+JSON.stringify({id:'chat_fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
   send({role:'assistant'})
   if(!usedTool&&hasTool)send({tool_calls:[{index:0,id:'call_fixture',type:'function',function:{name:toolName,arguments:'{}'}}]})
   else send({content:'runtime verified'})
   res.write('data: '+JSON.stringify({id:'chat_fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:!usedTool&&hasTool?'tool_calls':'stop'}],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7}})+'\n\ndata: [DONE]\n\n')
  }
  res.end()
 }catch(e){res.writeHead(500);res.end('fixture failed')}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port+'/v1'
try {
 await wire('credentials/set',{ref:'OPL_GATEWAY_DEEPSEEK_API_KEY',value:'fixture-deepseek'})
 await wire('credentials/set',{ref:'OPL_GATEWAY_CODEX_API_KEY',value:'fixture-codex'})
 await wire('settings/mutate',{ns:'opl-suite',ops:[{op:'set',path:['gateway','baseURL'],value:base}]})
 await wire('settings/mutate',{ns:'llm-pi-ai',ops:[{op:'set',path:['providers','opl-gateway-openai','baseURL'],value:base},{op:'set',path:['providers','opl-gateway-openai','api'],value:'openai-completions'}]})
 async function editGateway(group,input) {
  let snapshot=await harness('gateway-models'),descriptor=snapshot.groups.find(g=>g.id===group)
  if(!descriptor)throw Error(`验收分组不存在：${group}`)
  try{return await harness('edit-gateway-models',{group,revision:descriptor.revision,...input})}
  catch(error){
   if(!String(error?.message??error).includes('changed since it was read'))throw error
   snapshot=await harness('gateway-models');descriptor=snapshot.groups.find(g=>g.id===group)
   return harness('edit-gateway-models',{group,revision:descriptor.revision,...input})
  }
 }
 await editGateway('deepseek',{models:[{id:'deepseek-flash',name:'DeepSeek 设置回读'}]})
 await editGateway('codex',{api:'openai-completions',models:[{id:'gpt-5.4',name:'GPT-5.4'},{id:'deepseek-flash',name:'DeepSeek-V4.1-Flash'}]})
 const native=await wire('session/modelCatalog')
 const models=native.groups.find(g=>g.id==='opl-gateway').models
 assert.equal(models.find(m=>m.id==='deepseek-flash').name,'DeepSeek 设置回读')
 assert(models.some(m=>m.id==='codex::gpt-5.4'))
 assert(models.some(m=>m.id==='codex::deepseek-flash'))
 const catalog=await harness('catalog')
 const gpt={id:'accept-gpt-dsh',name:'GPT protocol acceptance',modelRef:{provider:'opl-gateway',model:'codex::gpt-5.4'},harnessRef:'dsh',permissionPolicy:'read-only',isDefault:false,enabled:true}
 catalog.combinations.push(gpt);await harness('save-catalog',{catalog})
 for(const combination of ['dsh/deepseek-flash',gpt.id]){
  const s=await harness('start',{combination,cwd:project,taskId:'accept-'+crypto.randomUUID(),origin:{kind:'desktop',sessionId:'isolated-acceptance'},sandbox:'read-only'})
  if(combination===gpt.id){await harness('select-combination',{sessionId:s.acpSessionId,combination});assert.equal((await harness('model-selection',{sessionId:s.acpSessionId})).combination,combination)}
  await harness('prompt',{sessionId:s.id,text:'Read the available combination list once, then reply runtime verified.',operationId:crypto.randomUUID()})
  const result=await rpc('harness','wait',{sessionId:s.id})
  assert.equal(result.state,'completed',JSON.stringify(result.turns.map(t=>({state:t.state,error:t.error}))))
 }
 assert(requests.some(r=>r.path.endsWith('/messages')&&r.key==='fixture-deepseek'))
 assert(requests.some(r=>r.path.endsWith('/chat/completions')&&r.key==='Bearer fixture-codex'&&r.model==='gpt-5.4'))
 assert(requests.filter(r=>r.usedTool).length>=2,'official tool execution missing')
 console.log(JSON.stringify({nativeSettingsReadback:true,groupedModels:models.map(m=>m.id),officialTools:true,requests:requests.map(({key,...rest})=>rest)},null,2))
}finally{server.closeAllConnections();server.close()}
