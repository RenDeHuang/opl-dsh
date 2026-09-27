# 开发与验证

OPL DSH 独立维护增强包，复用未修改的官方 DeepSeek Harness 桌面。公开产品版本跟随官方 DeepSeek Harness；插件内部修订号只用于兼容、回滚和自动更新。支持 Apple Silicon Mac 与 Windows x64。

## 代码与构建

- `src/gateway`：账户、分组密钥、明确分组模型路由与原生网页搜索。
- `src/coordination`：协作设置、任务等待、持久化反馈与可选 Codex 队列桥。
- `src/coordination/harness.ts`：外部 Harness 组合的 ACP 子进程、会话恢复、连续提示和取消。
- `src/client`：Gateway、首启和协作设置界面。
- `installer`：官方包校验、默认 `~/.dsh` profile、旧数据导入、兼容入口、Skill 及增强自动更新。
- `install.sh` / `install.ps1`：公开终端入口，选定最新 Release 后下载同一版本的增强 ZIP 与 SHA-256 清单，校验后调用现有安装器。
- `Casks/opl-dsh.rb`：直接以本仓库作为 Homebrew Tap，固定增强 ZIP 的发布地址与 SHA-256；安装时仍动态获取最新官方桌面。

开发需要 Node.js 24；分发安装器使用 Python 3、macOS 系统工具和 NSIS（`brew install nsis`）生成。使用者无需单独安装这些运行时。

```sh
npm ci
npm run typecheck
npm run build
npm test
# 在 macOS 构建两平台入口和内部增强包
node package.mjs
```

构建输出插件 tarball、带逐文件 SHA-256 的安装清单及Mac DMG 和 Windows EXE 在线安装器。桌面官方服务保留为 runtime peer，插件不携带另一套 Agent 循环。`dsh-llm-pi-ai` 为官方协议适配库，Codex 分组模型通过它使用 OpenAI 协议，不会改用 Pi Harness。

新增正式 Release 后，同步更新 Cask 的 `version`（官方版本、OPL 发布修订）和增强 ZIP 的 `sha256`，不得指向可变的 latest 下载地址。终端入口自动解析 latest，无需更新脚本。Cask 只调用 `install.command --no-launch`，不维护第二套安装实现；卸载保留官方桌面、数据和 Skill，只移除经过归属校验的默认快捷入口。

## 模型 + Harness 组合

组合由 `harness.ts` 管理。`来源对话 + 稳定 task ID + 规范项目目录 + 组合` 确定关联对话身份；每轮 operation ID 和指令指纹用于防重派发。`harness-sessions.json` 保存原生会话映射、来源、权限边界和各轮结果。创建前先保存身份，重启将未完成轮次标记为 `interrupted`，不会自行重发。

`DeepSeek-V4.1-Flash + DSH`（模型 ID `deepseek-flash`，来源 OPL Gateway）使用官方 Session API、Workspace Registry、sandbox policy 和 approval policy。子对话加入同项目的官方侧栏，保留原生授权卡片。`Grok + Grok Build`（模型 ID `grok-4.7`）启动官方 `grok agent stdio`，使用 ACP v1 的 initialize、new/load、prompt、update、permission 和 cancel notification。Grok 保留自己的 Agent 循环和会话文件，重启后通过 `session/load` 继续。

DSH Agent scope 注册 `delegate_to_harness`、`harness_result`；Codex Skill 提供 `delegate`、`delegate-start`、`delegate-prompt`、`delegate-list`、`delegate-wait`、`delegate-snapshot` 和 `delegate-cancel`。Grok 通过随 ACP 会话注入的 MCP 协作工具反向委派 DSH。MCP 只持有当前父对话的受限能力，不能使用 Host 全局令牌，不能换项目、提权或操作其他父对话的子任务。跨 DSH/Grok 的协作深度统一限制，取消父任务会取消仍在执行的子任务。

Gateway 分别维护 DeepSeek、Codex、Grok 三组 key。Grok 使用套件独立 `GROK_HOME`，无密钥 TOML 的 `env_key` 引用子进程环境中的 Grok key；模型配置不能放进会过滤 model 表的 `GROK_CONFIG` overlay。缺少对应 key 时明确失败，不读取机器上的其他分组凭据。ACP 权限暂停等待用户在组合面板选择本次允许或拒绝，通用 control bridge 不开放授权接口。

官方 `main` 插槽承载组合工作区，原生模型页保存模型配置，Harness 和组合分别管理；账户菜单只保留设置和账户登录。工作区按项目分组、展示来源/状态/工具/结果，支持新建、继续、取消和显式交接。Codex 原生侧栏任务创建及组合后台通知尚未实现；组合结果使用持久记录与 wait/snapshot，旧 `taskFeedback` 仍仅服务原生 dispatch。Claude、Grok CLI 自动安装及 Windows Grok 是后续扩展，不代表本版已支持。

### 执行目录

