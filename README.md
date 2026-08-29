# Harnessmith

> Forge once. Work consistently across coding agents.

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.en.md) · **简体中文** · [完整文档](https://alexpang.cn/harnessmith/)

Harnessmith 是一个本地优先、跨 Host 的 Personal Harness 分发与工作状态控制层。它把同一套个人规则、
渐进式上下文、非权威记忆和任务工具，安全地安装到不同 Coding Agent。

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
# 交互式选择宿主
npx harnessmith

# 指定宿主；写入前可加 --dry-run
npx harnessmith install --agent codex
npx harnessmith --dry-run --agent codex
```

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

# 安装后检查内嵌 Runtime
node <harness-path>/bin/harness.mjs health --json
```

完整参数和失败处理见 [CLI 参考](https://alexpang.cn/harnessmith/reference/cli)与
[安全生命周期](https://alexpang.cn/harnessmith/guide/lifecycle)。

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
- [Memory 与 Task](https://alexpang.cn/harnessmith/concepts/memory-and-tasks)、[版本与迁移](https://alexpang.cn/harnessmith/versions/migrations)
- [Memory Autopilot](https://alexpang.cn/harnessmith/concepts/memory-and-tasks) 的发现、验证与隐私边界
- [贡献指南](./CONTRIBUTING.md) · [安全策略](./SECURITY.md) · [许可证](./LICENSE)

## 参与开发

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

文档贡献约定见 [文档站点贡献指南](https://alexpang.cn/harnessmith/contributing)。
