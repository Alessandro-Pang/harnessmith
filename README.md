# Harnessmith

<p align="center">
  <img src="./apps/docs/site/public/brand/harnessmith-logo.svg" alt="Harnessmith" width="176" />
</p>

> Forge once. Work consistently across coding agents. —— 一次锻造，每个 Coding Agent 都用同一套工作方式。

[![npm version](https://img.shields.io/npm/v/harnessmith.svg)](https://www.npmjs.com/package/harnessmith)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.12-43853d.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[English](./README.en.md) · **简体中文** · [完整文档](https://alexpang.cn/harnessmith/)

## 它解决什么问题

同时在多个项目和 Coding Agent 之间工作的人，迟早会撞上同一堵墙：同一套个人规则在 Codex、Cursor、
Claude Code 里各写一份，改一处就得同步一遍，总有一份是过期的；项目之间的关系、干到哪了、为什么这么做，
每开一个新会话都要从头解释；历史文档越攒越多，全塞进模型上下文会挤爆窗口，删掉又等于丢掉决策记录。

Harnessmith 的做法是把解法打包成可安装的整体：验证有效的个人规则、按需加载的文档检索、不冒充事实的 Memory、
带验收门禁的长任务工具。一次装进多个 Coding Agent，之后的升级、备份、恢复和卸载都有明确路径——写之前能预览，
出问题能退回。

它完全跑在本地，不依赖云端服务；也不替代 Coding Agent。模型怎么推理、工具怎么授权、沙箱怎么隔离，
始终由宿主自己负责。

## 适合谁

- 在多个 Coding Agent 之间切换、希望规则只维护一份的开发者；
- 需要安全升级、备份、恢复和卸载个人 Harness 的维护者；
- 希望长任务跨会话续接、但拒绝把记忆当成项目事实的人。

如果你只用一个 Agent、规则不超过十行，一个手写的 `AGENTS.md` 就够了——那是更轻的正确答案。

```bash
npx harnessmith
```

## 30 秒开始

需要 Node.js 24.12.0 或更高版本，无需全局安装。

```bash
# 第一步：只看不动。预览宿主、目标文件、恢复方式与能力边界
npx harnessmith setup --agent codex --dry-run

# 第二步：确认无误后安装，并自动执行确定性健康检查
npx harnessmith setup --agent codex
```

非交互环境请显式加 `--yes`。两点提前说明：`setup` 通过只证明受管理文件和内嵌 Runtime 可用，
真实会话里的模型行为、工具权限和认证要在真实任务中另行验证（下文「安装到什么程度才算数」）；
已经有一套自己的规则时，先用 `adopt` 只读盘点生成接管提案，你确认后才写入，不会直接碰你的文件。

也可以把安装交给 Coding Agent，让它先读安装协议：

> 阅读 npm latest 发布包中的 [llms.txt](https://unpkg.com/harnessmith@latest/llms.txt)，按其中协议安装 Harnessmith；先执行 dry-run，再让我确认写入。

## 支持的宿主

| Agent | 安装范围 | 选择值 |
| --- | --- | --- |
| Codex | 全局 | `codex` |
| Cursor | 项目 | `cursor` |
| Claude Code | 全局 | `claude`（别名 `claude-code`） |
| OpenCode | 全局 | `opencode` |
| Kimi Code CLI | 全局 | `kimi`（别名 `kimi-code`） |
| Zed Agent | 全局 | `zed` |

「全局」装进宿主的个人配置目录，对所有项目生效；「项目」只装进指定项目，Cursor 需用
`--project /path/to/project` 指定。各宿主的目标路径、别名和证据见
[宿主指南](https://alexpang.cn/harnessmith/guide/hosts)。

## 常用操作

```bash
# 查看所有权与文件完整性
npx harnessmith status --agent codex

# 在状态之上，解释证据、风险和不会自动执行的安全下一步
npx harnessmith status --agent codex --explain

# 只读盘点已有规则，生成接管提案
npx harnessmith adopt --agent codex --json

# 确认提案，完成接管（复用返回的 proposalId）
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json

# 回退到上一层安装
npx harnessmith restore --agent codex

# 回退到首次安装前，并移除安装记录
npx harnessmith uninstall --agent codex

# 查看 Adapter 的机器可读能力边界
npx harnessmith capabilities --json

# 预览本地脱敏诊断报告；命令不上传、不持久化
npx harnessmith diagnostics --agent codex --json

# 导出可迁移的 personal overlay
npx harnessmith export --output ./harness-config.json --json

# 在另一台机器导入：先生成内容绑定提案，确认后写入
npx harnessmith import --input ./harness-config.json --json
npx harnessmith import --input ./harness-config.json --proposal <proposalId> --yes --json
```

装完之后的日常能力——文档检索、Memory、Task、跨仓库关系——由内嵌 Runtime 提供：

```bash
# 检查个人 Repository Map 中的跨仓库关系
node <harness-path>/bin/harness.mjs repository-map check --json

# 检查内嵌 Runtime 自身
node <harness-path>/bin/harness.mjs health --json
```

完整参数、退出码与失败处理见 [安装器 CLI](https://alexpang.cn/harnessmith/reference/cli)；
安装、升级、恢复、卸载各阶段的安全保证见
[安全生命周期](https://alexpang.cn/harnessmith/guide/lifecycle)。Repository Map 的关系模型、证据门槛和维护命令见
[运行时 CLI](https://alexpang.cn/harnessmith/reference/runtime-cli#repository-map-维护跨项目关系)。

## 安装到什么程度才算数

这三个词在文档里反复出现，含义固定：

| 阶段 | 含义 |
| --- | --- |
| `installed` | 文件写入完成，预检和备份通过 |
| `healthy` | 内嵌 Runtime 的确定性健康检查通过 |
| `host-verified` | 在真实宿主里完成一次只读受控任务，并保留了验证证据 |

前两步装完就有；`host-verified` 要你亲手在真实任务里确认——安装器代劳不了。完整路径见
[首次价值循环](https://alexpang.cn/harnessmith/guide/first-value-loop)。

## 装完之后怎么用

新开一个宿主会话，它会自动读取规则入口，不用贴提示词；给它正常任务，入口会按任务类型路由到对应 playbook；
任务跨会话时，Task 记录目标和进度，Memory 提供待核对的线索；收尾时用 `task verify` 留下证据，`complete` 由验收门禁放行。
`search` / `memory search` 默认 `--mode auto`：有本地全文索引时走加权 BM25，否则安全回退到有界扫描。索引只在显式 `--refresh-index` 时原子构建或增量更新——它是可重建的缓存，不是事实源；
`--mode fulltext` 在索引不可用时直接失败（fail closed），`--mode scan` 可强制扫描。

## 安全边界

| 状态 | Harnessmith 的承诺 |
| --- | --- |
| 已实现 | Adapter 分发、预检、备份、锁、回滚、非权威 Memory、Task gate、隐私安全的审计记录与脱敏诊断预览 |
| 由宿主负责 | 模型循环、工具/MCP 调度、sandbox、权限批准、token 与成本 |
| 不支持 | 通用 Runtime、Policy Engine、Pack/Registry、多 Agent 调度、自动规则提升 |

两条底线说破就不神秘：Markdown 规则是行为指导，不是权限强制；审计与诊断的 schema 天生拒绝原始 prompt、
模型输出、tool arguments、文件正文、环境变量和 secret，事件真实性由宿主或外部 attestation 保证。
逐项能力的 owner、状态与证据路径见 [capability-evidence.yaml](./apps/docs/site/capability-evidence.yaml)。

## 常见问题

装了它 Agent 会变聪明吗？不会——它不碰模型，只负责把正确的工作方式在正确的时间送进上下文。升级会覆盖我改过的规则吗？
不会——你维护的 personal overlay 和可变 `state/` 在升级与卸载时都会保留，受管理模板层更新前完整备份，可随时 `restore` 回上一层。

## 深入了解

- [完整文档](https://alexpang.cn/harnessmith/) · [快速开始](https://alexpang.cn/harnessmith/guide/getting-started) · [历史与渊源](https://alexpang.cn/harnessmith/concepts/history-and-influences)
- [架构](https://alexpang.cn/harnessmith/concepts/architecture) · [设计原则](https://alexpang.cn/harnessmith/concepts/design-principles) · [责任边界](https://alexpang.cn/harnessmith/concepts/boundaries)
- [记忆与任务](https://alexpang.cn/harnessmith/concepts/memory-and-tasks)（含 Memory Autopilot） · [迁移指南](https://alexpang.cn/harnessmith/reference/migrations)
- [贡献指南](./CONTRIBUTING.md) · [安全策略](./SECURITY.md) · [许可证](./LICENSE)

## 参与开发

```bash
pnpm install --frozen-lockfile
pnpm run preflight
pnpm run docs:dev
```

文档贡献约定见 [文档站点贡献指南](https://alexpang.cn/harnessmith/maintain/contributing)。
