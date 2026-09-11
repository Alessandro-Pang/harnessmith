---
title: Review Playbook
type: harness-playbook
status: active
updated: 2026-09-04
owner: review
---

# 评审

触发：code review、PR/diff 审查、架构/安全/性能/文档评审。

## 执行状态

`scope → inspect → challenge → findings → deliver`。评审只产生证据和问题清单，不因发现问题自动进入修改。

## 顺序

1. 确认基线、范围和需求；优先看 diff，再按调用关系读取上下文。
2. 检查正确性、数据与权限、安全、并发、兼容、失败处理、测试和运维影响。
3. 对高损失路径做一次反向审查：假设变更已失败，寻找边界输入、权限变化、并发、重试、旧数据和回滚路径上的反例。
4. 只报告可操作且由当前变更引入或暴露的问题；区分事实、推断和需要真实 Host 证据的风险。
5. 每条问题给出位置、触发条件、影响、证据和最小修复方向，按严重度排序。
6. 没有发现问题时明确已检查的风险面和测试缺口，不制造凑数建议。

评审默认不修改文件。用户要求“review and fix”时，先完成问题清单，再按 `change.md` 实施。
风格偏好只有违反现有规范或影响维护性时才作为 finding。

最小交付记录：`scope`、`checked-risk-surfaces`、`findings`、`evidence-gaps`、`residual-risk`。
