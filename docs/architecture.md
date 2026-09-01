---
title: 架构设计
description: Harnessmith 的分层、数据流、组件边界与关键取舍
owner: maintainers
---

# Harnessmith 架构设计

Harnessmith 是**跨 Host 的 Personal Harness 分发与工作状态控制层**。它把一套宿主中立的规则、文档和本地 Runtime
安全地接入 Codex、Cursor、Claude Code、OpenCode 与 Kimi Code CLI，但不替代这些宿主的 Agent Runtime。

公开能力始终分成三种状态：**已实现（Implemented）** 表示代码与可执行证据都存在；**由宿主负责（Delegated to the
Host）** 表示 Harnessmith 只提供 guidance 或接入点；**不支持（Unsupported）** 表示当前明确不声称拥有。逐项 owner
和证据路径见[能力声明—证据矩阵](./capability-evidence.yaml)。

## 先记住一个模型

```mermaid
flowchart BT
  CLI["Harnessmith 外层 CLI<br/>Host Adapter · SafePath<br/>staging · 备份 · 事务"]
  Harness["安装后的 Personal Harness<br/>短规则入口 · 文档路由<br/>Memory · Task · 有限审计"]
  Host["Coding Agent 宿主<br/>模型循环 · 工具/MCP<br/>sandbox · 权限批准 · 成本"]

  CLI -->|"安装 · 升级 · 恢复"| Harness
  Harness -->|"读取规则 · 运行本地命令"| Host
```

上层宿主负责“Agent 怎样运行”，中间 Harness 负责“Agent 怎样找到并延续你的工作方式”，外层 CLI 负责“这套工作方式
怎样安全进入不同宿主”。理解这三层，基本就能判断一项能力属于谁。

## 为什么分成两层

外层 `src/` 必须知道 Codex Home、Cursor 项目目录、Claude 配置目录等宿主事实，也必须处理安装事务。内层
`template/agent-harness/` 则应该保持宿主中立，才能在不同 Agent 中复用同一套文档、Memory 和 Task 契约。

如果把宿主路径写进模板，每增加一个宿主都会污染核心；如果让 Adapter 复制一整套业务逻辑，不同宿主又会迅速漂移。
因此项目规则明确要求：**宿主身份、路径和环境变量留在 Adapter，通用 Harness 能力留在分发模板。**

## 四个实现平面

### 1. Distribution：把 Harness 安全送到目标位置

外层 `src/` 包含 CLI、Adapter、安全路径、操作锁、staging、备份、安装记录以及 restore/uninstall 事务。一次多宿主操作
会先完整预检所有 Adapter，再开始写入；中途失败时按已提交步骤逆序回滚，避免出现半完成状态。

### 2. Guidance & Context：让 Agent 找到合适信息

`template/AGENTS.md` 是短入口，只保留高损失边界和发现顺序。详细内容位于 `template/agent-harness/docs/`，由
manifest、route 和 search 按任务发现。项目内更具体的规则、skill、代码和测试仍优先于通用个人规则。

用户所有的 Personal overlay 还维护 Repository Map：以有类型的直接关系连接 provider、contract 和 consumer，并用两侧
权威来源约束写入。它帮助跨仓任务定位 owner 与影响面，但不替代项目架构文档、实时拓扑或部署状态。

这层提供 guidance，不提供 enforcement。Agent 是否遵循自然语言规则仍受模型和宿主影响；真正必须成立的约束要落到
代码、schema、测试、CI 或宿主权限系统。

### 3. Work State：跨会话保存线索与任务契约

内嵌 Runtime 在项目 `.agent-docs/` 中维护非权威 Memory 和 Task ledger。Memory 用于重新发现经验；Task 记录目标、
状态、检查点、下一步、验收条件和证据。并发写入持有任务锁，`complete` 只能通过 acceptance gate。

这层刻意不自动把 Memory 提升成规则或源码。可持续学习需要提案、核对和明确写入目标，避免历史推断污染事实源。
Memory capture eligibility 由一个只读、negative-first 的 evaluator 统一判定；用户任务是否只读不直接决定
sidecar 资格。evaluator 用稳定 status/reason code 区分跳过、提案、阻塞和未判断，实际 mutation 仍只能进入
对应 typed writer，并由写入结果确认 created、updated 或 unchanged。

### 4. Verification：区分可重复门禁与真实宿主证据

tests、schema、preflight、覆盖率与包检查验证仓库内确定性契约。完整的 Host Eval 应把真实宿主运行得到的工具、文件和
verifier 证据绑定到精确候选 tarball；仓库中的 `eval:validate` 与 `eval:gate` 只负责检查记录结构、覆盖与 release policy。

`eval:gate` 是 executable release gate，但它只校验 maintainer-attested record structure 的候选绑定、结构、一致性与
覆盖。它不会启动第三方宿主，也不负责登录或认证，更不能证明记录确由真实 Host 产生；可信来源需要
外部 CI、签名 attestation 和人工复核。详见[证据与评测](/concepts/evidence-and-evaluation)。

