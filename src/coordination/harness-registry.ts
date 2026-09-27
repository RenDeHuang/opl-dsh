import { access, constants, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, delimiter, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HarnessDefinition } from './catalog-types.ts'
import type { HarnessInstallation } from './harness-registry-types.ts'
const exec = promisify(execFile)
const info: Record<string,{command:string;website:string;instructions:string}>={
  'grok-build':{command:join(homedir(),'.grok/bin/grok'),website:'https://grok.com/build',instructions:'使用 Grok Build 官方安装器安装或更新；安装后重新检测。'},
  codex:{command:'codex',website:'https://developers.openai.com/codex/cli/',instructions:'使用现有安装的 codex update 检查更新；新安装使用官方安装入口。'},
  claude:{command:'claude',website:'https://code.claude.com/docs/en/setup',instructions:'按 Claude Code 官方指引安装；已有安装可运行 claude update。'},
  antigravity:{command:'agy',website:'https://antigravity.google/docs',instructions:'使用 agy update 检查并更新 Antigravity CLI。'},
}
export async function executablePath(command:string):Promise<string|undefined>{
  const candidates=isAbsolute(command)?[command]:(process.env.PATH??'').split(delimiter).flatMap(root=>[join(root,command),...(process.platform==='win32'?['.exe','.cmd'].map(ext=>join(root,command+ext)):[])])
  for(const path of candidates)if(await access(path,constants.X_OK).then(()=>true,()=>false))return path
  return undefined
}
export async function inspectHarness(harness:HarnessDefinition, home:string, grokCommand?:string):Promise<HarnessInstallation>{
  if(harness.kind==='dsh'){
    const receipt=JSON.parse(await readFile(join(home,'opl-dsh/installation.json'),'utf8').catch(()=>'{}'))
    return {id:harness.id,name:harness.name,installed:true,runnable:true,version:process.env.OPL_OFFICIAL_VERSION??receipt.officialVersion??'由官方桌面提供',instructions:'内置于官方桌面，使用桌面的检查更新。',website:'https://github.com/deepseek-ai/deepseek-harness/releases'}
  }
  const entry=info[harness.id],command=harness.command??(harness.kind==='grok-build'?grokCommand:undefined)??entry?.command
  const path=command?await executablePath(command):undefined
  const maintenanceAction=process.platform==='win32'?undefined:path&&['codex','claude','grok-build','antigravity'].includes(harness.id)?'update':undefined
  const base={id:harness.id,name:harness.name,installed:!!path,runnable:!!path&&(harness.kind==='grok-build'||harness.id==='codex'||harness.id==='claude'),instructions:entry?.instructions??'使用此 Harness 的官方安装与更新方式。',website:entry?.website??'',...(maintenanceAction?{maintenanceAction:maintenanceAction as 'install'|'update'}:{})}
  if(!path)return {...base,error:'未找到可执行文件'}
  try{
    const {stdout}=await exec(path,['--version'],{timeout:5000,maxBuffer:4096,env:Object.fromEntries(['PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SYSTEMROOT','TEMP','TMP','TMPDIR','LANG'].flatMap(key=>process.env[key]?[[key,process.env[key]]]:[]))})
    const version=stdout.trim().split('\n')[0]?.slice(0,150)
    return {...base,path,...(version?{version}:{})}
  }catch{return {...base,path,error:'已发现可执行文件，版本检测未成功'}}
}
