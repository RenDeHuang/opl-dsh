#!/bin/bash
# Public bootstrap: resolve a single release, verify its payload, reuse the installer.
set -euo pipefail
umask 077
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo '此命令支持 Apple Silicon Mac；Windows 请使用 README 中的 PowerShell 命令。' >&2
  exit 1
fi
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/opl-dsh-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
BASE='https://github.com/gaofeng21cn/opl-dsh/releases'
LATEST="$(curl --fail --silent --show-error --location --retry 2 --max-time 60 --proto '=https' --proto-redir '=https' -o /dev/null -w '%{url_effective}' "$BASE/latest")"
TAG="${LATEST#"$BASE/tag/"}"
[[ "$LATEST" == "$BASE/tag/"* && "$TAG" =~ ^opl-dsh-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo '无法读取 OPL DSH 稳定发布版本。' >&2; exit 1; }
echo '正在下载并校验 OPL DSH 增强…'
for FILE in SHA256SUMS release-manifest.json OPL-DSH-Enhancements.zip; do
  curl --fail --silent --show-error --location --retry 2 --max-time 120 --proto '=https' --proto-redir '=https' "$BASE/download/$TAG/$FILE" -o "$STAGE/$FILE"
done
EXPECTED="$(awk '$2 ~ /(^|\/)OPL-DSH-Enhancements\.zip$/ {print $1}' "$STAGE/SHA256SUMS")"
[[ "$EXPECTED" =~ ^[0-9a-f]{64}$ ]] || { echo '增强包校验信息无效。' >&2; exit 1; }
ACTUAL="$(shasum -a 256 "$STAGE/OPL-DSH-Enhancements.zip" | awk '{print $1}')"
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo '增强包校验失败，未执行安装。' >&2; exit 1; }
MANIFEST_EXPECTED="$(awk '$2 ~ /(^|\/)release-manifest\.json$/ {print $1}' "$STAGE/SHA256SUMS")"
[[ "$MANIFEST_EXPECTED" =~ ^[0-9a-f]{64}$ ]] || { echo '联合发布清单校验信息无效。' >&2; exit 1; }
MANIFEST_ACTUAL="$(shasum -a 256 "$STAGE/release-manifest.json" | awk '{print $1}')"
[[ "$MANIFEST_ACTUAL" == "$MANIFEST_EXPECTED" ]] || { echo '联合发布清单校验失败，未执行安装。' >&2; exit 1; }
RELEASE_VERSION="${TAG#opl-dsh-v}"
[[ "$(/usr/bin/plutil -extract channel raw -o - "$STAGE/release-manifest.json")" == stable ]] || { echo '发布清单不是稳定版。' >&2; exit 1; }
[[ "$(/usr/bin/plutil -extract tagName raw -o - "$STAGE/release-manifest.json")" == "$TAG" ]] || { echo '发布清单 tag 与下载版本不符。' >&2; exit 1; }
[[ "$(/usr/bin/plutil -extract releaseVersion raw -o - "$STAGE/release-manifest.json")" == "$RELEASE_VERSION" ]] || { echo '发布清单版本与下载版本不符。' >&2; exit 1; }
ditto -x -k "$STAGE/OPL-DSH-Enhancements.zip" "$STAGE/payload"
/bin/bash "$STAGE/payload/install.command" "$@"
