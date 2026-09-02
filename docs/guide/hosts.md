---
title: 宿主支持
description: 支持的 Coding Agent、安装范围和责任边界
owner: maintainers
---

# 宿主支持

Harnessmith 当前为六类 Coding Agent 提供 Adapter。Adapter 负责路径与文件格式适配，不会替代宿主自身的
模型循环、工具调度、sandbox 或权限批准。

| 宿主 | `--agent` | 默认规则入口 | 范围与激活 |
| --- | --- | --- | --- |
| Codex | `codex` | `${CODEX_HOME:-~/.codex}/AGENTS.md` | 全局；宿主默认 |
| Cursor | `cursor` | `<project>/.cursor/AGENTS.md` 与 `rules/agent-harness.mdc` | 项目；MDC always |
| Claude Code | `claude`（别名 `claude-code`） | `${CLAUDE_CONFIG_DIR:-~/.claude}/AGENTS.md` 与 `CLAUDE.md` | 全局；宿主默认 |
| OpenCode | `opencode` | `${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/opencode}/AGENTS.md` | 全局；宿主默认 |
| Kimi Code CLI | `kimi`（别名 `kimi-code`） | `${KIMI_CODE_HOME:-~/.kimi-code}/AGENTS.md` | 全局；宿主默认 |
| DeepSeek Harness | `deepseek`（别名 `dsh`、`deepseek-harness`） | `${DSH_HOME:-~/.dsh}/AGENTS.md` | 全局；宿主默认 |

可以用机器可读输出核对当前版本的 Adapter 声明：

```bash
npx harnessmith capabilities --json
```

## 全局宿主与项目宿主

全局 Adapter 将个人规则与 Harness Runtime 安装到宿主约定的用户目录。Cursor Adapter 则写入明确授权的
项目根；省略 `--project` 时使用当前工作目录。所有路径会先做 containment 与 symlink 检查。

每个入口同目录还会包含 `agent-harness/` 和 `.harnessmith/install.json`；Cursor 的记录位于 `.cursor/.harnessmith/`。
环境变量解析、目标文件名和迁移兼容属于外层 Adapter，分发模板保持宿主中立。如需判断本机实际目标，优先运行
`--dry-run --json`，不要仅依据文档猜测。

Cursor 只把 Harnessmith 自己管理的文件写入 repository-local Git exclude 与 `.cursor/.ignore`，不会隐藏或覆盖团队已有的
整个 `.cursor/` 目录。Kimi Adapter 面向当前 TypeScript/Node.js 实现的 Kimi Code CLI，并使用 `KIMI_CODE_HOME`；它不接管
旧 Python `kimi-cli` 使用的 `~/.kimi/` 目录。DeepSeek Adapter 面向官方 `dsh` / `@deepseek-ai/dsh`，只托管用户全局
`$DSH_HOME/AGENTS.md`；项目根/嵌套候选、权限与 sandbox 仍由宿主负责。精确兼容要求以对应 npm 发布包中的 `llms.txt`
为准。

## 支持状态如何解释

“支持”表示该 Adapter 已实现安装生命周期、能力描述和自动化回归；不表示每个宿主版本都完成了真实运行评测。
逐项声明与证据路径以仓库中的
[capability-evidence.yaml](https://github.com/Alessandro-Pang/harnessmith/blob/main/docs/capability-evidence.yaml)
为准。真实 Host Eval 与发布门禁的限制见[证据与评测](/concepts/evidence-and-evaluation)。
