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
- 跨多个仓库复用的经历和提炼发现可按来源放在独立 memory；用户偏好和身份只写入 `profile.md`。
- `profile.md` 是 Harness 内唯一的当前用户画像；同一维度发生变化时原位更新，不追加冲突条目。
- 宿主原生 memory 只作为待核对线索，不作为第二份当前画像，也不手工编辑其生成状态。

先读 `core.md`，再按 `` `memory:<relative-name>` `` 读取需要的记忆。
