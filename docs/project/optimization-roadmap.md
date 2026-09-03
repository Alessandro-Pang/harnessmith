---
title: Prompt、Memory、Task 与 Host 可靠性优化路线图
description: Issues #87–#112 的 owner、架构边界、验收证据与外部依赖
owner: maintainers
type: roadmap
status: active
updated: 2026-09-01
---

# Prompt、Memory、Task 与 Host 可靠性优化路线图

本页是 Issues #87–#112 的仓库内追踪视图。它记录每项工作的 owner、不可跨越的边界、验收证据和截至
2026-09-01 的状态，但不替代 Issue、代码、测试、CI 或[能力声明—证据矩阵](../capability-evidence.yaml)。状态变化应先由这些
事实源证明，再更新本页；一个表格勾选不能把未验证能力变成 Implemented。

## 固定架构边界

- 不增加第二套 Runtime、Memory ontology、存储协议或状态源。
- Memory、Task、Handoff、Evidence 保持分离，各自继续使用既有 typed contract。
- managed distribution、personal overlay、mutable state 与 project sidecar 保持分离。
- 所有托管写入继续经过 typed CLI、schema、secret scan、SafePath、锁、原子写和回滚。
- Task complete 继续只由 acceptance gate 决定，策展、Prompt 或 Handoff 不能代替验收。
- Memory 保持非权威；docs、ADR、code、tests、schema、lint 和 CI 才是正式事实源。
- Host identity、hook 与环境变量只进入外层 Adapter，portable template 保持宿主中立。
- 真实 Host 行为不能由 Prompt、mock 或 catalog 代替；受限阴性结论必须保持 `inconclusive`。

## 分阶段路线

1. Phase 0：#92 架构护栏与 #102 可复现 Prompt/route 基准。
2. Phase 1：#87、#93、#101 收敛 Prompt owner、路由语义、回退和多语言策略。
3. Phase 2：#88、#94–#97 建立 typed Memory、资格、事实分类、单一目的与 promotion proposal。
4. Phase 3：#89–#90 控制启动上下文预算并提供 bounded bootstrap。
5. Phase 4：#91、#98–#99、#111 完成 Task/Handoff/Memory 关系、策展和 maintenance 闭环。
6. Phase 5：#100、#103 验证 replay 与多宿主矩阵；可信证明和 Host hook 继续由 #7、#10 跟踪。
7. Phase 6：#104–#110 完成 First Value、状态解释、接管、诊断、可移植配置和 repair。
8. Phase 7：迁移与发布证据继续受 #9、#7 约束，不因本批功能完成而自动升级 release claim。

## Issue 映射与验收证据

`CLOSED` 表示对应实现已进入 `dev` 且 Issue 已关闭，不表示已经发布。PR 链接证明代码评审与 CI 入口；具体能力仍以其中的代码、
测试和 capability evidence 为准。

