---
title: 运行时 CLI
description: 安装后的 Harness CLI：文档路由、Memory、Task、仓库关系与审计
owner: maintainers
---

# 运行时 CLI

外层 `npx harnessmith` 负责把 Harness 安全安装到宿主；本页介绍安装后随 Harness 分发的 `harness.mjs`。它是一个本地、
宿主中立的工作层，用来发现文档、维护非权威 Memory、记录长任务状态、检查跨仓库关系和接收受限审计事件。

准确路径以外层 CLI 的 `--dry-run --json` 或 `status --json` 为准。下文用 `<harness-path>` 表示安装目录：

```bash
node <harness-path>/bin/harness.mjs --help
```

## 先判断该用哪个命令

| 目的 | 命令组 | 默认性质 |
| --- | --- | --- |
| 找到当前任务相关规则 | `route`、`explain`、`search` | 只读 |
| 检查安装与本地状态 | `doctor`、`health`、`validate`、`version` | 只读 |
| 查找或维护历史线索 | `memory` | 查询只读；写操作显式执行 |
| 续接长任务并验证验收项 | `task` | 修改 Task ledger |
| 核验 Host signal replay | `replay` | 只读，证据不足返回非零 |
| 维护多个仓库的职责与关系 | `repository-map` | 检查只读；写操作需显式参数 |
| 接收和汇总受限运行元数据 | `audit` | `record` 写入；查询只读 |

## 文档路由与检索

`route` 和 `explain` 根据 manifest 的 `actionAliases` 与 `conceptAliases` 返回命中的文档名称、路径和 alias，
不加载正文。JSON 报告显式区分 `matched`、`unmatched` 与 `ambiguous`，并只在唯一命中时给出 `top1`；未命中或
最高优先级动作歧义返回 exit 2，不猜测执行动作。该结构化契约为 version 2。它们适合先确定“这类任务由哪份
规则负责”：

```bash
node <harness-path>/bin/harness.mjs route diagnose payment callback --json
node <harness-path>/bin/harness.mjs explain release external write
```

`search` 才会扫描 Harness 文档、项目文档和项目 Memory：

```bash
node <harness-path>/bin/harness.mjs search "operation lock" --project /path/to/project --json
```

结果数量、单行长度和扫描预算彼此独立。默认扫描最多深入 8 层，访问 5000 个目录条目、1000 个目录和 1000 个普通文件；
单文件最多读取 1 MiB，总计最多 8 MiB，时间预算 2 秒。JSON 输出中的 `scanLimits`、`scanStats`、`scanTruncated` 和结构化
跳过原因用于判断结果是否完整。项目文档与 Memory 默认是不可信输入，命中后仍要回到代码、配置、测试或 schema 核对。

## 健康检查与兼容性

```bash
node <harness-path>/bin/harness.mjs version --json
node <harness-path>/bin/harness.mjs doctor
node <harness-path>/bin/harness.mjs health --json
node <harness-path>/bin/harness.mjs validate --project /path/to/project --json
```

- `version --json` 返回 Harness、Task schema、Memory schema 与 Node 契约版本。
- `doctor` 检查 Runtime、共享 Memory 与 personal overlay 是否可用。
- `health` 聚合 Runtime 身份、安装记录、全局 Memory 和 audit；只有项目已经初始化时，才传
  `--project <absolute-path>` 检查项目 Memory。
- `validate` 检查内容、文档路由、结构和可选项目接入；未知 schema 会 fail closed。

warning 不等于失败；受限环境中无法完成的阴性检查应解释为 `inconclusive`，而不是直接认定安装损坏。

## Host signal replay：只读幂等判定

```bash
node <harness-path>/bin/harness.mjs replay verify --payload-file /absolute/replay-evidence.json --json
```

