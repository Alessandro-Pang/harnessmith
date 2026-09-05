---
title: 宿主支持
description: 六类 Coding Agent 的安装范围、路径规则与「支持」的准确含义
owner: maintainers
audience: users
status: active
updated: 2026-09-05
---

# 宿主支持

本文列出当前可用的六类 Adapter，说明它们的目标路径、安装范围和激活方式，并解释“支持”在本项目里具体承诺到哪一层。实际路径始终以当前版本的 `capabilities --json` 和 `setup --dry-run --json` 为准。

Harnessmith 当前为六类宿主提供 Adapter。可以把 Adapter 理解成「翻译层」：它负责路径解析和文件格式适配，让同一套个人规则落进不同宿主约定的位置。它不替代宿主自身的模型循环、工具调度、sandbox 或权限批准——那些仍然是宿主的地盘。

为什么要用 Adapter 而不是直接写文件？因为每个宿主对「规则入口」的约定不一样：有的读用户主目录下的固定文件，有的读项目目录，有的要求特定 frontmatter 格式。如果把这些差异硬编码进分发模板，模板就会和宿主耦合，换个宿主就得改模板。Adapter 模式把「写什么」（宿主中立的 Harness）和「写到哪里、用什么格式」（宿主相关）分开，新增宿主只需要新增一个 Adapter，不动模板。

## 一张表看懂六个宿主

| 宿主 | `--agent` | 默认规则入口 | 范围与激活 |
| --- | --- | --- | --- |
| Codex | `codex` | `${CODEX_HOME:-~/.codex}/AGENTS.md` | 全局；宿主默认 |
| Cursor | `cursor` | `<project>/.cursor/AGENTS.md` 与 `rules/agent-harness.mdc` | 项目；MDC always |
| Claude Code | `claude`（别名 `claude-code`） | `${CLAUDE_CONFIG_DIR:-~/.claude}/AGENTS.md` 与 `CLAUDE.md` | 全局；宿主默认 |
| OpenCode | `opencode` | `${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/opencode}/AGENTS.md` | 全局；宿主默认 |
| Kimi Code CLI | `kimi`（别名 `kimi-code`） | `${KIMI_CODE_HOME:-~/.kimi-code}/AGENTS.md` | 全局；宿主默认 |
| Zed Agent | `zed` | `~/.config/zed/AGENTS.md`（Windows：`%APPDATA%\Zed\AGENTS.md`） | 全局；宿主默认 |

想核对当前版本的 Adapter 声明，直接问 CLI 要机器可读输出：

```bash
npx harnessmith capabilities --json
```

这个命令输出每个宿主的范围、入口路径模板、环境变量和当前支持状态，适合在写脚本或排查「我的机器上到底会装到哪里」时使用。比起翻文档，它的优点是永远和你实际运行的版本一致。

## 全局宿主与项目宿主

六类宿主分两种安装范围。全局 Adapter 把个人规则与 Harness Runtime 装进宿主约定的用户目录，装一次对所有项目生效；Cursor 是唯一的例外——它写入你明确授权的项目根，省略 `--project` 时使用当前工作目录，换一个项目就要再装一次。

为什么 Cursor 要特殊处理？因为它的规则加载机制是项目级的：`.cursor/rules/` 目录下的 MDC 文件随项目走，而不是随用户走。这意味着如果你想在多个项目里用同一套 Harness，需要在每个项目里各装一次。好消息是安装是可重复的，且每次都会做冲突检查，不会因为你忘了装过就重复写入。

无论哪种范围，所有路径在写入前都会先做 containment 与 symlink 检查，防止目标被符号链接引到预期之外的位置。这个检查的实际意义是：如果你或某个工具曾经把 `~/.codex` 链接到了别的地方（比如一个同步盘），安装器会发现并停下来，而不是把文件写进你意想不到的位置。

每个入口的同目录下还会有 `agent-harness/` 和 `.harnessmith/install.json`（Cursor 的记录在 `.cursor/.harnessmith/`）。前者是分发出来的 Harness Runtime，后者是安装记录——卸载和恢复都依赖它。安装记录里存了版本、时间戳、文件清单和 checksum，有了它，`restore` 才能精确回滚到上一层，`uninstall` 才能知道该删哪些文件、不碰哪些。

环境变量解析、目标文件名和迁移兼容属于外层 Adapter，分发模板保持宿主中立。要判断你本机的实际目标路径，优先跑一次 `--dry-run --json`，不要凭文档猜。环境变量和平台差异都可能让真实路径和默认值不同。一个常见例子：如果你设置了 `XDG_CONFIG_HOME`，OpenCode 的规则入口就不在 `~/.config/opencode`，而在你指定的位置。dry-run 会把解析后的真实路径列出来，装之前看一眼，可以避免「装完了找不到文件」的困惑。

## 各宿主的差异与注意事项

- **Cursor**：Harnessmith 只把自己管理的文件写进 repository-local Git exclude 与 `.cursor/.ignore`，不会隐藏或覆盖团队已有的整个 `.cursor/` 目录。和团队共享仓库时，不会干扰他人的配置。这个设计的出发点是：`.cursor/` 目录通常已经存在，里面可能有团队共享的规则或设置，Harnessmith 只往里加自己管理的文件，并在 Git exclude 里登记，让 `git status` 不会被这些本地文件刷屏。
- **Kimi Code CLI**：Adapter 面向当前 TypeScript/Node.js 实现的 Kimi Code CLI，使用 `KIMI_CODE_HOME`；它不接管旧 Python `kimi-cli` 用的 `~/.kimi/` 目录。如果你的目录是旧的，先确认自己跑的是哪个版本。这个区分容易踩坑：两个版本的 CLI 可以共存，规则入口完全不同，装错了版本会看到「装了但 Agent 没反应」的现象。

精确兼容要求以对应 npm 发布包中的 `llms.txt` 为准，那是每次发布时最新的契约。如果你在读这份文档的离线副本，或者距离发布有一段时间了，`llms.txt` 里可能有更新的说明。

## 「支持」如何解释

「支持」表示该 Adapter 已实现安装生命周期、能力描述和自动化回归；不表示每个宿主版本都完成了真实运行评测。这是两层不同的承诺，别混用。

为什么要把这两层分开？因为「安装器能写进去」和「宿主真的按预期工作」是两回事。前者 Harnessmith 可以完全控制并测试：路径对不对、格式对不对、冲突检查是否生效。后者取决于宿主自身的行为：它是否按约定读取规则、是否在正确时机加载、权限系统是否按预期工作。Harnessmith 可以声明「我按宿主的公开契约写入了」，但不能替宿主承诺「宿主一定会这么做」。

逐项声明与证据路径，以仓库中的
[capability-evidence.yaml](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml)
为准。真实宿主评测与发布门禁的限制，见[证据与评测](/concepts/evidence-and-evaluation)。
