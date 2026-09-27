#!/usr/bin/env node
import {createInterface} from 'node:readline'
const send=x=>process.stdout.write(JSON.stringify(x)+'\n')
let threadId='native-test',turn='turn-1'
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line)
 if(m.method==='initialize')send({id:m.id,result:{userAgent:'fixture'}})
 if(m.method==='thread/start'||m.method==='thread/resume'){
  if(m.params.sandbox!=='read-only'||m.params.modelProvider!=='opl-gateway'||m.params.config.model_providers['opl-gateway'].env_key!=='OPL_NATIVE_API_KEY')throw Error('invalid native configuration')
  threadId=m.params.threadId??threadId;send({id:m.id,result:{thread:{id:threadId},model:m.params.model}})
 }
 if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:turn}}})
  send({id:100,method:'item/commandExecution/requestApproval',params:{threadId,turnId:turn,itemId:'tool',command:'outside project',reason:'sandbox escalation'}})
 }
 if(m.id===100&&m.result){
  if(m.result.decision!=='decline')throw Error('sandbox escalation allowed')
  send({method:'item/agentMessage/delta',params:{threadId,turnId:turn,itemId:'message',delta:'boundary preserved'}})
  send({method:'turn/completed',params:{threadId,turn:{id:turn,status:'completed'}}})
 }
})
