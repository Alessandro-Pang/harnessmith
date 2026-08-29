---
title: 设计原则
description: Harnessmith 在分发、上下文、状态与验证上的取舍
owner: maintainers
---

# 设计原则

## 本地优先，宿主中立

Harnessmith 分发同一套个人规则和 Runtime，但不实现通用 Agent Runtime。宿主身份、路径和环境变量只存在于
外层 Adapter；内嵌模板不依赖某个宿主。

## 渐进披露

常驻入口只保留高损失边界和路由规则。具体流程、工具与专题按任务加载，避免把完整知识库塞进每次上下文。

## 安全失败

无法证明目标仍可安全接管时拒绝写入。安装、restore 和 uninstall 共享路径 containment、symlink 检查、锁、
完整预检、备份与精确回滚，而不是通过覆盖异常继续运行。

## 状态不是事实源

Memory 保存待核对的经验与线索；Task 保存工作进度与验收证据。代码、测试、schema、配置和正式文档仍是事实源。
状态中的 `complete` 必须经过 acceptance gate，而不是由自然语言声称完成。

## 声明必须有证据

项目把能力分为已实现、由宿主负责和不支持。每项公开声明应能回到代码、测试、schema 或 CI；无法在当前环境验证的
阴性结果写成 `inconclusive`。

## 最小权限与可恢复变更

Harnessmith 只操作用户明确选择的宿主和项目根。它不扩大宿主权限、不自动批准工具调用、不把 advisory Markdown
描述成强制策略。需要覆盖已有文件时必须显式选择，并先保留恢复路径。
