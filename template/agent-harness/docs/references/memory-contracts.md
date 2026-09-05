---
title: Project Memory Contracts
type: harness-reference
status: active
updated: 2026-09-04
owner: project-agent-docs
---

# Project Memory Contracts

这是 `project-agent-docs` 的低频机械参考。只有实现、诊断、审计或明确需要精确字段时才加载；普通任务先遵循
[Project Memory Standard](../standards/project-agent-docs.md) 的资格、授权和可见性规则。这里的 schema、预算和命令
仍以当前 CLI、测试和 schema 为事实源，文档示例不能替代验证。

## Metadata

所有托管 Markdown 至少包含以下字段；新 writer 不得静默补猜缺失的语义：

```yaml
title: "标题"
description: "这份记忆帮助后续 Agent 回答什么"
type: "user-input | session-handoff | working-note | distilled-memory | evidence-manifest | agent-memory-index | analytical-finding | operational-experience | user-profile"
memory-kind: "input | episode | working | distilled | evidence | index"
status: "active | blocked | complete | superseded | archived"
owners: ["owner"]
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
project: "project-key"
tags: ["stable-keyword"]
scope: ["repo/relative/path"]
source-refs: ["docs/path.md", "commit:<sha>", "session:<id>"]
source-of-truth: false
schema-version: 1
```

新建 `input` 使用 input schema v2，另含 `input-purpose`、`retention`、来源和 verbatim 标记；
`retention: workstream` 必须绑定稳定 `workstream`。episode 可以带稳定 session identity。旧 metadata 只能经
`memory migrate` 显式迁移，缺失分类保持 legacy，不通过推断修补。

当前 typed schema 版本为：`input-schema-version: 2`、`document-purpose-schema-version: 1`、
`finding-schema-version: 2` 和 `experience-schema-version: 2`。`analytical-finding` 还必须声明
`finding-kind: analysis|review|research` 与 `fact-class: settled-fact|current-state|verification-pointer|recovery-state|formal-fact`；
finding 不能自称 `formal-fact`，durable finding 不能保存 `current-state` 或 `recovery-state`。

## Input payload

输入模式必须显式选择（`mode: verbatim|summary`）：`verbatim` 只允许用户原始字节，`summary` 才能包含 Agent 的概括、补全或上下文拼接。
标题可以概括，但不能用标题或摘要伪造用户原话。`capture-input` 的 payload 使用 `title`、`content` 或
`contentFile`、`source`、`mode`、`purpose`、`retention`，以及可选的 `workstream`、`scope`、`sourceRefs`；
字段命名、source 枚举、文件消费和重试方式由 [CLI contracts](cli-contracts.md) 约束。当前用户消息的 source 固定为 `chat`。

`close-input` 只关闭绑定工作流已结束的 input，并更新 `.agent-docs/core.md` 的可达引用；它不能把一次性授权重新变成
durable 规则，也不能代替事实源或 Task/Handoff 的关闭门禁。

自动产生的自由文本必须由非 shell 文件能力写入 task-scoped 绝对 JSON，再通过 `--payload-file` 传递；禁止 shell
插值、重定向或命令替换。不确定的文本、secret、Token、Cookie、验证码、私钥和未脱敏生产数据拒绝写入。

## Typed experience 与 finding

`capture-experience` 只接受 typed `lesson` 或 `failure`。新文档必须有非空 `conclusion`、`rationale`、
`application`、`evidence` 和来源引用；证据与来源必须是有界单行，不能把完整日志或源码复制进正文。

`capture-finding` 只接受 `analysis`、`review`、`research`，并显式标注 `settled-fact`、`current-state`、
`verification-pointer`、`recovery-state` 或 `formal-fact`。非权威 finding 不得标为 `formal-fact`；易漂移的
current/recovery state 只能保存重取状态的 verifier pointer。`durable` finding 进入 `distilled`，`workstream`
finding 进入 `working` 并绑定 expiry。

新 typed 文档必须声明与 title 对齐的 `document-purpose`，description 必须包含同一主题；低信息 legacy 文档只
能带 warning 继续读取。lesson/finding 以结论 digest 去重，合并来源和证据，不追加重复流水；写入后校验目标、
索引和全根 schema。

