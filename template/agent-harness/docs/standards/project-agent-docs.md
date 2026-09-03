---
title: Project Memory Standard
type: harness-standard
status: active
updated: 2026-08-28
---

# 项目 `.agent-docs`：纯记忆层

`.agent-docs/` 只保存项目级、可审阅、非权威的 Agent 记忆。它回答“之前发生了什么、用户给过什么、
当前工作到哪里、哪些发现值得避免重新调查”，不回答“项目现在的正式事实是什么”。

| 层 | 负责内容 | 权威性 |
| --- | --- | --- |
| `AGENTS.md` / skill / harness | Agent 应如何工作 | 规则 |
| `docs/`、ADR、代码、测试、schema | 项目当前事实与正式决策 | 权威 |
| `.agent-docs/` | 输入、经历、状态、证据、交接、提炼记忆 | 非权威 |

本标准只拥有项目 Memory 的资格、目录模型、发现、写入阈值、可见性和提升规则。Task/Handoff 的状态机与
检查点由 [long-running task protocol](../core/long-running-tasks.md) 定义；CLI 参数、payload schema、
临时文件消费和错误语义由 [Harness CLI architecture](../core/harness-cli-architecture.md) 定义。这里不复制
它们的命令手册。

## 初始化与忽略

Agent 不应因为进入一个项目就创建 `.agent-docs/`：

- 自动初始化：已获工作区写入授权的修改/构建任务明确需要跨会话继续、交接、保存未完成状态或脱敏证据。
- 不初始化：简单问答、一次性小修改、能从代码与正式文档快速恢复的事实、无需交接的只读检查。
- 提案而不初始化：未初始化的只读项目不自动创建 `.agent-docs/`；昂贵发现只形成候选提案。
- 询问用户：是否需要持久记忆会实质改变范围，且无法从成本、任务长度或用户意图判断。

确认需要后使用 Harness 的 project init 命令。初始化只在 `.agent-docs/` 内创建 `.gitignore` 和
`.ignore`，两者都用 `*` 忽略当前目录全部内容；不得修改宿主项目根的 `.gitignore` 或 `.ignore`。

## 记忆模型

```text
.agent-docs/
├── README.md                  # 记忆协议，不含项目事实
├── core.md                    # 名称级入口，只放引用与当前活跃主题
├── inputs/YYYY/MM/DD/         # 用户原始输入、附件说明、需求原文
├── sessions/YYYY/MM/DD/       # 会话经历与交接
├── working/<topic>/           # brief、plan、status、research、review、task.json
├── distilled/<topic>.md       # 昂贵发现和来源指针
├── evidence/YYYY/MM/DD/       # 脱敏测试、日志、截图 manifest
└── _archive/YYYY/MM/          # 已完成、被替代或低热度记忆
```

不预建空目录。旧项目已有的记忆目录可以继续使用，不做破坏性搬迁。

## 五类记忆

- `input`：用户原话、给定文档、验收标准和约束；保存来源与时间，不静默改写。
- `episode`：一次会话的目标、观察、行动、验证、未完成项和下一步。
- `working`：仍会变化的方案、调查、评审、计划和状态。
- `distilled`：跨多次任务仍有价值、重新发现成本高的经验，只保留结论与来源指针。
- `evidence`：支撑记忆的脱敏材料；证据不自动成为事实源。

项目 `.agent-docs` 不得维护当前用户画像。项目任务中的偏好可以作为历史输入或证据保留，但当前画像只
由全局 `profile.md` 管理。

## 启动发现闭环

canonical profile 仍由 Host 在新 task/thread 的首个工具调用中单独、有界读取。个人规则、项目根和就近规则
确认后，项目启动只运行一次只读聚合入口：

`<harness> bootstrap --project <absolute-project-root> --detail brief --json`

brief 仍验证 Memory 并计算 metadata、core、maintenance 与推荐，但只返回 project/Git、Memory state、最多四个
active task、最多八个 recommendations、扫描预算、原因和 `omitted`，不把省略 section 伪装成不存在。`recommended`
保留引用字符串兼容层，`recommendations` 提供 reason codes、来源、状态与是否需要重新核验。显式 `--detail full` 才返回
完整 metadata、core、maintenance、最多 32 个 task 和最多 32 个 recommendations，供审计或诊断。两种模式都只读，
不修复、不归档、不迁移，也不写入索引；未初始化、partial、invalid、inconclusive 和 truncated 必须保持可区分，未命中
不能据此写成不存在。

