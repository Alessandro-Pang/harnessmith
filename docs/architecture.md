# Harnessmith Architecture and Enforcement Model

Harnessmith 是一个本地优先、跨 Host 的 Personal Harness 分发与工作状态控制层，覆盖 Codex、Cursor、
Claude Code、OpenCode 和 DeepSeek Harness。它安全地安装和升级规则与内嵌 Harness CLI，并提供渐进式文档、项目上下文、
非权威记忆和带验收门禁的长任务状态。

| 能力状态 | 边界 |
| --- | --- |
| 已实现（Implemented） | Adapter 分发、安全安装生命周期、渐进式上下文、非权威记忆、任务状态、隐私安全运行审计和本地验证门禁 |
| 由宿主负责（Delegated to the Host） | 模型循环、工具与 MCP 调度、sandbox、权限批准、成本预算和事件流 |
| 不支持（Unsupported） | 通用 Agent Runtime、自动规则提升、Policy Engine、Canonical IR、Pack/Registry 和多 Agent 调度 |

Markdown 规则属于 advisory guidance；安全强制来自安装器、schema、测试、CI 和宿主自身权限。
机器校验的逐项 owner、状态与证据路径见[能力声明—证据矩阵](./capability-evidence.yaml)。

## 四个实现平面

| 平面 | 当前所有者 | 已实现职责 |
| --- | --- | --- |
| Distribution | 外层 `src/` | Adapter、SafePath、staging、进程锁、备份、安装记录、restore、uninstall |
| Guidance & Context | `template/AGENTS.md` 与 `docs/` | 高损失常驻规则、渐进披露、工具与任务路由 |
| Work State | 内嵌 Harness Runtime | 非权威 memory、长任务 ledger、checkpoint、acceptance gate、Host-supplied audit metadata |
| Verification | tests、evals、preflight、CI | schema、行为回归、包边界、跨平台矩阵、maintainer-attested record structure 校验和 executable release gate |

宿主 Enforcement 是外部边界；Evolution 是后续能力。

Host Eval gate 会校验维护者提交记录的 package version、候选 tarball SHA-256、完整 scenario contract、
behavior fingerprint、freshness、脱敏 artifact digest、工具行为、文件差异、逐项 pass 断言、禁止行为
断言和 verdict，并要求当前 release policy 中的必需宿主覆盖完整场景矩阵。当前必需宿主为 Codex；
Cursor、Claude Code、OpenCode 与 DeepSeek Harness 保留为受支持的可选证据。
The gate does not launch or authenticate to any third-party host. 真实宿主执行、脱敏和证据采集仍由明确
授权的维护者或 CI runner 完成。因此 gate
通过只表示“maintainer-attested structure 内部一致且绑定当前候选包”；本地记录和摘要可由仓库写入者
伪造，不能证明证据确由真实 Host 产生、内容完整或 verdict 为真。可信来源需要外部 CI/attestation
和人工证据复核；Harnessmith 仍未接管宿主 Runtime 或权限系统。

## Adapter 能力契约

`createAdapter()` 产生的每个 Adapter 都带有机器可读 `capabilities`，并出现在 dry-run、install
result 与 status JSON 中。

| Adapter | Scope | Instruction format | Native activation | Instruction enforcement | Permissions |
| --- | --- | --- | --- | --- | --- |
| Codex | global | Markdown | host-default | advisory | host-owned |
| Claude Code | global | Markdown | host-default | advisory | host-owned |
| OpenCode | global | Markdown | host-default | advisory | host-owned |
| DeepSeek Harness | global | Markdown | host-default | advisory | host-owned |
| Cursor | project | MDC | always | advisory | host-owned |

Cursor 的 `always` 只用于当前高损失 personal baseline，不表示 Harnessmith 已建模所有宿主原生规则
类型。若未来需要不同激活策略，应先增加真实宿主 Eval，再扩展 capability descriptor。

### DeepSeek Harness 契约来源与验证边界

产品身份（官方坐标）：仓库 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，
npm 包 `@deepseek-ai/dsh`，可执行文件 `dsh`。配置根为 `$DSH_HOME`（默认 `~/.dsh`）；空或仅空白的
`DSH_HOME` 按上游 `resolveDshHome` 视为未设置。契约以官方包文档与
`@deepseek-ai/dsh-agent-instructions` 为准；社区 handbook 仅作参考，不是 DeepSeek AI 官方项目。

**不要把 Adapter 契约等同于「写一个全局 Markdown 文件」。** 产品身份与指令加载是两件事：DSH 会话
baseline 是一条作用域链，而 Harnessmith 只托管其中固定的用户全局一层。

| 范围 | 谁负责 | 说明 |
| --- | --- | --- |
| 用户全局 `$DSH_HOME/AGENTS.md` | Harnessmith Adapter | 唯一安装的指令入口；同根下还有 `agent-harness/`、`.harnessmith/` |
| 项目根 / 嵌套 `AGENTS.md`、`CLAUDE.md` 与 `.local` overlay | 宿主 / 工作区 | 按 Session `cwd`、根标记与候选列表加载；**不在**安装范围内 |
| 权限、sandbox、工具白名单、审批 | 宿主 Runtime | 指令文件仅为 advisory，安装成功不等于强制执行 |
| Cordis patch、`settings.yaml`、凭证 | 宿主 / 用户 | Harnessmith **不**写入、不挂载插件 |

