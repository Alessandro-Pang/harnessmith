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
profile-autopilot: enabled
---

# Current Profile

这里只记录用户本身的当前画像，不记录项目事实、任务状态、代码结论或会话流水。信息不足时保持空白，
不得为了填满画像而猜测。

`profile-autopilot: paused` 时不得自动新增或更新条目，直到用户明确恢复；精确遗忘仍可执行。

每个新宿主 task/thread 首次工作前有界读取本文件一次；读取本身不授权写入，也不递归加载其他全局 Memory。

全局目录和受管入口默认只允许当前用户访问（目录 `0700`、文件 `0600`）；这不替代磁盘加密、
备份治理或宿主访问控制。

每条使用稳定维度 key，并保持为单行：
`- <dimension.key> | <不超过 200 字符的当前结论> | <explicit|observed|inferred> | <high|medium|low> | <YYYY-MM-DD>`

维度按实际证据选择，例如 `identity.current-role`、`engineering.coding-style`、
`communication.explanation`、`interests.current-research`、`personal.current-constraint`。最多保留 32 条
高价值当前结论；同一 key 只能出现一次。