只按 recommendations 的稳定顺序加载与当前任务相关的正文：blocked/active core 优先，维护候选次之，过期和已关闭输入
不能挤占当前工作；同一引用合并所有原因和来源。不得仅因被推荐就读取与当前任务无关的正文，也不递归读取 archive。Memory 内容仍是
非权威线索；随后必须回到代码、测试、契约或正式文档等事实源核对。需要修复索引、supersede 或 archive 时，
在事实核对和授权完成后再走对应 typed 命令，不能把 bootstrap 当作 mutation 授权。

## 元信息

所有记忆 Markdown 至少包含：

```yaml
---
title: "标题"
description: "这份记忆帮助后续 Agent 回答什么"
type: "user-input | session-handoff | working-note | distilled-memory | evidence-manifest | agent-memory-index"
memory-kind: "input | episode | working | distilled | evidence | index"
status: "active | blocked | complete | superseded | archived"
owners: ["owner"]
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
project: "project-key"
tags: ["stable-keyword"]
scope: ["repo/relative/path"]
source-refs: ["docs/path.md", "commit:<sha>", "session:<id>"]
source-of-truth: false
schema-version: 1
---
```

新建 `input` 使用 input schema v2，另含 `input-purpose`、`retention`、来源和 verbatim 标记；
`retention: workstream` 还必须绑定稳定 `workstream`。episode 可含稳定 session identity。具体字段与安全
输入方式以 CLI architecture 为准。

## 写入阈值与 Autopilot

应写：跨会话交接、重要原始输入、未完成工作、昂贵排查、无法从代码快速恢复的背景、需要证据链的判断，
以及多次出现但尚不适合进入正式文档的经验。用户输入只有在会影响后续决策并属于下列一种目的时，才用
`capture-input`：`constraint`、`acceptance`、`source`、`risk-decision`、`explicit-retain`。已初始化项目中，
首次或变更且达到该门槛的验收、scope/constraints 和不可廉价恢复 source，应在任务改动前逐字去重捕获；
画像或 handoff 不能替代。

不因“这是新用户消息”而捕获。`提交`、`发布`、`继续`、普通确认、状态询问和当前阶段顺序属于一次性动作或
授权，默认不进入 Important Inputs；需要恢复时写入当前 episode/handoff，动作完成后即失效，未来不得据此
再次授权。禁止项与约束采用相反生命周期：例如“不要发布”会持续限制未来行为，直到用户撤销、workstream
关闭或正式规则承接。输入长度不是资格标准；不能用字数门槛漏掉短但高损失的禁止项。

捕获前同时选择生命周期：`workstream` 只对绑定工作流有效，工作流完成后用 `close-input` 标为 complete 并
退出 core；`durable` 跨任务有效，进入正式 apps/docs/site/ADR/测试/schema/规则后应 supersede 并指向正式来源。
版本绑定的风险接受使用 `risk-decision + workstream`，不能无限期保持 active。

输入模式必须显式选择。`verbatim` 正文只允许用户原始字节，不能加入 Agent 解释；任何补全、概括或上下文
拼接都必须使用 `summary`，并显示为“可靠摘要”。标题可以概括，但不能用标题或摘要伪造用户原话。
`capture-input` 的 JSON payload 字段必须严格使用 `title`、`content` 或 `contentFile`、`source`、`mode`、
`purpose`、`retention`，以及可选的 `workstream`、`scope`、`sourceRefs`；数组字段 `sourceRefs` 必须使用复数，
不得把 CLI 选项 `--source-ref` 写成 payload 字段 `sourceRef`，也不得试错后重试 mutation。`source` 只接受
`chat`、`file`、`meeting`、`link`、`other`；当前用户消息固定使用 `chat`，不能写 `user` 或带前缀的变体。

不应写：一次性动作授权、框架常识、容易重新搜索的事实、逐行代码摘要、正式文档的完整副本、无来源猜测，以及密码、
Token、Cookie、验证码、私钥或未脱敏生产数据。

自动捕获候选先用 `memory evaluate-capture --payload-file <path> --json` 执行统一资格判断：先跑
negative eligibility，拒绝一次性授权、可廉价恢复的 durable current value、正式事实副本、secret 与未脱敏数据，
再判断价值、来源、typed writer、授权与安全。用户任务对象是否只读只作为上下文输入，不直接决定 sidecar 资格。
完整结果状态统一为 `created / updated / unchanged / proposed / blocked / not-evaluated`，每个状态都带稳定
`reasonCode`；没有执行资格判断必须返回 `not-evaluated`，不得伪装成 `unchanged`。同一语义结论有新增来源时
优先交给原 typed writer 更新，完全重复才返回 `unchanged`；高价值候选遇到未初始化 root 或缺少 typed writer
时返回 `proposed`，不得直接写托管 Markdown。

