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

确认需要后使用 Harness 的 project init 命令。初始化必须在仓库根 `.gitignore` 和 `.ignore` 中加入
`/.agent-docs/`：前者避免误提交，后者避免普通索引把全部历史装入上下文。

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

已有 `.agent-docs/` 时，任何 commentary 前先单独读取本文件的“输出可见性”段，再按独立阶段执行：

1. 用直接文件系统检查确认绝对项目根下的 `.agent-docs/`；不能因 Git、`rg` 或普通索引未命中而判不存在。
2. 获取不含正文的名称、type、status、updated 列表；无效 JSON 只重试一次，之后标为 `inconclusive`。
3. 读取 `core.md` 与 active/blocked task 状态，再获取只读维护候选。
4. 读取与当前目标、路径或关键词命中的 active/blocked 正文；仅同阶段多篇正文可用只读 `&&`，禁用 `;`。
5. 用当前代码、测试、契约或正式文档复核结论；失败不越级，不递归读取 archive 或全部历史。

未索引或过期不等于无效。仍有恢复价值的条目先修复索引；只有已核验为 contradicted、expired 且无独有
恢复价值的普通记忆，才可进入可恢复归档候选。

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

`input` 另含来源与 verbatim 标记；episode 可含稳定 session identity。具体字段与安全输入方式以 CLI
architecture 为准。

## 写入阈值与 Autopilot

应写：跨会话交接、重要原始输入、未完成工作、昂贵排查、无法从代码快速恢复的背景、需要证据链的判断，
以及多次出现但尚不适合进入正式文档的经验。已初始化项目中，首次或变更的验收、scope、constraints 和
不可廉价恢复 source 应在任务改动前逐字去重捕获；画像或 handoff 不能替代。

不应写：框架常识、容易重新搜索的事实、逐行代码摘要、正式文档的完整副本、无来源猜测，以及密码、
Token、Cookie、验证码、私钥或未脱敏生产数据。

项目 Memory 已初始化，或修改/构建任务符合初始化门槛后，重要输入、typed 经验、交接和索引修复属于
低风险本地 sidecar，无需逐次询问用户。自动权限不扩大到源码、正式文档、远端写入、不可逆删除或任意
自由格式文档；条件存疑时形成 proposal，需要用户决定时标为 blocked。

经验只通过 typed lesson/failure 流程写入，必须有非空 evidence 与来源引用；相同结论合并来源，不追加
重复流水。命令完成后必须校验目标文档、索引和全根 schema；失败时回滚托管写入或保留可恢复路径。

## 输出可见性

自动后台 sidecar 的恢复、检索、写入、校验和维护状态保持静默，不预告、不混入普通 commentary/final，
也不把“已保留”“已归档”“已校验”改写成用户任务结果。

用户明确请求 Memory 操作、交接、状态、审计或变更清单时，不套用后台静默规则；返回最小可核验结果：
`action`、`path`、`validation`。结果为 proposed 或 blocked 时同时说明原因和所需决策。普通任务仍只报告
源码、正式文档、测试或运行结果。

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
- `working` 应有过期时间；过期后选择续期、提炼、提升或可恢复归档，不自动删除 input 与 evidence manifest。
- 维护报告默认只读；迁移、替代和归档写入必须走对应 typed 命令与共享 memory-root lock。
- Memory 扫描必须有文件数、单文件、总字节、深度和时间预算；扫描截断时，未命中只能是 `inconclusive`。
- 托管 Markdown 拒绝符号链接、特殊文件、portable 路径碰撞和越界路径；写入使用 SafePath 预检、secret scan、锁、原子替换与失败回滚。
- `.agent-docs/host-evals/` 是 Host Eval 证据隔离区，不属于 Memory 扫描；必须单独运行 `pnpm run eval:validate`。
- `.agent-docs` 被忽略不等于可存秘密；本地文件仍可能被备份、同步或分享。

Task 的机器状态与 progress memory 是两套刻意分离的表示；验收账本记录机械证据，但不是签名、防篡改日志
或语义评审器。高风险 predicate 应由用户审阅或 CI/Host-owned verifier 持有。