| Issue | Owner | 边界与验收 | 状态与证据 |
| --- | --- | --- | --- |
| [#87](https://github.com/Alessandro-Pang/harnessmith/issues/87) | Prompt 与文档路由 owner | 保持路由只读；以 action intent 和 topic concept 的定向测试验收 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#88](https://github.com/Alessandro-Pang/harnessmith/issues/88) | Embedded Memory runtime | Finding 只能进入 typed writer；rationale、application、retention 与去重均由 schema 和测试验收 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#89](https://github.com/Alessandro-Pang/harnessmith/issues/89) | Memory core budget owner | Core 只保留 pointer，行数和 UTF-8 字节同时有界；超限必须 fail closed | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#90](https://github.com/Alessandro-Pang/harnessmith/issues/90) | Memory bootstrap owner | 聚合必须 bounded、只读且按需披露，不把完整 Prompt 编排留在入口规则 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#91](https://github.com/Alessandro-Pang/harnessmith/issues/91) | Memory curation owner | Task close 只产生候选，不自动 mutation；候选原因和范围必须可解释 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#92](https://github.com/Alessandro-Pang/harnessmith/issues/92) | Architecture preflight owner | 分层、typed write、acceptance gate 与 capability evidence 漂移由机械门禁拒绝 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#93](https://github.com/Alessandro-Pang/harnessmith/issues/93) | Prompt contract owner | Why/How、回退、confusing pairs 与保证等级必须由 manifest 和契约测试覆盖 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#94](https://github.com/Alessandro-Pang/harnessmith/issues/94) | Memory eligibility owner | Negative-first 判定与 proposal fallback 不得写入；结果状态保持稳定且互斥 | CLOSED — [PR #113](https://github.com/Alessandro-Pang/harnessmith/pull/113) |
| [#95](https://github.com/Alessandro-Pang/harnessmith/issues/95) | Memory semantics owner | settled fact、current state、recovery state 分型且不能互相冒充权威事实 | CLOSED — [PR #114](https://github.com/Alessandro-Pang/harnessmith/pull/114) |
| [#96](https://github.com/Alessandro-Pang/harnessmith/issues/96) | Memory document quality owner | 每份文档只有一个 purpose，索引描述可发现且不得复制正文 | CLOSED — [PR #115](https://github.com/Alessandro-Pang/harnessmith/pull/115) |
| [#97](https://github.com/Alessandro-Pang/harnessmith/issues/97) | Memory promotion owner | 只生成指向 ADR、docs、tests、schema 或 CI 的 typed proposal，不直接写事实源 | CLOSED — [PR #116](https://github.com/Alessandro-Pang/harnessmith/pull/116) |
| [#98](https://github.com/Alessandro-Pang/harnessmith/issues/98) | Memory maintenance owner | 候选、原因、覆盖范围和逐项结果可解释；partial 不能标成整批成功 | CLOSED — [PR #117](https://github.com/Alessandro-Pang/harnessmith/pull/117) |
| [#99](https://github.com/Alessandro-Pang/harnessmith/issues/99) | Work-state relationship owner | Task、phase、workstream、session、Memory 和 Handoff 关系有类型且保持单一 owner | CLOSED — [PR #118](https://github.com/Alessandro-Pang/harnessmith/pull/118) |
| [#100](https://github.com/Alessandro-Pang/harnessmith/issues/100) | Host-signal replay owner | generation、幂等和跨 turn verifier 必须拒绝陈旧、重复或错误绑定的 signal | CLOSED — [PR #119](https://github.com/Alessandro-Pang/harnessmith/pull/119) |
| [#101](https://github.com/Alessandro-Pang/harnessmith/issues/101) | Multilingual routing owner | CJK alias 与回复语言策略独立于英文 prose，并由 route Top-1 基准验收 | CLOSED — [PR #120](https://github.com/Alessandro-Pang/harnessmith/pull/120) |
| [#102](https://github.com/Alessandro-Pang/harnessmith/issues/102) | Prompt benchmark owner | 相同输入、规则 fingerprint 和确定性评估器形成可复现质量基准 | CLOSED — [PR #121](https://github.com/Alessandro-Pang/harnessmith/pull/121) |
| [#103](https://github.com/Alessandro-Pang/harnessmith/issues/103) | Host capability matrix owner | 矩阵区分 catalog、record 与真实 Host evidence，缺证据保持 not-evaluated | CLOSED — [PR #122](https://github.com/Alessandro-Pang/harnessmith/pull/122) |
| [#104](https://github.com/Alessandro-Pang/harnessmith/issues/104) | First-use setup owner | preview、确认、事务安装和 health 验证不降低文件 ownership 边界 | CLOSED — [PR #123](https://github.com/Alessandro-Pang/harnessmith/pull/123) |
| [#105](https://github.com/Alessandro-Pang/harnessmith/issues/105) | Installation status owner | `status --explain` 只解释观察事实并给非自动安全下一步，Host 结论保持 inconclusive | CLOSED — [PR #124](https://github.com/Alessandro-Pang/harnessmith/pull/124) |
| [#106](https://github.com/Alessandro-Pang/harnessmith/issues/106) | Existing-rule adoption owner | Inventory 默认只读，接管绑定精确 proposal，并事务保护 user-owned 内容 | CLOSED — [PR #125](https://github.com/Alessandro-Pang/harnessmith/pull/125) |
| [#107](https://github.com/Alessandro-Pang/harnessmith/issues/107) | Diagnostics owner | 诊断只收集 allowlisted、redacted、bounded 元数据，不落盘或上传原始内容 | CLOSED — [PR #126](https://github.com/Alessandro-Pang/harnessmith/pull/126) |
| [#108](https://github.com/Alessandro-Pang/harnessmith/issues/108) | Portable configuration owner | Export/import 版本化且跨 root fail closed，不携带 Host 私有身份或可变状态 | CLOSED — [PR #127](https://github.com/Alessandro-Pang/harnessmith/pull/127) |
| [#109](https://github.com/Alessandro-Pang/harnessmith/issues/109) | Product First Value owner | 本地可复现记录验证首个成功闭环，不把下载量或 Prompt 文案当成产品证据 | CLOSED — [PR #128](https://github.com/Alessandro-Pang/harnessmith/pull/128) |
| [#110](https://github.com/Alessandro-Pang/harnessmith/issues/110) | Memory repair owner | Repair proposal 有界、content-bound、显式确认且可回滚，失败保留 recovery path | CLOSED — [PR #129](https://github.com/Alessandro-Pang/harnessmith/pull/129) |
| [#111](https://github.com/Alessandro-Pang/harnessmith/issues/111) | Memory curation apply owner | 显式选择才调用 typed lifecycle；stale、drift、expiry、cycle 和 partial failure 均 fail closed | CLOSED — [PR #130](https://github.com/Alessandro-Pang/harnessmith/pull/130) |
| [#112](https://github.com/Alessandro-Pang/harnessmith/issues/112) | Maintainer roadmap owner | 只同步已验证状态；关闭前必须解决外部依赖 #7、#9、#10 和适用 release evidence | OPEN — 本页是 #112 对应 MR 的仓库交付 |

## 状态与关闭规则

- 写入结果使用 `created`、`updated`、`unchanged`、`proposed`、`blocked`、`not-evaluated` 或 `inconclusive`，不得把它们
  互相替换来抬高完成度。
- #87–#111 已有实现 PR 并进入 `dev`；它们仍未发布，不能据此声称 registry 或 clean-room 安装已验证。
- #7 需要独立于仓库内容的可信 attestation 和受保护执行链；仓库内自签 JSON 不能满足。
- #9 需要绑定 digest 的真实历史发布产物以及升级、失败回滚、restore、uninstall 兼容矩阵。
- #10 需要官方来源支持的 Host hook/event 结论，并至少完成一个真实 Host 的端到端 reference integration。
- #112 保持 OPEN，直到 #7、#9、#10 关闭、能力证据矩阵同步且适用 release/Host evidence 完整；单个 Phase 完成不能替代该关闭条件。

这些外部依赖不授权本页自动下载历史产物、修改受保护 CI、连接第三方 Host、发布包或写入远端环境。执行它们时应分别回到
对应 Issue 获取范围和授权。
