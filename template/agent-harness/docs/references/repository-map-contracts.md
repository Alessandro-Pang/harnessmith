---
title: Repository Map Contracts
type: harness-reference
status: active
updated: 2026-09-04
owner: repository-map
---

# Repository Map Contracts

这是 `repository-map` 的低频机械参考。只有实现、迁移、诊断或需要精确预算/命令时才加载；跨仓任务先遵循
[Repository Map Lifecycle](../projects/repository-map.md) 的语义门槛、证据边界和写回授权。代码、schema、测试和
当前 CLI 参数优先于本文示例。

## 存储与数据模型

个人语义层、生成视图和宿主状态必须分离：

```text
{{HARNESS_PERSONAL_HOME}}/projects/
├── repository-map.yaml     # canonical semantic map; user-owned
└── repository-map.md       # generated view

{{HARNESS_HOME}}/agent-harness/state/repository-map/
└── verification.json       # mutable source fingerprints and freshness
```

`repository-map.yaml` 使用 `schemas/repository-map.schema.json` 的 schema version 1；Markdown 只能由
`repository-map render --write` 生成。没有 generated marker 的旧视图或用户维护视图不得被覆盖；verification
state 可在不同 checkout/Host 重建，不是项目事实，也不进入 managed runtime checksum。

Repository catalog 的必需语义是稳定 `id`、相对项目根的 `checkout`、非空职责描述、有限 `owns`、aliases、
remotes 和 1–6 个正式 source。直接关系固定为 `provider -> contract -> consumer`，类型仅限 `package`、
`http-api`、`rpc`、`event`、`artifact`、`proxy`、`migration`、`extension`；稳定 key 由
`type + provider + contract + consumer` 计算。每条边必须有 provider 与 consumer 两侧的相对 evidence path，
多消费者拆成多条边。

## 命令与副作用

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map check --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map discover packages --apply --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map verify --record --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map maintain --max-age-days 30 --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map render --write
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map reconcile /absolute/observations.json --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs repository-map migrate /absolute/candidate.yaml --json
```

| 命令 | 默认行为 | 写入条件 |
| --- | --- | --- |
| `check` | 校验 schema、引用、方向、证据和容量 | 始终只读 |
| `render` | 生成确定性视图 | 只有显式 `--write` |
| `verify` | 检查 source 并计算 fingerprint | 只有显式 `--record` 写 state |
| `maintain` | 报告 stale、缺失、漂移和预算问题 | 始终只读 |
| `discover packages` | 从 catalog 的 package manifest 产生确定性观察 | 只有显式 `--apply` |
| `reconcile` | 去重外部观察并形成 proposal | `--apply` 仍需资格与证据 |
| `migrate` | 检查 legacy candidate | 只有显式 `--apply` |

`discover packages` 只读取 catalog 仓库的 `package.json` 名称和直接依赖；网页、搜索、日志、外部 Agent 或
启发式观察一律是不可信 proposal，不能因自称 deterministic extractor 就自动提升。`verify --record` 只接受
checkout 内的 regular file，记录 SHA-256、缺失项、map fingerprint、extractor version 和 `checkedAt`。

## 门槛、预算与确定性

关系进入 canonical map 前同时满足：稳定（不绑定当前 ref/HEAD/dirty、临时迁移或一次性线上现象）、可验证（能
指向代码、manifest、schema、测试、部署配置或正式文档）、直接（一跳，不物化传递闭包）、可复用且重新发现
成本高。当前预算为全图最多 200 个仓库、1000 条直接边；每仓 `owns` ≤ 12 项，每边 evidence 2–6 项。

canonical YAML 按 repository id 和 relation key 排序，upsert 不追加时间线；相同 YAML 必须生成相同 Markdown。
`maintain` 默认 30 天 freshness window，source 缺失或 fingerprint 改变标为 stale，不因一次扫描未命中就删除。
定期维护只需 `discover packages --apply`、`verify --record`、`maintain`，不要每次重新扫描全部源码。

## Legacy migration

初始化或升级只创建缺失文件，不覆盖既有 `repository-map.md`。旧自由文本可能混用 caller→callee 方向、聚合
多个仓库或缺少双侧 evidence，不能无损自动迁移。先建立 catalog、拆分关系并核对 source；YAML 校验通过前保留
旧视图。`migrate <candidate.yaml>` 默认只输出 proposal；显式 `--apply` 必须通过全部 source 校验，先把旧视图
保留为 `repository-map.legacy.md`，再安装 canonical YAML 和 generated view。

## 结果与写回

跨仓分析本身可以更新 personal `repository-map.yaml` 并重新生成 `repository-map.md`，但不得越过上述稳定性、
证据、路径和锁边界；用户明确禁止写入时只返回 `proposed`。结果只使用以下含义：

- `proposed`：等待证据审阅或用户禁止写入；
- `updated`：canonical map、generated view 和 verification state 已同步；
- `unchanged`：没有达到门槛的新关系，或稳定 key 已存在；
- `blocked`：路径、legacy view、证据或校验阻塞，并说明恢复条件。

不得把生成 Markdown 当作编辑入口，不得把 verification state 当作语义事实，不得把一个任务结束误当作所有共享
关系已失效。跨仓实现还要核对契约 owner、发布顺序、兼容窗口、消费者验证和回滚路径。
