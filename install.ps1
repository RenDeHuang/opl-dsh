# Public bootstrap; requires only Windows PowerShell 5.1 or newer.
param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$stage = Join-Path ([IO.Path]::GetTempPath()) ('opl-dsh-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/gaofeng21cn/opl-dsh/releases/latest' -TimeoutSec 60
    $tag = $release.tag_name
    if ($tag -notmatch '^[a-zA-Z0-9._-]+$') { throw '无法读取 OPL DSH 发布版本。' }
    $base = 'https://github.com/gaofeng21cn/opl-dsh/releases/download/' + $tag
    Write-Output '正在下载并校验 OPL DSH 增强…'
    foreach ($file in @('SHA256SUMS', 'OPL-DSH-Enhancements.zip')) {
        Invoke-WebRequest -UseBasicParsing -Uri ($base + '/' + $file) -OutFile (Join-Path $stage $file) -TimeoutSec 120
    }
    $checksums = Get-Content -LiteralPath (Join-Path $stage 'SHA256SUMS') -Raw
    $match = [regex]::Matches($checksums, '(?m)^([0-9a-f]{64})  (?:[^\r\n ]+/)?OPL-DSH-Enhancements\.zip\r?$')
    if ($match.Count -ne 1) { throw '增强包校验信息无效。' }
    $archive = Join-Path $stage 'OPL-DSH-Enhancements.zip'
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($archive))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
    if ($actual -ne $match[0].Groups[1].Value.ToLowerInvariant()) { throw '增强包校验失败，未执行安装。' }
    $payload = Join-Path $stage 'payload'
    Expand-Archive -LiteralPath $archive -DestinationPath $payload
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $payload 'install.ps1'))
    if ($NoLaunch) { $arguments += '-NoLaunch' }
    & powershell.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw 'OPL DSH 安装未完成，请查看安装日志。' }
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
