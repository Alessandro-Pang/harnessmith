---
title: Release, Migration, and External Action Playbook
type: harness-playbook
status: active
updated: 2026-09-04
owner: release-and-external
---

# 发布、迁移与外部动作

触发：发布、Tag、数据库/数据迁移、共享环境变更、远端写入、消息或审批。

这些动作需要比代码编辑更明确的授权和证据。

## 执行状态

`authorize → preflight → plan → execute → verify → recover`。任何授权、目标、环境或 verifier 不明确时停在 preflight。

1. `authorize`：确认精确目标、环境、版本/commit、owner、维护窗口和授权范围。
2. `preflight`：做只读检查：工作树、CI、依赖、凭据存在性、容量、兼容性、备份与当前状态。
3. `plan`：写执行顺序、成功指标、停止条件、回滚/前滚方案和观察窗口。
4. 数据迁移使用 expand → migrate/backfill → verify → contract；脚本必须幂等、分批、可恢复。
5. `execute`：每个远端写步骤前核对对象身份和环境；不能用相似名称、默认 target 或旧会话上下文猜测。
6. `verify`：保存脱敏证据和结果；失败时停止扩大影响，按既定恢复路径处理，不用总结文字代替 verifier。

用户只要求准备方案、脚本或检查时，不执行真实发布、迁移或远端写入。

最小交付记录：`authorization`、`target`、`preflight`、`plan`、`verifier`、`rollback`、`observation-window`。
