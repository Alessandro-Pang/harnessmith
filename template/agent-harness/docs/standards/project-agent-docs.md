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

已有 `.agent-docs/` 时，任何 commentary 前先单独读取本文件的“输出可见性”段。发现 `.agent-docs/` 后的
首个 Memory 命令必须且只能读取该段，不得与画像、个人规则、其它 Harness 文档、项目索引或正文合并；
随后严格用已解析的 `<harness>` CLI 前缀和项目根 `.` 执行以下独立命令：

`<harness> memory list . --json`
`sed -n '1,260p' .agent-docs/core.md`
`<harness> task status --project . --json`
`<harness> memory maintain . --json`
`memory list` 遇到空输出或非 JSON 时原样重试一次；不得猜测 `report`、`project` 或插入 `--help`。
`maintain` 后读取全部 unindexed、expired 及相关 active/blocked 正文；同阶段多篇只用只读 `&&`，禁用 `;`。
命中正文命令完成后，事实源必须由新的单独命令只读 `sed -n '1,260p' docs/architecture.md`，不得合并。事实核对后，
contradicted 先 `supersede` 再 `archive`，expired 且无独有价值则 `archive`；最后运行
`<harness> memory check . --indexed --json`。事实核对后的 final 以事实本身作主语，例如“当前架构边界为…”；不得使用“仍”或“依然”等依赖历史状态的延续词。完成核对前禁止发送 agent_message/commentary。

完整阶段如下：

1. 用直接文件系统检查确认绝对项目根下的 `.agent-docs/`；不能因 Git、`rg` 或普通索引未命中而判不存在。
2. 获取不含正文的名称、type、status、updated 列表；无效 JSON 只重试一次，之后标为 `inconclusive`。
3. 读取 `core.md` 与 active/blocked task 状态，再获取只读维护候选。
4. 读取与当前目标、路径或关键词命中的 active/blocked 正文；仅同阶段多篇正文可用只读 `&&`，禁用 `;`。
5. 用当前代码、测试、契约或正式文档复核结论；失败不越级，不递归读取 archive 或全部历史。

上述顺序固定为 metadata → `core.md` → active/blocked task → 维护候选 → 命中正文 → 事实源。每个阶段
使用单独命令，不得合并，也不得在这些阶段之间插入 `--help` 或再次路由；前一阶段未完成时不进入下一阶段。
前四阶段不得用 `find`、`rg` 或手工 frontmatter 扫描替代 Harness 报告。

维护候选中的 unindexed、expired 与 active/blocked 条目只要和当前任务相关，就都属于命中正文；全部读取后
才能核对事实源和发送首条 commentary。

事实源阶段读取正式事实后再进行其它源码检索，不得把正式事实源读取与 `rg`、文件枚举或其它检查合并在
同一命令中。

未索引或过期不等于无效。仍有恢复价值的条目先修复索引；只有已核验为 contradicted、expired 且无独有
恢复价值的普通记忆，才可进入可恢复归档候选。
对已核验为 contradicted 的 active/blocked 条目，必须先 `supersede` 再 `archive`；对 expired 且无独有
恢复价值的条目执行 `archive`。修复完成后运行 `memory check <project> --indexed --json` 验证索引闭环。

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
退出 core；`durable` 跨任务有效，进入正式 docs/ADR/测试/schema/规则后应 supersede 并指向正式来源。
版本绑定的风险接受使用 `risk-decision + workstream`，不能无限期保持 active。

输入模式必须显式选择。`verbatim` 正文只允许用户原始字节，不能加入 Agent 解释；任何补全、概括或上下文
拼接都必须使用 `summary`，并显示为“可靠摘要”。标题可以概括，但不能用标题或摘要伪造用户原话。
`capture-input` 的 JSON payload 字段必须严格使用 `title`、`content` 或 `contentFile`、`source`、`mode`、
`purpose`、`retention`，以及可选的 `workstream`、`scope`、`sourceRefs`；数组字段 `sourceRefs` 必须使用复数，
不得把 CLI 选项 `--source-ref` 写成 payload 字段 `sourceRef`，也不得试错后重试 mutation。`source` 只接受
`chat`、`file`、`meeting`、`link`、`other`；当前用户消息固定使用 `chat`，不能写 `user` 或带前缀的变体。

不应写：一次性动作授权、框架常识、容易重新搜索的事实、逐行代码摘要、正式文档的完整副本、无来源猜测，以及密码、
Token、Cookie、验证码、私钥或未脱敏生产数据。

项目 Memory 已初始化，或修改/构建任务符合初始化门槛后，重要输入、typed 经验、交接和索引修复属于
低风险本地 sidecar，无需逐次询问用户。自动权限不扩大到源码、正式文档、远端写入、不可逆删除或任意
自由格式文档；条件存疑时形成 proposal，需要用户决定时标为 blocked。

经验只通过 typed lesson/failure 流程写入，必须有非空 evidence 与来源引用；相同结论合并来源，不追加
重复流水。命令完成后必须校验目标文档、索引和全根 schema；失败时回滚托管写入或保留可恢复路径。

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

达到写入阈值的任务应得到 created、updated、unchanged、proposed 或 blocked 之一。后台成功按上节静默；
明确审计时返回相应结果。proposed 表示未初始化只读项目或超出 sidecar 边界；blocked 表示冲突、敏感信息、
缺少来源、写入失败或校验失败。

多个 episode 反复出现同一不变量、陷阱或昂贵发现时，可形成带来源的 distilled 候选。稳定且应由团队共同
维护的结论必须提升到 `docs/`、ADR、测试、schema、lint 或 CI；先确认 owner，再实际写入和验证正式事实源，
最后把 memory 更新为正式来源引用或 superseded。proposal 不得报告为 promoted。

## 维护与安全

- `core.md` 只指向 active/blocked 或高价值记忆；complete/superseded 内容确认无活跃引用后再归档。
- `memory maintain` 应报告 legacy input、仅含通用动作的 input 和仍 active 的 workstream input，供关闭或迁移审计；报告不自动删除或改写。
- `working` 应有过期时间；过期后选择续期、提炼、提升或可恢复归档，不自动删除 input 与 evidence manifest。
- 维护报告默认只读；迁移、替代和归档写入必须走对应 typed 命令与共享 memory-root lock。
- Memory 扫描必须有文件数、单文件、总字节、深度和时间预算；扫描截断时，未命中只能是 `inconclusive`。
- 托管 Markdown 拒绝符号链接、特殊文件、portable 路径碰撞和越界路径；写入使用 SafePath 预检、secret scan、锁、原子替换与失败回滚。
- `.agent-docs/host-evals/` 是 Host Eval 证据隔离区，不属于 Memory 扫描；必须单独运行 `pnpm run eval:validate`。
- `.agent-docs` 被忽略不等于可存秘密；本地文件仍可能被备份、同步或分享。

Task 的机器状态与 progress memory 是两套刻意分离的表示；验收账本记录机械证据，但不是签名、防篡改日志
或语义评审器。高风险 predicate 应由用户审阅或 CI/Host-owned verifier 持有。
