/** Package only an installer and OPL enhancement code, never an official desktop fork. */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
const root=import.meta.dirname, dist=join(root,'dist'), payload=join(dist,'OPL DSH 一键安装')
const artifact=JSON.parse(readFileSync(join(payload,'artifact.json'),'utf8'))
const archive=join(dist,'OPL-DSH-Enhancements.zip')
rmSync(archive,{force:true})
execFileSync('python3',['-c',`import pathlib,sys,zipfile
source=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for path in sorted(source.rglob('*')):
  if path.is_file():archive.write(path,str(path.relative_to(source)))
`,payload,archive])
const stage=join(dist,'dmg-stage');rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true})
const app=join(stage,'安装 OPL DSH.app')
execFileSync('/usr/bin/osacompile',['-o',app,join(root,'packaging/installer.applescript')])
cpSync(payload,join(app,'Contents/Resources/payload'),{recursive:true})
// osacompile creates an ad-hoc signature before resources are added; seal the final bundle.
execFileSync('/usr/bin/codesign',['--force','--sign','-',app])
// This small app is only the installer. The downloaded desktop keeps DeepSeek's identity/signature.
writeFileSync(join(stage,'安装说明.txt'),'打开“安装 OPL DSH”即可联网安装最新官方桌面及 OPL 增强。首次需要下载约 300 MB。\n安装后从用户“应用程序”目录打开 DeepSeek Harness。\n若 macOS 阻止未签名安装器，请在系统设置 → 隐私与安全性允许本次打开。\n')
execFileSync('/usr/bin/hdiutil',['create','-quiet','-volname','OPL DSH','-srcfolder',stage,'-format','UDZO','-ov',join(dist,'OPL-DSH-Installer-mac-arm64.dmg')])
execFileSync('makensis',['-V2',`-DNUMERIC_VERSION=${artifact.officialVersion.split('-')[0]}.0`,`-DOFFICIAL_VERSION=${artifact.officialVersion}`,`-DPAYLOAD=${payload}`,`-DOUTPUT=${join(dist,'OPL-DSH-Installer-windows-x64.exe')}`,join(root,'packaging/installer.nsi')])
for(const name of ['OPL-DSH-Installer-mac-arm64.dmg','OPL-DSH-Installer-windows-x64.exe','OPL-DSH-Enhancements.zip']) console.log(join(dist,name))
