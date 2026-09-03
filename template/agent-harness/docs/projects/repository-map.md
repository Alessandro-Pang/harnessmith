---
title: Repository Map Lifecycle
type: harness-project-map
status: active
updated: 2026-08-24
scope: |-
  {{HARNESS_REPOSITORY_ROOT}}
---

# Repository Map Lifecycle

Repository map 是跨仓决策索引：在不了解整套代码的情况下，快速定位仓库职责、契约 owner、直接
消费者、影响范围、发布顺序与回滚边界。它不是架构文档、CMDB、实时拓扑、依赖 lockfile，也不是
一次调查报告；项目代码、manifest、schema、ADR、部署配置和测试仍是权威事实源。

## 三层存储

```text
{{HARNESS_PERSONAL_HOME}}/projects/
├── repository-map.yaml     # canonical semantic data; user-owned
└── repository-map.md       # deterministic generated view

{{HARNESS_HOME}}/agent-harness/state/repository-map/
└── verification.json      # host-local fingerprints and freshness; mutable
```

`repository-map.yaml` 使用 `schemas/repository-map.schema.json` 的 schema version 1。Markdown 只由
`harness repository-map render --write` 生成；CLI 拒绝覆盖没有 generated marker 的旧版或用户维护
Markdown。`verification.json` 可在不同 checkout 和宿主上重建，不得提升为语义事实，也不参与受管理
runtime checksum。

## 应该存什么

### Repository catalog

每个仓库必须有稳定 `id`、相对 `{{HARNESS_REPOSITORY_ROOT}}` 的 `checkout`、一句话职责描述、有限的
`owns`、aliases、remotes，以及 1–6 个正式来源。描述回答“该仓库为什么存在、主要拥有哪个边界”，
不能只是重复仓库名。

### Typed direct relation graph

关系方向始终为：

```text
provider -> contract -> consumer
```

类型限定为 `package`、`http-api`、`rpc`、`event`、`artifact`、`proxy`、`migration` 和
`extension`。稳定唯一键由 `type + provider + contract + consumer` 计算，不手工维护随机 id。每条边
必须同时有 provider 与 consumer 两侧的仓库相对 evidence path；多消费者拆为多条边。

只有同时满足以下门槛才进入 canonical map：

- 稳定：不是当前分支、HEAD、dirty 状态、临时迁移阶段或一次性线上现象；
- 已验证：能指向项目正式文档、代码、manifest、schema、测试或部署配置；
- 直接：只存一跳关系，不物化可推导的传递闭包；
- 可复用且高成本：后续确实用于 owner、影响面、发布或回滚判断，重新发现需要跨仓追踪。

## 不应该存什么

- 当前 ref、HEAD、dirty、部署版本、实例地址、健康状态和检查时间；
- 文件摘要、source fingerprint、extractor 版本和 miss，它们属于 verification state；
- 接口的每个 endpoint、函数调用、数据库表字段或 lockfile 全量内容；
- 用户输入、会议记录、推断、待办、排障过程、报告正文和未经核验的线上拓扑；
- 传递边、重复别名边、按团队或产品聚合的虚拟仓库节点。

临时材料放项目 `.agent-docs/`；正式架构说明放对应仓库的 apps/docs/site/ADR。只有需要独立变更、兼容和发布的
契约边界才值得把 endpoint 级细节拆成单独关系。

## 自动发现、校验与维护

标准闭环为：inventory → discover observations → normalize → validate → reconcile → verify → render。

```bash
harness init personal
harness repository-map check --json
harness repository-map discover packages --apply --json
harness repository-map verify --record --json
harness repository-map maintain --json
harness repository-map render --write
```

- `check` 校验 schema、引用、双侧 evidence、稳定键、未知字段与容量预算，不读写状态；
- `discover packages` 是内置确定性 extractor，只从 catalog 中仓库的 `package.json` 名称与直接依赖
  生成 `package` 边；`--apply` 在 personal lock 下幂等写回 YAML 与 Markdown；
- `reconcile <observations.json>` 把外部 Agent、搜索或启发式结果一律视为不可信 proposal，即使数据
  自称 deterministic 也不会自动提升；
- `verify --record` 检查所有来源是 checkout 内的普通文件，记录 SHA-256、缺失项、map fingerprint、
  extractor version 和 `checkedAt`；
- `maintain` 默认以 30 天为新鲜度窗口，报告 source 漂移、缺失、map 变化和预算问题，不静默删除；
- `render --write` 确定性生成视图，相同 YAML 必须得到相同 Markdown。

内置 extractor 的代码和测试是确定性信任边界；仓库内容、外部 observation、网页、日志和模型判断
只是数据。HTTP、RPC、event、proxy、migration 等难以机械证明的关系必须先形成 proposal，再由 Agent
读取双侧权威来源后写入 canonical map。

## 防膨胀与时效策略

- 全图预算为 200 个仓库、1000 条直接边；每仓 `owns` 不超过 12 项，每边 evidence 为 2–6 项；
- canonical 序列化按 repository id 和稳定 relation key 排序，重复执行不产生顺序漂移；
- 关系按稳定键 upsert，不追加时间线；验证历史不进入 semantic map；
- source 缺失或 fingerprint 改变时标为 stale，先重新验证或修正，不把旧事实继续当作 current；
- 删除、归档或语义方向修正需要证据审阅，不因一次扫描没发现就自动删除；
- 定期任务只需执行 `discover packages --apply`、`verify --record`、`maintain`，无需重新扫描全部源码。

## 旧版 Markdown 兼容

初始化与升级只创建缺失文件，不覆盖既有 `repository-map.md`。旧版自由文本常混用 caller→callee 与
provider→consumer 方向，也可能把多个仓库合并在一条边中，因此不得无损自动迁移。迁移时先建立带
描述的 catalog，再把聚合边拆开、核对双侧 evidence 并统一方向；在 YAML 验证通过前保留旧文件。
使用 `harness repository-map migrate <candidate.yaml> --json` 先检查 proposal；显式 `--apply` 仅接受
全部 source 验证通过的 candidate，并把旧视图保留为 `repository-map.legacy.md` 后再安装 canonical
YAML 与 generated view。

## 跨仓任务写回

跨仓分析本身授权更新 personal `repository-map.md` 对应的 canonical `repository-map.yaml`，不需要用户
二次确认；但必须先通过上述维护门槛和权限边界。若旧版 Markdown 尚未迁移，不得为了自动写回
而覆盖它，应报告迁移阻塞与候选关系。

用户明确禁止写入时不得写入，只报告 `proposed`。

交付时只报告一个结果：

- `proposed`：用户明确禁止写入，或外部/启发式观察等待证据审阅；
- `updated`：canonical map 已新增或修正，生成视图与验证状态已同步；
- `unchanged`：没有达到门槛的新关系，或稳定键已经覆盖；
- `blocked`：路径不可写、legacy view 未迁移、证据缺失或验证失败，并说明恢复条件。

不得把“请求只要求分析”本身当作 `blocked`；但关系图写回授权不扩大到仓库源码、项目
`.agent-docs/`、其他 personal 文件或任何远端写入。
