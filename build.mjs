/** Build a self-contained enhancement tarball; DSH services stay runtime peers. */
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
const root = import.meta.dirname
const output = join(root, 'dist')
const project = JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const version = project.version
await rm(join(output,'package'), { recursive: true, force: true })
await mkdir(join(output, 'package/lib'), { recursive: true })
await build({entryPoints:[join(root,'src/index.ts')],bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',external:['@deepseek-ai/*'],tsconfig:join(root,'tsconfig.host.json'),outfile:join(output,'package/lib/index.js')})
await build({entryPoints:[join(root,'src/coordination/native-harness-bridge.ts')],bundle:true,platform:'node',format:'esm',target:'node24',outfile:join(output,'package/lib/native-harness-bridge.mjs'),banner:{js:"import { createRequire as oplCreateRequire } from 'node:module'; const require = oplCreateRequire(import.meta.url);"}})
await build({ entryPoints: [join(root,'src/client.tsx')], bundle: true, platform: 'browser', format: 'cjs', outfile: join(output,'client.cjs'), external: ['react','react/*','@deepseek-ai/*'], loader: { '.css': 'local-css' }, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } } })
const client = await readFile(join(output,'client.cjs'),'utf8')
const css = await readFile(join(output,'client.css'),'utf8')
await writeFile(join(output,'package/lib/client.js'), `window.__ModuleLoader__.load({id:"@one-person-lab/dsh-opl",factory:(require)=>{const module={exports:{}};const exports=module.exports;const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);${client}\nreturn module.exports;}});\n`)
let typert = await readFile(join(root, 'src/generated/gateway-host.mjs'), 'utf8')
typert = typert.replace("package: '@one-person-lab/dsh-llm-opl-gateway'", "package: '@one-person-lab/dsh-opl'")
await writeFile(join(output, 'package/lib/gateway.typert.js'), typert)
await cp(join(root,'src/generated/feedback-host.mjs'),join(output,'package/lib/feedback.typert.js'))
await writeFile(join(output,'package/lib/typert.host.js'), `import { TYPERT as gateway } from './gateway.typert.js';
import { TYPERT as feedback } from './feedback.typert.js';
export const TYPERT = { ...gateway, schemas: [...gateway.schemas, ...feedback.schemas], invocations: [...gateway.invocations, ...feedback.invocations] };
`)
const content = await readFile(join(output, 'package/lib/index.js'), 'utf8')
const imports = [...content.matchAll(/from ["']([^"']+)["']/g)].map(x => x[1]).filter(x => !x.startsWith('node:'))
const peers = Object.fromEntries([...new Set(imports)].map(name => [name, '*']))
await writeFile(join(output, 'package/package.json'), JSON.stringify({
  name: '@one-person-lab/dsh-opl', version, type: 'module', license: 'MIT',
  main: './lib/index.js', exports: { '.': './lib/index.js', './client': './lib/client.js', './typert': './lib/typert.host.js', './package.json': './package.json' },
  peerDependencies: peers,
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inject: ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings'], platform: 'web' } }
}, null, 2)+'\n')
await cp(join(root,'installer/skill/harness-mcp.mjs'),join(output,'package/lib/harness-mcp.mjs'))
await cp(join(root,'cordis.patch.yml'),join(output,'package/cordis.patch.yml'))
await mkdir(join(output,'package/licenses'),{recursive:true})
await cp(join(root,'node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md'),join(output,'package/licenses/claude-agent-sdk.md'))
for (const file of ['LICENSE', 'NOTICE']) await cp(join(root,file),join(output,'package',file))
execFileSync('tar', ['-czf', join(output, `opl-dsh-enhancements-${version}.tgz`), '-C', output, 'package'])
const archive = join(output, `opl-dsh-enhancements-${version}.tgz`)
const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
const name = `opl-dsh-enhancements-${version}-${digest.slice(0,12)}.tgz`
await cp(archive,join(output,name))
await writeFile(join(output,'artifact.json'),JSON.stringify({name,sha256:digest})+'\n')
console.log(join(output,name))

const installer = join(output,'OPL DSH 一键安装')
await rm(installer,{recursive:true,force:true})
await cp(join(root,'installer'),installer,{recursive:true})
await cp(join(output,name),join(installer,name))
const payloadFiles = {}
for (const file of ['official-feed.awk', 'compare.cjs', 'install.command', 'install.cmd', 'install.ps1', 'install.mjs', 'profile.cjs', 'migrate.cjs', 'setup.mjs', 'desktop-platform.mjs', 'update.mjs', 'skill-install.mjs', 'skill/SKILL.md', 'skill/control.mjs', 'skill/harness-mcp.mjs', name]) {
  payloadFiles[file] = createHash('sha256').update(await readFile(join(installer,file))).digest('hex')
}
const suiteSha256 = createHash('sha256').update(JSON.stringify(payloadFiles)).digest('hex')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const officialVersion = process.env.OPL_OFFICIAL_VERSION ?? project.devDependencies['@deepseek-ai/dsh-agent']
// The public release identity follows the official desktop. The enhancement
// revision remains an internal rollback/update identity.
const artifact = { version: officialVersion, officialVersion, enhancementVersion: version, sourceCommit, name, sha256: digest, suiteSha256, payloadFiles }
await writeFile(join(output,'artifact.json'),JSON.stringify(artifact,null,2)+'\n')
await writeFile(join(installer,'artifact.json'),JSON.stringify(artifact,null,2)+'\n')
console.log(installer)
