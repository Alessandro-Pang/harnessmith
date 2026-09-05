---
title: 首次价值循环
description: 从安装完成到真实宿主验证的可执行路径与证据边界
owner: maintainers
audience: users
status: active
updated: 2026-09-05
---

# 首次价值循环

安装器退出码为 0，只能证明本地事务完成。首次价值循环要回答更实际的问题：规则是否被真实宿主读取，Agent 是否能按规则完成一个低风险任务，以及你是否知道如何检查和恢复。

本文给出一条不依赖猜测的路径。前两项状态由本地 CLI 证明，后两项必须在真实宿主会话中确认。没有宿主证据时，结果写成 `inconclusive`，不要把“文件已安装”写成“Agent 已经正常工作”。

## 四个状态分别证明什么

| 状态 | 证明内容 | 主要 owner | 本地 CLI 能否独立证明 |
| --- | --- | --- | --- |
| `installed` | 安装记录存在，受管文件与记录中的 checksum 一致 | outer installer | 可以 |
| `healthy` | 内嵌 Runtime 的确定性 health 通过 | embedded Runtime | 可以 |
| `host-configured` | 真实宿主已读取规则，并具备预期认证和权限条件 | Host | 不可以 |
| `host-verified` | 真实宿主完成首次受控任务，且证据可复核 | Host 与用户 | 不可以 |

`setup` 和 `status` 只负责前两项。它们不会读取宿主的模型会话，也不会替宿主批准工具调用。`host-configured` 与 `host-verified` 没有证据时必须保持 `inconclusive`。本地测试、npm downloads 或 GitHub traffic 都不能替代或推断它们。

## 推荐路径：八个检查点

### 1. 确认定位

先读[为什么需要 Harnessmith](/guide/why-harnessmith)和[职责边界](/concepts/boundaries)，确认你需要的是跨宿主、可恢复的个人工作层。如果一个简短的 `AGENTS.md` 已经够用，可以在这里停止。

### 2. 选择宿主和范围

Codex、Claude Code、OpenCode、Kimi Code CLI、Zed Agent 使用全局范围；Cursor 使用项目范围。先查看[宿主支持](/guide/hosts)，再决定 `--agent` 和 `--project`。

### 3. 预览计划

```bash
npx harnessmith setup --agent codex --dry-run --json
```

逐项检查目标路径、范围、文件状态、冲突、备份位置和恢复命令。看到 `unmanaged` 或 `modified` 时先停下，不要用 `--force` 代替理解差异。

### 4. 安装并检查本地状态

```bash
npx harnessmith setup --agent codex
npx harnessmith status --agent codex --explain
npx harnessmith diagnostics --agent codex --json
```

`status` 确认安装所有权和完整性；`diagnostics` 运行确定性 Runtime 检查。到这里最多得到 `installed` 和 `healthy`。命令中的 `codex` 可替换为任意受支持宿主；`installed` 之后统一的下一步是 `npx harnessmith diagnostics --agent <agent> --json`，确定性 health 通过后再进入真实宿主。

### 5. 准备一个低风险受控任务

打开新的宿主会话，使用只读任务。推荐直接复制下面的请求，再按仓库实际内容替换主题：

> 只读分析当前仓库的发布流程。列出你读取的文件和命令，区分代码、配置、测试和文档事实；说明无法验证的部分。不要修改文件、提交、推送、发送消息或访问外部系统。

任务要足够真实，能触发规则入口、项目发现、文档路由和事实核对；又要足够安全，失败时不会改变工作树。

### 6. 确认宿主已加载规则

在宿主输出或工具记录中确认三件事：

1. Agent 读取了当前宿主对应的规则入口；
2. 它遵守了只读范围，没有写入、提交、推送或调用未授权的外部服务；
3. 它列出了事实来源和未验证范围，而不是只给出结论。

这三项是人工或 Host-owned 检查，不是 `status` 可以代替的本地 verifier。若宿主未登录、工具记录缺失或权限状态无法确认，写成 `inconclusive`。

### 7. 保存最小证据

至少保留以下信息：宿主名称和版本、Harnessmith 候选版本、会话时间、任务原文、读取的文件或工具动作、工作树前后状态、Agent 输出、用户或独立 verifier 的判断。

对于本页的只读任务，最小可复核证据可以是：

```text
host: <codex|cursor|...> <version>
candidate: harnessmith <version>
task: <任务原文>
observed: <规则入口已读取；读取了哪些文件；执行了哪些只读命令>
workspace_before: <git status 或文件 digest>
workspace_after: <同一检查结果>
verifier: <用户复核 / Host-owned verifier / 命令>
result: passed | inconclusive | failed
limitations: <认证、网络、工具记录等限制>
```

退出码为 0 或最终文本说“完成”都不能单独构成 `passed`。如果没有直接 verifier，保留证据但将结果标为 `inconclusive`。

### 8. 确认恢复路径

在宣布“可以长期使用”前，先查看：

```bash
npx harnessmith status --agent codex --explain
npx harnessmith restore --agent codex --dry-run
```

确认你知道备份在哪里、restore 会恢复哪一层、失败时应保留哪些现场。恢复预览不会修改文件。

## 维护者的本地回归

维护者可以运行：

```bash
pnpm run eval:first-value
```

该命令在 disposable 目录中回归 preview、install、health、status explain 和 restore preview，并生成 `evals/first-value-record.schema.json` 规定的本地 acceptance record。基础回归通过时，结果是 `local-baseline-passed`，但`hostConfigured`、`hostVerified` 和 `firstValueAchieved` 仍应是 `inconclusive` 或 `false`。它不启动、登录或遥测第三方宿主。

## 何时算完成

只有当本地 `installed`、`healthy` 均通过，真实宿主完成受控任务，工作树和工具证据可复核，并且恢复路径已经确认时，才可以把首次价值记录为 `host-verified`。任何一个环节缺证据，都保留当前结果并写清限制，不要用更强的措辞替代验证。
