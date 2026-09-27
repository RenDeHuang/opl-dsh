import { CollaborationTasks, TaskReview, taskState } from './CollaborationTasks.tsx'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { GROK_COMBINATION, type HarnessCatalog, type HarnessSnapshot } from '../coordination/harness-types.ts'
import css from './HarnessPanel.module.css'
type Call = <T>(method:string,input?:unknown)=>Promise<T>
const stateLabel:Record<string,string>={...taskState,idle:'未开始',running:'执行中',waiting_approval:'等待授权',waiting_input:'等待回答',completed:'已完成',failed:'未完成',cancelled:'已取消',interrupted:'已中断'}
const sessionState=(s:HarnessSnapshot)=>s.turns.at(-1)?.review?.decision==='accepted'?'验收通过':s.turns.at(-1)?.review?.decision==='changes_requested'?'需要修改':s.assignment?taskState[s.state]:stateLabel[s.state]
export function HarnessPanel({call,close,initialSession}:{call:Call;close?:()=>void;initialSession?:string}) {
  const [catalog,setCatalog]=useState<HarnessCatalog>(),[selected,setSelected]=useState(initialSession??''),[cwd,setCwd]=useState(''),[combination,setCombination]=useState(GROK_COMBINATION)
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[source,setSource]=useState<HarnessSnapshot>()
  const load=useCallback(async()=>{setCatalog(await call<HarnessCatalog>('list'))},[call])
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;const tick=async()=>{try{if(active)await load()}catch(e){if(active)setError(e instanceof Error?e.message:'状态读取失败')}finally{if(active)timer=setTimeout(()=>void tick(),1200)}};void tick();return()=>{active=false;clearTimeout(timer)}},[load])
  useEffect(()=>{if(initialSession)setSelected(initialSession)},[initialSession])
  const session=catalog?.sessions.find(s=>s.id===selected)
  const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(e instanceof Error?e.message:'操作失败')}finally{setBusy(false)}}
  const groups=Map.groupBy(catalog?.sessions??[],s=>s.cwd)
  const submit=()=>act(async()=>{
    let id=selected
    if(!id&&source){const s=await call<HarnessSnapshot>('delegate',{origin:{kind:'harness',sessionId:source.id},combination,task:text,taskId:crypto.randomUUID(),operationId:crypto.randomUUID(),wait:false});setSelected(s.id);setText('');setSource(undefined);return}
    if(!id){const s=await call<HarnessSnapshot>('start',{combination,cwd,taskId:crypto.randomUUID(),origin:source?{kind:'harness',sessionId:source.id}:{kind:'desktop',sessionId:'panel'},...(source?{sandbox:source.sandbox}:{})});id=s.id;setSelected(id)}
    await call('prompt',{sessionId:id,text,operationId:crypto.randomUUID()});setText('');setSource(undefined)
  })
  return <div className={css.panel}>
    <header className={css.header}><div><h2>项目协作</h2><p>每个子对话使用自己的模型与官方 Harness，工作目录保持一致。</p></div>{close&&<Button variant='outline' onClick={close}>返回 DSH</Button>}</header>
    {error&&<p className={css.error} role='alert'>{error}</p>}
    <div className={css.body}>
      <aside className={css.sidebar}><Button variant='outline' onClick={()=>{setSelected('');setSource(undefined)}}>新建对话</Button>
        {[...groups].map(([project,sessions])=><section key={project}><h3 title={project}>{project.split(/[\\/]/).filter(Boolean).at(-1)}</h3><details className={css.path}><summary>项目目录</summary>{project}</details>{sessions.map(s=><button className={css.session} data-selected={selected===s.id} key={s.id} onClick={()=>{setSelected(s.id);setCwd(s.cwd);setCombination(s.combination)}}><strong>{s.title}</strong><span>{s.assignment?'子任务 · ':''}{sessionState(s)}</span></button>)}</section>)}
      </aside>
      <main className={css.conversation}>
        {session?<><div className={css.sessionHeader}><strong>{session.title}</strong><span>{sessionState(session)}</span><Button variant='outline' disabled={busy||['queued','waiting_child','running','waiting_approval','waiting_input'].includes(session.state)} onClick={()=>{setSource(session);setSelected('');setCwd(session.cwd);setCombination(catalog?.combinations.find(c=>c.available&&c.id!==session.combination)?.id??'');setText('')}}>委派任务</Button><Button variant='outline' disabled={busy||!['queued','waiting_child','running','waiting_approval','waiting_input'].includes(session.state)} onClick={()=>void act(()=>call('cancel',{sessionId:session.id}))}>取消任务</Button></div><p className={css.path}>{catalog?.combinations.find(c=>c.id===session.combination)?.name??session.harnessRef} · {session.sandbox==='workspace'?'项目内写入':'只读'}</p><details className={css.path}><summary>会话详情</summary>{session.cwd}<br/>{session.id}</details>
          {session.origin.kind==='harness'&&<Button variant='outline' onClick={()=>setSelected(session.origin.sessionId)}>返回发起对话</Button>}
          <CollaborationTasks call={call} origin={{kind:'harness',sessionId:session.id}} open={setSelected}/>
          <TaskReview key={session.id} call={call} session={session} reload={load}/>
          <div className={css.messages}>{session.turns.map(turn=><section key={turn.operationId}><div className={css.user}>{turn.prompt}</div>{turn.tools.length>0&&<details><summary>工具过程 · {turn.tools.length}</summary>{turn.tools.map(t=><p key={t.id}>{t.title} · {t.status}</p>)}</details>}<div className={css.assistant}>{turn.text||stateLabel[turn.state]}</div>{turn.error&&<p className={css.error}>{turn.error}</p>}</section>)}</div>
          {['waiting_approval','waiting_input'].includes(session.state)&&session.harnessRef==='dsh'&&<section className={css.approval} role='alert'><strong>DSH 子对话等待你的确认</strong><p>在左侧同项目中打开此 DSH 子对话，通过官方授权或问题卡片处理后，结果会同步回这里。</p><p className={css.path}>{session.acpSessionId}</p>{close&&<Button variant='outline' onClick={close}>返回 DSH 对话</Button>}</section>}
          {session.approvals.map(a=><section key={a.id} className={css.approval} role='alert'><strong>{catalog?.combinations.find(c=>c.id===session.combination)?.harness??'Harness'} 请求执行操作</strong><pre>{a.title}</pre><div className={css.buttons}>{a.options.map(o=><Button key={o.optionId} variant={o.kind==='allow_once'?'primary':'outline'} disabled={busy} onClick={()=>void act(()=>call('answer',{sessionId:session.id,approvalId:a.id,optionId:o.optionId}))}>{o.kind==='allow_once'?'本次允许':'本次拒绝'}</Button>)}<Button variant='outline' disabled={busy} onClick={()=>void act(()=>call('answer',{sessionId:session.id,approvalId:a.id}))}>取消授权</Button></div></section>)}
        </>:<div className={css.new}><h3>{source?'向另一组合交接任务':'新建对话'}</h3>{source&&<p>来源：{source.title}。请在任务中写明交接内容；另一 Harness 会使用独立上下文。</p>}<label>运行配置<select value={combination} onChange={e=>setCombination(e.target.value)}>{catalog?.combinations.map(c=><option key={c.id} value={c.id} disabled={!c.available}>{c.name}{c.available?'':' · 未就绪'}</option>)}</select></label><p>{catalog?.combinations.find(c=>c.id===combination)?.reason}</p><label>项目目录<input placeholder='/absolute/project' value={cwd} onChange={e=>setCwd(e.target.value)}/></label></div>}
        <form className={css.composer} onSubmit={e=>{e.preventDefault();void submit()}}><label htmlFor='opl-harness-prompt'>{session?'继续此对话':'任务与交接说明'}</label><textarea id='opl-harness-prompt' value={text} onChange={e=>setText(e.target.value)} placeholder='说明目标、范围和验收要求…' disabled={busy}/><Button type='submit' disabled={busy||!text.trim()||(!session&&!cwd)||!!session&&['queued','waiting_child','running','waiting_approval','waiting_input'].includes(session.state)}>发送</Button></form>
      </main>
    </div>
  </div>
}
