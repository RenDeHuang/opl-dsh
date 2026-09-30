# OPL DSH 发布约定

OPL DSH 使用一个联合稳定版本表示一套可安装组合。版本号只递增，不复用，不在稳定渠道发布 `-rc`、`-beta` 或 nightly。

## 命名

- Git tag：`opl-dsh-v<OPL版本>`，例如 `opl-dsh-v0.2.18`。
- Release 名称：`OPL DSH v<OPL版本>`。
- Release channel：GitHub stable release，`draft=false`、`prerelease=false`、`latest=true`。
- Release Note 标题固定为 `## OPL DSH v<OPL版本>`，正文顺序固定为：联合版本、官方 DSH 版本、变更、验证、已知限制、升级方式。

每个稳定 Release 必须同时提供 `release-manifest.json`、`OPL-DSH-Enhancements.zip`、macOS DMG、Windows EXE、`SHA256SUMS` 和官方兼容验收记录。`release-manifest.json` 是 DSH 与 OPL 版本配对的权威清单，要求 tag、清单、增强资产摘要和构建产物彼此一致。

## 联合版本

`releaseVersion` 与 `enhancement.version` 相同，`official.version` 记录本次验收所针对的官方 DeepSeek Harness。官方桌面仍由 DeepSeek 更新清单负责下载和签名校验，OPL 安装器不修改官方应用资源。新的官方桌面版本必须先完成隔离资格验收，再生成新的联合 Release。

## 自动更新

安装器从 GitHub `releases/latest` 解析稳定联合 Release；维护启动器每小时检查一次。更新器依次校验 stable channel、canonical tag、release manifest、GitHub 资产摘要、增强包摘要和逐文件清单，全部一致后才安装。官方桌面更新继续由官方 feed、SHA-512、签名和版本校验负责；运行中的 profile 不替换，失败保留当前版本并写入更新状态。

直接打开官方桌面不会加载外部维护启动器。要自动执行 OPL 更新，用户应从安装器建立的 OPL 维护入口或已启用自动启动的 Codex Skill 启动；官方桌面自身的更新仍按 DeepSeek 原生机制执行。设置中的更新状态显示最近一次联合 Release 检查结果。

## 历史清理

稳定频道只保留一个最新 Release 和一个对应 tag。发布新版本后，删除旧 Release 与旧发布 tag；源码提交和本地安装回执仍保留用于追溯。删除前保存 release/tag 元数据和资产摘要，避免把公开历史误当作恢复凭据。
