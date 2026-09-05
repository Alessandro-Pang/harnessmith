---
title: Personal Agent Harness Index
type: harness-index
status: active
updated: 2026-09-04
---

# Personal Agent Harness Docs

这里是安装器管理、按需读取的 coding-agent 规则与稳定说明层；个人 overlay 位于 `{{HARNESS_PERSONAL_HOME}}/`，跨项目记忆位于 `{{HARNESS_MEMORY_HOME}}/`，项目记忆位于仓库 `.agent-docs/`。本目录不应整体加载。

## 快速路由

| 当前任务 | 读取文件 |
| --- | --- |
| 涉及信任、授权、只读边界，或不确定 Agent 如何推进与判定事实 | [operating model](core/operating-model.md) |
| 需要拆分阶段、组织工具循环、处理验证失败或恢复任务 | [execution loop](core/execution-loop.md) |
| 需要选择 MCP、浏览器、Figma、文档或 Shell 能力 | [tool routing](core/tool-routing.md) |
| 涉及权限、破坏性操作、验证范围或交付证据 | [safety and verification](core/safety-and-verification.md) |
| 新建/检查分支，编写/校验提交信息，设计 Git 规范 | [Git conventions](core/git-conventions.md) |
| 扩展、测试或调试 personal Harness CLI | [Harness CLI architecture](core/harness-cli-architecture.md) |
| 接入运行审计、查看 policy decision、耗时、token 或成本 | [runtime observability](core/observability.md) |
| 跨上下文推进、维护任务契约、验收账本或交接 | [long-running tasks](core/long-running-tasks.md) |
| 修改或实现代码、配置、脚本 | [change playbook](playbooks/change.md) |
| 排查故障、修复 bug、分析 CI 失败 | [diagnose playbook](playbooks/diagnose.md) |
| 代码、架构、安全或性能评审 | [review playbook](playbooks/review.md) |
| 做方案、计划、调研、技术选型 | [research and design](playbooks/research-and-design.md) |
| 理解代码库、梳理架构、追踪调用链或新成员上手 | [understand and map](playbooks/understand-and-map.md) |
| 验证结果、执行验收、证明某个结论或回归质量 | [verify and accept](playbooks/verify-and-accept.md) |
| 发布、迁移、远端写操作或共享环境变更 | [release and external](playbooks/release-and-external.md) |
| 跨仓任务识别仓库关系 | [repository map](projects/repository-map.md) |
| 新建或精简项目 `AGENTS.md` | [project AGENTS standard](standards/project-agents.md) |
| 创建或维护项目 `.agent-docs/` | [project memory standard](standards/project-agent-docs.md) |
| 读取或更新紧凑用户画像、处理偏好变化与冲突 | [user profile standard](standards/user-profile-memory.md) |
| 调试 CLI、搜索 benchmark、Git 项目覆盖或设计 Prompt 示例 | [references](references/)（按需读取对应文件） |

## 目录职责

- `core/` 是跨任务稳定原则，`playbooks/` 是按提示触发的工作流，`projects/` 是跨仓导航，`standards/` 是规则设计；Playbook 决定任务动作，reasoning mode 会根据用户明确概念或任务结构自动选择，不自动叠加到每个任务。
- `../templates/` 保存项目入口模板；`{{HARNESS_PERSONAL_HOME}}/` 是用户 overlay，安装器只补骨架、不覆盖正文。
- `../bin/harness.mjs` 提供自包含 bundle 的初始化、检索、检查和维护入口，Agent home 无需安装依赖。

## 读取原则

1. 能够可靠判断当前动作时，显式 `intent` 只选择唯一 playbook（即 `primaryPlaybook`）；自动推断多个动作返回歧义，无法匹配返回 `unmatched`，不可靠时不猜。
2. `route` 同时保留 `rawQuery` 和 `normalizedQuery`；先加载 primary playbook 和 execution loop，再加载预算内的 `requiredTopics`，最后按顺序加载可选 `topics`。如果报告包含 `reasoningModes`，读取 `references/reasoning-modes.md` 中返回模式对应的章节后再行动；`matchedSignals` 用于审计触发原因。`omittedReasoningModes` 表示超过模式预算的候选，不能解释为未命中；需要执行被省略模式时应先缩小任务范围或显式重新路由。
3. topic 总数默认最多四个，required 优先；`omittedTopics` 只是延迟候选，不能解释为不存在，`omittedRequiredTopics` 非空时停止并报告缺失。
4. 更具体的 `AGENTS.md`、skill 或项目事实源优先；路由只决定发现，不授予权限。
5. 检索先返回标题、元信息或命中段落，确认相关后才读全文；长期规则在本目录，单次证据在项目 `.agent-docs/`。
6. 通用规范使用“标准术语 + 项目差异 + 一个正/反例 + 可执行验收”；字段状态机、路径和安全门禁只在 owner 文档或 CLI/schema 定义。
7. 规则改变时同步更新本索引、`manifest.yaml` 和对应 owner；禁止新增无路由入口或唯一 owner 的孤儿文档。

## 加载层级

| 层级 | 内容 | 加载时机 |
| --- | --- | --- |
| Core | 信任、授权、事实源、执行循环、未验证和交付边界 | 每个相关任务 |
| Playbook | 当前唯一任务动作的执行流程 | 选定动作后 |
| Required topic | 高损失信号绑定的 owner 协议 | 命中后全部加载 |
| Supporting topic | 当前任务的补充概念 | 按顺序、受预算限制 |
| Reference | 低频背景、benchmark、长命令 | 用户或诊断明确需要时 |

## 最小发现入口

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs route --intent review 评审 permissions --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs search --project /absolute/project/path --json "authentication"
```

命中后只读取所需文档；搜索模式、刷新、预算和 benchmark 细节按需读取 [search reference](references/search-and-benchmarks.md)，其他参数以 `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs --help` 和子命令 `--help` 为准。
