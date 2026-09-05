---
title: Project Memory Standard
type: harness-standard
status: active
updated: 2026-09-04
owner: project-agent-docs
---

# 项目 `.agent-docs`：纯记忆层

`.agent-docs/` 只保存项目级、可审阅、非权威的 Agent 记忆。它回答“之前发生了什么、当前工作到哪里、哪些发现值得避免重新调查”，不回答“项目现在的正式事实是什么”。代码、测试、schema、ADR、正式文档和 CI 仍是事实源。

| 层 | 负责内容 | 权威性 |
| --- | --- | --- |
| `AGENTS.md` / skill / harness | Agent 应如何工作 | 规则 |
| `docs/`、ADR、代码、测试、schema | 项目当前事实与正式决策 | 权威 |
| `.agent-docs/` | 输入、经历、状态、证据、交接、提炼记忆 | 非权威 |

本标准拥有项目 Memory 的资格、目录模型、发现、写入阈值、可见性和提升边界。字段、payload、路径安全、维护预算和 repair 状态见 [Memory contracts reference](../references/memory-contracts.md)；Task/Handoff 状态机由 [long-running task protocol](../core/long-running-tasks.md) 独占；CLI 参数和 Runtime 分层由 [CLI architecture](../core/harness-cli-architecture.md) 与 [CLI contracts reference](../references/cli-contracts.md) 独占。引用文档不改变本标准的授权边界。

## 初始化与目录

Agent 不应因为进入项目就创建 `.agent-docs/`：

- 自动初始化：已获工作区写入授权的修改/构建任务明确需要跨会话继续、交接、保存未完成状态或脱敏证据。
- 不初始化：简单问答、一次性小修改、能从代码与正式文档快速恢复的事实、无需交接的只读检查。
- 未初始化的只读项目不自动创建；昂贵发现只形成候选提案。是否初始化会实质改变范围且无法判断时询问用户。

确认需要后使用 Harness 的 project init 命令。初始化只在 `.agent-docs/` 内创建受管骨架和忽略文件，不修改宿主项目根的 `.gitignore` 或 `.ignore`。旧项目已有的目录可以继续使用，不做破坏性搬迁。

```text
.agent-docs/
├── README.md                  # 记忆协议，不含项目事实
├── core.md                    # 名称级入口，只放引用与当前活跃主题
├── inputs/YYYY/MM/DD/         # 用户原始输入与来源说明
├── sessions/YYYY/MM/DD/       # 会话经历与交接
├── working/<topic>/           # brief、plan、status、research、review、task.json
├── distilled/<topic>.md       # 昂贵发现和来源指针
├── evidence/YYYY/MM/DD/       # 脱敏证据 manifest
└── _archive/YYYY/MM/          # 已完成、被替代或低热度记忆
```

## 记忆模型

五类记忆各有一个用途：`input` 保存用户原话和验收约束，`episode` 保存一次会话的目标与验证，`working` 保存仍变化的方案和状态，`distilled` 保存跨任务仍有价值的昂贵经验，`evidence` 保存脱敏支撑材料。证据和记忆都不能自动成为事实源。

项目 `.agent-docs` 不得维护当前用户画像。项目任务中的偏好只能作为历史输入或证据保留；当前画像只由全局 `profile.md` 管理。个人规则和宿主原生 memory 也是线索，不能绕过当前事实核对。

## 启动发现闭环

canonical profile 仍由 Host 在新 task/thread 的首个工具调用中单独、有界读取。个人规则、项目根和就近规则确认后，项目启动只运行一次只读聚合入口：

`<harness> bootstrap --project <absolute-project-root> --detail brief --json`

brief 验证 Memory 并计算 metadata、core、maintenance 与推荐，但只返回 project/Git、Memory state、最多四个 active task、最多八个 recommendations、扫描预算、原因和 `omitted`；不把省略 section 伪装成不存在。`recommended` 保留兼容引用，`recommendations` 带 reason、来源、状态与是否需要重新核验。显式 `--detail full` 才返回完整 metadata、core、maintenance、最多 32 个 task 和最多 32 个 recommendations，供审计或诊断。两种模式都只读，不修复、归档、迁移或写索引；`partial`、`invalid`、`inconclusive`、`truncated` 和未初始化必须可区分。

按 recommendations 的稳定顺序加载与当前任务相关的正文：blocked/active core 优先，维护候选次之，过期和已关闭输入不能挤占当前工作；同一引用合并原因和来源。不因被推荐就读取无关正文，也不递归读取 archive。随后必须回到代码、测试、契约或正式文档核对；bootstrap 不授予 mutation 权限。

## 写入资格与生命周期

