import { useEffect, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { displayModelSource, selectableModels, modelRefKey, type ExecutionCatalog, type CombinationDefinition } from '../coordination/catalog-types.ts'
import type { HarnessCatalog } from '../coordination/harness-types.ts'
import css from './SettingsSection.module.css'
type Call = <T>(method:string,input?:unknown)=>Promise<T>
export function ExecutionCatalogSection({call}:{call:Call}) {
  const [catalog,setCatalog]=useState<ExecutionCatalog>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const [availability,setAvailability]=useState<HarnessCatalog>()
  const [draft,setDraft]=useState({name:'',model:'',harness:'dsh'})
  const [editing,setEditing]=useState<string>()
  useEffect(()=>{void Promise.all([call<ExecutionCatalog>('catalog'),call<HarnessCatalog>('list')]).then(([catalog,status])=>{setCatalog(catalog);setAvailability(status)}).catch(()=>setNotice('无法读取组合目录'))},[call])
  const save=async(next:ExecutionCatalog)=>{setBusy(true);setNotice('');try{setCatalog(await call('save-catalog',{catalog:next}));setAvailability(await call('list'));setNotice('已保存，新的选择使用此配置。')}catch(e){setNotice(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}}
  const update=(id:string,patch:Partial<CombinationDefinition>)=>{
    if(!catalog)return
    const target=catalog.combinations.find(x=>x.id===id)!
    void save({...catalog,combinations:catalog.combinations.map(x=>x.id===id?{...x,...patch,generated:false}:patch.isDefault&&modelRefKey(x.modelRef)===modelRefKey(target.modelRef)?{...x,isDefault:false}:x)})
  }
  return <div className={css.section}><h2 className={css.title}>运行配置</h2><p className={css.intro}>保存模型、渠道、Harness 与权限的搭配，在对话中直接选用。模型在“模型”页管理，账号与凭据在“OPL Gateway”中管理。</p>
    {!catalog&&!notice&&<p className={css.muted} role='status'>正在加载组合…</p>}
    {notice&&<p role='status' className={css.notice}>{notice}</p>}
    {catalog&&<details className={css.details}><summary>添加运行配置</summary><div className={css.detailsBody}>
      <label className={css.field}>名称<input className={css.input} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label className={css.field}>模型<select className={css.input} value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})}><option value=''>选择模型</option>{selectableModels(catalog.models).map(model=><option key={modelRefKey(model.ref)} value={modelRefKey(model.ref)}>{displayModelSource(model.ref,model.source)} · {model.name}{model.available?'':' · 未就绪'}</option>)}</select></label>
      <label className={css.field}>Harness<select className={css.input} value={draft.harness} onChange={e=>setDraft({...draft,harness:e.target.value})}>{catalog.harnesses.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <Button disabled={busy||!draft.name.trim()||!draft.model} onClick={()=>{const model=catalog.models.find(m=>modelRefKey(m.ref)===draft.model);if(!model)return;void save({...catalog,combinations:[...catalog.combinations,{id:crypto.randomUUID(),name:draft.name.trim(),modelRef:model.ref,harnessRef:draft.harness,permissionPolicy:'read-only',isDefault:false,enabled:true}]});setDraft({name:'',model:'',harness:'dsh'})}}>保存运行配置</Button>
    </div></details>}
    {catalog?.combinations.map(item=>{
      const model=catalog.models.find(x=>modelRefKey(x.ref)===modelRefKey(item.modelRef)),harness=catalog.harnesses.find(x=>x.id===item.harnessRef)
      const status=availability?.combinations.find(c=>c.id===item.id)
      return <details className={css.card} key={item.id} open={editing===item.id} onToggle={event=>{const open=event.currentTarget.open;setEditing(current=>open?item.id:current===item.id?undefined:current)}}><summary className={css.header}>
        <span className={css.identity}><strong>{item.name}</strong>{item.isDefault&&item.enabled&&<span className={css.muted}>此模型的默认运行配置</span>}<span className={css.muted}>{displayModelSource(item.modelRef,model?.source)} · {model?.name??item.modelRef.model} · {harness?.name??item.harnessRef}</span></span>
        <span className={css.row}><span className={css.muted}>{!item.enabled?'已停用':status?.available?'可执行':status?.reason??model?.reason??'尚未验证'}</span><Switch label={`启用 ${item.name}`} disabled={busy} checked={item.enabled} onChange={enabled=>update(item.id,{enabled})}/></span>
      </summary>
        <div className={css.detailsBody}>
          <label className={css.field}>配置名称<input className={css.input} defaultValue={item.name} disabled={busy} onBlur={e=>{if(e.target.value!==item.name)update(item.id,{name:e.target.value})}}/></label>
          <div className={css.row}><Switch label='作为此模型的默认运行配置' disabled={busy||!item.enabled} checked={item.isDefault} onChange={isDefault=>update(item.id,{isDefault})}/><span className={css.muted}>默认运行配置</span></div>
          <label className={css.field}>权限<select className={css.input} value={item.permissionPolicy} disabled={busy} onChange={e=>update(item.id,{permissionPolicy:e.target.value as 'workspace'|'read-only'})}><option value='read-only'>只读</option><option value='workspace'>工作区内修改（仍需 Harness 授权）</option></select></label>
        </div>
      </details>
    })}

  </div>
}
