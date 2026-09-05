---
title: Change and Implementation Playbook
type: harness-playbook
status: active
updated: 2026-09-04
owner: change
---

# 修改与实现

触发：实现功能、修改配置、重构、搭建模块、补测试或更新文档。

## 执行状态

`frame → inspect → implement → verify → deliver`。每个阶段只推进一个可观察增量；阶段产物不完整时停在当前阶段，不把计划写成已完成。

1. `frame`：找到用户可观察结果、验收条件、非目标、授权范围和影响边界。
2. `inspect`：搜索现有相似实现、公共边界、生成流程和测试模式；先确认 owner，再新增文件。
3. 明确输入、输出、失败、权限、幂等、数据迁移和兼容性中哪些适用，并记录仍未知的条件。
4. `implement`：选择最小完整方案。不要用占位实现、假成功 mock、硬编码演示值或无期限 TODO 交付生产功能。
5. 修改与行为变化直接相关的测试和正式文档；用户新增验收、scope/constraints 或不可廉价恢复 source
   且会影响后续决策时，必须先按 Memory 标准判定 purpose/lifecycle，去重后交给对应 typed writer；文件
   payload 的安全边界和重试方式按 [CLI reference](../references/cli-contracts.md) 执行。一次性动作授权与阶段推进不写 Important Input。
   交接达到可观察边界时使用 typed Memory Autopilot；超出边界只提交 proposal。
6. `verify`：先跑定向验证，再根据跨模块程度扩大；验证失败时保留原输出，分类根因，修复后重新运行同一个 verifier，不降低门槛。
7. `deliver`：检查 diff 是否混入用户改动、生成噪声、秘密、无关格式化或跨仓遗漏，并报告 claim、证据、未验证范围和风险。

最小交付记录：`scope`、`changed`、`verifier`、`result`、`limitations`。需要跨阶段恢复时才创建 Task/Handoff。

跨仓变更额外确认：契约 owner、发布顺序、兼容窗口、消费者验证和回滚路径；先按需读取
`../projects/repository-map.md`。
