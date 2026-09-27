/** Open the login page or focus the existing runtime using platform shell APIs. */
import { execFileSync } from 'node:child_process'
export function openLoginPage(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
    throw new Error('登录页面必须来自本机 OPL DSH')
  if (process.platform === 'win32')
    execFileSync('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true })
  else execFileSync('/usr/bin/open', [url])
}
export function focusApplication(application) {
  if (process.platform !== 'win32') return execFileSync('/usr/bin/open', ['-a', application])
  const script =
    '$p = Get-Process | Where-Object { $_.Path -eq $env:OPL_APPLICATION_PATH -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { $shell = New-Object -ComObject WScript.Shell; $null = $shell.AppActivate($p.Id) }'
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: { ...process.env, OPL_APPLICATION_PATH: application + '\\DeepSeek Harness.exe' },
  })
}
