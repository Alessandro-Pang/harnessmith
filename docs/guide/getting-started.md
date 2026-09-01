---
title: 快速开始
description: 先预览，再安装并验证第一个 Harnessmith 宿主
owner: maintainers
---

# 快速开始

这条路径会先预览，再安装到一个宿主，最后核对结果。Harnessmith 是 npm initializer，不要求预先全局安装；需要
Node.js 24.12.0 或更高版本。

## 开始前

先确认目标 Coding Agent 已经安装，并知道自己要使用全局个人范围还是 Cursor 项目范围。Harnessmith 不需要你的模型
API key，也不会替你登录第三方宿主。

## 第一步：只看计划

以 Codex 为例：

```bash
npx harnessmith setup --agent codex --dry-run
```

dry-run 不写文件。它会输出之后安装所复用的同一份计划，包括宿主范围、目标根、每个文件的
`missing` / `managed` / `unmanaged` / `modified` 状态、不会改动的 Host 能力以及恢复命令。机器处理时可加
`--json`。

## 第二步：执行安装

直接指定宿主：

```bash
npx harnessmith setup --agent codex
```

交互模式会在写入前再次展示变更、不变项和恢复方式，并允许取消。非交互环境必须显式确认：

```bash
npx harnessmith setup --agent codex --yes --json
```

如果目标是 `unmanaged` 或受管理后被修改为 `modified`，引导仍会默认拒绝，不会通过确认步骤绕过。不要用 `--force`
掩盖未知冲突；先确认文件来源和差异，确实要接管时再显式选择，并保留生成的备份。没有对应 Adapter 的宿主是
`unsupported`，在解析或写入目标前停止。

## 第三步：验证安装

`setup` 会在安装事务完成后自动检查所有权和内嵌 Runtime 健康。也可以随时重新核对：

```bash
npx harnessmith status --agent codex
```

安装失败时，事务会尝试回滚；按错误中的指引先重新 dry-run 并检查 `status`，只有存在上一安装层时才使用
`restore`。安装成功或确定性健康检查通过，不等于真实 Host 行为已经通过：模型行为、工具权限、认证与运行时事件均为
`host-dependent`，必须在实际宿主会话中另行验证。

## 选择其他宿主

`codex`、`claude-code`、`opencode` 与 `kimi-code` 使用全局安装范围；`cursor` 使用项目范围：

```bash
npx harnessmith setup --agent cursor --project /path/to/project
```

同一命令可以逗号分隔多个宿主：

```bash
npx harnessmith setup --agent codex,opencode,kimi-code
```

准确目标路径、别名和支持状态见[宿主支持](/guide/hosts)。

## 第一次实际使用

新开的宿主会话会读取对应规则入口。你不需要在每个请求里粘贴整套规则，可以从一个普通任务开始：

> 只读分析当前仓库的发布流程，说明事实来源和未验证范围，不要修改文件。

这类请求会先命中入口中的信任与发现规则，再按需路由到具体 playbook。Harnessmith 提供上下文和工作契约；宿主是否
执行命令、是否要求权限批准，仍由宿主自身决定。

## 让 Agent 帮你安装

<!-- markdownlint-disable MD034 -->

你也可以把以下请求交给 Coding Agent，并在写入前亲自检查目标：

> 阅读 https://raw.githubusercontent.com/Alessandro-Pang/harnessmith/main/llms.txt，按其中协议安装 Harnessmith；先执行 dry-run，再让我确认写入。

<!-- markdownlint-enable MD034 -->
