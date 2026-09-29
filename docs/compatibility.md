# 官方桌面兼容验证

Linux CI 继续运行 Host / Client 类型检查、构建与全部自动测试。官方桌面兼容工作流在 macOS arm64 与 Windows 上下载并运行未修改的官方桌面，用独立数据目录验证增强包；它不需要模型账号，不访问实际用户 profile。

当前 OPL 增强 `0.2.15` 的开发依赖固定为官方 `0.2.0-rc.2`，macOS arm64 隔离验收通过。上游仍为 RC；OPL 增强稳定渠道与官方桌面渠道分别管理。Windows 安装器继续作为附加资产提供，其运行资格以工作流的单平台结果为准。

## 本机验证

先运行 `npm run build`，再指定已安装的官方应用：

```sh
node scripts/qualify-official-runtime.mjs --app "$HOME/Applications/DeepSeek Harness.app"
```

Windows 的 `--app` 指向包含 `DeepSeek Harness.exe` 的目录。runner 校验官方签名与版本，通过官方插件管理接口向新建的临时 `opl-dsh-accept-*` profile 安装增强包，并指定独立 Electron user-data 目录。它只关闭自己启动的进程树；Suite、Skill 与安装回执均落在该临时根目录；不改用户 Skill 或快捷方式、不停止已有用户桌面。旧数据迁移固定读取临时空目录，避免导入真实账号和会话。

`--evidence <文件>` 指定证据 JSON，默认在 `dist/qualification-<平台>.json`。正常清理会删除临时 profile；排障时可用 `--keep-profile` 保留。保留目录含本次本地测试的控制令牌，不应上传整个目录。

## 验证覆盖与证据

runner 实际执行以下链路，任一步失败均返回非零退出码：

- 官方应用的签名、发布身份与版本校验；验收前后 `app.asar` 摘要一致。
- 增强包与安装文件逐项 SHA-256 校验，记录构建的源码修订、工作区是否有未提交修改、增强版本及套件摘要。
- 官方 Host 启动、控制绑定、认证后的 RPC、模型设置写入及官方模型目录回读。
- 通过仅连接自有 Electron 的调试管道验证 OPL Client 挂载、首启与官方设置导航，打开 Harness、运行配置、协作和模型页面；检查可见错误及运行异常，并保存截图。
- 本地模型 fixture 分别输出 DeepSeek messages 和 OpenAI completions 流；实际官方 Agent 执行工具并完成两次会话。
- 停止自有桌面并重新启动，回读已保存的组合选择。

模型 fixture 证明协议、官方工具执行与本地持久化的兼容性；它不证明外部模型服务的网络、凭据或质量。页面截图与可见性检查可定位加载回归；复杂布局、交互体验仍需结合截图审阅。`status: passed` 只表示 JSON 中列出的检查通过，不把跳过、排队或构建成功写成桌面通过。

## CI 与官方升级

`.github/workflows/official-compatibility.yml` 保留手动触发，并在主线或 PR 的依赖、源码、协议/构建、安装器及资格脚本变化时执行；发布事件也执行。两平台互不取消，失败时仍上传证据文件。配置下载或签名失败会直接失败，不降级为跳过。

CI 使用 `--download` 重用套件现有官方安装器的 HTTPS、SHA-512、签名与版本校验。macOS 使用明确的 arm64 runner。Windows 官方安装器会写入用户注册表和系统快捷方式，因此下载模式仅允许在临时 GitHub Actions runner 执行；开发机器请使用已有官方应用的 `--app` 模式。

每次证据都记录实际运行的 `officialVersion`，而不是把开发依赖固定版本当成桌面版本。官方更新清单会变化，应以对应构建摘要的成功证据为兼容结论。跨平台工作流尚未运行时，仅能报告本机实际执行的平台结果。