## Eligibility 与结果

`memory evaluate-capture --payload-file <path> --json` 是只读统一资格入口。它先检查 negative eligibility，
再检查价值、来源、typed writer、授权、root 状态和语义重复；不会初始化 Memory，也不代替具体写命令。

资格结果使用 `unchanged`、`proposed`、`blocked`、`not-evaluated`；实际 writer 返回 `created`、`updated`、
`unchanged`。每个结果带稳定 `reasonCode`：没有运行资格判断必须是 `not-evaluated`，缺少 writer 或未初始化的
高价值候选是 `proposed`，冲突、敏感信息、来源缺失或校验失败是 `blocked`。完全重复才可 `unchanged`；新来源交给
原 typed writer 合并。

## Promotion、curation 与 relationships

`memory promote` 只生成 typed proposal，不写 ADR、docs、tests、schema、lint 或 CI。proposal 必须声明目标
类型、owner、理由、原始证据、精确 verifier、source freshness、目标 dirty state、授权状态和未满足条件；
目标已承接结论时也只能形成带 adoption evidence 的 supersede candidate。

`memory curate <project> --task <id> --json` 默认只读，按当前 task/workstream 生成 promote、close、supersede、
archive、skipped 或 `result: none` 候选，并区分 phase/task/workstream 完成与 user-cancel。候选必须有稳定
`proposalId`、source digest、workspace digest、`expiresOn`、前置条件和 verifier。显式 apply 只接受有界 proposal
集并带 `--yes`；执行前重新核验 source、Task、引用、cycle、权限和 dirty drift，stale/changed/expired 必须重新生成。
promotion 仍只生成正式 proposal，close/supersede/archive 走各自 typed lifecycle；partial failure 逐项报告，不能
冒充整批成功，curation apply 与 acceptance gate 相互独立。

多个 `task:` source ref 表示共享 owner；只结束一个 task/workstream 时不得关闭或归档共享文档。`memory relationships
<project> --json` 只读汇总 Task、phase/workstream、Memory、session 与 owner，报告 orphan task reference 和
cross-workstream binding，不创建新的权威状态层。

## Maintenance 与 repair

`core.md` 使用 host-neutral 预算：soft limit 160 行或 24 KiB，hard limit 240 行或 48 KiB，单条入口最多 512
UTF-8 bytes；每条非占位 bullet 只有一个 canonical `memory:` pointer，同一引用不重复。超限只产生压缩候选，不能
自动删除被引用正文。`working` 必须有 expiry；维护报告只读，不自动删除、关闭或归档。

维护 candidate 必须带 category、outcome、reason code、证据、suggested action、风险和 eligibility 状态；
`none`、`proposed`、`unchanged`、`not-evaluated`、`inconclusive` 与 execution failure 分开表示。扫描必须声明
文件数、单文件、总字节、深度和时间预算；截断时未命中只能是 `inconclusive`。

托管 Markdown 拒绝 symlink、特殊文件、路径碰撞和越界路径；写入使用 SafePath、secret scan、共享 lock、原子
替换和失败回滚。`.agent-docs/host-evals/` 不参加 Memory 扫描，需单独运行 `pnpm run eval:validate`。

`memory repair` 必须按 `diagnose-only → content-bound proposal → explicit apply → independent verifier` 分阶段。
partial initialization、core index、derived index、exact orphan marker 和 interrupted transaction restore 是不同
action；proposal 记录 authority、精确目标、backup/recovery、前置条件、风险和 verifier。apply 同时要求精确
`--proposal` 与 `--yes`，复用 identity、SafePath、lock、atomic write 和 rollback。active lock 直接拒绝，stale
lock 只能由同一 typed lock acquisition 回收；unknown、ownerless、身份不完整或无法机械归类的目标保持 `inconclusive`。

维护、迁移、替代和归档命令都必须保留失败路径；任何后续成功命令都不能覆盖前一条执行失败。详细 Task/Handoff
证据与 replay 由 [task and replay contracts](task-and-replay-contracts.md) 拥有，CLI 字段由 [CLI contracts](cli-contracts.md)
拥有。
