---
title: Runtime Observability
type: harness-core
status: active
updated: 2026-08-28
---

# Runtime Observability

Harness 提供宿主中立的轻量审计接收、存储和汇总层，不接管模型循环或工具执行。Host、CI 或明确的
生命周期 hook 负责在动作结束后生成事件，并调用 `audit record --payload-file`；Harness 不声称能自动
观察未接入的 Host 行为。

## 事件契约

每个事件只保存运行元数据：`traceId`、UTC 时间、`operation`、`action`、policy decision/version、
耗时、结果、artifact SHA-256 digest，以及可选 token、成本和错误码。禁止提交原始 prompt、模型输出、
tool arguments、文件正文、环境变量、凭据或用户内容。payload 只接受已知字段，数值、标识符、枚举、
digest 数量与文件大小均有上限，并执行高置信 secret 检查。

`operation` 可表示 `model`、`tool`、`memory`、`task`、`policy`、`lifecycle` 或 `other`。这只是统一的
可观测事件类型，不意味着 Harness 已获得稳定的 session-end、compaction-before 或权限决策 hook。

```bash
node <harness-path>/bin/harness.mjs audit record --payload-file /absolute/event.json --json
node <harness-path>/bin/harness.mjs audit list --trace-id trace-123 --limit 100 --json
node <harness-path>/bin/harness.mjs audit summary --since 2026-08-01T00:00:00.000Z --json
```

成功写入后才可用 `--consume-payload-file` 删除输入。校验或写入失败时保留 payload 供诊断。

## 存储与健康

活动事件按 UTC 日期写入 `state/audit/YYYY-MM-DD.jsonl`，使用运行时锁、SafePath、regular-file 检查、
原子写，并在可表达 POSIX mode 的平台使用 `0600`；Windows 依赖 ACL 与宿主访问控制，不把无法
可靠保留的 POSIX permission bits 当作事务身份。单文件、总字节和总事件数均有限制；读取遇到损坏、symlink 或超预算时
fail closed。`health` 中缺少审计目录表示尚未配置，不是故障；存在但不可验证的审计状态是 failed。

## 保留策略

`audit maintain --max-age-days 30 --json` 只读报告陈旧文件和预算状态，发现候选时返回非零。
`audit archive --before YYYY-MM-DD --json` 默认只给 proposal；显式 `--apply` 才把匹配的完整日文件移动到
`state/audit/archive/`。归档不删除数据，也不进入活动查询与汇总。归档区的长期保留、加密、外部传输和
最终删除由用户或 Host 的数据治理策略负责。

审计记录是诊断和统计证据，不是项目事实源、权限强制器、签名证明或可信远程 attestation。需要证明
某个 Host 确实产生事件时，必须由 Host/CI 提供独立信任边界。
