---
title: Repository Relationship Map
type: harness-project-map
status: template
updated: 2026-08-18
scope: |-
  {{HARNESS_REPOSITORY_ROOT}}
---

# Repository Relationship Map

这是跨仓任务的维护规范，不预置任何组织、产品或仓库名称。用户实际维护的关系入口位于
`{{HARNESS_PERSONAL_HOME}}/projects/repository-map.md`；不要直接修改本受管理文档，否则升级会将其
恢复为分发版本。

## 读取顺序

1. 确认每个目标的真实 Git 根、当前 ref 和工作树状态。
2. 读取各仓库自身的 instruction file、README、manifest、lockfile 和相关正式文档。
3. 沿实际 API、RPC、事件、包依赖、构建产物或部署配置确认关系，不按目录名猜测。
4. 明确契约 owner、生产者、消费者、兼容窗口、发布顺序、验证入口和回滚边界。

## 可维护映射

仅在关系稳定、跨任务重复使用且重新发现成本较高时补充：

```text
<producer repository>
  -> <contract or artifact>
  -> <consumer repository>
```

每条映射应附正式来源路径或可验证命令。临时调查、用户输入和交接状态放项目 `.agent-docs/`，
不要写入本文件。
