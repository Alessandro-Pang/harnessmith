---
name: agent-harness
description: 个人 coding-agent Harness（Harnessmith 分发）。当用户要修改/实现代码或配置、排查故障/修 bug/分析 CI 失败、评审/review、做方案/技术选型/调研、理解代码库/梳理架构、验证/验收/证明结论、发布/迁移/远端写操作、写 commit/分支等 Git 操作、推进跨会话长任务与交接、记录或查询项目/全局 Memory、更新用户画像、查 Repository Map，或需要 Harness CLI（bootstrap、route、search、task、memory、health、validate）时使用。Personal coding-agent harness. Use for change, diagnose/debug/CI failure, review, research/design, understand/map a codebase, verify/accept, release/migration/external writes, Git conventions, long-running task checkpoints and handoffs, project or global Memory capture, user-profile updates, Repository Map lookups, or the bundled Harness CLI. Loads only the documents the deterministic router selects; grants no permissions and does not replace host or project rules.
license: MIT
compatibility: Host-neutral. Requires Node.js 22.12 or newer to run scripts/harness.mjs; no network access and no extra dependencies.
metadata:
  owner: harnessmith
  layout: skills/agent-harness
---

# Agent Harness

这是 Harnessmith 分发的个人 Harness：宿主中立的工作协议、按任务路由的规则文档和自包含的 Harness CLI。
授权边界、会话启动顺序和回合结束前的 Memory 沉淀由宿主的 always-on 入口（`AGENTS.md` 或宿主等价文件）约束；
本 skill 是发现层：说明目录、CLI 和协议，不扩权、不改变宿主权限模型，也不替代项目自己的规则和事实源。
下文 `<harness>` 指本目录的 `node scripts/harness.mjs`（宿主给出的 skill 路径 + `scripts/harness.mjs`）。

## 唯一入口命令

如果你没有拿到 always-on 入口（子代理、无规则文件的宿主），先运行与入口完全相同的一条命令，再按输出行动：

```bash
<harness> bootstrap --project <absolute-project-root> --detail brief --json "<用户当前原文>"
```

- `route.load`：按顺序读取的文档绝对路径（execution loop → primary playbook → required topics → topics → reasoning modes）。
- `route.ask` 非空：停止并向用户提问，不猜 intent。
- `memory.recommended`：只加载这些命中正文；`truncated`/`inconclusive` 不等于不存在。

## 目录

| 路径 | 内容 | 何时读取 |
| --- | --- | --- |
| `scripts/harness.mjs` | Harness CLI 入口（Node.js，自包含 bundle） | bootstrap、route、search、task、memory、health、validate |
| `docs/README.md` | 快速路由表、目录职责和加载层级 | 需要人工挑选文档，或核对路由结果时 |
| `docs/core/` | 跨任务稳定原则：operating model、execution loop、tool routing、safety、Git、长任务 | 路由返回 `topics` 命中时 |
| `docs/playbooks/` | 七类任务动作的执行流程 | 路由返回 `primaryPlaybook` 时 |
| `docs/references/` | CLI/Memory/Task/Repository Map 契约、reasoning modes、prompt 示例 | 路由或诊断明确需要时 |
| `docs/standards/` | 项目 `AGENTS.md`、`.agent-docs/`、用户画像的设计标准 | 新建或精简这些文件时 |
| `assets/templates/` | 个人 overlay、项目入口、`.agent-docs/` 骨架模板 | 由 `init`/`project init` 使用，不直接加载 |
| `assets/schemas/` | Task、Replay、Repository Map、Memory promotion 的 JSON Schema | 校验或调试数据时 |

不要整体加载 `docs/`；路由和检索只决定发现，不授予权限。

## 路由协议（bootstrap 内部执行；重路由或诊断时单独调用）

1. 路由查询保留用户当前原文，不得改写，以便命中遗漏验收、未来默认、仍有后续或 host-signal 等信号。
   重路由时运行 `<harness> route --intent <intent> --json "<用户当前原文>"`；intent 取值为 change、diagnose、review、
   research-and-design、understand-and-map、verify-and-accept、release-and-external；无法判定时向用户提问，不猜。
2. 先读 `primaryPlaybook` 与 `docs/core/execution-loop.md`，再加载全部由路由返回的 `requiredTopics` 和预算内的 `topics`；
   报告含 `reasoningModes` 时读取 `docs/references/reasoning-modes.md` 对应章节并按步骤执行。
3. `omittedRequiredTopics` 非空即停止并报告；`omittedTopics` 只是延迟候选；`unmatched` 或歧义时停止并提问。
   references 仅按 owner 按需加载。
4. 本地 Harness Memory/画像控制不是宿主产品设置：此范围不加载产品文档、其他 skill 或 web，其余按路由结果加载。

## Memory 与长任务

- 跨回合仍有价值的约束、昂贵结论、未完成状态或交接，在交付前通过 typed writer 静默沉淀
  （`memory capture-*`、`handoff`、`task checkpoint`）；Memory 是待核对线索而非事实源。
- 长任务的 `task close --status complete` 只能通过 acceptance gate；并发写入必须持有任务锁。
- 命令、参数、退出码和 payload 以 `<harness> --help` 及子命令 `--help` 为准；契约细节按 owner 读取
  `docs/references/cli-contracts.md`。

## 位置

- 个人 overlay：`{{HARNESS_PERSONAL_HOME}}/`（用户所有，安装器只补骨架）。
- 跨项目 Memory 与用户画像：`{{HARNESS_MEMORY_HOME}}/`。
- 项目 Memory：仓库内 `.agent-docs/`（非权威）。
- 可变运行状态：`{{HARNESS_STATE_HOME}}/`（hub 内与 `skills/` 同级），升级时保留，不参与完整性校验。
