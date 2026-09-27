# 模型、Harness 与组合

OPL DSH 在官方桌面上提供账号自动配置、Harness 管理和组合选择。模型配置继续由 DSH 保存，官方 DSH 和外部 Harness 分别执行各自的 Agent 循环。

## 数据职责

| 对象               | 唯一配置位置                   | 内容                                                         |
| ------------------ | ------------------------------ | ------------------------------------------------------------ |
| Gateway 账号与分组 | Gateway 账号服务、DSH 凭据服务 | 登录、用量、分组权限、本机激活、各分组 Key、同步错误         |
| 模型               | DSH profile 设置与 LLM 注册表  | 来源、模型 ID、名称、能力、分组路由和协议                    |
| Harness            | OPL Harness 目录               | 程序身份、可执行文件、适配器；安装路径和版本来自本机检测     |
| 组合               | `execution-catalog.json`       | `modelRef`、`harnessRef`、`permissionPolicy`、默认与启用状态 |
| 对话               | 官方 Session 或外部 ACP 会话   | 项目、实际模型与 Harness、权限、历史及协作关联               |

组合不再保存连接或协议。模型列表是 DSH 注册表的只读投影，不写入组合文件。DSH 原生模型页中的 OPL Gateway 子树通过官方 `settings.mutate` 保存模型：DeepSeek 分组位于 `opl-suite.gateway.models`，其他分组位于官方 `llm-pi-ai` 的对应 Provider profile。编辑和运行读取同一份配置。

## Gateway 分组

账号页管理 DeepSeek、OpenAI 协议、Grok、Gemini、AWS、Kiro 六种分组的独立凭据。没有某一组的权限不阻止账号登录，也不影响其他已授权组。页面区分未配置、未授权、凭据就绪和同步错误；凭据就绪不等于真实模型调用已经验收。

登录、刷新时按分组尝试获取模型目录。首次导入和未被用户修改的自动目录可以更新；已有用户模型列表保留。模型页也可手动获取候选模型并保存。自动导入失败时保留已有配置。模型目录所有权摘要保存在原生设置中，不另存一份模型表。

用户只看到一个 OPL Gateway 来源，账号页控制本机激活分组，模型页获取目录并勾选所需模型。停用分组保留 Key、模型配置和已有对话，但阻止新的调用。新加入的 Kiro 默认未激活；升级保留原分组的激活行为。分组路由显式映射，绝不按模型名字猜测，也不在错误后换组：

| 分组        | 默认执行接口                               | 凭据         |
| ----------- | ------------------------------------------ | ------------ |
| DeepSeek    | 官方 DeepSeek adapter / Messages           | DeepSeek Key |
| OpenAI 协议 | 官方 pi-ai 协议适配库 / OpenAI Responses   | Codex Key    |
| Grok        | OpenAI Responses；Grok Build 通过 ACP 执行 | Grok Key     |
| Gemini      | OpenAI Chat Completions，可在模型页调整    | Gemini Key   |
| Kiro        | 官方 pi-ai 协议适配库 / Anthropic Messages | Kiro Key     |
| AWS         | Anthropic Messages                         | AWS Key      |

上述协议是套件默认配置，实际服务支持以端点为准。官方 `dsh-llm-pi-ai` 仅转换模型协议，不负责 Agent 循环。

同名模型具有不同身份：DeepSeek 分组保持历史 ID `deepseek-flash`，OpenAI 协议分组使用 `codex::deepseek-flash`。线上请求仍发送 `deepseek-flash`；组合引用同时确定分组，用户不需要输入内部限定 ID。GPT 通过 OpenAI 协议分组直接调用。默认自动目录不会将 DeepSeek Flash 复制到该渠道，用户可在模型页主动加入。

## 设置与使用

- **OPL Gateway**：Gateway 登录、用量、分组权限与凭据。其他 Provider 保留官方的配置入口。
- **模型**：沿用官方模型页面；OPL Gateway 排在第一位，其他 Provider 和自定义 API 使用官方表单。Gateway 默认显示模型及必要的渠道选项，手动字段和协议放进高级编辑，不要求重填 Key。
- **Harness**：检测 DSH、Grok Build、Codex CLI、Claude Code、Antigravity CLI（agy）的安装、版本与路径；可登记其他程序。Codex CLI 与 Claude Code 会搜索登录 Shell PATH、常见用户目录和官方桌面附带目录；已安装时调用官方更新器，未安装时提供固定官方一键安装入口，安装后重新检测绝对路径和版本。内置 DSH 随官方桌面更新，不可删除。
- **组合**：从 DSH 模型目录选择模型，绑定 Harness 与权限。每个模型可指定一个默认组合；没有自定义默认时，GPT 默认 Codex CLI、Claude 默认 Claude Code，其他模型使用已配置的官方默认组合。

对话输入栏沿用 DSH 原生模型选择器和官方会话 UI，选项显示“模型 · Harness”，来源仅作为展开菜单的分组标题。没有凭据的官方 DeepSeek 模型不作为可选项。可由 DSH 原生 Agent 执行的组合调用官方 Session 的模型选择接口；只读组合可以收窄权限，不会静默扩大当前权限。外部 Harness 组合不接管原生输入框，而是由当前 DSH/Codex 对话通过委派工具创建同项目子任务；原生会话列表不会出现第二套 OPL 管理页面。