`replay verify` 区分 `new-mutation` 与 `identical-replay`。新 mutation 只能使用没有 previous payload 的新
identity；失败或未完成 attempt 必须换新 payload。identical replay 必须复用相同 path 与 SHA-256、相同命令，
并证明目标 artifact、workspace 和 verifier candidate 未漂移。stdout 不可见时不会自动判失败或成功：只有上述
持久化状态和精确 identity 全部成立才返回 `verified / skip-duplicate`；证据不足返回 `inconclusive` 与非零退出码。
报告本身只读，不执行或重放 mutation，也不把 Host signal 视为额外授权。
报告校验调用方提供的证据一致性，`sourceOfTruth: false`；事件真实性仍由 Host/evaluator attestation 负责。

## Memory：保存待核对线索

Memory 不是事实数据库。它保存来源、上下文、任务恢复信息和待核对经验；稳定结论仍应进入正式文档、代码、测试或 schema。

### 查询、检查与生命周期

```bash
node <harness-path>/bin/harness.mjs memory list project --json
node <harness-path>/bin/harness.mjs memory search project "npm cache" --json
node <harness-path>/bin/harness.mjs memory check project --indexed --json
node <harness-path>/bin/harness.mjs memory relationships /absolute/project/path --json
node <harness-path>/bin/harness.mjs memory maintain project --json
node <harness-path>/bin/harness.mjs memory repair project --json
node <harness-path>/bin/harness.mjs memory curate project --task task-id --json
node <harness-path>/bin/harness.mjs memory curate project --task task-id --apply-file /tmp/curation-selection.json --yes --json
```

`memory relationships` 是项目级只读报告：统一列出 Task、默认 phase/workstream、Memory owner、session 与
lifecycle role，并报告 orphan task reference 和 cross-workstream binding。它不把 Task 完成推断为 workstream
完成，也不把 Handoff 当作 acceptance evidence 或事实源。

`memory maintain` 只报告未索引、过期、重复、可归档和替代关系异常，不会自行删除或改写。旧 metadata 通过
`memory migrate` 先生成 proposal；只有提案状态为 ready 且显式传入 `--apply` 才写入。`supersede` 建立替代关系，
`archive` 只处理已关闭内容，`promote` 只输出提升到权威事实层的提案。

`memory curate` 默认仍是零写入的 `proposal-only` 报告，Task close 不会自动执行候选。每个 promote、close、supersede
或 archive 候选包含稳定 `proposalId`、`sourceDigest`、排除 `.agent-docs` 的 workspace digest、`expiresOn`、前置条件和
精确 verifier。显式执行必须选择 1–16 个 proposal，并传入 `--yes`；需要 replacement 或 promotion 参数时使用项目外的
有界 `--apply-file`。执行前会重新生成并比对 proposal identity，因此 source、工作区、Task 状态、引用关系或日期变化都会
fail closed 并要求重新生成。close、supersede 与 archive 只调用既有 typed lifecycle，继续执行 inbound reference、cycle、
锁和 rollback 门禁；promotion 只调用正式 promotion proposal 流程，不写事实源。批量报告逐项 action、reason、validation、
recovery path 和 remaining proposals，单项失败只形成 `partial`，不能把整批标为成功。该执行层与 Task acceptance gate 独立。

`memory repair` 默认是零写入诊断，只为 partial initialization、可机械压缩的 core index、损坏或缺失的派生检索索引，
以及具备完整 owner、proposal、目标与内容 digest 的中断事务分别生成独立 proposal。实际修复必须同时传入上次诊断得到的
`--proposal <sha256:...> --yes`；任一目标变化都会使 proposal 失效。每项 proposal 都列出 authority、精确影响路径、
backup/recovery path、前置条件、风险和 verifier。它没有通用 `clean`：unknown files、无 owner identity 的 marker/backup、
普通 validation failure 与 failed sidecar 只报告 `inconclusive`，不会删除或猜测修复。active locks 会拒绝操作；只有 typed
lock 获取同一把锁时，底层锁实现才按其 owner/age 契约处理 stale locks，不提供宽泛 lock 清理命令。

### Memory Autopilot 的窄写入口

