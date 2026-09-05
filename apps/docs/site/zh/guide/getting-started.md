---
title: 快速开始
description: 从一条 dry-run 命令到第一次真实对话的完整路径
owner: maintainers
audience: users
status: active
updated: 2026-09-05
---

# 快速开始

按「预览 → 写入 → 核对」三步完成第一次安装。本文以 Codex 为例，说明每一步会改变什么、如何处理拒绝，以及本地安装成功后还需要怎样验证真实宿主。

Harnessmith 是 npm initializer，用 `npx` 直接运行，不需要提前全局安装任何东西。唯一的环境要求是 Node.js 24.12.0 或更高版本。

## 开始之前

先确认两件事：

- 目标 Coding Agent 已经装好，并且你能正常打开它。Harnessmith 只写入宿主的规则入口，不负责替你安装宿主。
- 想清楚装在哪个范围：全局个人目录（大多数宿主），还是某个具体项目（Cursor）。

它不需要你的模型 API key，也不会替你登录任何第三方服务。如果你对「它到底会改我哪些文件」有顾虑，恰好这就是第一步要解决的问题。

## 三个动作走完安装

### 第一个动作：只看计划

以 Codex 为例：

```bash
npx harnessmith setup --agent codex --dry-run
```

dry-run 不写任何文件。它输出的是安装将要执行的同一份计划：宿主范围、目标根、每个文件的 `missing` / `managed` / `unmanaged` / `modified` 状态、不会被动到的 Host 能力，以及出问题时用的恢复命令。写盘之前先看一遍这份计划，是你对「改动范围」的第一道确认；需要机器处理时加 `--json`。

### 第二个动作：执行写入

```bash
npx harnessmith setup --agent codex
```

交互模式会在写入前再次展示变更、不变项和恢复方式，并允许你取消。非交互环境（CI、脚本）必须显式确认：

```bash
npx harnessmith setup --agent codex --yes --json
```

### 第三个动作：核对结果

`setup` 在安装事务完成后会自动检查所有权与内嵌 Runtime 健康；之后你也可以随时重新核对：

```bash
npx harnessmith status --agent codex
npx harnessmith status --agent codex --explain
```

普通 `status` 只回答「安装是否完整」。当你需要据此做决定时，加 `--explain`：它会给出 observed state、owner、证据、风险和一个稳定的 action code。这些动作只是建议，不会自动执行。

## 两种会被拒绝的情况

有些写入请求会被默认拒绝。这不是安装出了问题，而是安全边界在起作用，提前知道可以少走弯路：

- **目标文件不归 Harnessmith 管**：文件已存在但是 `unmanaged`，或受管后被改成了 `modified`，引导会默认拒绝，确认步骤也不能绕过。正确的做法是先弄清文件来源和差异；确实要接管时走 `adopt` 显式导入（见[安全生命周期](/guide/lifecycle)），并保留生成的备份。不要用 `--force` 掩盖未知冲突。它会先备份再替换，但「覆盖了什么」需要你自己负责。
- **宿主没有 Adapter**：没有对应 Adapter 的宿主是 `unsupported`，会在解析或写入任何目标之前就停下来，不会留下半个安装。

## 安装失败怎么办

安装是一个事务：失败时会尝试回滚本次写入的精确路径。按错误信息里的指引，先重新 dry-run、再查 `status`，确认现场干净。只有当存在上一安装层时才使用 `restore` 回退，没有上一层的机器上跑它没有意义。

## 「装好了」到底证明了什么

这一页反复出现两种「通过」，值得分开记：

- 安装成功、确定性健康检查通过——只说明本地文件与内嵌 Runtime 是好的；
- 模型行为、工具权限、认证与运行时事件——这些是 `host-dependent`，必须到真实宿主会话里另行验证。

统一的状态词汇是 `installed`、`healthy`、`host-configured`、`host-verified`：`setup` 能在本地证明前两项；`status` 只证明 `installed`，不会顺带证明 `healthy`。受限于环境的检查会明确返回 `inconclusive`，而不是把「安装完整」夸大成「会话健康」。

完成安装后的标准下一步是：

```bash
npx harnessmith diagnostics --agent <agent> --json
```

然后进入真实宿主，跑完你的第一个受控任务。起点、终点、owner、失败出口与零遥测回归的完整定义，见 [首次价值循环](/guide/first-value-loop)。

## 装到其他宿主

`codex`、`claude-code`、`opencode`、`kimi-code` 与 `zed` 使用全局安装范围；`cursor` 使用项目范围，需要显式给出项目根：

```bash
npx harnessmith setup --agent cursor --project /path/to/project
```

同一命令也支持逗号分隔的多个宿主，一次装完：

```bash
npx harnessmith setup --agent codex,opencode,kimi-code
```

各宿主的准确路径、别名和支持状态见[宿主支持](/guide/hosts)。

## 装完之后的第一次对话

新开的宿主会话会自动读取对应规则入口，你不需要在每个请求里粘贴整套规则。从一个普通任务开始就好，比如：

> 只读分析当前仓库的发布流程，说明事实来源和未验证范围，不要修改文件。

这样的请求会先命中入口中的信任与发现规则，再按需路由到具体 playbook。Harnessmith 提供的是上下文和工作契约；宿主是否执行命令、是否要求权限批准，仍由宿主自己决定。

只有真实宿主完成该任务并保留工具、文件系统与 verifier 证据，才算到达 `host-verified`。在那之前，先看一眼 `status --explain` 和 `restore --dry-run`，把恢复路径确认清楚。这是首次价值循环里 `recovery-aware` 检查点的要求。

## 让 Agent 帮你装

<!-- markdownlint-disable MD034 -->

你也可以把安装交给 Coding Agent 自己完成，只要在写入前亲自检查目标：

> 阅读 https://raw.githubusercontent.com/Alessandro-Pang/harnessmith/main/llms.txt，按其中协议安装 Harnessmith；先执行 dry-run，再让我确认写入。

<!-- markdownlint-enable MD034 -->
