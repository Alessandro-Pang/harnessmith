---
title: Compact User Profile
description: 当前用户身份、工作方式、技术背景、偏好与兴趣的紧凑画像。
type: user-profile
memory-kind: distilled
status: active
owners:
  - |-
    {{HARNESS_OWNER}}
created: "{{DATE}}"
updated: "{{DATE}}"
project: global
tags: ["user-profile", "cross-project"]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
confidence: medium
---

# Current Profile

这里只记录用户本身的当前画像，不记录项目事实、任务状态、代码结论或会话流水。信息不足时保持空白，
不得为了填满画像而猜测。

每条使用稳定维度 key，并保持为单行：
`- <dimension.key> | <不超过 200 字符的当前结论> | <explicit|observed|inferred> | <high|medium|low> | <YYYY-MM-DD>`

维度按实际证据选择，例如 `identity.current-role`、`engineering.coding-style`、
`communication.explanation`、`interests.current-research`、`personal.current-constraint`。最多保留 32 条
高价值当前结论；同一 key 只能出现一次。
