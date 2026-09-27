import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export async function assertIsolatedRoot(root) {
  const actual = await realpath(root)
  const temporary = await realpath(tmpdir())
  const path = relative(temporary, actual)
  if (
    !path ||
    isAbsolute(path) ||
    path.startsWith('..' + sep) ||
    path === '..' ||
    !path.split(sep)[0].startsWith('opl-dsh-accept-')
  ) {
    throw new Error('必须提供临时 opl-dsh-accept- 隔离目录')
  }
  return actual
}

export async function verifyPayload(payload) {
  const artifact = JSON.parse(await readFile(join(payload, 'artifact.json'), 'utf8'))
  if (!/^opl-dsh-enhancements-[a-zA-Z0-9.-]+\.tgz$/.test(artifact.name))
    throw new Error('增强包清单名称无效')
  if (
    !artifact.payloadFiles ||
    sha256(JSON.stringify(artifact.payloadFiles)) !== artifact.suiteSha256
  )
    throw new Error('套件文件清单摘要不匹配')
  for (const [file, expected] of Object.entries(artifact.payloadFiles)) {
    if (
      isAbsolute(file) ||
      file.includes('\\') ||
      file.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('套件文件路径无效')
    if (sha256(await readFile(join(payload, file))) !== expected)
      throw new Error('套件文件摘要不匹配：' + file)
  }
  if (sha256(await readFile(join(payload, artifact.name))) !== artifact.sha256)
    throw new Error('增强包摘要不匹配')
  return artifact
}

export function safeBinding(binding) {
  const endpoint = new URL(binding.endpoint)
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !Number.isSafeInteger(binding.pid) ||
    binding.pid <= 0 ||
    typeof binding.token !== 'string' ||
    !binding.token
  )
    throw new Error('隔离运行控制绑定无效')
  return binding
}