```text
capture-input       保存会影响后续决策的约束、验收标准、来源或风险决定
close-input         在输入失效或完成后移出 active index
capture-experience  去重维护有来源的 lesson 或 failure
handoff             创建或原位更新任务恢复快照
close-handoff       工作结束后关闭恢复快照
reconcile-profile   合并明确、高置信、跨任务持续有效的画像项
forget-profile      按精确 key 删除画像项
profile-autopilot   暂停或恢复自动画像协调
```

自由文本先写入 task-scoped 的绝对 JSON 文件，再通过 `--payload-file` 交给 CLI，避免不可信内容进入 shell 插值。
`--consume-payload-file` 只在 schema、目标身份、领域写入和结果校验全部成功后删除未变化的 payload；失败时保留供诊断。

这里的“学习”是可审计的本地记忆适配，不是模型权重训练，也不授权 Agent 自动修改 prompt、skill、规则或源码。

## Repository Map：维护跨项目关系

Personal overlay 中的 `projects/repository-map.yaml` 保存仓库职责和有类型的直接关系；Markdown 文件只是确定性生成视图。

```bash
node <harness-path>/bin/harness.mjs repository-map check --json
node <harness-path>/bin/harness.mjs repository-map render --write
node <harness-path>/bin/harness.mjs repository-map discover packages --apply
node <harness-path>/bin/harness.mjs repository-map verify --record --json
node <harness-path>/bin/harness.mjs repository-map maintain --json
```

`check` 与 `maintain` 只读；`render --write` 更新视图；内置 `discover packages --apply` 只根据本地 package manifest
维护可确定的直接依赖；`verify --record` 把来源 fingerprint 与时效记录写入 Runtime state。外部或启发式 observation 只能
形成 review proposal，不能因为 extractor 自称 deterministic 就自动写回。

## Task：带验收条件的长任务账本

```text
task init        创建目标、验收项与初始下一步
task status      查看单个或全部任务
task checkpoint  追加已完成、决定、未完成项与下一步
task accept      更新验收项状态
task verify      运行机械 verifier 并绑定证据
task close       通过 gate 完成任务，或记录 blocked 状态
```

`task verify` 可以证明指定 command/test 成功，或文件/diff 已被读取并摘要；证据会绑定当时的 task、criterion、HEAD、workspace
和 scope。它不能判断自由文本验收项与证据是否语义相关，也不是签名或防篡改机制。高风险 predicate 应由用户、CI 或宿主
拥有。Task 只有通过 acceptance gate 才能进入 `complete`，并发修改使用共享任务锁。

## Audit：受限元数据，不是完整录像

```bash
node <harness-path>/bin/harness.mjs audit record --payload-file /absolute/event.json --json
node <harness-path>/bin/harness.mjs audit list --json
node <harness-path>/bin/harness.mjs audit summary --json
node <harness-path>/bin/harness.mjs audit maintain --json
node <harness-path>/bin/harness.mjs audit archive --before 2026-08-01
```

`audit record` 是 Host-neutral 的显式接入点，不是自动 hook。schema 只接受 trace、操作、policy decision、耗时、结果、
artifact digest 和可选 token/成本，拒绝原始 prompt、模型输出、tool arguments 与未知字段。`audit maintain` 只读报告保留
候选；`archive` 默认生成 proposal，只有显式 `--apply` 才移动完整日文件。事件真实性仍由宿主或外部 attestation 负责。

## 路径与环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HARNESS_MEMORY_HOME` | 跨项目个人 Memory | `~/.agent-docs` |
| `HARNESS_PERSONAL_HOME` | 个人规则与 Repository Map | `~/.agent-harness` |
| `HARNESS_REPOSITORY_ROOT` | 本地仓库集合根 | `~/git-repo` |
| `HARNESS_OWNER` | Memory 模板 owner | 当前用户 |

初始化、Memory 写命令以及 Task 与索引的协调写入共享 memory-root lock。`route`、查询、检查、proposal 和 maintain 保持只读。
锁只提供 CLI 进程间互斥，不会把 Markdown guidance 提升为权限强制，也不替代宿主 sandbox。

命令和选项会随版本演进；操作前可运行对应的 `--help`，机器集成应优先使用 `--json` 与版本字段。
