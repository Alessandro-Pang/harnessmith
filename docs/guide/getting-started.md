---
title: 快速开始
description: 安装 Harnessmith、选择宿主并验证结果
owner: maintainers
---

# 快速开始

Harnessmith 是 npm initializer，不要求预先全局安装。它需要 Node.js 24.12.0 或更高版本。

## 最短路径

交互式安装：

```bash
npx harnessmith
```

也可以直接指定宿主：

```bash
npx harnessmith install --agent codex
```

执行前只查看计划，不写入文件：

```bash
npx harnessmith --dry-run --agent codex
```

安装后确认 Harnesssmith 是否仍拥有目标文件且内容完整：

```bash
npx harnessmith status --agent codex
```

## 选择宿主

`codex`、`claude-code`、`opencode` 与 `kimi-code` 使用全局安装范围；`cursor` 使用项目范围，需通过
`--project` 指定项目根：

```bash
npx harnessmith install --agent cursor --project /path/to/project
```

同一命令可重复或逗号分隔选择多个宿主：

```bash
npx harnessmith install --agent codex,opencode,kimi-code
```

目标路径与支持状态见[宿主支持](/guide/hosts)。

## 让 Agent 帮你安装

<!-- markdownlint-disable MD034 -->

把以下请求交给 Coding Agent，并在执行写入前检查它展示的目标：

> 阅读 https://raw.githubusercontent.com/Alessandro-Pang/harnessmith/main/llms.txt，按其中协议安装 Harnesssmith；先执行 dry-run，再让我确认写入。

## 下一步

<!-- markdownlint-enable MD034 -->

- 理解 restore、uninstall 和文件接管规则：[生命周期](/guide/lifecycle)
- 查看所有参数：[CLI 参考](/reference/cli)
- 理解哪些能力由 Harnessmith 实现、哪些由宿主负责：[责任与安全边界](/concepts/boundaries)
