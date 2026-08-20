# Harnesssmith

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.en.md) · **简体中文**

Harnesssmith 是一个本地优先的 Personal Coding Agent Harness initializer。它把同一套个人工作规则、
渐进式文档、记忆协议和任务状态工具，安全地安装到 Codex、Cursor 与 Claude Code。

```bash
npx harnessmith
```

一次配置，多端保持一致。你的 coding agent 会知道如何开始任务、何时读取上下文、怎样保护现有改动，
以及在什么条件下才能宣告完成。

## 为什么需要 Harnesssmith

不同 Agent 的规则文件、作用域和目录结构各不相同。手工维护通常会遇到三个问题：规则逐渐漂移、
升级容易覆盖个人内容、长任务换会话后丢失上下文。

Harnesssmith 将它们拆成职责清晰的四层：

| 层 | 解决什么问题 |
| --- | --- |
| Instructions | 为每个宿主安装紧凑、常驻的高损失规则 |
| Progressive docs | 按任务类型读取详细流程，不把整套手册塞进上下文 |
| Memory & work state | 保存非权威记忆、紧凑用户画像和可恢复的长任务状态 |
| Installer safety | 通过预检、备份、校验、锁与回滚保护用户文件 |

Harnesssmith 不替代 Agent Runtime，也不接管模型循环、工具调用、sandbox 或权限审批。Markdown 规则
属于行为引导；真正的安全强制仍由安装器、测试、CI 和宿主权限系统承担。

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

安装完成后，Harnesssmith 会初始化：

- 宿主对应的规则入口和内嵌 Harness CLI；
- 用户维护的 `~/.agent-harness` personal overlay；
- 默认位于 `~/.agent-docs` 的跨项目个人记忆；
- 最多 32 条、按当前状态原位更新的紧凑用户画像。

> [!NOTE]
> **使用 LLM 或 coding agent 安装**
>
> 将下面的指令直接发送给 AI。它会先读取 [llms.txt](https://raw.githubusercontent.com/Alessandro-Pang/harnessmith/refs/heads/main/llms.txt)，再按照其中的安装流程、目标核对、权限边界和失败处理规范完成安装。
>
> `请先阅读 https://raw.githubusercontent.com/Alessandro-Pang/harnessmith/refs/heads/main/llms.txt，并按照其中的协议为我安装 Harnesssmith。`

## 支持的 Agent

| Agent | 生效的规则入口 | Harness 目录 | 作用域 |
| --- | --- | --- | --- |
| Codex | `$CODEX_HOME/AGENTS.md` | `$CODEX_HOME/agent-harness` | 全局 |
| Claude Code | `$CLAUDE_CONFIG_DIR/CLAUDE.md`，并保留 `AGENTS.md` | `$CLAUDE_CONFIG_DIR/agent-harness` | 全局 |
| Cursor | `<project>/.cursor/rules/agent-harness.mdc` | `<project>/.cursor/agent-harness` | 项目 |

Cursor 的文件化规则按项目安装。使用 `--project` 指定仓库；Harnesssmith 只把自己管理的文件写入
repository-local Git exclude 和 `.cursor/.ignore`，不会隐藏或覆盖团队已有的整个 `.cursor/` 目录。

## 常用操作

```bash
# 安装单个或多个 Agent
npx harnessmith install --agent codex
npx harnessmith --agent codex,cursor,claude --project /absolute/path/to/repository

# 为自动化输出稳定的 JSON Lines
npx harnessmith --agent all --project . --dry-run --json

# 查看安装所有权与文件完整性
npx harnessmith status --agent all --project .

# 恢复上一层安装
npx harnessmith restore --agent codex

# 逐层恢复到首次安装前
npx harnessmith uninstall --agent codex
```

`restore` 和 `uninstall` 不会删除共享/项目 `.agent-docs` 或用户维护的 personal overlay。`--yes` 只
关闭交互，并在没有指定 Agent 时默认选择 Codex；它**不会**自动同意文件冲突。只有审阅目标并接受
备份接管后，才应使用 `--force`。

## 你会得到什么

### 渐进式规则

常驻 `AGENTS.md` 只保留高损失、不可推断的默认规则；诊断、评审、变更、发布、Git 和工具路由等
详细流程按任务读取。项目内更具体的规则始终优先。

### 分层记忆

Harnesssmith 将“如何工作”“用户是谁”“之前发生了什么”和“项目当前事实”刻意分开：

| 位置 | 保存内容 | 边界 |
| --- | --- | --- |
| 宿主原生 memory | 宿主自动召回的历史线索 | 只作待核对输入，不是 Harness 当前画像 |
| `~/.agent-harness` | 用户维护的个人规则和仓库关系 | 属于规则 overlay，不是记忆；升级和卸载不会覆盖 |
| `~/.agent-docs/profile.md` | 当前身份、工作方式、技术背景、偏好和研究方向 | Harness 内唯一当前用户画像；变化时原位更新 |
| `~/.agent-docs/core.md` 与其他全局 memory | 跨项目活跃主题、经历及高价值提炼发现 | 只保留名称级入口、来源和上下文，不保存第二份当前画像 |
| `<project>/.agent-docs` | 项目输入、会话、工作状态、证据、提炼发现和历史归档 | 可审阅但非权威；默认被 Git 与普通索引忽略 |
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
检查、检索、替代、归档和 proposal-only 提升。

项目记忆只在任务确实需要跨会话交接、保存重要输入/方案/上下文、未完成状态、脱敏证据或昂贵发现时
初始化；简单问答、一次性小修改和能从代码快速恢复的事实不会触发初始化。读取时先看 `core.md` 和
名称/元信息，再按引用加载正文，不默认读取整棵目录或 archive。

### 长任务账本

内嵌 Harness CLI 可以保存目标、下一步、checkpoint 和 acceptance evidence。任务只能通过
acceptance gate 进入 `complete`，并发更新使用任务锁。

### 安全的安装生命周期

- 写入前完整 staging，并对生成的 `.mjs` 做语法检查；
- 对 output、backup、record 和 ignore path 做 lexical 与 canonical containment 校验；
- 默认拒绝授权根下的 symlink、junction 和 reparse path；
- 遇到陌生文件或用户修改过的受管理文件时 fail closed；
- 多 Agent 操作使用进程锁、完整预检和事务回滚；
- 升级保留可变 `state/`，personal overlay 永不被升级、restore 或 uninstall 覆盖。

完整边界与 enforcement owner 见[架构说明](./docs/architecture.md)和[安全策略](./SECURITY.md)。

<details>
<summary><strong>自动化参数与退出码</strong></summary>

可重复传入 `--agent`；支持 `codex`、`cursor`、`claude`、`claude-code` 和 `all`。非交互调用应显式
指定 Agent，并在需要稳定协议时使用 `--json`。

`--no-init-global` 只跳过共享全局记忆初始化，不会跳过 personal overlay。dry-run、install result
和 status JSON 都包含 Adapter `capabilities`，用于区分作用域、激活方式、文件所有权和权限 owner。

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
- [LLM 安装协议](https://raw.githubusercontent.com/Alessandro-Pang/harnessmith/refs/heads/main/llms.txt)

---

如果你希望不同 coding agent 以同样谨慎、可恢复、可验证的方式工作，Harnesssmith 就是那层共同的
个人基础设施。
