/** Rebuild the RPC contract from the real Host sources with official Typert. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FaceModelEmitter, WorkspaceAnalyzer } from '@deepseek-ai/dsh-typert-generator'

export async function generateRpc({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  check = false,
  checkDiagnostics = true,
} = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'opl-dsh-typert-'))
  try {
    // The official analyzer registers packages only below workspace/packages.
    // Copy a disposable source snapshot rather than changing the repository shape
    // or monkey-patching its analyzer. No credentials or runtime data are copied.
    const packageRoot = join(temporary, 'packages', 'opl')
    await mkdir(packageRoot, { recursive: true })
    await cp(join(root, 'src'), join(packageRoot, 'src'), { recursive: true })
    await cp(join(root, 'installer'), join(packageRoot, 'installer'), {
      recursive: true,
    })
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifest))
    for (const name of await readdir(root)) {
      if (/^tsconfig(?:\..+)?\.json$/.test(name))
        await cp(join(root, name), join(packageRoot, name))
    }
    await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'junction')
    const hostConfig = JSON.parse(await readFile(join(root, 'tsconfig.host.json'), 'utf8'))
    // Typert recognizes decorators by their registered package identity. Register
    // the installed protocol declarations unchanged; never emulate decorators.
    const protocolRoot = join(temporary, 'packages', 'protocol')
    await cp(join(root, 'node_modules/@deepseek-ai/dsh-typert-protocol'), protocolRoot, {
      recursive: true,
    })
    await writeFile(
      join(protocolRoot, 'tsconfig.json'),
      JSON.stringify({ files: ['lib/types/index.d.ts'] }),
    )
    const compilerOptions = {
      ...hostConfig.compilerOptions,
      paths: {
        ...hostConfig.compilerOptions.paths,
        '@deepseek-ai/dsh-typert-protocol': [join(protocolRoot, 'lib/types/index.d.ts')],
      },
    }
    await writeFile(
      join(packageRoot, 'tsconfig.host.json'),
      JSON.stringify({ ...hostConfig, compilerOptions }),
    )
    await writeFile(
      join(temporary, 'tsconfig.host.json'),
      JSON.stringify({
        compilerOptions,
        files: [],
        references: [
          { path: './packages/opl/tsconfig.host.json' },
          { path: './packages/protocol/tsconfig.json' },
        ],
      }),
    )
    const workspace = new WorkspaceAnalyzer({
      root: temporary,
      faces: ['host'],
      packages: [manifest.name],
      checkDiagnostics,
    }).analyze()
    const host = workspace.faces.find((face) => face.face === 'host')
    if (!host)
      throw new Error(
        'Typert did not discover the Host package; check package exports and tsconfig.host.json',
      )
    const generated = new FaceModelEmitter(host).emit(manifest.name)
    if (!generated.remote) throw new Error('Typert did not discover any @Remote methods')
    // Emitter paths assume package/lib. Our checked-in files live in
    // src/generated, so relocate only source-navigation metadata.
    const remoteMap = JSON.parse(generated.remote.dtsMap)
    remoteMap.file = 'remote.d.mts'
    remoteMap.sources = remoteMap.sources.map((source) => source.replace(/^\.\.\/src\//, '../'))
    const outputs = {
      'host.mjs': generated.js.replaceAll('"file":"packages/opl/', '"file":"'),
      'host.d.mts': generated.dts,
      'remote.mjs': generated.remote.js.replaceAll('"file":"packages/opl/', '"file":"'),
      'remote.d.mts': generated.remote.dts.replace(
        'sourceMappingURL=typert.remote-client.d.ts.map',
        'sourceMappingURL=remote.d.mts.map',
      ),
      'remote.d.mts.map': `${JSON.stringify(remoteMap)}\n`,
    }
    const drift = []
    if (!check) await mkdir(join(root, 'src/generated'), { recursive: true })
    for (const [name, content] of Object.entries(outputs)) {
      const path = join(root, 'src/generated', name)
      if (check) {
        const current = await readFile(path, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        if (current !== content) drift.push(name)
      } else await writeFile(path, content)
    }
    if (drift.length)
      throw new Error(`RPC generation drift: ${drift.join(', ')}. Run npm run generate:rpc.`)
    return Object.keys(outputs)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  try {
    const unsupported = process.argv
      .slice(2)
      .filter((value) => !['--check', '--skip-typecheck'].includes(value))
    if (unsupported.length) throw new Error(`Unknown arguments: ${unsupported.join(', ')}`)
    await generateRpc({
      check,
      checkDiagnostics: !process.argv.includes('--skip-typecheck'),
    })
    console.log(
      check
        ? 'RPC generated files are current.'
        : 'RPC contracts generated from Host @Remote declarations.',
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