`execution-catalog.json` 是用户配置的单一入口，保存 `models`、`harnesses` 和 `combinations` 三类引用。连接、地址、协议和密钥由 DSH 原生模型设置及 Gateway 账号服务负责；组合只保存模型引用、Harness 引用、默认标记、启用状态和权限边界。密钥不写入目录。安装器首次创建 DeepSeek-V4.1-Flash + DSH、Grok + Grok Build 两个默认组合；设置页可以修改组合名称、默认组合和权限边界，也可以登记 OpenAI 兼容模型。没有适配器的自定义组合保留在目录中但显示为不可运行，避免把配置存在误报为真实能力。旧目录中的 `deepseek-v4-pro`、`gpt-5` 和 `gpt-5-mini` 会在读取时过滤并清理。

## 安装位置

| 内容 | macOS | Windows |
| --- | --- | --- |
| 套件与数据 | `~/Library/Application Support/OPL DSH Suite` | `%APPDATA%/OPL DSH Suite` |
| 官方桌面 | `~/Applications/DeepSeek Harness.app` | 优先复用官方已安装位置 |
| OPL 兼容入口 | 套件目录 `launch.command` | 套件目录 `launch.vbs` / 开始菜单 `OPL DSH` |
| Codex Skill | `~/.codex/skills/opl-dsh-official` | `%USERPROFILE%/.codex/skills/opl-dsh-official` |

官方 `~/.dsh` 是唯一 DSH profile；`~/.dsh/opl-dsh/installation.json` 记录与官方 profile 的绑定。套件目录的 `releases` 保留已安装增强和回滚版本，旧 `data` 目录仅作为迁移来源保留。可用 `OPL_CODEX_HOME` 指定 Skill 安装位置；用户手动修改的 Skill 不会被静默覆盖。配置中的自动启动偏好随更新保留。

## 版本与两套更新的边界

公开 Release 使用 `dsh-v<官方版本>-opl.<修订>` 标识，主标题展示官方版本；`enhancementVersion` 仅作为内部递增修订。旧 0.2.x 安装器把 GitHub tag 当内部版本，需运行一次新安装器过渡；新更新器从校验过的增强清单读取修订号，不再耦合公开 tag。

Mac 已安装的官方桌面若不旧于当前 feed 则复用；Windows 优先检查 installation.json 或官方卸载注册表记录的路径，避免官方自行升级后装回旧版本。签名和版本验证始终保留。

官方桌面由官方更新器负责。OPL 快捷入口在启动官方进程前调用 `update.mjs`，读取本仓库最新正式 Release 的 `OPL-DSH-Enhancements.zip`，验证 GitHub 资产摘要、内部清单及每个文件，再使用官方插件管理器安装。增强更新不会重装或修改官方桌面。

运行中 profile 会跳过更新；同一更新过程使用独占锁；离线或验证失败继续旧版。安装失败会尝试恢复上一增强版本。状态写入 `enhancement-update.json`，旧 release 与源数据保留。安装器读取官方桌面 `nightly-mac.yml` / `nightly.yml`，验证清单中的平台下载地址、SHA-512 和 DeepSeek 发布者签名；插件核心依赖保留 runtime peer，不以 SemVer 上限拒绝未来版本（包括 RC）。开发依赖仍固定以保证可复现；官方 API 实质变化仍需重新验收和适配。

首次欢迎仍由官方桌面处理；OPL 插件在官方 profile 加载后提供 Gateway 和组合设置。生产启动不开放 TCP 调试端口，不修改官方签名资源。旧兼容入口只负责增强更新和启动官方程序，不替换官方应用。

## 旧数据

首次安装只在目标不存在时复制旧会话、关联存储、偏好与本产品凭据，排除锁文件、旧运行时 profile 和浏览器鉴权 token。复制前后核对文件大小与修改时间，原目录不变。macOS 默认来源为 `~/.dsh-opl`，Windows 为 `%APPDATA%/@deepseek-ai/dsh-desktop/dsh-home`。

检测到 V5 或更新开发格式时，不导入整组会话及关联存储，记录 `historySkipped`；不把不受官方支持的文件伪装成已迁移。V3 公开版已实际导入并打开。V5 核心格式补丁和旧桌面壳不再维护。

## 验证

发布检查包括 Host/Client 类型检查、模型分组路由和凭据隔离、协作幂等派发、持久化反馈、通知子进程、安装包完整性、更新拒绝条件及迁移边界测试。

隔离官方桌面验收覆盖 macOS 与 Windows 的安装、启动、应用内首启和协作设置。macOS 已使用真实 Gateway 模型执行工具任务、生成结果并保存完成反馈；增强更新后登录、会话、反馈和自动启动偏好保留。官方账号完整外部授权不使用测试人员代登录，已验证授权发起与取消。

测试通过不等于公开发布：发布后须回读 Release 资产及摘要，并验证公开增强资产的实际下载更新路径。

## 官方桌面隔离验收

`node scripts/verify-official-runtime.mjs <临时 opl-dsh-accept- 目录>` 用于已经安装当前增强并启动的隔离官方桌面。脚本只接受系统临时目录下的验收 profile，使用本地模拟端点和虚拟凭据，验证模型设置回读、DeepSeek Messages、Codex Chat Completions、官方工具调用和连续回复。它会修改该隔离 profile；不得指向用户数据目录。真实 Gateway 调用和外部 Harness 完整资格需要另行验证。

重启同一隔离桌面后，在命令末尾加 `--readback-selections`，只回读此前保存的对话组合选择，确认恢复结果。组合关联由 OPL 文件保存，官方会话仍使用官方格式。
