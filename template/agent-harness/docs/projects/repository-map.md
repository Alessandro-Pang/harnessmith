---
title: Repository Relationship Map
type: harness-project-map
status: template
updated: 2026-08-24
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

用户实际维护的关系入口是 personal `repository-map.md`。仅在一条关系同时满足以下条件时写入：

- 稳定：不是当前分支、HEAD、dirty 状态、临时迁移阶段等动态状态或一次性排查结果；
- 已验证：能指向项目正式文档、代码、manifest、schema、部署配置或可重复的验证命令；
- 可复用：后续跨仓任务会用于判断 owner、契约、消费者、发布顺序或回滚边界；
- 高成本：如果不保留入口，重新发现需要跨仓追踪或较高调查成本。

只保存名称级关系和正式来源，不复制报告正文、逐文件摘要、用户输入、推断或未经核验的线上状态：

```text
<producer repository>
  -> <contract or artifact>
  -> <consumer repository>
  source: <authoritative path or repeatable verification command>
```

临时调查、用户输入和交接状态放项目 `.agent-docs/`，不要写入关系图。

## 维护与写回闭环

跨仓分析、评审、设计或修改任务在交付前必须完成以下步骤：

1. 读取 personal `repository-map.md`，保留用户内容，并按 producer、contract、consumer 和 source 去重。
2. 从本次发现中筛选满足全部门槛的关系；多个消费者可拆成多条边，共享同一正式来源。
3. 跨仓分析本身授权更新 personal `repository-map.md`：对满足门槛的关系执行最小写回，不需要用户
   二次确认。此授权仅覆盖关系图，不覆盖仓库源码、项目 `.agent-docs/`、其他 personal 文件或远端。
4. 用户明确禁止修改关系图时不得写入，只报告 `proposed`；这表示服从明确边界，不表示等待用户再次
   确认。目标路径不可写、写入或校验失败、来源仍需确认时不猜测，结果记为 `blocked`。
5. 交付中必须报告且只选一个结果：
   - `proposed`：仅在用户明确禁止写入时，列出达到门槛但按其边界未落盘的候选关系；
   - `updated`：列出已新增或修正的名称级关系；
   - `unchanged`：说明本次没有达到写入门槛的新关系，或已有映射已覆盖；
   - `blocked`：说明技术或证据阻塞、未写入的候选关系和恢复条件；不得把“任务只要求分析”当作阻塞。
