---
title: 临时资源生命周期
description: 临时目录、payload、锁与诊断残留的所有权和清理边界
owner: maintainers
---

# 临时资源生命周期

Harnessmith 只会清理能够验证 owner、用途和精确身份的临时资源，或属于明确用户数据协调命名空间的资源。目录名带有
`harnessmith-*` 前缀、看起来较旧或位于系统临时目录，都不能单独构成删除依据。

## 四种生命周期

每个受管临时 workspace 都包含私有的 `.harnessmith-temp-resource.json` 标记，记录 owner、purpose、创建时间、创建进程、
唯一资源身份和生命周期：

| 生命周期 | 所有权与清理方式 |
| --- | --- |
| `process` | 只在单个进程存活期间存在，进程结束前清理 |
| `operation` | 操作成功或普通失败时由 disposer 清理 |
| `workstream` | 跨多个相关操作保留，直到该工作流明确结束 |
| `retained-for-recovery` | 仅在已诊断失败需要保留精确恢复证据时继续存在 |

`withTemporaryWorkspace` 是 `process` 和 `operation` workspace 的默认入口。清理前会重新核对目录身份和未变化的 marker，
只删除创建时记录的精确路径。业务错误仍是主错误；如果清理不完整，结果会附带保留路径。任何失败保留都必须说明原因和
精确位置。

## 不同资源放在哪里

- Memory、profile、handoff、experience 和 audit JSON payload 属于 `operation`。调用方传入 `--consume-payload-file` 后，
  只有 schema、目标身份、领域写入和结果校验全部成功，Harness 才会删除内容未变化的文件；此前任何失败都会保留原文件
  用于诊断。
- 安装器 snapshot 和 preflight clean room 使用共享临时 workspace。成功和普通失败都会释放；只有 rollback 失败才保留
  精确恢复路径。
- `.release/` 下准备好的 npm tarball 与发布状态属于 `workstream`，不是匿名系统临时文件。Host Eval 证据位于
  `.agent-docs/host-evals/`，属于需要保留的证据。
- 临时 registry、npm cache、coverage、Host Eval 和 clean-room 目录应通过共享 workspace helper 创建。需要长期保存的
  证据应移动到受管 release/evidence 目录。
- 用户数据锁命名空间是稳定目录。每个根对应的 `.lock` 目录和同级 handoff proof 属于 `process`；旧的空 digest 目录只能
  被报告为维护候选，不能通过通配符批量删除。

## 检查历史残留

```bash
pnpm run temp:scan
```

该命令执行有界、只读的 JSON 扫描，只报告两类可识别对象：带有效 marker 的受管 workspace，以及用户数据锁命名空间中
精确匹配 64 位十六进制 digest 的目录。结果包含 owner、lifecycle、年龄、大小和活动状态，但不会删除任何内容。

未知目录、活跃锁或 proof，以及为了恢复而保留的路径，都不能根据名称或年龄推断为安全。当前只提供扫描，不提供 apply
模式；历史清理必须由独立、明确授权的流程逐项重新验证 owner marker、精确路径、活动状态和 SafePath 边界。
