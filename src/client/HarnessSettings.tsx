import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HarnessInstallation } from '../coordination/harness-registry-types.ts'
import type { ExecutionCatalog } from '../coordination/catalog-types.ts'
import css from './SettingsSection.module.css'
type Call=<T>(method:string,input?:unknown)=>Promise<T>
export function HarnessSettings({call}:{call:Call}){
 const [draft,setDraft]=useState({name:'',command:''})
 const [items,setItems]=useState<HarnessInstallation[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const load=async()=>{setBusy(true);setError('');try{setItems(await call('harness-installations'))}catch{setError('检测失败，请重试')}finally{setBusy(false)}}
 useEffect(()=>{void load()},[call])
 useEffect(()=>{
  if(!items.some(item=>item.maintenance?.state==='running'))return
  const timer=setTimeout(()=>{void call<HarnessInstallation[]>('harness-installations').then(setItems).catch(()=>setError('更新状态读取失败，请重新检测'))},3000)
  return ()=>clearTimeout(timer)
 },[items,call])
 const update=async(id:string)=>{setBusy(true);setError('');try{await call('harness-update',{id});await load()}catch(e){setError(e instanceof Error?e.message:'无法启动更新')}finally{setBusy(false)}}
 return <div className={css.section}><div className={css.header}><h2 className={css.title}>Harness</h2><Button variant='outline' disabled={busy} onClick={()=>void load()}>{busy?'检测中…':'重新检测'}</Button></div><p className={css.intro}>查看本机已安装的执行程序、版本和官方更新入口。可用的模型 + Harness 组合在“运行配置”页中管理。</p>{error&&<p role='alert'>{error}</p>}
 {busy&&!items.length&&<p className={css.muted} role='status'>正在检测本机执行程序…</p>}
 {items.map(item=><div className={css.card} key={item.id}><div className={css.header}><span className={css.identity}><strong>{item.name}</strong><span className={css.muted}>{item.version??(item.installed?'版本未检测':'尚未安装')}</span></span><span>{item.installed?'已安装':'未安装'}</span></div>{item.error&&<p className={css.muted}>{item.error}</p>}{item.installed&&<p className={css.muted}>{item.runnable?'可用于对话组合':'可在本机终端使用；暂不能用于对话组合'}</p>}{item.website&&<a href={item.website} target='_blank' rel='noreferrer'>官方安装与更新</a>}
 {item.maintenanceAction&&<Button variant='outline' disabled={busy||item.maintenance?.state==='running'} onClick={()=>void update(item.id)}>{item.maintenance?.state==='running'?'正在安装或更新…':item.maintenanceAction==='install'?'安装最新版':'检查并更新'}</Button>}
 {item.maintenance&&<div role='status'><p>{item.maintenance.state==='running'?'正在使用官方更新器，请保持应用运行。':item.maintenance.state==='completed'?'已完成，版本已重新检测。':'未完成，可重新检测或重试。'}</p><details><summary>更新详情</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.maintenance.message}</pre></details></div>}
 {item.id!=='dsh'&&<details><summary>可执行文件路径</summary><input className={css.input} defaultValue={item.path??''} placeholder='绝对路径或 PATH 中的命令' disabled={busy} onBlur={async e=>{const command=e.target.value.trim();if(command===item.path)return;setBusy(true);try{const catalog=await call<ExecutionCatalog>('catalog');catalog.harnesses=catalog.harnesses.map(h=>h.id===item.id?{...h,command}:h);await call('save-catalog',{catalog});await load()}catch{setError('路径未保存')}finally{setBusy(false)}}}/></details>}
 </div>)}
 <details className={css.details}><summary>登记其他 Harness</summary><div className={css.detailsBody}>
 <label className={css.field}>名称<input className={css.input} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label className={css.field}>可执行文件<input className={css.input} value={draft.command} onChange={e=>setDraft({...draft,command:e.target.value})}/></label>
 <p className={css.muted}>可登记并检测本机程序。登记仅用于发现程序和查看路径，不会自动增加对话执行能力。</p>
 <Button disabled={busy||!draft.name.trim()||!draft.command.trim()} onClick={async()=>{setBusy(true);setError('');try{const catalog=await call<ExecutionCatalog>('catalog');catalog.harnesses.push({id:'custom-'+crypto.randomUUID(),name:draft.name.trim(),kind:'acp',command:draft.command.trim()});await call('save-catalog',{catalog});setDraft({name:'',command:''});await load()}catch(e){setError(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}}}>登记 Harness</Button>
 </div></details>
 </div>
}
