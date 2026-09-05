---
title: 临时资源生命周期
description: 临时目录、payload、锁和诊断残留的所有权与安全清理边界
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
---

# 临时资源生命周期

临时目录、payload、锁和失败现场可能包含恢复所需的证据。Harnessmith 不按名称、年龄或所在目录批量删除资源；只有 owner、用途、精确身份和生命周期都能核对时，才允许清理。

## 生命周期与责任

| 生命周期 | 清理时机 | 例子 |
| --- | --- | --- |
| `process` | 当前进程结束时 | 安装事务的 staging 目录、语法检查文件 |
| `operation` | 当前操作成功或普通失败后 | export、diagnostics 的临时数据 |
| `workstream` | 工作流明确结束后 | release workspace、Host Eval workspace |
| `retained-for-recovery` | 恢复证据核对完成后 | rollback 失败现场快照 |

受管 workspace 包含 `.harnessmith-temp-resource.json` marker。清理前必须重新读取 marker，核对 owner、purpose、resource identity、活动状态和未变化的路径。只删除 marker 指向的精确资源，不删除同目录下的其他文件。

## 常见资源的处理方式

- `--consume-payload-file` 只有在 schema、目标身份、领域写入和结果校验全部成功后，才会删除内容未变化的 payload；任何失败都保留原文件。
- 安装器 snapshot、preflight clean room 和普通 operation workspace 成功或普通失败后释放；rollback 失败则保留精确路径。
- `.release/`、Host Eval 证据和 recovery snapshot 是受管工作流数据，不能按系统临时文件处理。
- 用户数据锁目录和 handoff proof 属于稳定命名空间；活跃锁、proof 或未知 digest 目录只能报告，不能用通配符删除。

## 扫描残留

```bash
pnpm run temp:scan
```

扫描是只读 JSON 报告，主要字段包括。扫描结果只能提供清理线索，不能单独构成删除依据：

```json
{
  "owner": "harnessmith",
  "lifecycle": "retained-for-recovery",
  "path": "/private/tmp/example",
  "ageSeconds": 3600,
  "active": false,
  "reason": "rollback-failed"
}
```

实际字段以当前 CLI 输出为准；示例只帮助理解结构，不是可复制的删除清单。未知目录、活动锁、恢复保留路径和 marker 缺失资源应保留并记录为 `inconclusive`。

当前没有通用 `temp:scan --apply` 或 `rm -rf /tmp/harnessmith-*` 安全路径。需要清理时，逐项核对 owner marker、精确路径、活动状态和 SafePath 边界，再由有权限的生命周期流程执行。删除前先保存日志、digest 和 recovery path。
