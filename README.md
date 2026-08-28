# Harnessmith

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.en.md) · **简体中文**

Harnessmith 是一个本地优先、跨 Host 的 Personal Harness 分发与工作状态控制层。它把同一套个人
工作规则、渐进式文档、记忆协议和任务状态工具，安全地安装到 Codex、Cursor、Claude Code、OpenCode 与 Kimi Code CLI。

```bash
npx harnessmith
```

一次配置，多端保持一致。你的 coding agent 会知道如何开始任务、何时读取上下文、怎样保护现有改动，
以及在什么条件下才能宣告完成。

## 为什么需要 Harnessmith

不同 Agent 的规则文件、作用域和目录结构各不相同。手工维护通常会遇到三个问题：规则逐渐漂移、
升级容易覆盖个人内容、长任务换会话后丢失上下文。

Harnessmith 将它们拆成职责清晰的四层：

| 层 | 解决什么问题 |
| --- | --- |
| Instructions | 为每个宿主安装紧凑、常驻的高损失规则 |
| Progressive docs | 按任务类型读取详细流程，不把整套手册塞进上下文 |
| Memory & work state | 保存非权威记忆、紧凑用户画像和可恢复的长任务状态 |
| Installer safety | 通过预检、备份、校验、锁与回滚保护用户文件 |

| 能力状态 | 边界 |
| --- | --- |
| 已实现（Implemented） | 跨宿主分发、安全安装生命周期、渐进式上下文、非权威记忆、可恢复任务状态与隐私安全运行审计 |
| 由宿主负责（Delegated to the Host） | 模型循环、工具执行、sandbox、权限审批、成本与事件流 |
| 不支持（Unsupported） | 通用 Agent Runtime、自动改写规则、Policy Engine、Pack/Registry 与多 Agent 调度 |

Markdown 规则属于行为引导；真正的安全强制仍由安装器、测试、CI 和宿主权限系统承担。
每项公开声明的 owner、状态、实现与验证路径见[能力声明—证据矩阵](./docs/capability-evidence.yaml)。

## 30 秒开始

要求 Node.js 24.12 或更高版本。

```bash
# 交互式选择要安装的 Agent
npx harnessmith

# 或直接安装到 Codex
npx harnessmith --agent codex

# 写入前先查看所有目标和动作
npx harnessmith --agent all --project /absolute/path/to/repository --dry-run
```

安装完成后，Harnessmith 会初始化：

- 宿主对应的规则入口和内嵌 Harness CLI；
- 用户维护的 `~/.agent-harness` personal overlay；
- 默认位于 `~/.agent-docs` 的跨项目个人记忆；
- 最多 32 条、按当前状态原位更新的紧凑用户画像。

