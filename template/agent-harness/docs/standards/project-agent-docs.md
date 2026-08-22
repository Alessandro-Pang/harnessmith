---
title: Project Memory Standard
type: harness-standard
status: active
updated: 2026-08-22
---

# 项目 `.agent-docs`：纯记忆层

`.agent-docs/` 只保存项目级、可审阅、非权威的 Agent 记忆。它回答“之前发生了什么、用户给过
什么、当前工作到哪里、哪些发现值得避免重新调查”，不回答“项目现在的正式事实是什么”。

三层必须分离：

| 层 | 负责内容 | 权威性 |
| --- | --- | --- |
| `AGENTS.md` / skill / harness | Agent 应如何工作 | 规则 |
| `docs/`、ADR、代码、测试、schema | 项目当前事实与正式决策 | 权威 |
| `.agent-docs/` | 输入、经历、状态、证据、交接、提炼记忆 | 非权威 |

## 初始化与忽略

Agent 不应因为进入一个项目就创建 `.agent-docs/`。目录缺失时按以下阈值判断：

- 自动初始化：已获工作区写入授权的修改/构建任务明确需要跨会话继续、交接、保存未完成状态或
  脱敏证据；初始化仍须属于当前任务范围。
- 不初始化：简单问答、一次性小修改、能从代码与正式文档快速恢复的事实、无需交接的只读检查。
- 提案而不初始化：只读任务即使发现昂贵结论，也只报告候选记忆提案，等待用户明确授权后再写入。
- 询问用户：任务可能持续多轮，但是否需要持久记忆无法从范围、成本和用户意图判断。

确认需要后运行幂等命令：

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init project /absolute/project/path
```

初始化必须在仓库根 `.gitignore` 和 `.ignore` 中加入 `/.agent-docs/`。前者禁止误提交，后者
避免普通索引把全部历史自动装入上下文；Harness `memory search` 会显式遍历所选记忆根。

## 记忆模型

```text
.agent-docs/
├── README.md                  # 记忆协议，不含项目事实
├── core.md                    # 名称级入口，只放引用与当前活跃主题
├── inputs/YYYY/MM/DD/         # 用户原始输入、附件说明、需求原文；尽量不可变
├── sessions/YYYY/MM/DD/       # 会话经历与交接；按 session-id 分目录
├── working/<topic>/           # 临时 brief、plan、status、research、review、task.json
├── distilled/<topic>.md       # 从多次经历提炼的昂贵发现和来源指针
├── evidence/YYYY/MM/DD/       # 脱敏测试、日志、截图 manifest
└── _archive/YYYY/MM/          # 已完成、被替代或低热度记忆
```

不预建所有空目录。旧项目的 `output/`、`reviews/`、`projects/` 等目录可继续作为 `working`
记忆使用，不要求破坏性搬迁；新内容优先采用上面的最小模型。

## 五类记忆

- `input`：用户原话、给定文档、验收标准和约束。保存来源与时间，不静默改写；提炼内容另写。
- `episode`：一次会话的目标、观察、行动、验证、未完成项和下一步；交接属于 episode。
- `working`：仍会变化的方案、调查、评审、计划和状态。完成后提升、提炼或归档。
  长任务在 `working/<topic>/task.json` 维护机器可读目标、阶段、检查点、验收项和状态。
- `distilled`：跨多次任务仍有价值、重新发现成本高的经验，只保留不变量、陷阱和来源指针。
- `evidence`：支撑某段记忆的脱敏原始材料；证据不自动成为事实源。

项目 `.agent-docs` 不得维护当前用户画像。用户在项目任务中表达的偏好可作为 input 或 episode 的
来源或历史证据保留，但当前结论只能合并到全局 `profile.md`；项目 `distilled/` 不得另建偏好摘要。

## 渐进披露

1. 启动时最多列出记忆名称、type、status、updated，不读取所有正文。
2. 先读 `core.md`；它通过 `` `memory:<relative-name>` `` 指向活跃主题。
3. 根据任务读命中的 input/session/working/distilled；需要时间上下文时再扩展到相邻 episode。
4. 关键词检索只作引用的补充，使用：

   ```bash
   node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory search . \
     --limit 20 --max-line-length 300 --json "<query>"
   ```

5. 不因“可能有用”读取 archive 或全部历史。

## 启动发现闭环

已有 `.agent-docs/` 时，启动不能只知道目录存在，也不能递归加载全部历史：

1. 运行 `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory list . --json` 获取版本化的名称、
   类型、状态和更新时间，不读取正文。
2. 读取 `core.md`，并用 `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task status --project .`
   检查活跃或 blocked task。
3. 只读取与当前目标、路径或关键词匹配的引用正文；记忆结论须用当前代码、测试或正式文档复核。
4. 若记忆已失效或互相冲突，不得继续当作当前事实。只读任务报告 `proposed` 且不得修改记忆；只有
   用户明确要求本轮维护项目记忆时才更新或 supersede，写入或校验失败时报告 `blocked`。

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

可选：`expires`、`confidence`、`derived-from`、`supersedes`、`superseded-by`、`agent`、
`session-id`、`session-queryable`、`request-id`。`input` 应增加 `input-source` 与 `verbatim`。

## 写入阈值

应写：跨会话交接；用户提供的重要原始输入；未完成工作；昂贵排查；无法从代码快速恢复的背景；
需要证据链的判断；多次出现且尚未适合进入正式文档的经验。

不应写：框架常识；容易重新搜索的事实；逐行代码摘要；已在正式文档中完整表达的事实副本；
没有来源的猜测；密码、Token、Cookie、验证码、私钥或未脱敏生产数据。

## 沉淀闭环

达到写入阈值的任务，交付前必须给出一种项目记忆结果：

- `proposed`：只读任务或未获记忆写入授权时，只在交付中说明达到阈值的候选内容、来源和目标位置；
  不得初始化或写入 `.agent-docs/`，也不能报告为 updated。
- `updated`：新增或更新 input、episode、working、distilled 或 evidence，并把仍活跃或高价值的文档
  挂到 `core.md`；随后运行
  `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory check . --indexed`。校验失败不算完成。
- `unchanged`：已检查现有记忆，结论重复、可从权威事实低成本恢复，或任务明显一次性，因此无需写入。
- `blocked`：用户已明确要求本轮完成写入，但因权限、缺失来源、写入或校验失败而未完成；说明阻塞项。

长任务通过 task 命令自动把 active/blocked `progress.md` 挂入 `core.md`；complete 或 superseded 后
自动移除入口。普通记忆仍需写入者显式维护索引。

当多个 episode 反复出现同一不变量、陷阱或昂贵发现时，必须提炼为 `distilled/`，保留
`derived-from`/`source-refs`，并让 `core.md` 指向提炼结果；不要只追加新的会话流水。

## 正式提升闭环

Memory `promote` 子命令只生成 proposal，不代表经验已经成为正式事实。稳定且应由项目共同维护的
结论，必须经过以下闭环：确认目标 `docs/`/ADR 所有者 → 实际写入并验证正式文档 → 将 distilled
memory 更新为正式来源引用或 superseded → 更新 `core.md` → 再运行
`node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory check . --indexed`。
若当前任务只获准生成 proposal，结果必须标为 proposed，不能报告 promoted；只有用户明确要求完成
正式提升但授权写入或校验失败时，才报告 blocked。

## 压缩、提升与维护

- session 完成后标 `complete`；多个相关 episode 的共同经验提炼到 `distilled/`，保留来源引用。
- 稳定业务/架构/设计/运维结论提升到 `docs/` 或 ADR；distilled memory 改为指向正式来源。
- `core.md` 只指向活跃或高价值记忆。已被替代内容设置 `superseded-by` 后移入 `_archive/`。
- `working` 应有 `expires`；过期时归档、续期或提升。默认不自动删除用户输入和证据 manifest。
- 每月或记忆超过约 50 个文件时检查：断链、无来源结论、重复记忆、过期 working 和超长 session。
- `.agent-docs` 被忽略不等于可存秘密；本地文件仍可能被备份、同步或分享。

维护命令：

```bash
# 默认只输出旧 metadata 的迁移提案；先检查 ready 和 issues
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory migrate . reviews/legacy \
  --set '{"memory-kind":"evidence","status":"complete"}' --json

