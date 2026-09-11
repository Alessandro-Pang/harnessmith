---
title: Agent Execution Loop
type: harness-core
status: active
updated: 2026-09-05
owner: operating-model
---

# Agent Execution Loop

这是所有非 trivial 任务共用的执行控制器。它约束任务如何推进，不要求 Agent 暴露完整思维链；只保留能影响下一步行动和验收的中间产物。

## 状态

```text
frame → observe → decide → act → verify → deliver
                         ↘ recover ↗
```

- `frame`：确认目标、scope、非目标、授权和 acceptance；缺少高损失信息时停止猜测。
- `observe`：读取当前状态和一手证据，区分 `fact`、`inference`、`hypothesis`、`unknown`。
- `decide`：只选择一个最小、可停止、可验证的下一步，并写明预期观察结果。
- `act`：执行已授权动作；工具调用前后重新读取会变化的外部状态。
- `verify`：用最直接的测试、schema、CLI、日志、契约或 Host verifier 检查 claim。
- `deliver`：只交付已有证据支持的结果，分别列出未验证范围、风险和下一步。

## 交付前沉淀检查

每个用户回合在 `deliver` 前执行一次有界的 Memory 判定，不等待用户再次提醒：

1. 检查本回合是否产生跨回合仍有价值的约束、昂贵结论、失败经验、未完成状态或恢复信息。
2. 先将回合事实结构化（可用 `memory discover-candidates` 生成候选），再补齐候选的来源、价值、授权和 root 状态并运行
   `memory evaluate-capture`；通过后只使用对应 typed writer：用户约束用 `capture-input`，高价值分析用 `capture-finding`，可复用经验或失败经验用 `capture-experience`，未完成工作用 `handoff`。
3. 用户明确表达跨任务默认或纠正时，按 `user-profile-memory` owner 调用 `reconcile-profile`；单次行为只能保留为候选或
   `proposed`，不得升级为画像事实。
4. 写入后立即运行最小 `memory check` 或对应 verifier；失败保留 `blocked`/`proposed` 和恢复路径，不能把发现候选当成已沉淀。

该检查保持后台静默，不在普通回复中披露路径或写入动作。宿主没有 turn-end/session-end hook 时，Agent 必须在最终回复前自行调用
Harness CLI；这仍是 Agent-guided 行为，不能冒充 Host 级自动保证。被中断、超时或没有安全 writer 时，保留未消费 payload 或
`inconclusive` 证据供下一回合恢复。

## 每一步的最小记录

```text
claim: 当前要判断或改变的对象
evidence: 已核对的事实和来源
unknowns: 会改变决策的未知
nextAction: 下一步动作
expectedEvidence: 动作完成后应看到什么
stopCondition: 何时停止、阻塞或请求授权
```

复杂任务可以把这些字段放入 Task/Handoff；简单任务只需在工作过程中保持同样的判断，不创建额外状态文件。

## 验证失败与恢复

1. 先保留失败输出、退出码、范围和环境，不把失败改写成未执行。
2. 将失败归类为实现缺陷、范围错误、证据不足、环境阻塞、verifier 缺陷或授权阻塞。
3. 只有根因和最小修复已明确时才重试；重试必须重新执行原 verifier。
4. 连续失败、证据互相冲突或需要扩大权限时进入 `blocked` 或 `inconclusive`，不要无限循环。

## 组合边界

- reasoning mode 决定如何分析，不改变授权、事实源和完成条件。
- Playbook 决定当前任务动作，不替代 verifier。
- verifier 决定 claim 是否被证据支持，不由总结文字代替。
- 外部状态变化、长任务和失败恢复必须回到 `observe`，不能沿着旧计划盲目继续。
