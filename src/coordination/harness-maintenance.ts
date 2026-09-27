/** Official CLI updaters only. The plugin never accepts an arbitrary shell command. */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { HarnessInstallation } from './harness-registry-types.ts'
const exec=promisify(execFile)
export function maintenanceEnvironment():NodeJS.ProcessEnv {
  return Object.fromEntries(['PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SYSTEMROOT','TEMP','TMP','TMPDIR','LANG','LC_ALL','CODEX_HOME','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','NODE_USE_SYSTEM_CA'].flatMap(key=>process.env[key]?[[key,process.env[key]]]:[]))
}
export function maintenancePlan(item:HarnessInstallation):{command:string;args:string[]} {
  if(!item.maintenanceAction)throw Error('请使用此 Harness 的官方安装与更新入口')
  if(['codex','claude','grok-build','antigravity'].includes(item.id)&&item.path)return {command:item.path,args:['update']}
  throw Error('此 Harness 没有自动更新入口')
}
function safeOutput(value:string):string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'').replace(/(Bearer\s+|(?:token|api[_-]?key|password)\s*[=:]\s*)\S+/gi,'$1[REDACTED]').replace(/https?:\/\/[^\s]+/g,'[链接]').trim().slice(-1800)
}
/** Use the existing installation's official updater. */
export async function maintainHarness(item:HarnessInstallation):Promise<{message:string;command:string;expectedVersion?:string}> {
  const plan=maintenancePlan(item),env=maintenanceEnvironment()
  const installedCommand=item.path??''
  try {
    const {stdout,stderr}=await exec(plan.command,plan.args,{env,cwd:homedir(),timeout:600000,maxBuffer:1024*1024})
    const expectedVersion=item.id==='claude'?stdout.match(/Successfully updated from \S+ to version (\d+\.\d+\.\d+)/)?.[1]:undefined
    return {command:installedCommand,message:safeOutput(stdout+'\n'+stderr)||'官方更新器执行完成',...(expectedVersion?{expectedVersion}:{})}
  }catch(error){
    const detail=error as {code?:string|number;stdout?:string;stderr?:string;killed?:boolean}
    throw Error(detail.killed?'更新器超时，请重新检测版本后再操作':`官方更新器未完成（${detail.code??'启动失败'}）：${safeOutput((detail.stderr??'')+'\n'+(detail.stdout??''))}`)
  }
}