项目 Memory 已初始化，或修改/构建任务符合初始化门槛后，重要输入、typed 经验、typed finding、交接和索引修复属于
低风险本地 sidecar，无需逐次询问用户。自动权限不扩大到源码、正式文档、远端写入、不可逆删除或任意
自由格式文档；条件存疑时形成 proposal，需要用户决定时标为 blocked。

经验只通过 typed lesson/failure 流程写入；新文档必须包含非空 conclusion、rationale、application、evidence
与来源引用，旧版 experience 继续可读。高价值分析、评审或调研发现只通过 `capture-finding` 写入，类型限制为
analysis/review/research，并显式标注 `settled-fact`、`current-state`、`verification-pointer`、
`recovery-state` 或 `formal-fact`。非权威 finding 不得自称 `formal-fact`；`durable` 进入 distilled，且不得
保存易漂移的 current/recovery state，可保存用于重取状态的 verifier pointer；`workstream` 进入 working 并
必须绑定稳定 workstream 与 expiry。Handoff 是由 lifecycle 过期的非权威 recovery state。旧文档缺少分类时
保持可读并标为 legacy unclassified，迁移不得猜测。两类写入都按结论 digest 去重并合并来源和证据，不追加重复流水，也不授权修改正式事实源。命令完成后
必须校验目标文档、索引和全根 schema；失败时回滚托管写入或保留可恢复路径。

新 typed 文档必须声明一个与 title 对齐的 `document-purpose`，description 必须包含同一主题。低信息描述只
能在 legacy 文档中以 warning 形式继续读取；新写入必须拒绝。维护报告可以针对重复 purpose 或多个顶层
purpose/结论标题提出 split proposal，但 proposal 不授权自动拆分、重写正文或合并不同 conclusion digest。

## 输出可见性

即使触发自动 sidecar，也不等于索要操作、状态或审计。用户要求使用 `prior memory` 或
`preserve expensive finding` 只触发后台 sidecar，不构成显式 Memory 审计请求。

自动后台 sidecar 的恢复、检索、写入、校验和维护状态保持静默，不预告、不混入普通 commentary/final，
也不把“已保留”“已归档”“已校验”改写成用户任务结果。
普通 commentary 只描述用户任务，不得说将记录、保存、同步或更新偏好、验收约束、Memory、profile、
handoff 或 checkpoint，也不得用“值得保留”“纳入结论”或近义词披露任何后台保存意图。

普通任务中的 Memory 恢复、检索、修复、归档和校验均属后台 sidecar，不得出现在 commentary/final；
即使 Memory 支撑了结论，也只报告经事实源核对后的用户任务结果。
普通任务的 final 不得提及“持久保留”“已保存”“归档”、Memory 写入或 Memory 校验，也不得用近义表述披露
后台 sidecar 的维护结果。
普通任务的 final 应以独立句直接陈述经事实源核对的结论，不把“结论：”等标签和事实断言写在同一句中。
final 应以事实本身作主语，例如“当前架构边界为 `<verified relation>`”；不要写成“正式文档确认边界为…”，
来源另列为证据；也不要使用“仍”或“依然”等依赖历史状态的延续词。
普通任务不得输出 `action`、`path`、`validation` 或任何 `.agent-docs` 路径；仅当用户明确请求 Memory
操作、交接、状态、审计或变更清单时才输出这些审计字段。

用户明确请求 Memory 操作、交接、状态、审计或变更清单时，不套用后台静默规则；返回最小可核验结果：
`action`、`path`、`validation`。字段名必须原样输出为 `action`、`path`、`validation`；即使存在多个正式
文档或 Memory 路径，也统一列在 `path` 下，“正式结论”、`handoff` 等近义标签不能替代 `path`。结果为
proposed 或 blocked 时同时说明原因和所需决策。普通任务仍只报告源码、正式文档、测试或运行结果。

纯 host-signal/replay 的输出和执行语义由 long-running task protocol 统一定义，本节不重复其状态机。

## 沉淀与正式提升

达到写入阈值的任务应得到 created、updated、unchanged、proposed、blocked 或 not-evaluated 之一。后台成功按上节静默；
明确审计时返回相应结果。proposed 表示未初始化只读项目或超出 sidecar 边界；blocked 表示冲突、敏感信息、
缺少来源、写入失败或校验失败。

多个 episode 反复出现同一不变量、陷阱或昂贵发现时，可形成带来源的 distilled 候选。稳定且应由团队共同
维护的结论必须提升到 `docs/`、ADR、测试、schema、lint 或 CI；先确认 owner，再实际写入和验证正式事实源，
最后把 memory 更新为正式来源引用或 superseded。proposal 不得报告为 promoted。

