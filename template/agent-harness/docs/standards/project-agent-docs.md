---
title: Project Memory Standard
type: harness-standard
status: active
updated: 2026-08-19
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

- 自动初始化：任务明确需要跨会话继续或交接；用户要求保存输入/方案/上下文；存在未完成状态、
  昂贵排查发现或需要保留的脱敏证据。
- 不初始化：简单问答、一次性小修改、能从代码与正式文档快速恢复的事实、无需交接的只读检查。
- 询问用户：任务可能持续多轮，但是否需要持久记忆无法从范围、成本和用户意图判断。

确认需要后运行幂等命令：

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init project /absolute/project/path
```

初始化必须在仓库根 `.gitignore` 和 `.ignore` 中加入 `/.agent-docs/`。前者禁止误提交，后者
避免普通索引把全部历史自动装入上下文；显式记忆检索必须使用 `--no-ignore`。

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

## 渐进披露

1. 启动时最多列出记忆名称、type、status、updated，不读取所有正文。
2. 先读 `core.md`；它通过 `` `memory:<relative-name>` `` 指向活跃主题。
3. 根据任务读命中的 input/session/working/distilled；需要时间上下文时再扩展到相邻 episode。
4. 关键词检索只作引用的补充，使用：

   ```bash
   node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory search . "<query>"
   ```

5. 不因“可能有用”读取 archive 或全部历史。

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

## 压缩、提升与维护

- session 完成后标 `complete`；多个相关 episode 的共同经验提炼到 `distilled/`，保留来源引用。
- 稳定业务/架构/设计/运维结论提升到 `docs/` 或 ADR；distilled memory 改为指向正式来源。
- `core.md` 只指向活跃或高价值记忆。已被替代内容设置 `superseded-by` 后移入 `_archive/`。
- `working` 应有 `expires`；过期时归档、续期或提升。默认不自动删除用户输入和证据 manifest。
- 每月或记忆超过约 50 个文件时检查：断链、无来源结论、重复记忆、过期 working 和超长 session。
- `.agent-docs` 被忽略不等于可存秘密；本地文件仍可能被备份、同步或分享。

维护命令：

```bash
# 建立替代关系；replacement 必须已存在
harness memory supersede . working/old --by distilled/current

# 默认只归档 complete 或 superseded；active/blocked 需要显式 --force
harness memory archive . working/old

# 输出 proposal-only manifest，绝不自动写正式文档
harness memory promote . distilled/current --target docs/architecture.md --json
```

`memory check` 同时校验必需字段和类型、真实日期、schema version、input 特有字段、替代链接、
重复 `session-id`、memory 引用和高置信 secret pattern。`working` 缺少 `expires` 会告警；Harness
生成的 task progress 默认 30 天到期，checkpoint 会续期。

Task 有两套刻意分离的状态表示：`working/<topic>/task.json` 使用 `pending`、`in_progress`、
`blocked`、`complete`、`superseded` 描述任务状态机；同目录 `progress.md` 是 working memory，
其 frontmatter 必须使用 memory lifecycle。任务的 `pending` 和 `in_progress` 映射为 `active`，其余
终态保持同名。不要把 task status 原样写入 memory frontmatter。

本设计借鉴 Serena 的纯 Markdown、名称列表、显式引用和人工维护思想，但项目记忆默认本地忽略，
且稳定事实必须提升到 `docs/`，避免 Serena 式“稳定约定也留在 memory”造成双事实源。
