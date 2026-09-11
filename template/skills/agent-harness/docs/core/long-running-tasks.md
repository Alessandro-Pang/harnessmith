---
title: Long-running Task Protocol
type: harness-core
status: active
updated: 2026-09-04
owner: long-running-tasks
---

# Long-running Task Protocol

本文件是 Task/Handoff 状态机的唯一 Prompt owner。Task ledger 是任务验收状态与当前 `nextAction` 的唯一事实源，Handoff 只保存跨上下文恢复快照；二者都是非权威工作记忆，不能替代代码、测试、ADR 或正式计划。详细 task verification、replay 和 evidence 机械契约见 [reference](../references/task-and-replay-contracts.md)。

## 何时创建

- 创建：跨上下文、跨仓、多阶段、高风险、昂贵调查，或有多个必须逐项验证的验收条件。
- 不创建：简单问答、一次性小改动、无需交接且能从 Git/代码快速恢复的工作。
- 不确定时询问用户；不要因为工具存在就给每个任务增加状态文件。
- `task init` 至少要有一个可判定的 `--accept`；没有成功条件的任务不能进入账本。

## 最小生命周期

使用 Harness 的 `task init`、`checkpoint`、`status` 和 `close` 管理账本；`init` 必须有可判定的 acceptance，
检查点必须留下当前 next，关闭必须经过 acceptance gate。精确参数、evidence 类型和退出码只在
[Task/Handoff reference](../references/task-and-replay-contracts.md) 中加载。

## Checkpoint 与 Handoff

每个阶段完成、已验证且仍有具体后续时，更新已有 Task checkpoint；没有 ledger 时才创建可恢复 Handoff，不为它临时制造 Task。收到上下文压缩信号时，在该 signal turn 内执行并校验一次；同一 session 的第二个独立已验证任务使用 multi-task，并在 `reason` 标明 multi-task；优先级为 `compaction > multi-task > phase`，手动交接使用 manual。陈旧 backlog、相同快照和普通请求完成都不触发关闭。

同一 session/workstream 使用稳定 base；active/blocked generation 原位更新，旧 generation 已结束后才创建下一代。写前读取旧 Handoff 和 Task，保留未变化字段；`next` 必须点名当前仍有效的文件、命令或动作，不能写“处理下一请求”。精确字段、冻结路径和安全 payload 由 reference 独占。

Handoff 必须能让新上下文恢复目标、已完成证据和单一下一步；旧 open 全部解决时才清空，部分完成必须保留剩余项。缺少恢复信息时先加载 reference 修正 payload，不猜测或直接关闭。

## 关闭与验收

只有当前 user/host turn 明示整个 workstream `completed` 或 `cancelled`，并核对 Task、plan/backlog、Handoff 没有仍有效事项，才执行 `memory close-handoff`。阶段、单个请求、verifier 或普通 task 完成不等于 workstream 结束；存疑不关闭。

`passed` 只能来自当前 Task 的 acceptance gate；完成文字不能替代机械证据。高风险 predicate 由用户或 CI/Host-owned verifier 持有，外部观察不足时保持 `inconclusive`。精确新鲜度和 evidence 规则见 reference。

每次只推进一个边界清晰的增量，先读取状态和基线；失败时保留恢复路径，不用降低 verifier 门槛、删除失败测试或未经授权的 commit 制造恢复点。任务完成后再把稳定结论提升到正式事实源，不让 ledger 成为第二套项目事实。

## Host signal 与可见性

宿主没有 session-end/compaction hook 时，Prompt 只能提供显式 fallback，不能声称自动保证。纯 host-signal/replay turn 中，宿主允许空响应时不得发送 `agent_message`；宿主强制响应时只陈述上一用户任务的验证结果，不提 sidecar、checkpoint 或 replay 动作。自动 sidecar 的写入与维护遵循 [project Memory standard](../standards/project-agent-docs.md) 的静默规则；显式 Memory/Handoff 请求才返回可核验结果。

需要精确 payload、Replay、Task evidence、scope budget 或迁移规则时，先加载[机械契约参考](../references/task-and-replay-contracts.md)，再执行 CLI；参考文档不改变本文件的关闭和授权边界。
