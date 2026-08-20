---
title: Project Agent Memory
description: 项目本地 Agent 记忆协议与渐进读取入口。
type: agent-memory-index
memory-kind: index
status: active
owners:
  - |-
    {{HARNESS_OWNER}}
created: "{{DATE}}"
updated: "{{DATE}}"
project: |-
  {{PROJECT_KEY}}
tags: ["agent-memory"]
scope: [".agent-docs"]
source-refs: []
source-of-truth: false
schema-version: 1
---

# Project Agent Memory

本目录是项目本地、非权威的 Agent 记忆系统，默认被 `.gitignore` 和 `.ignore` 忽略。

- 正式事实与决策：写入 `docs/`、ADR、代码、测试或 schema。
- 用户原始输入：`inputs/`。
- 会话经历与交接：`sessions/`。
- 临时计划、调研、评审和状态：`working/`。
- 经多次任务验证的昂贵发现：`distilled/`，但必须指向来源。
- 脱敏原始证据：`evidence/`。
- 被替代或低热度记忆：`_archive/`。

先读取 `core.md` 和记忆名称/元信息，再按 `` `memory:<relative-name>` `` 引用加载正文。禁止默认
读取整棵目录。显式检索使用：

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory search . "<query>"
```
