import { useEffect, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SettingsSection.module.css'
interface Status { installed: boolean; autoStart: boolean; version: string; wakeTransport: string; wakeExecution: string; wakeExecutable: string; wakeDistro: string; update: { state?: string } }
export function CoordinationSection({ call,harnessCall }: { call: (action: string, value?: unknown) => Promise<unknown>;harnessCall:<T>(method:string,input?:unknown)=>Promise<T> }) {
  const [status,setStatus]=useState<Status>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const [cooperation,setCooperation]=useState<{autoReview:boolean;maxRevisions:number;externalCodex:boolean}>()
  useEffect(()=>{void harnessCall<typeof cooperation>('cooperation-settings').then(setCooperation)},[harnessCall])
  const save=async(value:NonNullable<typeof cooperation>)=>{setBusy(true);try{setCooperation(await harnessCall('save-cooperation-settings',value));setNotice('协作设置已保存。')}catch{setNotice('保存失败，请重试。')}finally{setBusy(false)}}
  const load=async()=>setStatus(await call('coordination-status') as Status)
  useEffect(()=>{void load().catch(()=>setNotice('无法读取协作配置，请重新运行增强安装器。'))},[call])
  const act=async(action:string,value?:unknown)=>{setBusy(true);setNotice('');try{await call(action,value);await load();setNotice(action==='wake-settings'?'已保存，重新打开 OPL DSH 后生效。':'已保存。')}catch{setNotice('操作未完成。手动修改过的 Skill 会被保留，请检查安装状态。')}finally{setBusy(false)}}
  return <div className={css.section}>
    <h2 className={css.title}>协作与自动化</h2><p className={css.intro}>在当前项目委派其他运行配置。子任务独立执行，发起对话负责监督和验收。</p>
    <div className={css.card}><h3 className={css.name}>项目内协作</h3><p className={css.muted}>直接在对话中说明“请另一模型完成这项任务”。可查看子任务、处理授权、验收交付或继续修改。同项目托管写任务排队，只读任务可并行。</p>
      {cooperation&&<><div className={css.row}><span>交付后自动唤回发起对话验收</span><Switch label='交付后自动验收' checked={cooperation.autoReview} disabled={busy} onChange={autoReview=>void save({...cooperation,autoReview})}/></div><label className={css.field}>每个任务最多自动要求修改次数<select className={css.input} disabled={busy} value={cooperation.maxRevisions} onChange={e=>void save({...cooperation,maxRevisions:Number(e.target.value)})}>{[0,1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label></>}
      <p className={css.muted}>执行完成后仍需核验实际产物。权限或问题等待由你处理；失败和重启中断不会自动重派。</p>
    </div>
    <details className={css.details}><summary>外部 Codex 接入</summary><div className={css.detailsBody}>
      {cooperation&&<div className={css.row}><span>允许外部 Codex Skill 连接</span><Switch label='允许外部 Codex 接入' checked={cooperation.externalCodex} disabled={busy} onChange={externalCodex=>void save({...cooperation,externalCodex})}/></div>}
      <p className={css.muted}>此开关不影响项目内 Codex CLI 运行配置。</p>
    <div className={css.card}><h3 className={css.name}>{!status ? '正在读取协作状态…' : status.installed ? '协作 Skill 已就绪' : '协作 Skill 未安装'}</h3><p className={css.muted}>支持自动启动、连续任务、权限等待、持久化反馈与结果验收。</p><Button variant='outline' disabled={busy || !status} onClick={()=>{void act('skill-install')}}>{status?.installed?'更新 / 修复 Skill':'安装 Skill'}</Button>
      <div className={css.row}><span>Codex 派发任务时自动启动 DSH</span><Switch label='Codex 派发任务时自动启动 DSH' checked={status?.autoStart??true} disabled={busy||!status} onChange={value=>{void act('auto-start',value)}} /></div>
    </div>
    <details className={css.details}><summary>任务完成通知</summary><div className={css.detailsBody}><p className={css.muted}>任务反馈始终保存在本机。主动唤醒 Codex 需要可用的队列桥；未配置时可在 Codex 中等待或读取反馈。</p>
      {status&&<div className={css.form}>
        <label className={css.field}><span>回调方式</span><select className={css.input} disabled={busy} value={status.wakeTransport} onChange={e=>setStatus({...status,wakeTransport:e.target.value})}><option value='unconnected'>不主动唤醒</option><option value='codex-queue'>Codex 队列桥</option></select></label>
        {status.wakeTransport==='codex-queue'&&<><label className={css.field}><span>运行环境</span><select className={css.input} disabled={busy} value={status.wakeExecution} onChange={e=>setStatus({...status,wakeExecution:e.target.value})}><option value='native'>本机</option><option value='wsl'>WSL</option></select></label><label className={css.field}><span>队列桥可执行文件</span><input disabled={busy} className={css.input} value={status.wakeExecutable} onChange={e=>setStatus({...status,wakeExecutable:e.target.value})}/></label>{status.wakeExecution==='wsl'&&<label className={css.field}><span>WSL 发行版</span><input disabled={busy} className={css.input} value={status.wakeDistro} onChange={e=>setStatus({...status,wakeDistro:e.target.value})}/></label>}</>}
        <Button variant='outline' disabled={busy || !status} onClick={()=>{void act('wake-settings',status)}}>保存通知设置</Button>
      </div>}</div>
    </details>
    </div></details>
    <details className={css.details}><summary>OPL 增强更新</summary><p className={css.muted}>当前官方桌面版本 {status?.version??'—'}。在桌面启动前自动检查并安装兼容增强；应用运行中不更换插件，网络不可用时继续使用当前版本。官方桌面可独立更新。</p></details>
    {notice&&<p className={css.notice} role='status'>{notice}</p>}
  </div>
}
