---
title: Harness CLI Architecture
type: harness-core
status: active
updated: 2026-09-05
owner: harness-cli-architecture
---

# Harness CLI Architecture

这是 Harnessmith CLI 的低频架构摘要，不是每次任务的启动 Prompt。只有扩展、测试、调试或评审
Harness CLI、Adapter、Runtime 分层时加载；参数、payload、Memory/Task 状态机和 benchmark 细节由对应
Reference 独占。

## 源码 owner

| 范围 | owner | 规则 |
| --- | --- | --- |
| 外层宿主集成 | `packages/cli/src/`、`packages/cli/src/adapters/` | Adapter、安装事务、staging、备份、恢复和发布边界 |
| 内层 Runtime | `packages/harness/src/` | 宿主中立的 Memory、Task、路由、搜索、验证和审计原语 |
| 命令用例 | `packages/harness/src/commands/` | 组合用户用例，不承载通用领域原语 |
| 参数注册 | `packages/harness/src/cli.ts`、`packages/harness/src/program/` | 注册命令和参数契约 |
| 可复用原语 | `packages/harness/src/lib/` | 不依赖 `commands/` |
| Runtime 环境 | `packages/harness/src/runtime.ts` | 解析 root、owner、日期、身份和可覆盖路径 |
| 分发入口 | `bin/harnessmith.mjs`、`template/skills/agent-harness/scripts/harness.mjs` | 外层安装器与内层 bundle 的入口 |
| always-on 模块 | `template/entry/` | 以 `AGENTS.md` 为入口：只放边界、启动顺序和进入 skill 的触发规则 |
| skill 模块 | `template/skills/agent-harness/` | 以 `SKILL.md` 为入口的单个 skill：`scripts/`、`dist/`、`docs/`、`assets/`、`manifest.json` |

外层 Adapter 不是通用 Memory/Task 实现的 owner。`template/skills/agent-harness/dist/` 和根 `dist/` 是构建产物，
只能由构建生成，不能手工编辑；模板必须保持宿主中立。Node.js 运行时要求以当前 package、源码和测试为准。
分发模板按 Agent Skills 约定组织，只渲染一份到共享 hub `{{HARNESS_HOME}}/skills/agent-harness/`（默认
`~/.agents/harnessmith`），always-on 入口渲染为 `{{HARNESS_HOME}}/entry/AGENTS.md`；各宿主只收到指向 hub 的符号链接。
hub 内 `state/`、`rules/`（个人 overlay）与 `memory/`（跨项目记忆）位于 skill 之外，升级不触碰。宿主链接路径与旧布局
迁移只属于外层 Adapter，模板内只用 `{{HARNESS_HOME}}/skills/agent-harness` 引用自身。

## 修改边界

1. 先判断变更属于外层 Adapter、内层 Runtime、命令用例还是可复用原语，再选择目录。
2. 宿主路径、环境变量、规则格式和安装生命周期只进入外层 Adapter；通用 Memory/Task 能力留在内层。
3. 命令接收 `runtime`，通过可注入 `io` 输出；参数和错误必须可被测试观察。
4. 写入必须经过 owning store/transaction、SafePath、锁、原子写和结果校验；多文件 rollback 可能失败，失败时保留
   精确 recovery path，不能声称不可失败的原子事务。
5. 个人 overlay 位于 managed output 之外；升级和卸载不得覆盖或删除用户正文。未知 schema 或 Runtime identity
   必须 fail closed。

## Runtime 能证明什么

| 能力 | Runtime 可以证明 | 不能据此声称 |
| --- | --- | --- |
| `route` / `explain` | manifest、action、concept、required topic 和 deferred reference 的解析结果 | 宿主一定会读取或遵循路由 |
| `search` | 有界检索、provenance 和索引失效回退 | 未命中就证明内容不存在 |
| `health` / `validate` | 身份、schema、内容和安装状态检查 | warning 自动等于故障 |
| Task acceptance | 绑定 HEAD、workspace 和 scope 的机械证据 | 自由文本 criterion 已语义满足 |
| Memory/Task/Handoff | typed store、权限、锁、原子性和失败回退 | 任意 Markdown 或远端写入已被授权 |

宿主事件 hook 尚未提供；prompt/单元测试和 scenario contract 不能替代真实 Host Eval。没有绑定候选包的 passing
record 时，Host 行为必须报告为 `inconclusive`；`.agent-docs/host-evals/` 不属于 Memory 扫描，需单独运行
`pnpm run eval:validate`。

“记忆适配闭环”是可审计的本地流程，不是模型权重学习；Autopilot 不得自动改写 prompt、skill、规则或源码。
Memory repair 只在对应 owner 中定义 `diagnose-only → content-bound proposal → explicit apply → independent verifier`
流程；Memory curation 的 promotion 只生成 proposal，不直接写入事实源。本文件不复制这些字段和状态机。

## 按需加载的 owner

- CLI 参数、payload、退出码、Runtime identity 和安装记录：[`cli-contracts`](../references/cli-contracts.md)。
- Task、Handoff、Replay 和 acceptance evidence：[`task-and-replay-contracts`](../references/task-and-replay-contracts.md)。
- Memory 资格、curation、repair 和维护：[`project-agent-docs`](../standards/project-agent-docs.md) 及其
  [`memory-contracts`](../references/memory-contracts.md)。
- 搜索模式、索引预算和 benchmark：[`search-and-benchmarks`](../references/search-and-benchmarks.md)。
- Prompt 正反例和规则样本：[`prompt-examples`](../references/prompt-examples.md)。

读取 Reference 不改变授权，也不能把文档示例当作事实源；参数、退出码和 schema 以当前 `--help`、代码、测试
和 schema 为准。

## 最小验证

修改 Harness CLI 后运行与变更匹配的定向测试，并至少检查：

```bash
pnpm run test:harness
pnpm run check:docs
pnpm run preflight
```

端到端命令必须使用 task-scoped 临时 `HOME`（或 `HARNESS_HOME`、`HARNESS_MEMORY_HOME`、`HARNESS_PERSONAL_HOME`），
避免修改真实的 `~/.agents/harnessmith`。
