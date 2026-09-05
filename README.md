# Harnessmith

<p align="center">
  <img src="./apps/docs/site/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harnessmith"><img alt="npm version" src="https://img.shields.io/npm/v/harnessmith.svg?color=orange" /></a>
  <a href="https://www.npmjs.com/package/harnessmith"><img alt="npm downloads" src="https://img.shields.io/npm/d18m/harnessmith" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg" /></a>
</p>

![Alt](https://repobeats.axiom.co/api/embed/4a00cfbec88908df6e48df475db48a0cf056caa1.svg "Repobeats analytics image")

[English](./README.en.md) · **简体中文** · [完整文档](https://alexpang.cn/harnessmith/)

> Harnessmith 是跨 Host 的 Personal Harness 分发与工作状态控制层：把一套宿主无关的个人 Agent Harness 分发到多个 Coding Agent，并保存跨会话、跨项目的工作状态。

你只维护一份规则，Harnessmith 负责适配宿主、预检目标、备份文件，以及在升级、恢复和卸载时保护现有内容。它完全跑在本地，不依赖云端服务，也不替代 Coding Agent；模型怎么推理、工具怎么授权、沙箱怎么隔离，始终由宿主自己负责。

## ✨ 解决什么问题

在多个项目和 Coding Agent 之间切换时，规则很容易出现副本、版本漂移和覆盖冲突。会话结束后，任务目标、进度和决定也可能丢失。历史文档需要保留，但把整套历史文档反复放进模型上下文，又会挤占当前任务需要的空间。

Harnessmith 将这些问题分成几条可检查的边界。Repository Map 负责记录跨仓库关系，帮助你找到项目职责和直接契约：

- 规则只维护一份，由 Adapter 分发到不同宿主；
- 文档按任务路由，需要时再读取，不把整套手册放进每次会话；
- Memory 保存带来源、仍需复核的线索，不冒充项目事实；
- Task 保存目标、检查点、验收条件和证据，方便跨会话继续工作；
- 安装、接管、升级、恢复和卸载都先做 dry-run，执行时检查所有权，失败时保留备份和回滚路径。

如果你只使用一个 Agent，规则也只有几行，手写一个简短的 `AGENTS.md` 往往更省事。

## 🚀 30 秒开始

要求 Node.js 24.12.0 或更高版本，不需要全局安装。

```bash
# 1. 预览目标、冲突、备份和恢复方式，不写入文件
npx harnessmith setup --agent codex --dry-run

# 2. 检查预览结果后执行安装，并运行本地确定性健康检查
npx harnessmith setup --agent codex
```

在非交互环境中，请显式添加 `--yes`。如果你已经维护宿主规则，先运行 `adopt`。它只读盘点现有文件并生成提案；审阅提案后，用同一个 `proposalId` 确认接管。原文件不会被直接覆盖。

也可以让 Coding Agent 按安装协议操作：

> 阅读 npm latest 发布包中的 [llms.txt](https://unpkg.com/harnessmith@latest/llms.txt)，按协议安装 Harnessmith。先执行 dry-run，写入前向我确认。

## 🤖 支持的宿主

| 宿主 | 安装范围 | 选择值 |
| --- | --- | --- |
| Codex | 全局 | `codex` |
| Cursor | 项目 | `cursor` |
| Claude Code | 全局 | `claude`，别名 `claude-code` |
| OpenCode | 全局 | `opencode` |
| Kimi Code CLI | 全局 | `kimi`，别名 `kimi-code` |
| Zed Agent | 全局 | `zed` |

全局安装写入宿主的个人配置目录，对所有项目生效；项目安装只作用于一个项目。Cursor 可以通过 `--project /path/to/project` 指定项目，省略时使用当前工作目录。实际目标路径、环境变量和宿主激活方式见[宿主支持](https://alexpang.cn/harnessmith/guide/hosts)。

## 🧰 常用操作

```bash
# 查看所有权、文件完整性和风险说明
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain

# 只读盘点已有规则；确认提案后再接管
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

安装结果会给出 Runtime 的实际路径。将它填入 `<harness-path>` 后，可以运行健康检查和 Repository Map 检查：

```bash
node <harness-path>/bin/harness.mjs health --json
node <harness-path>/bin/harness.mjs repository-map check --json
```

新建宿主会话后，规则入口会自动参与任务路由。长任务用 `task checkpoint` 保存进度，用 `task verify` 绑定机械证据；只有验收门禁通过后，才能运行 `task close --status complete`。`search` 和 `memory search` 默认使用 `--mode auto`：有可用索引时走全文检索，否则退回有界扫描。`--mode fulltext` 在索引不可用时直接失败，`--mode scan` 强制扫描。只有显式传入 `--refresh-index` 才会写入索引，而且索引只是可重建缓存。

完整命令、选项、退出码和失败处理见[安装器 CLI](https://alexpang.cn/harnessmith/reference/cli)与[运行时 CLI](https://alexpang.cn/harnessmith/reference/runtime-cli)。

## ✅ “安装完成”意味着什么

文档中统一使用以下四个状态：

| 状态 | 能证明什么 |
| --- | --- |
| `installed` | 受管文件已经写入，安装记录、预检和备份关系有效 |
| `healthy` | 内嵌 Runtime 的确定性健康检查通过 |
| `host-configured` | 真实宿主按自己的契约加载了规则、认证和权限配置 |
| `host-verified` | 真实宿主完成首次受控任务，并留下可复核证据 |

安装器最多直接证明前两项。后两项必须在真实宿主会话中确认；本地测试、npm 下载量和 GitHub 流量都不能替代宿主证据。完整流程见[首次价值循环](https://alexpang.cn/harnessmith/guide/first-value-loop)。

## 🔒 安全边界

| 状态 | Harnessmith 的职责 |
| --- | --- |
| 已实现 | Adapter 分发、路径预检、备份、锁、回滚、非权威 Memory、Task 验收门禁、脱敏 audit 和 diagnostics 预览 |
| 由宿主负责 | 模型循环、工具/MCP 调度、sandbox、权限审批、认证、token 和成本 |
| 不支持 | 通用 Agent Runtime、Policy Engine、Pack/Registry、多 Agent 调度、自动规则提升 |

审计和诊断只输出 schema 允许的元数据。受限的 `audit record` 不包含原始 prompt、模型输出、tool arguments、文件正文、环境变量或 secret。事件是否真实发生，仍由宿主或外部 attestation 负责。逐项能力、owner 和证据路径见仓库源文件 `apps/docs/site/capability-evidence.yaml` 及其[在线版本](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml)。

## 📚 继续阅读

- [完整文档](https://alexpang.cn/harnessmith/) · [快速开始](https://alexpang.cn/harnessmith/guide/getting-started) · [为什么需要 Harnessmith](https://alexpang.cn/harnessmith/guide/why-harnessmith)
- [架构设计](https://alexpang.cn/harnessmith/concepts/architecture) · [职责边界](https://alexpang.cn/harnessmith/concepts/boundaries) · [记忆与任务](https://alexpang.cn/harnessmith/concepts/memory-and-tasks)（含 Memory Autopilot）

## 🤝 参与开发

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

贡献流程见[贡献指南](./CONTRIBUTING.md)，漏洞披露见[安全策略](./SECURITY.md)，文档维护规则见[文档站点贡献指南](https://alexpang.cn/harnessmith/maintain/contributing-docs)。

## ⭐ Star History

<a href="https://www.star-history.com/?repos=alessandro-pang%2Fharnessmith&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=alessandro-pang/harnessmith&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=alessandro-pang/harnessmith&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=alessandro-pang/harnessmith&type=date&legend=top-left" />
 </picture>
</a>

## 👥 Supporters

[![Stargazers repo roster for @Alessandro-Pang/harnessmith](https://reporoster.com/stars/Alessandro-Pang/harnessmith)](https://github.com/Alessandro-Pang/harnessmith/stargazers)

[![Forkers repo roster for @Alessandro-Pang/harnessmith](https://reporoster.com/forks/Alessandro-Pang/harnessmith)](https://github.com/Alessandro-Pang/harnessmith/network/members)

## 📄 License

[MIT](./LICENSE)

---

欢迎在 [GitHub Issues](https://github.com/Alessandro-Pang/harnessmith/issues) 上讨论、报告问题或提交 Pull Request！
