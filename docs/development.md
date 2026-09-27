# 开发与验证

OPL DSH 维护一个增强包 `@one-person-lab/dsh-opl`，使用未修改的官方 DeepSeek Harness 桌面。各能力有独立的 Host、Client 和契约目录，统一安装、构建、发布与回滚；不要求用户单独管理多个插件版本。

## 模块与依赖

| 目录                | 职责                                                     | 依赖边界                                                                                |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/suite`         | Host/Client 装配、套件配置、执行生命周期连接             | 组合能力，不保存另一套业务状态                                                          |
| `src/gateway`       | 账号、分组凭据、原生模型配置、路由和搜索，以及对应页面   | 不依赖执行与协作模块；`host/execution-access.ts` 提供 Host 内部的模型读取与执行凭据入口 |
| `src/execution`     | Harness 目录、组合、会话、执行器适配、工作区与选择器     | 使用官方 DSH Session 或外部官方执行器，不实现 Agent 循环                                |
| `src/collaboration` | Agent 协作工具、外部 Codex 接入、Skill 管理和反馈        | 共用执行模块的父子对话与交付记录；旧 TaskFeedback 协议用于兼容原生 dispatch             |
| `src/setup`         | 首启与账号选择                                           | 官方账号与稍后设置不依赖 Gateway 服务挂载                                               |
| `src/compat`        | 必要的官方 UI 结构适配、旧调用入口                       | 新客户端不调用旧接口；模型写操作仍归 Gateway                                            |
| `src/shared`        | 共同使用的模型标识、带类型的 Remote 调用、控制传输及样式 | 不保存业务状态，不提供通用杂物接口                                                      |
| `src/contracts`     | 对外公开的纯类型汇总                                     | 用于生成声明；不引入 Host 实现                                                          |
| `src/generated`     | 官方 Typert 生成的 Host/Remote/声明                      | 只从源代码重建，不手工维护                                                              |
| `installer`         | 安装、迁移、更新、官方校验及 Skill 分发                  | 只操作套件拥有的文件，保留用户修改                                                      |

功能内部使用 `host/`、`client/`、`contracts/`。Gateway 模型页面直接调用 `oplGatewayModels`；执行、首启、安装协作设置分别调用 `oplExecution`、`oplSetup`、`oplCoordination`。账户仍使用 `oplGatewayAccount`。Host 与 Client 分别声明实际依赖，执行和 Skill 设置不以账户服务为共同前提。

`npm run check:boundaries` 检查浏览器不得运行 Host 实现、Gateway 不反向依赖执行/协作、首启不得接管其他能力，以及功能不得依赖套件装配。前端数据请求和异步状态由各能力的 hook 管理，视图负责渲染和明确用户操作。

## 构建与契约

开发使用 Node.js 24。

```sh
npm ci --ignore-scripts
npm run generate:rpc
npm run typecheck
npm run check:boundaries
npm run format:check
npm run build
npm test
```

首次运行或修改 `@Remote` 参数与返回值后执行生成。`npm run check:rpc` 只检查漂移，不改文件。生成器使用安装的官方 `dsh-typert-generator`：在临时目录建立它要求的 workspace 布局，分析真实源代码和原版 protocol 声明，完成后移除临时目录。没有手写平行 Schema 或修改上游生成器。

原生 Client、兼容控制入口和 Skill 调用使用同一个生成契约。Provider 专有模型字段使用可递归的 JSON 类型，经过前后端校验后保留，避免编辑显示名称时丢掉模型能力配置。

`build.mjs` 先生成契约，再构建 Host、Client 和外部执行器协议桥。官方服务保持 runtime peer；peer 清单来自构建器依赖元数据。Client 样式跟随插件生命周期释放。增强清单记录官方目标版本、内部修订、源提交、dirty 状态、源树摘要及各发布文件摘要，避免将未提交构建误认为纯 HEAD 产物。

`npm run format` 统一格式；生成文件不经过二次格式化。`npm run package` 创建分发入口。Mac 图形安装器需要系统工具，Windows 安装入口的打包需要 NSIS；用户安装无需自行准备 Node.js。

## 执行器与协作

`execution/host/adapters` 中的 DSH、Grok Build、Codex CLI、Claude Code 各自声明匹配规则和启动方式。外部程序仍保存自己的上下文、工具与原生会话。Codex 使用 app-server，Claude 使用官方 Agent SDK，Grok 使用 ACP。OPL 只转换协议、权限与状态。Harness 注册表同时搜索桌面 PATH、登录 Shell PATH、常见用户目录和官方应用附带 CLI；Codex CLI 与 Claude Code 的安装/更新只走固定官方入口，安装完成后必须重新回读绝对路径和版本。

组合目录只保存模型引用、Harness 引用、默认/启用状态和权限。`ExecutionModelResolver` 从官方模型注册表和 Gateway 读取投影，不另存模型连接。新增执行器应提供一个适配器及其协议/权限/恢复测试，不在中心服务增加账户或 Provider 配置分支。

通用协作后台记录父子对话、明确任务、验收要求、执行状态、交付和回传状态。执行完成不等于验收通过。同项目写任务按现有协作规则排队，只读任务可并行；取消父任务传递给后代，子任务不能扩大权限。主界面保持官方 DSH 会话 UI，不渲染第二套外部会话列表；外部 Codex 开关只限制外部桥接，不关闭内部 Codex CLI 组合。

TaskFeedback 的事件投影、纯状态决策、持久回执与投递调度分别位于 `session-facts.ts`、`state.ts`、`receipts.ts`、`delivery.ts`。Remote 服务仍负责唯一的恢复与编排，不再增加一套通知数据库。

## 数据位置与恢复

| 内容                     | 权威位置                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 官方模型、登录与原生会话 | `DSH_HOME`，默认 `~/.dsh`；由官方设置、凭据和会话服务负责                                                                |
| 组合配置                 | `profiles/desktop/execution-catalog.json`；不保存模型连接和密钥                                                          |
| OPL 会话映射、轮次与交付 | `profiles/desktop/harness-sessions/`，每个会话一个按 ID 哈希命名的文件                                                   |
| 原生对话的组合选择       | `profiles/desktop/combination-selection.json`                                                                            |
| 官方 TaskFeedback 数据   | 官方 Storage Domain 的 `task_feedback` 域                                                                                |
| 套件版本、更新缓存与状态 | 安装回执中的 `suiteRoot`；Mac 默认 `~/Library/Application Support/OPL DSH Suite`，Windows 默认 `%APPDATA%/OPL DSH Suite` |
| Codex Skill 与派发账本   | 回执中的 `skillDir`、`ledgerDir`；已有账本路径在修复时保留                                                               |

安装回执明确 `suiteRoot`、`profileHome`、`skillDir`、`ledgerDir`，profile 下的回执用于找到 Suite。旧回执可从已有 release 路径解析，不猜另一个根目录。自定义 profile 的升级、回滚与启动都显式传递原 profile。

旧 `harness-sessions.json` 首次读取时迁移为按会话文件，完成标记在数据写完后保存；旧文件原样保留。中断迁移补齐缺失文件，不覆盖已经落盘的新数据。非法身份、权限或记录会报错并保留原文件。只序列化和落盘变更的会话；重启把未完成轮次标记为中断，不自动重派。

会话列表返回分页摘要，选中会话返回最近轮次；修订号未变时不返回历史正文。更早轮次按需加载。任务卡片只读取任务摘要与最新验收/回传元数据。分页和全量旧协议各自保持明确调用者，新 UI 不轮询全量历史。

`releases` 保留已安装版本和恢复资料，回执记录 `previousRelease`。当前不会自动删除可能被其他 profile 使用的 release。回滚插件前应保留当前 profile 快照；旧插件无法读取新布局中新发生的会话变更，保留旧文件不等于逆向迁移。

## 两套更新与安装入口

官方桌面自行更新。OPL 增强由维护入口在启动前检查，每小时最多一次；Skill 在需要自动启动桌面时通过维护入口触发。**直接打开官方桌面不会自动调用 OPL 更新器。** 设置页读取 Suite 的真实检查状态，不把直接启动描述为检查成功。

增强更新校验 GitHub 摘要、套件清单与逐文件字节，使用官方插件管理器安装；运行中的 profile 跳过更新，失败保留旧版本并尝试恢复。官方应用使用官方 feed，校验 SHA-512、Bundle ID、Developer ID/Windows 发布者签名及实际版本，不关闭 TLS 或修改签名资源。

Homebrew Cask 固定对应 Release 的 URL 和摘要，调用相同安装器；终端入口解析最新正式 Release。卸载兼容入口保留官方应用、数据和 Skill。旧 V5 开发会话格式仍不伪装成已迁移的官方历史。

## 验证与发布边界

Linux CI 执行契约漂移、模块边界、格式、Host/Client 类型、构建与测试。构建必须先于 artifact 测试。

官方桌面资格工作流在相关变更、发布及手动触发时覆盖 macOS arm64 与 Windows。它使用独立临时 profile 和模拟模型，验证实际 Client 插槽、RPC、两类协议模型流、官方工具、重启恢复及官方应用未修改，产出 JSON 和截图。具体命令和平台要求见 [兼容验证](compatibility.md)。

本地模拟验证不等于真实 Gateway 或所有外部 Harness 组合验收；一台 Mac 的通过也不代表 Windows 通过。发布还需要实际公开资产与摘要回读。本地实现请求不自动触发提交、推送、发布或用户 profile 升级。
