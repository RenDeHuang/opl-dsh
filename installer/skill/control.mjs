/** Stable dispatch identities over the official DSH Session API. */
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'))
const [command,...argv]=process.argv.slice(2)
const args={}
for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||argv[i+1]===undefined)throw new Error('参数必须为 --name value');args[argv[i].slice(2)]=argv[i+1]}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
let binding
async function connected(){try{const b=JSON.parse(await readFile(join(config.home,'profiles/desktop/control.json'),'utf8'));process.kill(b.pid,0);binding=b;return true}catch{return false}}
if(!await connected()){
 if(config.autoStart===false)throw new Error('自动启动已关闭，请先打开 OPL DSH')
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const child=spawn(process.platform==='win32'?'wscript.exe':config.launcher,process.platform==='win32'?[config.launcher]:[],{env,detached:true,stdio:'ignore'});let launchError;child.once('error',()=>{launchError=true});child.unref()
 for(let i=0;i<120&&!launchError&&!await connected();i++)await new Promise(resolve=>setTimeout(resolve,500))
 if(!binding)throw new Error('DSH 启动失败，请运行 OPL 一键安装器检查配置')
}
async function rpc(method,input,timeout=150000,namespace='session'){
 const response=await fetch(binding.endpoint,{method:'POST',headers:{authorization:'Bearer '+binding.token,'content-type':'application/json'},body:JSON.stringify({namespace,method,args:['tasks','outbox','wake','receipts','flush'].includes(method)?{}:method==='wait'?input:{request:input},timeoutMs:timeout}),signal:AbortSignal.timeout(timeout+5000)})
 const result=await response.json();if(!result.ok)throw new Error(result.error);return result.value
}
async function harnessRpc(method,input,timeout=600000){
 const response=await fetch(binding.endpoint,{method:'POST',headers:{authorization:'Bearer '+binding.token,'content-type':'application/json'},body:JSON.stringify({namespace:'harness',method,args:input,timeoutMs:timeout}),signal:AbortSignal.timeout(timeout+5000)})
 const result=await response.json();if(!result.ok)throw new Error(result.error);return result.value
}
if(['delegate-review','delegate-tasks','delegate','delegate-start','delegate-prompt','delegate-cancel','delegate-snapshot','delegate-list','delegate-wait'].includes(command)){
 const origin={kind:'codex',sessionId:process.env.CODEX_THREAD_ID??'manual'}
 if(command==='delegate-review'){if(!args.session||!args.operation||!args.decision||!args['note-file'])throw Error('需要 --session --operation --decision --note-file');console.log(JSON.stringify(await harnessRpc('review',{origin,sessionId:args.session,operationId:args.operation,decision:args.decision,note:await readFile(args['note-file'],'utf8')})))}
 else if(command==='delegate-tasks')console.log(JSON.stringify(await harnessRpc('tasks',{origin})))
 else if(command==='delegate-list')console.log(JSON.stringify(await harnessRpc('list',{})))
 else if(['delegate-cancel','delegate-snapshot','delegate-wait'].includes(command)){
  if(!args.session)throw Error('缺少 --session')
  console.log(JSON.stringify(await harnessRpc(command.slice(9),{sessionId:args.session,...(args.operation?{operationId:args.operation}:{})})))
 }else{
  if(command!=='delegate-prompt')for(const key of ['combination','cwd','task'])if(!args[key])throw Error('缺少 --'+key)
  if(args.cwd&&!isAbsolute(args.cwd))throw Error('--cwd 必须为绝对路径')
  let text
  if(command!=='delegate-start'){
   for(const key of ['operation','prompt-file'])if(!args[key])throw Error('缺少 --'+key)
   if(!isAbsolute(args['prompt-file']))throw Error('--prompt-file 必须为绝对路径')
   text=await readFile(args['prompt-file'],'utf8');if(!text.trim())throw Error('任务不能为空')
  }
  if(command==='delegate'){console.log(JSON.stringify(await harnessRpc('delegate',{origin,combination:args.combination,cwd:args.cwd,taskId:args.task,operationId:args.operation,task:text,...(args.session?{sessionId:args.session}:{})})));process.exit(0)}
  const started=command==='delegate-prompt'?{id:args.session}:await harnessRpc('start',{combination:args.combination,cwd:args.cwd,taskId:args.task,origin,...(args.session?{existingSessionId:args.session}:{})})
  if(command==='delegate-start')console.log(JSON.stringify(started))
  else{
   if(!started.id)throw Error('缺少 --session')
   await harnessRpc('prompt',{sessionId:started.id,text,operationId:args.operation})
   // The Host records acceptance and results, so a disconnect can be reconciled
   // without sending the prompt again. Permission waits return immediately.
   console.log(JSON.stringify(await harnessRpc('wait',{sessionId:started.id,operationId:args.operation})))
  }
 }
} else if(command==='dispatch'){
 for(const key of ['task','operation','cwd','prompt-file'])if(!args[key])throw new Error('缺少 --'+key)
 if(!isAbsolute(args.cwd)||!isAbsolute(args['prompt-file']))throw new Error('cwd 和 prompt-file 必须为绝对路径')
 const thread=process.env.CODEX_THREAD_ID??'manual'
 const sessionId='session-opl-'+hash([thread,args.task,args.cwd]).slice(0,28)
 const requestId='opl-'+hash([sessionId,args.operation])
 const prompt=await readFile(args['prompt-file'],'utf8');if(!prompt.trim())throw new Error('提示词不能为空')
 const provider=args.provider??'opl-gateway'
 if(!['opl-gateway','opl-gateway-openai'].includes(provider))throw new Error('未知 Gateway 通道')
 const fingerprint=hash({sessionId,prompt,provider})
 await mkdir(config.ledger,{recursive:true,mode:0o700})
 const file=join(config.ledger,requestId+'.json'),lock=file+'.lock'
 const fd=await open(lock,'wx',0o600)
 try {
  let previous;try{previous=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  if(previous&&previous.fingerprint!==fingerprint)throw new Error('同一个 operation ID 的内容发生变化，请为新指令使用新 ID')
  if(previous?.accepted){console.log(JSON.stringify({...previous,idempotent:true}));process.exitCode=0}
  else {
   const taskId=requestId
   const record={sessionId,requestId,taskId,fingerprint,accepted:false}
   async function save(value){const temp=file+'.'+randomUUID();const out=await open(temp,'wx',0o600);try{await out.writeFile(JSON.stringify(value)+'\n');await out.sync()}finally{await out.close()}await rename(temp,file)}
   await save(record)
   await rpc('create',{sessionId,cwd:args.cwd})
   await rpc('selectModel',{sessionId,provider,model:'deepseek-flash'})
   const registered=await rpc('register',{taskId,sessionId,target:{kind:'codex-thread',threadId:thread},acceptance:args.acceptance??'读取结果并独立检查产物'},150000,'taskFeedback')
   if(registered.task?.taskId!==taskId)throw new Error('任务反馈登记未确认，未发送提示词')
   const receipt=await rpc('prompt',{sessionId,requestId,mode:'queue',content:[{type:'text',text:prompt}]})
   if(receipt.accepted!==true)throw new Error('未确认接收，请沿用同一个 operation ID 重试')
   await save({...record,accepted:true});console.log(JSON.stringify({...record,accepted:true}))
  }
 } finally {await fd.close();await unlink(lock)}
} else if(['wait','snapshot','cancel'].includes(command)){
 if(!args.session)throw new Error('缺少 --session')
 console.log(JSON.stringify(await rpc(command,command==='snapshot'?{address:{kind:'session',sessionId:args.session},maxMessages:30,assistantStream:true}:{sessionId:args.session},command==='wait'?Number(args.timeout??150000):150000)))
} else if(['tasks','outbox','wake','receipts','flush'].includes(command)){
 console.log(JSON.stringify(await rpc(command,{},150000,'taskFeedback')))
} else if(['task','receive','consume','resumeFailed'].includes(command)){
 if(!args['request-file'])throw new Error('需要 --request-file 指向请求 JSON 文件')
 console.log(JSON.stringify(await rpc(command,JSON.parse(await readFile(args['request-file'],'utf8')),150000,'taskFeedback')))
} else throw new Error('用法：dispatch | delegate | delegate-start | delegate-prompt | delegate-cancel | delegate-snapshot | wait | snapshot | cancel | tasks | outbox | wake | task | receive | consume | resumeFailed')
