---
title: Personal Agent Harness Index
type: harness-index
status: active
updated: 2026-08-19
---

# Personal Agent Harness Docs

这里是安装器管理、按需读取的 coding-agent 规则与稳定说明层。用户维护的个人补充规则位于
`{{HARNESS_PERSONAL_HOME}}/`；跨项目个人记忆位于 `{{HARNESS_MEMORY_HOME}}/`，项目记忆位于仓库
`.agent-docs/`。本目录不应整体加载。

## 快速路由

| 当前任务 | 读取文件 |
| --- | --- |
| 不确定 Agent 应如何推进、何时询问、事实如何判定 | `core/operating-model.md` |
| 需要选择 MCP、浏览器、Figma、文档或 Shell 能力 | `core/tool-routing.md` |
| 涉及权限、破坏性操作、验证范围或交付证据 | `core/safety-and-verification.md` |
| 新建/检查分支，编写/校验提交信息，设计 Git 规范 | `core/git-conventions.md` |
| 扩展、测试或调试 personal harness CLI | `core/harness-cli-architecture.md` |
| 跨上下文推进、维护任务契约、验收账本或交接 | `core/long-running-tasks.md` |
| 修改或实现代码、配置、脚本 | `playbooks/change.md` |
| 排查故障、修复 bug、分析 CI 失败 | `playbooks/diagnose.md` |
| 代码、架构、安全或性能评审 | `playbooks/review.md` |
| 做方案、计划、调研、技术选型 | `playbooks/research-and-design.md` |
| 发布、迁移、远端写操作或共享环境变更 | `playbooks/release-and-external.md` |
| 跨仓任务识别仓库关系 | `projects/repository-map.md` |
| 新建或精简项目 `AGENTS.md` | `standards/project-agents.md` |
| 创建或维护项目 `.agent-docs/` | `standards/project-agent-docs.md` |
| 读取或更新紧凑用户画像、处理偏好变化与冲突 | `standards/user-profile-memory.md` |

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

1. 先由任务类型命中一个 playbook，再按其中链接读取最多必要的专题文档。
2. 项目内存在更具体的 `AGENTS.md`、skill 或文档索引时，优先读取项目事实源。
3. 检索先返回文件名、标题、元信息或命中段落；只有确认相关后才读取全文。
4. 本目录保存跨仓、长期、个人级规则和事实导航；单次任务记忆与证据放项目 `.agent-docs/`。
5. 规则改变时同步更新本索引和 `manifest.yaml`；不要新增没有路由入口的孤儿文档。

## 常用命令

```bash
# 检查规则、文档路由、架构边界与可选项目接入
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs validate --project /absolute/project/path

# 获取项目启动事实的结构化快照
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs project inspect /absolute/project/path --json

# 全局和当前项目的显式检索（包含被 ignore 的 .agent-docs）
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs search "authentication"

# 幂等初始化全局个人记忆
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init global

# 幂等初始化用户维护的个人规则与仓库关系
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init personal

# 为一个项目初始化本地 Agent 工作区
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init project /absolute/project/path

# 只列记忆名称和元信息；正文仍按需读取
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory list /absolute/project/path

# 检查必要元信息和 memory: 引用完整性
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory check /absolute/project/path

# 查询 Harness、task schema、memory schema 和 Node 兼容契约
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs version --json

# 先建立替代关系，再把已关闭记忆移入日期 archive
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory supersede /absolute/project/path old --by current
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory archive /absolute/project/path old

# 只输出正式化建议；不会创建或修改 docs/ 文件
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory promote /absolute/project/path \
  distilled/finding --target docs/architecture.md --json
```
