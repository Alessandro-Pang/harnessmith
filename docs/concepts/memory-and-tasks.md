---
title: Memory 与 Task
description: 非权威记忆、长任务状态和验收门禁
owner: maintainers
---

# Memory 与 Task

Harnesssmith 的内嵌 Runtime 为跨会话工作提供两类互补状态：Memory 帮助重新发现有价值的历史线索，Task
保存一个明确目标的进度与验收证据。两者都不能替代项目事实源。

## 分层 Memory

- canonical 用户画像位于共享个人目录，由用户控制；项目不能修改它。
- 项目 Memory 位于 `.agent-docs/`，保存与项目相关、可追溯但仍需核对的经验。
- 自动 sidecar 只做有界提取和索引，不应污染正常对话或把推断提升为事实。

需要得出当前结论时，先用索引定位最小相关内容，再回到代码、配置、测试、schema 或正式文档验证。Memory
中的时间敏感状态应标明可能过期。

## 长任务 Ledger

Task 记录目标、状态、检查点、预算和 acceptance。并发写入必须持有任务锁；达到 `complete` 前，acceptance gate
必须核对声明的证据。旧 schema 的宽松通过状态在迁移后会降为 `inconclusive`，需要重新验证。

## 隐私与审计

审计记录只接受限界的结构化字段，例如 trace、操作、策略决定、耗时、结果与 artifact digest。schema 明确拒绝
原始 prompt、模型输出、tool arguments 和未知字段。它提供本地可检查性，不提供远程签名证明。

## 深入实现

命令、schema 和状态机的权威实现位于分发模板中：

- [Harness CLI architecture](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/harness-cli-architecture.md)
- [Memory architecture](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/memory-architecture.md)
- [Task lifecycle](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/topics/task-lifecycle.md)

链接内容随发布版本演进；安装到本机后的模板文档与对应 npm 版本才是该版本的契约。