官方规则加载契约来自 `@deepseek-ai/dsh-agent-instructions`：用户全局基线固定为
`$DSH_HOME/AGENTS.md`（该作用域无 local overlay）。因此 DeepSeek Adapter 复用 global Markdown
Adapter，只管理上表「Harnessmith Adapter」行。

| 状态 | DeepSeek 边界 |
| --- | --- |
| 已实现（Implemented） | 用户全局路径解析、`install --dry-run` / `install` / `status` / `restore` / `uninstall`、SafePath、锁、备份、所有权标记与回滚；**不**声称托管完整作用域链 |
| 已在真实宿主验证（Verified on Host） | 尚未提交 maintainer-attested DeepSeek Host Eval；文件存在 ≠ 已验证 Session baseline 注入；发布门禁仍只要求 Codex |
| 由宿主负责（Delegated to the Host） | 项目/嵌套指令发现、模型循环、工具/权限/sandbox/审批、profile/bundle、会话存储与凭证 |

真实 Host Eval 计划（可选证据，不阻断当前 release policy）：在隔离 `$DSH_HOME` 下安装候选包，启动
真实 `dsh` Session，按 `evals/scenarios.json` 跑通场景并写入脱敏 `run.json`；验证宿主确实把
`$DSH_HOME/AGENTS.md` 注入 baseline（而非仅检查文件落盘），且 Harness CLI 健康检查通过。

## 运行审计边界

内嵌 Runtime 的 `audit record` 是 Host-neutral 的显式接入点。Host、CI 或生命周期 hook 负责生成
事件；Harness 只校验、限界、存储和汇总 trace、操作、policy decision/version、耗时、结果、artifact
digest 与可选 token/成本。schema 拒绝原始 prompt、模型输出、tool arguments 和未知字段，活动 JSONL
使用 SafePath、锁、原子写、regular-file 校验以及文件/总量预算。

`health` 会区分“未配置”与损坏状态；`audit maintain` 只读报告保留候选；`audit archive` 默认 proposal，
显式 `--apply` 才移动完整日文件，且不删除归档。该能力不自动捕获 Host 行为，不是权限强制器、项目事实
源、签名证明或远程 attestation。模型循环、工具执行、sandbox、权限事件、稳定 session-end hook 和事件
真实性仍由宿主负责。

## 安装安全边界

有副作用的生命周期操作共享以下安全骨架：

1. canonicalize 用户授权的 Agent home 或项目根；
2. 校验所有 output、record、backup 和 ignore path 的 lexical containment；
3. 对授权根及其下方每个现存路径段执行 `lstat`，默认拒绝 symlink、junction 和 reparse path；
4. 获取每个 Adapter 的跨进程 operation lock，并按路径排序避免多 Adapter 死锁；
5. commit 前再次校验全部目标，每次 mkdir、rename 或 write 前再校验直接目标；
6. 失败时仅按已记录的精确路径回滚。

其中 install 会先完整 staging、渲染并对 `.mjs` 做 JavaScript syntax check；restore 与 uninstall
不重新渲染模板，而是完整预检安装记录、当前受管理文件和备份关系后，按记录执行恢复事务。

Node.js 无法提供跨平台 `openat(O_NOFOLLOW)` 等同语义，因此 TOCTOU 防护是“锁 + commit 前全量
复检 + 每次变更前复检”的 best effort。授权根外的并发攻击者不在正常使用模型内，但任何检测到的
路径替换都会 fail closed。

## 版本与迁移

- npm package version 描述外层安装器发布版本，唯一事实来源是根 `package.json`。
- `harnessVersion` 描述内嵌 Runtime 功能，各 schema version 描述持久化契约；唯一事实来源是
  `template/agent-harness/manifest.json`。
- `harness version --json` 输出全部兼容字段，`validate` 拒绝未知 schema。
- 当前 Task schema 为 3，Memory schema 为 1。读取旧 Task ledger 时执行确定性内存迁移：v1 字符串
  evidence 标记为 `legacy`，v2 typed evidence 标记为 `external`；仍活跃 Task 的旧 `passed` 会降为
  `inconclusive`，必须经 `task verify` 重新机械验证。Memory metadata 只允许通过 proposal-first 的
  `memory migrate` 显式升级；不自动覆盖原记录。

## 发布就绪定义

源码与测试达到 Alpha 质量不等于已发布。首次公开发布至少需要：P0 安全回归、`preflight`、覆盖率、
tarball dry-run、依赖审计、真实 CI 记录、当前 release policy 要求的真实宿主 Eval 证据，
以及正式 Git commit/tag baseline。当前必需宿主为 Codex；Cursor、Claude Code、OpenCode 与 DeepSeek Harness 是受支持但非发布
阻断的可选证据。仓库没有真实运行记录时只能报告“已配置”或“本地通过”，不能报告“跨平台已验证”。
