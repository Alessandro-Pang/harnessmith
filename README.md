# Harnessmith

<p align="center">
  <img src="./apps/docs/site/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

> Forge once. Work consistently across coding agents. —— 一次锻造，让不同 Coding Agent 共用一套可靠的工作方式。

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.en.md) · **简体中文** · [完整文档](https://alexpang.cn/harnessmith/)

## Harnessmith 解决什么问题

如果你在多个项目和 Coding Agent 之间切换，个人规则通常会被复制到多个位置。规则一多，版本就会漂移；项目关系和任务进度只能靠聊天记录续接；配置升级又可能误伤自己维护的文件。

Harnessmith 把这部分工作整理成一套可安装的本地工作层：

- 一份宿主中立的规则，通过 Adapter 适配到多个 Coding Agent；
- 详细流程按任务路由，需要时再读取，避免把整套手册塞进每次会话；
- 历史文档继续保留，但不会默认全部送进模型上下文；路由先筛选与当前任务有关的内容；
- Memory 保存有来源、但仍需复核的历史线索；Memory Autopilot 只负责受限捕获与整理；Task 保存目标、检查点、验收条件和证据；
- 安装、升级、接管、恢复和卸载都有 dry-run、所有权检查、备份、锁和回滚路径。

Harnessmith 是跨 Host 的 Personal Harness 分发与工作状态控制层。它完全运行在本地，不替代 Coding Agent 的模型循环、工具调度、sandbox、权限批准、认证或成本控制。Markdown 规则可以指导行为，但不能代替宿主权限系统。

## 它适合谁

- 经常在多个 Coding Agent 之间切换，并希望个人规则只维护一份的人；
- 需要安全升级、备份、恢复和卸载个人 Harness 的维护者；
- 需要跨会话续接长任务，同时坚持把 Memory 当作线索而不是事实源的人。

如果你只使用一个 Agent，规则也只有几行，直接维护一个简短的 `AGENTS.md` 往往更合适。

## 30 秒开始

环境要求：Node.js 24.12.0 或更高版本。不需要全局安装。

```bash
# 1. 预览目标、冲突和恢复方式；不会写文件
npx harnessmith setup --agent codex --dry-run

# 2. 确认预览无误后安装，并执行本地确定性健康检查
npx harnessmith setup --agent codex
```

非交互环境请显式加 `--yes`。如果你已经维护了一份自己的宿主规则，先运行 `adopt` 生成只读接管提案，审阅后再用同一个 `proposalId` 确认，不要直接覆盖原文件。

也可以让 Coding Agent 按安装协议操作：

> 阅读 npm latest 发布包中的 [llms.txt](https://unpkg.com/harnessmith@latest/llms.txt)，按协议安装 Harnessmith；先执行 dry-run，再让我确认写入。

## 支持的宿主

| 宿主 | 范围 | 选择值 |
| --- | --- | --- |
| Codex | 全局 | `codex` |
| Cursor | 项目 | `cursor` |
| Claude Code | 全局 | `claude`，别名 `claude-code` |
| OpenCode | 全局 | `opencode` |
| Kimi Code CLI | 全局 | `kimi`，别名 `kimi-code` |
| Zed Agent | 全局 | `zed` |

全局安装进入宿主的个人配置目录，对所有项目生效。项目安装只作用于指定项目；Cursor 可以用 `--project /path/to/project` 显式指定项目，省略时使用当前工作目录。目标路径、环境变量和宿主激活方式见[宿主支持](https://alexpang.cn/harnessmith/guide/hosts)。

## 常用操作

```bash
# 查看所有权和文件完整性
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain

# 只读盘点已有规则；确认后再接管
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json

# 恢复上一层，或恢复到首次安装前
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex

# 查看 Adapter 能力和本地脱敏诊断
npx harnessmith capabilities --json
npx harnessmith diagnostics --agent codex --json

# 导出 personal overlay；在另一台机器上先生成提案再导入
npx harnessmith export --output ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --proposal <proposalId> --yes --json
```

安装后的文档路由、Memory、Task、Repository Map 和审计由内嵌 Runtime 提供：

```bash
node <harness-path>/bin/harness.mjs health --json
node <harness-path>/bin/harness.mjs repository-map check --json
```

完整命令、选项、退出码和失败处理见[安装器 CLI](https://alexpang.cn/harnessmith/reference/cli)与[运行时 CLI](https://alexpang.cn/harnessmith/reference/runtime-cli)。

## “安装完成”意味着什么

文档使用以下状态词：

| 状态 | 能证明什么 |
| --- | --- |
| `installed` | 受管文件已写入，安装记录、预检和备份关系有效 |
| `healthy` | 内嵌 Runtime 的确定性健康检查通过 |
| `host-configured` | 真实宿主按自己的契约加载了规则、认证和权限配置 |
| `host-verified` | 真实宿主完成首次受控任务，并留下可复核证据 |

安装器最多直接证明前两项。后两项必须在真实宿主会话中确认；本地测试、npm 下载量和 GitHub 流量都不能替代这一步。完整流程见[首次价值循环](https://alexpang.cn/harnessmith/guide/first-value-loop)。

## 安全边界

| 状态 | Harnessmith 的职责 |
| --- | --- |
| 已实现 | Adapter 分发、路径预检、备份、锁、回滚、非权威 Memory、Task gate、脱敏 audit 和 diagnostics 预览 |
| 由宿主负责 | 模型循环、工具/MCP 调度、sandbox、权限批准、认证、token 与成本 |
| 不支持 | 通用 Agent Runtime、Policy Engine、Pack/Registry、多 Agent 调度、自动规则提升 |

审计和诊断只输出 schema 允许的元数据；受限的 `audit record` 不包含原始 prompt、模型输出、tool arguments、文件正文、环境变量或 secret。事件是否真实发生，仍由宿主或外部 attestation 负责。逐项能力、owner 和证据路径见 [capability-evidence.yaml](./apps/docs/site/capability-evidence.yaml)。

## 继续阅读

- [完整文档](https://alexpang.cn/harnessmith/) · [快速开始](https://alexpang.cn/harnessmith/guide/getting-started) · [为什么需要 Harnessmith](https://alexpang.cn/harnessmith/guide/why-harnessmith)
- [架构设计](https://alexpang.cn/harnessmith/concepts/architecture) · [职责边界](https://alexpang.cn/harnessmith/concepts/boundaries) · [记忆与任务](https://alexpang.cn/harnessmith/concepts/memory-and-tasks)
- [贡献指南](./CONTRIBUTING.md) · [安全策略](./SECURITY.md) · [许可证](./LICENSE)

## 参与开发

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

文档维护规则见[文档站点贡献指南](https://alexpang.cn/harnessmith/maintain/contributing)。
