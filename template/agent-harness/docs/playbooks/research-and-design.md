---
title: Research, Planning, and Design Playbook
type: harness-playbook
status: active
updated: 2026-09-04
owner: research-and-design
---

# 调研、计划与设计

触发：技术选型、方案设计、架构分析、路线图、实施计划、外部调研。

## 执行状态

`frame → evidence → candidates → prune → recommend`。先固定决策问题和硬门槛，再生成少量真实候选；不要把资料罗列误当成方案。

1. 明确决策问题、用户、成功指标、硬约束、非目标和截止条件。
2. 先调查当前系统与已有决策，再查版本匹配的官方资料；不要用新方案覆盖未知现状。
3. 将事实、假设、推断和建议分开，记录来源日期与适用版本。
4. 至少比较：保持现状、最小增量方案、结构性方案；只保留真实候选，并用硬约束先剪枝。
5. 评价成本、风险、可逆性、迁移、运维、测试、跨仓消费者和退出策略；关键未知可能改变结论时先调查。
6. 输出推荐、理由、被否决方案、阶段、验收、未决问题和决策 owner，并明确推荐的适用条件。

最小交付记录：`decision-question`、`facts`、`assumptions`、`candidates`、`trade-offs`、`recommendation`、`open-questions`。

只有用户授权项目写入且结论已被采纳，才写正式 ADR 或项目 `docs/`，并把已有记忆更新为指向正式
文档的来源索引；否则只提交 proposal。探索材料达到记忆阈值且获写入授权后，才放入
`.agent-docs/working/`。计划不得把目标架构描述为当前已实现。
