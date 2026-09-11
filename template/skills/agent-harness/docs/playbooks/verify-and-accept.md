---
title: Verify and Accept Playbook
type: harness-playbook
status: active
updated: 2026-09-05
owner: verify-and-accept
---

# 验证与验收

触发：验证修复、执行回归、检查质量门禁、验收交付、证明某个技术结论或比较候选结果。

## 执行状态

`claim → criterion → verifier → run → classify → accept`。每个 claim 都必须能指向一个直接 verifier；没有 verifier 时不能写成 passed。

1. `claim`：把要证明的内容改写成可判定的 criterion，并明确版本、HEAD、workspace、scope 和环境边界。
2. `verifier`：为每个 criterion 选择最小且直接的 verifier；优先使用现有测试、schema、CLI、hook 或 CI。
3. `run`：运行验证并保留命令、退出码、时间、输入范围和关键输出；不要用相邻检查代替目标 verifier。
4. `classify`：分别报告 `passed`、`failed`、`blocked` 和 `inconclusive`；截断、权限不足或 Host 证据缺失不能算通过。
5. `accept`：检查验证是否覆盖真实风险；测试通过只证明测试覆盖的行为，不自动证明语义目标、生产状态或真实 Host 行为。

验证失败时分类为实现缺陷、范围错误、证据不足、环境阻塞或 verifier 缺陷；只有修复原因后才重跑原 verifier。

最小交付记录：`claim`、`criterion`、`verifier`、`scope`、`status`、`evidence`、`limitations`。

验收失败时修复根因或明确下一步，不降低 verifier 门槛、不删除失败测试、不把报告文字写成通过证据。需要修改时转入 `change`，需要查找根因时转入 `diagnose`。
