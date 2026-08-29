---
layout: home
title: Harnessmith 文档
description: 跨宿主分发和安全管理个人 Agent Harness
owner: maintainers
hero:
  name: Harnessmith
  text: 把你的 Agent 工作方式，安全地带到不同 Coding Agent
  tagline: 一次维护个人规则、工作状态与验证习惯；由 Harnessmith 负责适配、安装、恢复和升级。
  actions:
    - theme: brand
      text: 5 分钟开始
      link: /guide/getting-started
    - theme: alt
      text: 它解决什么问题
      link: /guide/why-harnessmith
features:
  - title: 一套工作方式，多个宿主
    details: 面向 Codex、Cursor、Claude Code、OpenCode 与 Kimi Code CLI 分发同一套个人 Harness。
  - title: 改动前可看，出问题可退
    details: dry-run、完整预检、备份、锁、恢复和精确回滚共同保护已有文件。
  - title: 长任务不只靠聊天记录
    details: 用本地 Memory、Task、检查点和验收证据衔接跨会话工作，同时保留项目事实源的权威性。
---

# Harnesssmith 是什么

你是否遇到过这些情况？同一套安全边界要在多个 Coding Agent 中反复维护；规则越写越长，却越来越难被 Agent
正确找到；一个任务跨过几次上下文压缩后，下一次会话只能靠猜；升级配置时，又担心覆盖自己原有的文件。

Harnesssmith 解决的不是“少写一份配置”，而是让一套个人 Agent 工作方式可以被**安全分发、按需发现、跨会话延续，
并用证据核对结果**。它由两部分组成：外层 npm initializer 负责宿主适配和可恢复安装；安装后的本地 Harness
负责文档路由、非权威 Memory、长任务状态与有限审计。

Harnessmith 不替代 Coding Agent。模型循环、工具执行、sandbox、权限批准和 token 成本仍由 Codex、Cursor、
Claude Code、OpenCode 或 Kimi Code CLI 自己负责。Harnessmith 管理的是它们周围那层可携带、可维护的个人工作环境。

## 从这里开始

- 还不确定是否需要它：先读[它解决什么问题](/guide/why-harnessmith)。
- 想马上试用：跟随[5 分钟快速开始](/guide/getting-started)。
- 想知道一次安装后发生了什么：阅读[Harnessmith 如何工作](/concepts/how-it-works)。
- 要评估安全性和技术取舍：进入[架构](/architecture)、[责任边界](/concepts/boundaries)与[证据和评测](/concepts/evidence-and-evaluation)。

English readers can start from the [English overview](/en/).