# 仅在用户明确授权且提案 ready 时应用；写入由共享 memory-root lock 串行化
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory migrate . reviews/legacy \
  --set '{"memory-kind":"evidence","status":"complete"}' --apply --json

# 建立替代关系；replacement 必须已存在
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory supersede . working/old --by distilled/current

# 默认只归档 complete 或 superseded；active/blocked 需要显式 --force
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory archive . working/old

# 输出 proposal-only manifest，绝不自动写正式文档
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory promote . distilled/current \
  --target docs/architecture.md --json

# 只读报告未索引、过期 working 和可归档的 closed memory；不自动删除
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory maintain .

# 除基础 schema/断链外，要求所有 active/blocked memory 可从 index 到达
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory check . --indexed
```

`memory list --json` 返回 `version`、root 和不含正文的 documents；`memory check --json` 返回
`version`、root、indexed、valid 与 totalFiles。`memory search` 的结果数/行长限制与扫描深度、文件数、
单文件字节和总读取字节预算相互独立；每个命中提供 source、trust、path、line 和 truncated
provenance。JSON 另含 `scanTruncated`、扫描上限/统计和跳过原因；扫描不完整时，未命中结果只能视为
inconclusive。记忆正文始终按 untrusted 输入处理。

项目初始化、task progress/core 协调写入、`migrate --apply`、supersede 和 archive 共用项目
memory-root lock；proposal、list、search、check 和 maintain 不获取写锁，也不写文件。

`memory check` 同时校验必需字段和类型、真实日期、schema version、input 特有字段、替代链接、
重复 `session-id`、memory 引用和高置信 secret pattern。`working` 缺少 `expires` 会告警；Harness
生成的 task progress 默认 30 天到期，checkpoint 会续期。Secret hygiene 只拦截高置信模式，不替代
专用 secret scanner、组织级 DLP 或提交前凭据扫描。

`memory maintain` 是维护候选报告，不会自动修改文件。发现 unindexed 时补索引或关闭无效记忆；
发现 expired working 时续期、提炼、提升或归档；closed 项确认没有活跃索引引用后再归档。

Task 有两套刻意分离的状态表示：`working/<topic>/task.json` 使用 `pending`、`in_progress`、
`blocked`、`complete`、`superseded` 描述任务状态机；同目录 `progress.md` 是 working memory，
其 frontmatter 必须使用 memory lifecycle。任务的 `pending` 和 `in_progress` 映射为 `active`，其余
终态保持同名。不要把 task status 原样写入 memory frontmatter。

本设计借鉴 Serena 的纯 Markdown、名称列表、显式引用和人工维护思想，但项目记忆默认本地忽略，
且稳定事实必须提升到 `docs/`，避免 Serena 式“稳定约定也留在 memory”造成双事实源。