> [!NOTE]
> **使用 LLM 或 coding agent 安装**
>
> 将下面的指令直接发送给 AI。它会先读取 npm `latest` 发布包中的 [llms.txt](https://unpkg.com/harnessmith@latest/llms.txt)，再按照同一发布通道的安装流程、目标核对、权限边界和失败处理规范完成安装。
>
> `请先阅读 https://unpkg.com/harnessmith@latest/llms.txt，并按照其中的协议从 npm latest 通道为我安装 Harnessmith。`

## 支持的 Agent

| Agent | 生效的规则入口 | Harness 目录 | 作用域 |
| --- | --- | --- | --- |
| Codex | `$CODEX_HOME/AGENTS.md` | `$CODEX_HOME/agent-harness` | 全局 |
| Claude Code | `$CLAUDE_CONFIG_DIR/CLAUDE.md`，并保留 `AGENTS.md` | `$CLAUDE_CONFIG_DIR/agent-harness` | 全局 |
| OpenCode | `$OPENCODE_CONFIG_DIR/AGENTS.md`；未设置时 `${XDG_CONFIG_HOME:-~/.config}/opencode/AGENTS.md` | 对应配置根下 `agent-harness` | 全局 |
| Kimi Code CLI | `$KIMI_CODE_HOME/AGENTS.md`；未设置时 `~/.kimi-code/AGENTS.md` | 对应数据根下 `agent-harness` | 全局 |
| Cursor | `<project>/.cursor/rules/agent-harness.mdc` | `<project>/.cursor/agent-harness` | 项目 |

Cursor 的文件化规则按项目安装。使用 `--project` 指定仓库；Harnessmith 只把自己管理的文件写入
repository-local Git exclude 和 `.cursor/.ignore`，不会隐藏或覆盖团队已有的整个 `.cursor/` 目录。

Kimi Code CLI 支持 `0.12.0` 及以上版本；Harnessmith 只适配当前 Node.js 版 Kimi Code CLI，不接管旧 Python
`kimi-cli` 的 `~/.kimi/` 目录。
配置契约以 Kimi Code CLI 官方 [数据位置](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html)
和 [AGENTS.md 自定义](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents) 文档为准。

## 常用操作

```bash
# 安装单个或多个 Agent
npx harnessmith install --agent codex
npx harnessmith --agent codex,cursor,claude,opencode,kimi --project /absolute/path/to/repository

# 为自动化输出稳定的 JSON Lines
npx harnessmith --agent all --project . --dry-run --json

# 只读查看各 Adapter 的作用域、激活和 enforcement owner
npx harnessmith capabilities --agent all --json

# 查看安装所有权与文件完整性
npx harnessmith status --agent all --project .

# 恢复上一层安装
npx harnessmith restore --agent codex

# 逐层恢复到首次安装前
npx harnessmith uninstall --agent codex

# 安装后聚合检查 Runtime、安装与全局记忆健康度
node <harness-path>/bin/harness.mjs health --json

# 由 Host 显式提交不含原始内容的运行元数据
node <harness-path>/bin/harness.mjs audit record --payload-file /absolute/event.json --json
```

只有项目已经执行过 `init project` 时，才应再传 `health --project <absolute-path>` 检查项目记忆；
未初始化项目记忆不等于安装不健康。

`audit record` 是 Host-neutral 的显式接入点：Harness 只保存 trace、操作、policy decision、耗时、结果、
artifact digest，以及可选 token/成本；拒绝原始 prompt、模型输出和 tool arguments。Host 仍负责模型
循环、工具与权限事件的产生，Harness 不会自动观察未接入的运行过程。`audit maintain` 只读报告保留
候选，`audit archive` 默认 proposal，只有 `--apply` 才把完整日文件移入保留区。

`restore` 和 `uninstall` 不会删除共享/项目 `.agent-docs` 或用户维护的 personal overlay。`--yes` 只
关闭交互，并在没有指定 Agent 时默认选择 Codex；它**不会**自动同意文件冲突。只有审阅目标并接受
备份接管后，才应使用 `--force`。

## 你会得到什么

### 渐进式规则

常驻 `AGENTS.md` 只保留高损失、不可推断的默认规则；诊断、评审、变更、发布、Git 和工具路由等
详细流程按任务读取。宿主显式加载的项目规则可细化项目工作，但不能扩大权限或降低安全要求。

内嵌 CLI 的 `route` / `explain` 根据 manifest trigger 只返回命中的文档名称、路径和 trigger，不加载
正文。`search` 的 `--limit` 只限制结果数；扫描另有独立的条目、目录、深度、文件、单文件字节、
总字节和时间预算，具体默认值以 JSON `scanLimits` 与 `--help` 为准。JSON 同时返回 provenance、
`scanTruncated`、`scanStats` 和结构化跳过原因；普通输出也会提示扫描不完整。

### 分层记忆

Harnessmith 将“如何工作”“用户是谁”“之前发生了什么”和“项目当前事实”刻意分开：

| 位置 | 保存内容 | 边界 |
| --- | --- | --- |
| 宿主原生 memory | 宿主自动召回的历史线索 | 只作待核对输入，不是 Harness 当前画像 |
| `~/.agent-harness` | 用户维护的个人规则和仓库关系 | 属于规则 overlay，不是记忆；升级和卸载不会覆盖 |
| `~/.agent-docs/profile.md` | 当前身份、工作方式、技术背景、偏好和研究方向 | Harness 内唯一当前用户画像；仅跨任务 `explicit/high` 信号自动原位更新，可暂停或遗忘 |
| `~/.agent-docs/core.md` 与其他全局 memory | 跨项目活跃主题、经历及高价值提炼发现 | 只保留名称级入口、来源和上下文，不保存第二份当前画像 |
| `<project>/.agent-docs` | 项目输入、会话、工作状态、证据、提炼发现和历史归档 | 可审阅但非权威；目录内自带 ignore 文件，不修改项目根 ignore 配置 |
| `docs/`、ADR、代码、测试、schema、lint、CI | 项目当前事实、正式决策与可执行约束 | 权威层；稳定结论最终应提升到这里 |

项目 `.agent-docs` 采用渐进披露的最小模型：

```text
.agent-docs/
├── core.md                 # 活跃主题与高价值记忆入口
├── inputs/                 # 用户原话、附件说明、验收标准
├── sessions/               # 会话经历、交接、未完成项与下一步
├── working/                # 计划、调研、评审、状态和长任务账本
├── distilled/              # 多次经历提炼出的昂贵发现与来源指针
├── evidence/               # 脱敏测试、日志、截图 manifest
└── _archive/               # 已完成、被替代或低热度记忆
```

这些内容对应 `input`、`episode`、`working`、`distilled`、`evidence` 五类记忆；`core.md` 是索引。
长任务的目标、checkpoint、验收项和下一步保存在 `working/<task-id>/task.json`，稳定事实仍必须提升到
正式事实层。记忆支持 `active`、`blocked`、`complete`、`superseded`、`archived` 生命周期，以及
检查、检索、替代、归档和 proposal-only 提升。`memory check --indexed` 会拒绝无法从索引到达的
active/blocked 记忆，`memory maintain` 只读报告未索引、过期 working、可归档内容、重复 active title、
supersession cycle，以及待审阅的 legacy、通用动作和 workstream input。

`memory list --json` 和 `memory check --json` 提供版本化机器契约。旧 metadata 只通过显式
`memory migrate --set ...` 迁移：默认输出 proposal，审阅且 `ready` 后才使用 `--apply`；初始化、
task progress 和 Memory 写命令通过共享 memory-root lock 串行化。

Memory Autopilot 让 Agent 在不反复打扰用户的前提下调用类型化命令：`capture-input --payload-file`
只保存会影响后续决策的 constraint、acceptance、source、risk-decision 或 explicit-retain，并要求显式选择
verbatim/summary 和 workstream/durable 生命周期；`close-input` 在输入失效后将其移出 active index。
`capture-experience` 去重维护有来源的 lesson/failure，`handoff` / `close-handoff`
维护未完成工作，`reconcile-profile` / `forget-profile` /
`profile-autopilot` 维护可暂停的当前画像。`提交`、`发布`、`继续`等一次性动作授权默认不持久化为
Important Input，短但持续有效的禁止项不按字数过滤。verbatim 输入按原始文本、来源和模式精确去重，可靠摘要按
规范化文本去重；命令会拒绝
高置信敏感信息、精确更新索引、校验托管 Memory 并在失败时回滚。所有自动自由文本先由非 shell 文件
能力写入 JSON，再经 `--payload-file` 传递，禁止把不可信文本做 shell 插值。例行自动
`created/updated/unchanged` 不另行通知，`proposed/blocked` 简短告知；用户明确要求画像控制时简报结果。本地
`host-evals/` 由独立的 `eval:validate` 校验，但 scenario 或单元测试不代表真实 Host 已通过。

这里的“学习/进化”是可审计的记忆适配，不是模型权重学习，也不允许 Agent 自动改写 prompt、skill、
规则或源码；这些变化仍需明确授权、评审和验证。

handoff 协议不要求等待宿主结束事件，但当前没有稳定的 session-end/compaction-before hook，因此不能
机械保证每次压缩前均已写入。阶段已验证且仍有后续、宿主发出上下文压缩/预算信号，或旧快照已不足
恢复且 `completed/decisions/open/verification/next` 发生实质变化时触发检查。写前读取当前 handoff 与
active task；只有已证实 resolved/superseded 的内容才清理，模糊状态保留。宿主 thread/task id 优先作为稳定
session base；同一 workstream 原位替换最新 active generation，不累积聊天流水。工作结束且无后续时关闭并
移出 active index；同一 base 后续出现新任务时确定性创建下一 generation，并保留旧 episode。

项目记忆只在已获工作区写入授权且任务确实需要跨会话交接、未完成状态或脱敏证据时初始化；简单
问答和一次性小修改不触发初始化，未初始化的只读项目即使发现昂贵结论也只报告 proposal。读取时先看
`core.md` 和名称/元信息，再按引用加载正文，不默认读取整棵目录或 archive。跨项目主题命中时同样按需
读取全局 Memory 的 `core.md`；canonical `profile.md` 是有界例外，每个新宿主 task/thread 首次工作前读取
一次以应用已有跨任务偏好。新 distilled 未经 typed 流程或当前授权只形成 proposal。
达到沉淀阈值的任务在内部得到 `proposed`、`created`、`updated`、`unchanged` 或 `blocked` 结果；
例行自动 `created/updated/unchanged` 静默，`proposed/blocked` 才简短说明。长任务入口由 task 命令自动同步到 `core.md`，
稳定经验只有实际写入并验证正式文档后才算完成提升。

### 可维护的 Repository Map

Personal overlay 使用 `projects/repository-map.yaml` 保存带职责描述的仓库目录和有类型的直接关系，
`repository-map.md` 只是确定性生成视图。`harness repository-map check` 校验 schema、方向、双侧证据与
容量预算；`discover packages --apply` 可从本地 package manifest 幂等维护直接包依赖；`verify
--record` 把 source fingerprint 和时效记录到宿主 `state/`；`maintain` 只读报告漂移和缺失。外部或
启发式 observation 始终停留在 proposal，不能通过自报 deterministic 自动写回。

### 长任务账本

内嵌 Harness CLI 可以保存目标、下一步、checkpoint 和 acceptance evidence。任务只能通过
acceptance gate 进入 `complete`，并发更新使用任务锁。`task verify` 只证明调用方选择的机械检查已
执行、结果新鲜且 scope 在执行期间稳定；它不自动判断自由文本 criterion 与证据的语义相关性，也
不是防篡改边界。证据绑定 task/criterion，可拒绝原样跨任务复制，但直接编辑 ledger 或替换 verifier
仍在威胁模型之外。高风险验收应由用户审阅或 CI/Host-owned verifier 定义
不可由当前任务随意替换的 predicate，再由 `task verify` 调用；外部 evidence 只能记为 `failed` 或
`inconclusive`，不能直接通过 gate。

### 安全的安装生命周期

- 写入前完整 staging，并对生成的 `.mjs` 做语法检查；
- 对 output、backup、record 和 ignore path 做 lexical 与 canonical containment 校验；
- 默认拒绝授权根下的 symlink、junction 和 reparse path；
- 遇到陌生文件或用户修改过的受管理文件时 fail closed；
- 多 Agent 操作使用进程锁和完整预检；失败时按已登记路径尝试事务回滚，若回滚不完整则报错并
  保留 recovery path，不能声称已原子恢复；
- 升级保留可变 `state/`，personal overlay 永不被升级、restore 或 uninstall 覆盖。

完整边界与 enforcement owner 见[架构说明](./docs/architecture.md)和[安全策略](./SECURITY.md)。

<details>
<summary><strong>自动化参数与退出码</strong></summary>

可重复传入 `--agent`；支持 `codex`、`cursor`、`claude`、`claude-code`、`opencode`、`kimi`、`kimi-code` 和 `all`。非交互调用应显式
指定 Agent，并在需要稳定协议时使用 `--json`。

`capabilities` 是不解析安装路径、不写文件的只读命令。dry-run、install result 和 status JSON 也
包含同一 Adapter `capabilities`，用于区分作用域、激活方式、文件所有权和权限 owner。
`--no-init-global` 只跳过共享全局记忆初始化，不会跳过 personal overlay。

JSON 失败输出为单条 stderr 对象，包含 `version`、`error.code`、`message` 和 `exitCode`：

| Exit code | 含义 |
| ---: | --- |
| 1 | 未分类内部错误 |
| 2 | CLI 用法错误 |
| 3 | 安全或完整性拒绝 |
| 4 | operation lock 冲突 |
| 5 | 没有可操作的安装状态 |

</details>

<details>
<summary><strong>环境变量</strong></summary>

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `CODEX_HOME` | Codex 安装目标 | `~/.codex` |
| `CLAUDE_CONFIG_DIR` | Claude Code 安装目标 | `~/.claude` |
| `OPENCODE_CONFIG_DIR` | OpenCode 配置与安装目标 | `${XDG_CONFIG_HOME:-~/.config}/opencode` |
| `KIMI_CODE_HOME` | Kimi Code CLI 配置与安装目标 | `~/.kimi-code` |
| `HARNESS_MEMORY_HOME` | 跨项目个人记忆 | `~/.agent-docs` |
| `HARNESS_PERSONAL_HOME` | 用户维护的规则与仓库关系 | `~/.agent-harness` |
| `HARNESS_REPOSITORY_ROOT` | 仓库集合根目录 | `~/git-repo` |
| `HARNESS_OWNER` | 记忆模板 owner | 当前用户 |

宿主专用变量只存在于对应 Adapter，不会进入宿主中立的 Harness 模板和运行时契约。

</details>

## 从源码开发

仓库使用 Node.js 24.12+ 和 pnpm 10.13.0。根 `dist/` 与
`template/agent-harness/dist/` 均为构建产物，不要直接修改。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node bin/harnessmith.mjs --help
pnpm run preflight
pnpm run test:harness
pnpm run test:coverage
npm pack --dry-run
```

项目使用 Biome、Markdownlint、Commitlint、Vitest、lint-staged 和 Husky。依赖安装、脚本编排与 CI
统一使用 pnpm；`npm pack --dry-run` 仅用于验证最终 npm 分发清单。

## 进一步阅读

- [架构与 enforcement model](./docs/architecture.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)
- [发布流程](./RELEASING.md)
- [版本记录](./CHANGELOG.md)
- [LLM 安装协议（npm latest）](https://unpkg.com/harnessmith@latest/llms.txt)

---

如果你希望不同 coding agent 以同样谨慎、可恢复、可验证的方式工作，Harnessmith 就是那层共同的
个人基础设施。
