# Harnessmith

Forge once. Work consistently across coding agents.

[English](./README.en.md) | 简体中文

通过一个轻量的 npm initializer，把 Personal Coding Agent Harness 安装到 Codex、
Cursor 或 Claude Code：

```bash
npx harnessmith
```

需要 Node.js 24.12+。源码开发固定使用 pnpm 10.13.0；交互模式允许多选 Agent，自动化或脚本中
使用 `--agent`。

这是一个 opinionated personal Harness：默认语言、Git 契约、记忆边界和安全策略有明确取舍；
宿主路径与格式由 Adapter 隔离，分发模板中不包含特定 Agent 的标识。

它是 Personal Harness 的分发与本地 work-state/rule validation toolkit，不替代宿主 Agent Runtime，
也不把 Markdown guidance 宣传为安全强制。当前架构和 enforcement owner 见
[`docs/architecture.md`](./docs/architecture.md)。

如果由 LLM 或 coding agent 代为安装，请让它先读取 [`llms.txt`](./llms.txt)。其中包含目标解析、
dry-run、权限边界、初始化、验证和失败处理协议。

## 地址映射

| Agent | 生效的规则文件 | Harness 目录 |
| --- | --- | --- |
| Codex | `$CODEX_HOME/AGENTS.md`，默认 `~/.codex/AGENTS.md` | `$CODEX_HOME/agent-harness` |
| Claude Code | `$CLAUDE_CONFIG_DIR/CLAUDE.md`，并保留同目录 `AGENTS.md` | `$CLAUDE_CONFIG_DIR/agent-harness` |
| Cursor | `<project>/.cursor/rules/agent-harness.mdc`，并保留 `.cursor/AGENTS.md` | `<project>/.cursor/agent-harness` |

Cursor 的文件化规则按项目安装，因为 Cursor 的全局 User Rules 由设置界面管理，官方文档没有把
`~/.cursor/rules` 定义为可靠的全局规则入口。使用 `--project` 指定 Cursor 项目根目录。
Harnesssmith 会把自己管理的 Cursor 文件写入仓库本地 Git exclude 与 `.cursor/.ignore`，不会忽略
团队已有的整个 `.cursor/` 目录，也不会让生成文件出现在 `git status` 中。

## 使用方式

直接通过 npm registry 运行 Harnesssmith：

```bash
# 交互选择
npx harnessmith

# 安装一个 Agent
npx harnessmith --agent codex

# 等价的显式形式
npx harnessmith install --agent codex

# 无交互地使用默认选择 Codex
npx harnessmith --yes

# 同时安装；Cursor 使用指定项目
npx harnessmith \
  --agent codex,cursor,claude \
  --project /absolute/path/to/project

# 只查看会写到哪里
npx harnessmith --agent all --project . --dry-run

# 为脚本或 LLM 输出稳定的 JSON Lines
npx harnessmith --agent all --project . --dry-run --json

# 查看安装状态和文件完整性
npx harnessmith status --agent codex

# 恢复上一层安装
npx harnessmith restore --agent codex

# 逐层恢复到首次安装前并卸载
npx harnessmith uninstall --agent codex
```

`--json` 同时覆盖成功和失败。失败写入一条 stderr JSON，包含 `version`、稳定 `error.code`、
`message` 和 `exitCode`；CLI 用法错误返回 2，安全或完整性拒绝返回 3，operation lock 冲突返回
4，无可操作安装状态返回 5，未分类内部错误返回 1。普通文本模式保持面向人的错误信息。

可重复传入 `--agent`。可选值为 `codex`、`cursor`、`claude`、`claude-code` 和 `all`。
交互终端使用多选、冲突确认和分层状态输出；非交互调用应显式传入 `--agent`，需要稳定机器协议时
使用 `--json`。`--yes` 只关闭交互并在未指定 Agent 时选择 Codex，不会自动同意文件冲突。

支持以下环境变量：

- `CODEX_HOME`：Codex 目标目录。
- `CLAUDE_CONFIG_DIR`：Claude Code 目标目录。
- `HARNESS_MEMORY_HOME`：共享的跨项目个人记忆目录，默认 `~/.agent-docs`。
- `HARNESS_PERSONAL_HOME`：用户维护的个人规则与仓库关系 overlay，默认 `~/.agent-harness`。
- `HARNESS_REPOSITORY_ROOT`：仓库集合根目录，默认 `~/git-repo`。
- `HARNESS_OWNER`：记忆模板 owner。

