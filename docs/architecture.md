# Harnesssmith Architecture and Enforcement Model

Harnesssmith 是一个本地优先、opinionated、跨 Codex、Cursor 和 Claude Code 的 Personal Harness
分发与管理工具。它安全地安装和升级规则与内嵌 Harness CLI，并提供渐进式文档、项目上下文、
非权威记忆和带验收门禁的长任务状态。

它不是宿主 Agent Runtime：不接管模型循环、工具调用、MCP 调度、sandbox、权限批准、成本预算或
事件流。Markdown 规则属于 advisory guidance；安全强制来自安装器、schema、测试、CI 和宿主自身
权限。

## 四个实现平面

| 平面 | 当前所有者 | 已实现职责 |
| --- | --- | --- |
| Distribution | 外层 `src/` | Adapter、SafePath、staging、进程锁、备份、安装记录、restore、uninstall |
| Guidance & Context | `template/AGENTS.md` 与 `docs/` | 高损失常驻规则、渐进披露、工具与任务路由 |
| Work State | 内嵌 Harness Runtime | 非权威 memory、长任务 ledger、checkpoint、acceptance gate |
| Verification | tests、evals、preflight、CI | schema、行为回归、包边界、跨平台矩阵和手工宿主 Eval 证据契约 |

宿主 Enforcement 是外部边界；Evolution 是后续能力。当前不实现 Policy Engine、Canonical IR、
Pack/Registry、自动规则提升或多 Agent Runtime。

## Adapter 能力契约

`createAdapter()` 产生的每个 Adapter 都带有机器可读 `capabilities`，并出现在 dry-run、install
result 与 status JSON 中。

| Adapter | Scope | Instruction format | Native activation | Instruction enforcement | Permissions |
| --- | --- | --- | --- | --- | --- |
| Codex | global | Markdown | host-default | advisory | host-owned |
| Claude Code | global | Markdown | host-default | advisory | host-owned |
| Cursor | project | MDC | always | advisory | host-owned |

Cursor 的 `always` 只用于当前高损失 personal baseline，不表示 Harnesssmith 已建模所有宿主原生规则
类型。若未来需要不同激活策略，应先增加真实宿主 Eval，再扩展 capability descriptor。

## 安装安全边界

有副作用的生命周期操作共享以下安全骨架：

1. canonicalize 用户授权的 Agent home 或项目根；
2. 校验所有 output、record、backup 和 ignore path 的 lexical containment；
3. 对授权根及其下方每个现存路径段执行 `lstat`，默认拒绝 symlink、junction 和 reparse path；
4. 获取每个 Adapter 的跨进程 operation lock，并按路径排序避免多 Adapter 死锁；
5. commit 前再次校验全部目标，每次 mkdir、rename 或 write 前再校验直接目标；
6. 失败时仅按已记录的精确路径回滚。

其中 install 会先完整 staging、渲染并对 `.mjs` 做 JavaScript syntax check；restore 与 uninstall
不重新渲染模板，而是完整预检安装记录、当前受管理文件和备份关系后，按记录执行恢复事务。

Node.js 无法提供跨平台 `openat(O_NOFOLLOW)` 等同语义，因此 TOCTOU 防护是“锁 + commit 前全量
复检 + 每次变更前复检”的 best effort。授权根外的并发攻击者不在正常使用模型内，但任何检测到的
路径替换都会 fail closed。

## 版本与迁移

- npm package version 描述外层安装器发布；当前为 `0.1.0` unreleased。
- `harnessVersion` 描述内嵌 Runtime 功能；当前为 `2.1.0`。
- `schemaVersion` 与 `memorySchemaVersion` 当前都为 `1`。
- `harness version --json` 输出全部兼容字段，`validate` 拒绝未知 schema。
- 当前没有待迁移 schema，也没有 `migrate` 命令。将来任何 schema 变更必须先实现显式、可测试、
  可回滚的迁移，再提升对应 schema version。

## 发布就绪定义

源码与测试达到 Alpha 质量不等于已发布。首次公开发布至少需要：P0 安全回归、`preflight`、覆盖率、
tarball dry-run、依赖审计、SBOM、真实 CI 记录、手工宿主 Eval 证据，以及正式 Git commit/tag
baseline。仓库没有真实运行记录时只能报告“已配置”或“本地通过”，不能报告“跨平台已验证”。
