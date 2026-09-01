# Harnessmith

<p align="center">
  <img src="./docs/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.en.md) · **简体中文** · [完整文档](https://alexpang.cn/harnessmith/)

如果你经常在多个项目和 Coding Agent 之间切换，就会反复遇到同一类问题：规则散落在不同宿主，项目关系和工作进度
需要一遍遍解释，历史文档越积越多，却不能每次全部塞进模型上下文。

Harnessmith 是一个本地优先、跨 Host 的 Personal Harness 分发与工作状态控制层。它把实践中已经有效的个人规则、
渐进式文档检索、非权威 Memory 和 Task 工具，安全地安装到不同 Coding Agent，并为升级、恢复和验证提供明确边界。

```bash
npx harnessmith
```

## 适合谁

- 同时使用多个 Coding Agent，希望个人规则保持一致的开发者；
- 需要安全升级、备份、恢复和卸载个人 Harness 的维护者；
- 希望长任务跨会话可继续、但不把记忆误当项目事实的人。

Harnessmith 不实现通用 Agent Runtime，也不接管模型循环、工具权限或远端服务。

## 30 秒开始

需要 Node.js 24.12.0 或更高版本，无需全局安装。

```bash
# 先查看宿主、目标、文件状态、恢复方式与能力边界
npx harnessmith setup --agent codex --dry-run

# 复用同一计划，确认后安装并执行确定性健康检查
npx harnessmith setup --agent codex
```

非交互环境需显式追加 `--yes`。`setup` 的安装与健康检查通过，只证明受管理文件和内嵌 Runtime 可用；真实 Host
会话中的模型行为、工具权限和认证仍需另行验证。

也可以让 Coding Agent 先读取安装协议：

> 阅读 npm latest 发布包中的 [llms.txt](https://unpkg.com/harnessmith@latest/llms.txt)，按其中协议安装 Harnessmith；先执行 dry-run，再让我确认写入。

## 支持的宿主

| Agent | 范围 | 选择值 |
| --- | --- | --- |
| Codex | 全局 | `codex` |
| Cursor | 项目 | `cursor` |
| Claude Code | 全局 | `claude`（别名 `claude-code`） |
| OpenCode | 全局 | `opencode` |
| Kimi Code CLI | 全局 | `kimi`（别名 `kimi-code`） |

Cursor 需用 `--project /path/to/project` 指定项目根。目标路径、别名和支持证据见
[宿主指南](https://alexpang.cn/harnessmith/guide/hosts)。

## 常用操作

```bash
# 查看所有权与文件完整性
npx harnessmith status --agent codex

# 恢复上一安装层
npx harnessmith restore --agent codex

# 恢复到首次安装前并移除安装记录
npx harnessmith uninstall --agent codex

# 查看 Adapter 的机器可读边界
npx harnessmith capabilities --json

# 检查个人 Repository Map 中的跨仓库关系
node <harness-path>/bin/harness.mjs repository-map check --json

# 安装后检查内嵌 Runtime
node <harness-path>/bin/harness.mjs health --json
```

完整参数和失败处理见 [CLI 参考](https://alexpang.cn/harnessmith/reference/cli)与
[安全生命周期](https://alexpang.cn/harnessmith/guide/lifecycle)。Repository Map 的关系模型、证据门槛和维护命令见
[运行时 CLI](https://alexpang.cn/harnessmith/reference/runtime-cli#repository-map-维护跨项目关系)。

## 内嵌文档检索

`search` / `memory search` 默认使用 `--mode auto`：存在有效的本地全文索引时执行加权 BM25 检索，否则安全回退到
原有有界扫描。索引只在显式传入 `--refresh-index` 时于 `state/search/` 下原子构建或增量更新；它是可重建缓存，
不是事实源。`--mode fulltext` 在索引不可用时 fail closed，`--mode scan` 可强制使用扫描。

## 安全边界

| 状态 | Harnessmith 的承诺 |
| --- | --- |
| 已实现（Implemented） | Adapter 分发、预检、备份、锁、回滚、非权威 Memory、Task gate 与隐私安全的 `audit record` |
| 由宿主负责（Delegated to the Host） | 模型循环、工具/MCP 调度、sandbox、权限批准、token 与成本 |
| 不支持（Unsupported） | 通用 Runtime、Policy Engine、Pack/Registry、多 Agent 调度和自动规则提升 |

Markdown 规则是行为指导，不是权限强制。审计 schema 拒绝原始 prompt、模型输出和 tool arguments；事件真实性仍由
宿主或外部 attestation 保证。逐项 owner、状态与证据路径见
[docs/capability-evidence.yaml](./docs/capability-evidence.yaml)。

## 深入了解

- [完整文档](https://alexpang.cn/harnessmith/)与[快速开始](https://alexpang.cn/harnessmith/guide/getting-started)
- [架构](https://alexpang.cn/harnessmith/architecture)、[设计原则](https://alexpang.cn/harnessmith/concepts/design-principles)与[责任边界](https://alexpang.cn/harnessmith/concepts/boundaries)
- [Memory 与 Task](https://alexpang.cn/harnessmith/concepts/memory-and-tasks)（含 Memory Autopilot）、[版本与迁移](https://alexpang.cn/harnessmith/versions/migrations)
- [历史与思想来源](https://alexpang.cn/harnessmith/project/history-and-influences)
- [贡献指南](./CONTRIBUTING.md) · [安全策略](./SECURITY.md) · [许可证](./LICENSE)

## 参与开发

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

文档贡献约定见 [文档站点贡献指南](https://alexpang.cn/harnessmith/contributing)。