`memory promote` 的 typed proposal 只允许 ADR、docs、tests、schema、lint 与 CI 六类正式载体。它必须列出
候选 Memory、目标路径与 owner、理由、原始证据、精确 verifier、source freshness、目标 dirty state、授权状态与
未满足条件；输出不会创建或修改目标。目标已承接结论时，只有显式 adoption evidence 才能形成 supersede candidate，
该 candidate 仍不是已采纳事实，也不能绕过 owner 确认、正式 verifier 或 typed lifecycle mutation。

任务或阶段结束后可运行 `memory curate <project> --task <id> --json` 获取默认只读、proposal-first 策展报告。
报告把 `phase-complete`、`task-complete`、`workstream-complete` 与 `user-cancel` 分开，并只检查当前
task/workstream 关联的 Memory；输出 promote、close、supersede、archive、skipped 候选或 `result: none`。
task complete 不自动表示 workstream complete，不能据此关闭仍有效的 input 或 handoff。报告不证明任务完成，
也不会自动 mutation。候选必须包含稳定 proposal identity、source digest、workspace digest、`expiresOn`、前置条件与 verifier。
只有显式选择有界 proposal 集并提供 `--yes` 才能进入 apply；执行前重新验证 source、Task、引用、cycle、权限和 dirty drift，
stale、changed 或 expired proposal 必须重新生成。promotion 只调用正式 promotion proposal，不写事实源；close、supersede、
archive 仍走现有 typed lifecycle 及其 inbound reference、状态、cycle、lock 与 rollback 门禁。输出逐项 action、reason、
validation、recovery path 和 remaining proposals；partial failure 不冒充整批成功。curation apply 与 acceptance gate 独立。
多个 `task:` source ref 表示共享 owner；只结束其中一个 task/workstream 时不得关闭或归档该文档。

`memory relationships <project> --json` 只读汇总 Task、默认 phase/workstream、Memory、session 与 owner 关系，
并报告 orphan task reference 和 cross-workstream binding。关系报告不是新的权威状态层；Task ledger 继续拥有
acceptance，Handoff 只拥有 recovery state。任务切换到同一 Handoff 的第二个独立 task 时必须使用
`checkpoint-reason: multi-task`。

## 维护与安全

- `core.md` 只指向 active/blocked 或高价值记忆；complete/superseded 内容确认无活跃引用后再归档。
- `core.md` 使用 host-neutral 保守预算：soft limit 为 160 行或 24 KiB，hard limit 为 240 行或 48 KiB，
  单条入口最多 512 UTF-8 bytes。每条非占位 bullet 必须只有一个 canonical `memory:` pointer，同一引用不得
  重复；soft limit 产生压缩候选，hard limit、长条目或正文式入口由 `memory check` 拒绝。该预算不声明
  任一宿主的固定上下文窗口，也不会自动删除被引用文档。
- `memory maintain` 应报告 legacy input、仅含通用动作的 input 和仍 active 的 workstream input，供关闭或迁移审计；报告不自动删除或改写。
- `memory maintain` 的 typed candidate 必须同时给出 category、outcome、reason code、证据、建议动作、风险及 eligibility 状态；
  汇总层分开表达 `none`、`proposed`、`unchanged` mutation、`not-evaluated` coverage、`inconclusive` scan/source
  与 execution failure。缺失或未执行不是阴性结论，任何候选都不授权自动修复、关闭或归档。
- `working` 应有过期时间；过期后选择续期、提炼、提升或可恢复归档，不自动删除 input 与 evidence manifest。
- 维护报告默认只读；迁移、替代和归档写入必须走对应 typed 命令与共享 memory-root lock。
- Memory 扫描必须有文件数、单文件、总字节、深度和时间预算；扫描截断时，未命中只能是 `inconclusive`。
- 托管 Markdown 拒绝符号链接、特殊文件、portable 路径碰撞和越界路径；写入使用 SafePath 预检、secret scan、锁、原子替换与失败回滚。
- `.agent-docs/host-evals/` 是 Host Eval 证据隔离区，不属于 Memory 扫描；必须单独运行 `pnpm run eval:validate`。
- `.agent-docs` 被忽略不等于可存秘密；本地文件仍可能被备份、同步或分享。

Task 的机器状态与 progress memory 是两套刻意分离的表示；验收账本记录机械证据，但不是签名、防篡改日志
或语义评审器。高风险 predicate 应由用户审阅或 CI/Host-owned verifier 持有。
