---
title: Personal Agent Harness Index
type: harness-index
status: active
updated: 2026-08-28
---

# Personal Agent Harness Docs

这里是安装器管理、按需读取的 coding-agent 规则与稳定说明层。用户维护的个人补充规则位于
`{{HARNESS_PERSONAL_HOME}}/`；跨项目个人记忆位于 `{{HARNESS_MEMORY_HOME}}/`，项目记忆位于仓库
`.agent-docs/`。本目录不应整体加载。

## 快速路由

| 当前任务 | 读取文件 |
| --- | --- |
| 涉及信任、授权、只读边界，或不确定 Agent 如何推进与判定事实 | [operating model](core/operating-model.md) |
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
| 发布、迁移、远端写操作或共享环境变更 | [release and external](playbooks/release-and-external.md) |
| 跨仓任务识别仓库关系 | [repository map](projects/repository-map.md) |
| 新建或精简项目 `AGENTS.md` | [project AGENTS standard](standards/project-agents.md) |
| 创建或维护项目 `.agent-docs/` | [project memory standard](standards/project-agent-docs.md) |
| 读取或更新紧凑用户画像、处理偏好变化与冲突 | [user profile standard](standards/user-profile-memory.md) |

## 目录职责

- `core/`：跨任务的稳定运行原则。
- `playbooks/`：按用户提示类型触发的工作流，不常驻上下文。
- `projects/`：跨仓关系、稳定边界和导航；不复制每个仓库的实现细节。
- `standards/`：项目规则与文档系统的设计规范。
- `../templates/`：项目入口和本地 Agent 工作文档模板。
- `{{HARNESS_PERSONAL_HOME}}/`：用户所有的个人 overlay；安装器只补齐缺失骨架，不覆盖正文。
- `../bin/harness.mjs`：加载自包含 bundle 的初始化、检索、检查和维护入口；Agent home 无需再次
  安装任何包管理器依赖。

## 读取原则

1. 路由返回至多一个 `primaryPlaybook` 和零个或多个 `topics`。先加载 primary playbook，再按任务所需加载 supporting topics。
2. 最高优先级的 playbook 有多个候选时视为歧义：停止自动选择并向用户澄清，不能靠文档顺序决定。
3. 项目内存在更具体的 `AGENTS.md`、skill 或文档索引时，优先读取项目事实源。
4. 检索先返回文件名、标题、元信息或命中段落；只有确认相关后才读取全文。
5. 本目录保存跨仓、长期、个人级规则和事实导航；单次任务记忆与证据放项目 `.agent-docs/`。
6. 规则改变时同步更新本索引和 `manifest.yaml`；不要新增没有路由入口的孤儿文档。

## 最小发现入口

```bash
# 使用 manifest 中英 aliases 返回命中文档，不加载正文
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs route 评审 permissions --json

# 在 Harness、项目 docs 与记忆中做有界检索
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs search --project /absolute/project/path \
  --limit 20 --max-line-length 300 --json "authentication"
# 显式构建或增量刷新本地全文索引；之后 auto 会优先使用有效索引
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs search --project /absolute/project/path \
  --refresh-index --json "authentication"
```

命中后只读取所需文档。其他命令、参数与默认预算以
`node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs --help` 和子命令 `--help` 为准。