`CODEX_HOME` 和 `CLAUDE_CONFIG_DIR` 只属于对应安装 adapter；它们不会进入 Harness 模板、运行时
字段或渐进式文档。

内置 Harness 使用完全中性的运行时契约；新增宿主时只需扩展 adapter，不修改模板核心。
dry-run、install result 和 status JSON 都包含 Adapter 的 `capabilities`，明确 scope、instruction
format、native activation，以及 file ownership、instruction guidance 和权限的 enforcement owner。

## 安全与升级

- install 先在目标目录创建完整 staging，并对所有 `.mjs` 执行语法检查，再进行替换；restore 和
  uninstall 使用安装记录预检精确恢复目标，不重复渲染安装模板。
- 所有受管理 output、backup、record 和 ignore path 同时做 lexical 与 canonical containment 校验；
  授权根及其下方的 symlink、junction 或 reparse path 默认拒绝。
- install、status、restore 和 uninstall 使用每个 Adapter 的跨进程 operation lock；多 Adapter 按
  lock path 排序，避免并发覆盖和死锁。
- 新文件直接创建；由当前安装记录管理且 checksum 未变化的文件可以安全升级。
- 遇到陌生文件或安装后被用户修改的文件时默认停止。只有明确接受备份并接管时才使用
  `--force`。
- 已有规则文件不会被覆盖，会在同目录重命名为
  `<filename>.backup-<timestamp>`。
- 已有 `agent-harness/` 会重命名为 `agent-harness.backup-<timestamp>`。
- 多 Agent 安装中任一目标失败，会回滚本次已替换的目标。
- 已有 Harness 的 `state/` 会复制到新版本，且不参与受管理运行时 checksum；运行状态变化不会
  被误判为源码篡改。
- `~/.agent-harness`（或 `HARNESS_PERSONAL_HOME`）是用户所有的持久 overlay，安装器只补齐缺失
  骨架，升级、恢复和卸载均不覆盖或删除它。
- 每个 Adapter 都保存独立安装记录，`status` 会报告 `managed`、`modified` 或 `missing`。
- `restore` 只恢复上一层；`uninstall` 逐层恢复，最终回到首次安装前状态。两者检测到用户修改时
  默认停止，可显式使用 `--force`。
- 升级 Cursor 或 Claude Code 安装时重新运行本 initializer；不要直接运行其中的
  `harness install`。

安装器默认幂等初始化个人 overlay 和全局 `.agent-docs`；`--no-init-global` 只跳过全局记忆，
不会跳过个人 overlay。项目
`.agent-docs` 仍由 Agent 根据任务性质判断是否初始化，无法确定时询问用户。
全局记忆包含最多 32 条的紧凑用户画像：只记录用户当前身份、工作方式、技术背景、偏好和研究方向；
同一维度发生变化时原位更新，不保留相互冲突的并列结论。

## 开发

安装器与内置 Harness 均以 strict TypeScript 编写。先以 Node.js 24.12+ 和 pnpm 10.13.0 安装
锁定依赖；`pnpm run build` 会把安装器编译到根目录
`dist/`，并把内置 Harness 打包到 `template/agent-harness/dist/harness.mjs`；两个目录都是生成物，
不要直接修改。npm 包和用户安装目录只包含内置 Harness 的运行时、文档、模板与 Schema，
TypeScript 源码只保留在源码仓库中。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node bin/harnessmith.mjs --help
pnpm run format
pnpm run preflight
pnpm run test:harness
pnpm run test:coverage
npm pack --dry-run
```

`npm pack --dry-run` 特意保留为 npm 分发物清单验证；仓库依赖安装、脚本编排和 CI 均使用 pnpm。

Biome、Markdownlint、Commitlint、Vitest、lint-staged 与 Husky 共同提供代码规范门禁。
`pre-commit` 检查暂存文件和文档契约，`commit-msg` 检查 Conventional Commit，`pre-push`、CI
和 `prepack` 执行 `pnpm run preflight`；`prepublishOnly` 执行包含覆盖率门禁的
`pnpm run release:check`。该预检还会实际探测安装器与内置
Harness CLI，并检查文档路由、frontmatter、相对链接、模板 token 和宿主中立性。
贡献、安全报告与版本记录分别见
[`CONTRIBUTING.md`](./CONTRIBUTING.md)、[`SECURITY.md`](./SECURITY.md) 和
[`CHANGELOG.md`](./CHANGELOG.md)。发布步骤见 [`RELEASING.md`](./RELEASING.md)。