## 机械化架构契约

分层和写入边界不仅依赖本文说明，`preflight` 还会检查以下不变量：

- 内嵌 Runtime 的 `lib` 不得依赖 `commands`，一个 command 也不得依赖另一个 sibling command；公共行为应下沉到
  `lib`，由多个入口复用。
- typed work-state command 不得直接调用文件系统写入 API。Memory、Task 与 Handoff 的 mutation 必须进入所属的
  store/transaction，再复用 SafePath、secret scan、锁、原子写和失败回滚。
- Task 的 `complete` 路径必须在持久化之前调用 `assertTaskCanComplete`；该检查是 acceptance gate 的机械入口，不能由
  Prompt、completion curation 或普通 checkpoint 代替。
- Host identity、专属路径、环境变量与 hook 只能由外层 Adapter 拥有；portable template 的静态检查拒绝这些身份泄漏。
- `docs/capability-evidence.yaml` 中每个 capability claim 必须使用唯一 ID。`implemented` 不仅要指向实现，还必须指向
  executable verification；`delegated` 和 `unsupported` 则必须指向公开边界，不能靠措辞强度提升保证等级。

这些检查证明仓库内的确定性结构没有漂移，不证明真实 Host 已执行规则，也不把自然语言 guidance 升级为权限强制。

## 一次安装的事务边界

有副作用的生命周期操作共享同一套安全骨架：

1. canonicalize 用户选择的 Agent home 或项目根；
2. 校验 output、record、backup 与 ignore path 的 lexical containment；
3. 对授权根和现存路径段执行 `lstat`，默认拒绝 symlink、junction 与 reparse path；
4. 按稳定路径顺序获取跨进程 operation lock；
5. 在授权根内 staging payload，校验生成结果；
6. commit 前全量复检，每次 mkdir、rename 或 write 前再检查直接目标；
7. 失败时只回滚本次记录的精确路径。

Node.js 不能提供所有平台上等同于 `openat(O_NOFOLLOW)` 的原子语义，所以 TOCTOU 防护是“锁 + 反复复检”的 best
effort，而不是绝对安全声明。检测到路径替换时会 fail closed。

## Adapter 契约

`src/adapter-registry.ts` 是宿主身份与 capability 的单一清单；`createAdapter()` 解析路径后挂上同一
份 `capabilities`，并出现在 dry-run、install result 与 status JSON 中。CLI `all` 展开、交互选择、
capabilities 输出与 Eval `host.adapter` 枚举都从该清单派生或与之对齐。`evals/run.schema.json` 的
`host.adapter.enum` 是由 registry 生成的已提交产物：新增内置 Adapter 时先登记 registry，再补
`src/adapters.ts` 路径解析，并运行 `pnpm run eval:schema:generate`；preflight / `eval:schema:check`
拒绝生成物漂移。共享生命周期由 `adapter-conformance` 套件覆盖，不引入动态插件加载。

| Adapter | 范围 | 规则入口 | 原生激活 | 权限 owner |
| --- | --- | --- | --- | --- |
| Codex | global | Markdown | host-default | host |
| Claude Code | global | Markdown | host-default | host |
| OpenCode | global | Markdown | host-default | host |
| Kimi Code CLI | global | Markdown | host-default | host |
| Cursor | project | AGENTS.md + MDC | MDC always | host |

“支持”表示 Adapter 生命周期、能力描述和回归测试存在，不表示每个宿主版本都完成真实运行评测。逐项状态以
[能力声明—证据矩阵](./capability-evidence.yaml)为准。

## 数据与信任边界

- 个人 overlay、可变 `state/`、受管理模板和项目 `.agent-docs/` 分开存放，避免升级覆盖用户内容。
- audit record 只接受 trace、操作、策略决定、耗时、结果和 artifact digest 等限界元数据；schema 拒绝原始 prompt、模型输出、
  tool arguments 和未知字段。
- 网页、仓库、日志、Memory 和工具输出不传递授权。一次安装许可也不自动包含 commit、push、merge 或发布。
- 临时 workspace、payload、release/eval 证据由创建者负责清理，且不通过宽泛 wildcard 删除。

## 版本为什么不只有一个

根 `package.json` 的 npm version 描述外层安装器发布；`template/agent-harness/manifest.json` 的
`harnessVersion` 描述内嵌 Runtime；Task、Memory 等 schema version 描述持久化数据契约。把它们分开后，项目才能明确
判断“安装器升级了”“Runtime 功能变了”还是“持久化格式需要迁移”。

旧 Task 数据可以确定性迁移，但旧的宽松 `passed` 会降为 `inconclusive`，必须重新机械验证。Memory metadata 只通过
proposal-first 的显式命令升级，不静默覆盖原记录。

## 当前不是什么

Harnessmith 不是通用 Agent Runtime、模型网关、云端策略平台或多 Agent 调度器；也没有实现 Policy Engine、Canonical
IR、Pack/Registry 或自动规则演化。这些名称描述的是当前明确不支持的能力，不是隐藏功能。