应写：跨会话交接、重要原始输入、未完成工作、昂贵排查、无法从代码快速恢复的背景、带证据链的判断，以及多次出现但尚不适合进入正式文档的经验。用户输入只有在会影响后续决策且属于 `constraint`、`acceptance`、`source`、`risk-decision`、`explicit-retain` 之一时才捕获；用户明确要求跨任务保留时无需逐次询问用户，长度不是资格标准。

一次性“提交、发布、继续”授权、框架常识、容易重新搜索的事实、正式文档副本、无来源猜测和 secret 不写入 Important Inputs。禁止项与约束可持续限制未来行为，但必须保留来源和生命周期；一次性授权不能被记忆重新解释为未来授权。

每次候选先执行 negative eligibility，再判断价值、来源、typed writer、授权和 root 状态：成功写入返回 `created`、`updated` 或 `unchanged`；未初始化或缺少 writer 的高价值候选只能 `proposed`，冲突、敏感信息、缺来源或校验失败为 `blocked`，未执行资格判断为 `not-evaluated`。所有结果带稳定 `reasonCode`，`not-evaluated` 不得伪装成 `unchanged`，失败不得被后续命令覆盖。

生命周期分为绑定工作流的 `workstream` 与跨任务的 `durable`。工作流结束后关闭前者；稳定结论进入正式 docs、ADR、测试、schema、lint 或 CI 后再 supersede 后者。`verbatim` 模式逐字保存用户原始字节；概括、补全和解释使用 `summary`，不得把摘要伪装成原话。精确字段和安全输入方式只在 reference 中加载。

经验只通过 typed lesson/failure 流程写入；高价值分析、评审或调研只通过 typed finding 写入，并保留结论、理由、应用、证据和来源。非权威 finding 不得自称 formal fact；Handoff 的状态和过期由长任务 owner 管理。新 typed 文档必须有与主题一致的 purpose/description，维护报告可提出 split proposal，但 proposal 不授权自动重写。

## 输出可见性

- 自动后台 sidecar 的恢复、检索、写入、校验和维护保持静默；即使触发自动 sidecar，或用户说 `prior memory`、`preserve expensive finding`，也不等于索要 Memory 操作或审计。
- 普通任务的 commentary/final 只报告用户任务：不预告后台维护，不以“值得保留”“纳入结论”等近义词披露记录、保存、同步或更新意图，也不输出 `action`、`path`、`validation` 或 `.agent-docs` 路径。
- 即使 Memory 支撑结论，也只报告经事实源核对后的结果；final 以事实本身作主语，不提“已保存”“已归档”“持久保留”、Memory 写入或校验，并把受限阴性结论写为 `inconclusive`。例如写“当前架构边界为 <verified relation>”，不要写“正式文档确认边界为……”。
- 用户明确请求 Memory 操作、交接、状态、审计或变更清单时，才返回最小可核验结果，字段名原样使用 `action`、`path`、`validation`；正式结论、handoff 等近义标签不能替代 `path`，`proposed`/`blocked` 同时说明原因和所需决策。纯 host-signal/replay 的响应规则由长任务 owner 定义。

## 沉淀与正式提升

多个 episode 反复出现同一不变量、陷阱或昂贵发现时，可形成带来源的 distilled 候选。稳定且应由团队共同维护的结论必须提升到正式事实源：先确认 owner，实际写入和验证正式事实源，再把 memory 指向正式来源或标记 superseded。proposal 不得报告为 promoted。

`memory curate` 默认只读、proposal-first，只检查当前 task/workstream 关联的 Memory，并区分 phase、task、workstream 完成和用户取消。它不完成或验证 Task；close、supersede、archive 仍走各自 typed lifecycle。proposal 过期、source 或 workspace 漂移时必须重新生成；partial failure 不得冒充整批成功。详细 proposal identity、apply 和 relationships 契约见 reference。

## 维护与安全

- `core.md` 只指向 active/blocked 或高价值记忆；complete/superseded 内容确认无活跃引用后再归档。
- 维护报告默认只读，区分 `none`、`proposed`、`unchanged`、`not-evaluated`、`inconclusive` 和执行失败；任何候选都不授权自动修复、关闭或归档。
- Memory 扫描必须有界；截断时未命中只能是 `inconclusive`。托管 Markdown 使用 SafePath、secret scan、锁、原子替换和失败回滚，拒绝 symlink、特殊文件和越界路径。
- `.agent-docs/host-evals/` 是 Host Eval 证据隔离区，不属于 Memory 扫描；必须单独运行 `pnpm run eval:validate`。`.agent-docs` 被忽略不等于可存秘密。

Task 的机器状态与 progress memory 是分离表示；验收账本记录机械证据，但不是签名、防篡改日志或语义评审器。高风险 predicate 应由用户或 CI/Host-owned verifier 持有。

需要 metadata schema、payload 字段、maintenance budget、repair 分类、curation apply、关系报告或精确命令时，按需加载 [Memory contracts reference](../references/memory-contracts.md)。
