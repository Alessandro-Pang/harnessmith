---
title: Global Agent Memory
description: 跨项目个人记忆协议与入口。
type: agent-memory-index
memory-kind: index
status: active
owners:
  - |-
    {{HARNESS_OWNER}}
created: "{{DATE}}"
updated: "{{DATE}}"
project: global
tags: ["agent-memory", "cross-project"]
scope:
  - |-
    {{HARNESS_REPOSITORY_ROOT}}
source-refs: []
source-of-truth: false
schema-version: 1
---

# Global Agent Memory

这里保存跨项目、跨 Agent、可人工审阅的个人记忆；不是全局规则或项目事实源。

- 稳定工作规则放宿主加载的 instruction file 与 `{{HARNESS_HOME}}/agent-harness/docs/`。
- 项目事实放各仓库 `docs/`、代码、测试和 ADR。
- 单仓输入、交接和工作状态放该仓库 `.agent-docs/`。
- 只有确实跨多个仓库复用的偏好、经历和提炼发现才放这里。
- 宿主原生 memory 是自动召回补充层，不手工编辑其生成状态来代替本目录。

先读 `core.md`，再按 `` `memory:<relative-name>` `` 读取需要的记忆。
