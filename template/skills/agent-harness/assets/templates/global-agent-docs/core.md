---
title: Global Memory Core
description: 当前跨项目活跃主题与高价值个人记忆入口。
type: agent-memory-index
memory-kind: index
status: active
owners:
  - |-
    {{HARNESS_OWNER}}
created: "{{DATE}}"
updated: "{{DATE}}"
project: global
tags: ["memory-index"]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---

# Global Memory Core

## User Profile

- 每个新宿主 task/thread 首次工作前读取一次 `memory:profile`；同一 task/thread 不重复读取。

其余跨项目记忆只写“何时读取 + 能回答什么 + `memory:` 引用”。
