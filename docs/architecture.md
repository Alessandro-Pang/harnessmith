# Harnessmith Architecture and Enforcement Model

Harnessmith 是一个本地优先、opinionated、跨 Codex、Cursor 和 Claude Code 的 Personal Harness
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
| Verification | tests、evals、preflight、CI | schema、行为回归、包边界、跨平台矩阵、maintainer-attested record structure 校验和 executable release gate |

宿主 Enforcement 是外部边界；Evolution 是后续能力。当前不实现 Policy Engine、Canonical IR、
Pack/Registry、自动规则提升或多 Agent Runtime。

Host Eval gate 会校验维护者提交记录的 package version、候选 tarball SHA-256、完整 scenario contract、
behavior fingerprint、freshness、脱敏 artifact digest、工具行为、文件差异、逐项 pass 断言、禁止行为
断言和 verdict，并要求 Codex、Cursor、Claude Code 覆盖完整场景矩阵。
The gate does not launch or authenticate to any third-party host. 真实宿主执行、脱敏和证据采集仍由明确
授权的维护者或 CI runner 完成。因此 gate
通过只表示“maintainer-attested structure 内部一致且绑定当前候选包”；本地记录和摘要可由仓库写入者
伪造，不能证明证据确由真实 Host 产生、内容完整或 verdict 为真。可信来源需要外部 CI/attestation
和人工证据复核；Harnessmith 仍未接管宿主 Runtime 或权限系统。

## Adapter 能力契约

`createAdapter()` 产生的每个 Adapter 都带有机器可读 `capabilities`，并出现在 dry-run、install
result 与 status JSON 中。

| Adapter | Scope | Instruction format | Native activation | Instruction enforcement | Permissions |
| --- | --- | --- | --- | --- | --- |
| Codex | global | Markdown | host-default | advisory | host-owned |
| Claude Code | global | Markdown | host-default | advisory | host-owned |
| Cursor | project | MDC | always | advisory | host-owned |

Cursor 的 `always` 只用于当前高损失 personal baseline，不表示 Harnessmith 已建模所有宿主原生规则
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

- npm package version 描述外层安装器发布版本，唯一事实来源是根 `package.json`。
- `harnessVersion` 描述内嵌 Runtime 功能，各 schema version 描述持久化契约；唯一事实来源是
  `template/agent-harness/manifest.json`。
- `harness version --json` 输出全部兼容字段，`validate` 拒绝未知 schema。
- 当前 Task schema 为 3，Memory schema 为 1。读取旧 Task ledger 时执行确定性内存迁移：v1 字符串
  evidence 标记为 `legacy`，v2 typed evidence 标记为 `external`；仍活跃 Task 的旧 `passed` 会降为
  `inconclusive`，必须经 `task verify` 重新机械验证。Memory metadata 只允许通过 proposal-first 的
  `memory migrate` 显式升级；不自动覆盖原记录。

## 发布就绪定义

源码与测试达到 Alpha 质量不等于已发布。首次公开发布至少需要：P0 安全回归、`preflight`、覆盖率、
tarball dry-run、依赖审计、SBOM、真实 CI 记录、当前 release policy 要求的真实宿主 Eval 证据，
以及正式 Git commit/tag baseline。当前必需宿主为 Codex；Cursor 与 Claude Code 是受支持但非发布
阻断的可选证据。仓库没有真实运行记录时只能报告“已配置”或“本地通过”，不能报告“跨平台已验证”。
