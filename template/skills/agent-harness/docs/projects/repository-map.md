---
title: Repository Map Lifecycle
type: harness-project-map
status: active
updated: 2026-09-04
owner: repository-map
scope: |-
  {{HARNESS_REPOSITORY_ROOT}}
---

# Repository Map Lifecycle

Repository Map 是跨仓决策索引：帮助定位仓库职责、契约 owner、直接消费者、影响范围、发布顺序和回滚边界。
它不是架构文档、CMDB、实时拓扑、lockfile 或调查报告；代码、manifest、schema、ADR、部署配置和测试仍是
当前事实源。

## 语义边界

只收录稳定、已验证、直接且可复用的关系。方向固定为：

```text
provider -> contract -> consumer
```

关系必须能回到两侧权威 source；不存当前 ref/HEAD/dirty、部署实例、健康状态、用户输入、推断、传递闭包或
接口/函数/字段的全量清单。一次性线上现象和仍需证据审阅的观察留在 proposal 或项目 Memory，不进入 canonical map。

## 三层存储

语义 YAML、生成视图和宿主验证状态分离：`repository-map.yaml` 是 canonical map，`repository-map.md` 是
生成视图，运行时 verification state 只是可重建的 freshness/fingerprint。个人 overlay 位于受管理安装目录之外；
任何一层都不是项目正式事实或权限来源。

## 自动发现、校验与维护

闭环固定为：`inventory → discover observations → normalize → validate → reconcile → verify → render`。
内置确定性 extractor 只提供候选；外部 Agent、搜索、网页、日志和启发式结果一律按不可信 observation 处理。
`check`、`maintain` 和默认 `reconcile` 是只读；只有通过 owner、证据、路径、锁和结果校验的 typed 写入口才可
更新 personal map。缺失、漂移或受限扫描不能解释为不存在，不能因一次扫描未命中自动删除关系。

跨仓分析本身授权更新 personal `repository-map.md` 对应的 canonical `repository-map.yaml`，不需要用户二次确认；
该授权不扩大到源码、项目 `.agent-docs/`、其他 personal 文件或远端写入。用户明确禁止写入时不得写入，只报告 `proposed`。

## 交付边界

跨仓任务先确认契约 owner、直接消费者、发布顺序、兼容窗口、验证方式和回滚路径。输出只区分：

- `proposed`：观察等待证据审阅，或用户禁止写入；
- `updated`：canonical map 已更新并完成对应视图/状态同步；
- `unchanged`：没有达到门槛的新关系，或稳定 key 已覆盖；
- `blocked`：路径、legacy view、证据或校验失败，并说明恢复条件。

需要 schema、relation key、精确命令、预算、legacy migration、结果字段或 verifier 时，按需加载
[Repository Map Contracts](../references/repository-map-contracts.md)。本文件只保留跨仓任务每次都要判断的语义和授权。