每个原生对话选中的组合 ID 保存在 OPL 自有的 `combination-selection.json`，用于重启后区分同一模型的多个自定义组合。它只关联官方会话 ID，不改变官方会话格式；组合停用或模型被其他入口切换后，不再采用失配的关联。

执行器使用官方 DSH、Grok Build、本机 Codex CLI 的 app-server，以及官方 Claude Agent SDK 驱动的本机 Claude Code。OPL 只做协议、权限、显示和协作映射，不实现 Agent 循环。Codex 与 Claude 的配置及会话保存在套件自有目录，不改日常 CLI 配置。Antigravity 暂仅支持本机管理。

各已接入 Harness 的协作工具可以先查询可用组合，再使用组合 ID 派发同项目子任务。Codex Skill 同样通过组合目录派发。各 Harness 保留自己的上下文，交接依靠明确的任务说明。

## 迁移与验证

旧组合目录首次读取时先保留 `.v1.backup`，再转为模型引用。用户名称、默认选择、权限和原会话映射保留；旧自定义模型若未进入原生模型系统，会显示未配置，原声明仍在备份中。发现旧组合的连接与其模型来源冲突时停止迁移并保留文件，避免猜错账号。此迁移只涉及 OPL 组合文件，不改变官方会话格式。

隔离验收使用未修改的官方 0.1.7-rc.2 桌面与本地模拟模型端点，覆盖原生设置写入、模型目录回读、DeepSeek Messages、Codex Chat Completions、官方工具执行及后续模型回复。真实 Gateway 新增分组模型和外部 CLI 的完整调用，需要对应服务和安装环境，不能由本地模拟验收替代。

## 模型与组合的界面规则

模型配置继续写入 DSH 原生设置。Gateway 账号页只管理账号、用量和分组凭据；模型页中的 OPL Gateway 卡片默认平铺模型，同名模型以必要的渠道标记区分，编辑时才展开各调用路由和协议。Key 同步状态不表示真实调用已验证。

新增组合只列出凭据就绪的模型。同名模型的不同计费渠道可分别选用：DeepSeek Flash 的 DeepSeek/OpenAI 协议，以及 Claude Opus 5.5 的 AWS/Kiro；DeepSeek Flash 的 OpenAI 协议渠道必须由用户主动加入。组合绑定精确渠道，不在失败后静默换组。倍率仅显示 Gateway 实际返回值。已有组合的精确模型引用和权限保持不变，失效组合保留并说明原因，不把不可用模型当作新增选项。对话按钮显示“模型 · Harness”，来源只在展开菜单中分组展示。

设置入口按OPL Gateway、模型、Harness、运行配置、协作与自动化排列。官方通用设置、内置插件和 Agent 预设继续由官方维护；Agent 预设控制 DSH 的工具和工作方式，并非另一种 Harness。连接页“管理模型”通过官方 onboarding 的 openSection 导航到原生模型页。

## 通用项目协作

`HarnessService` 是新协作任务的唯一 owner，`harness-sessions/` 同时保存父子关系、冻结的模型引用、任务要求、轮次、交付和验收。`control.ts` 注册官方 DSH 工具；每个外部 Harness 的私有 MCP capability 绑定真实父会话，两者调用相同的 delegate/result/report/review/cancel 方法。外部 Codex 入口单独放在 `coordination/external-codex.ts`，开关不会影响内部工具。旧 dispatch 反馈服务仅保留兼容旧记录。

执行状态与验收状态分开；完成轮次进入 pending 验收，父对话基于实际产物选择 accepted 或 changes_requested。后续修改沿用子会话和 taskId，使用新 operationId。原 operation 重试幂等，变更内容被拒绝。回传以持久 ID 和官方 prompt requestId 去重，只有用户显式重试创建新的交付尝试。重启不会自动重新执行未完成的轮次。

项目写队列覆盖 OPL 托管会话；同步委派时父对话处于 waiting_child，子任务可执行，异步任务在写占用解除后执行。只读任务可以并发。原生 DSH 父对话繁忙时异步写子任务等待，独立原生会话和外部编辑器不在此队列控制范围。

主界面只使用官方会话列表、消息流和输入框；组合、父子关系、子任务轮次、交付与验收仍由 `HarnessService` 后台持久化。没有注入独立会话管理面板，也没有修改官方会话格式或桌面资源。

## 实现边界

Gateway 模型读写由独立 `oplGatewayModels` Remote 负责，不经过首启或 Harness 服务。`oplExecution` 提供运行配置、执行、协作状态及分页读取；账号、首启和 Skill 维护分别挂载。所有 Remote 从同一份服务声明生成 Host 校验和 Client 类型。

会话目录按 ID 分文件保存，原全量文件保留为迁移来源；任务摘要与历史详情分别读取。程序身份、协议桥与环境构造位于各执行器适配模块；主服务管理会话关系、权限和协作规则。具体目录与恢复边界见[开发与验证](development.md)。
