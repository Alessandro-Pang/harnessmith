---
title: 历史与思想来源
description: 区分研发前架构评审、近期综述与当前实现事实
owner: maintainers
---

# 历史与思想来源

Harnessmith 的设计不是从一份固定蓝图直接实现出来的。项目在研发前有过系统性架构评审，研发过程中又根据代码、测试、
真实宿主差异和发布经验收缩边界。近期 Agent Harness 综述则提供了更广的领域地图。三者用途不同，不能互相替代。

## 研发前的架构评审

`Personal Agent Harness CLI Architecture Review` 是研发前文档。它提出本地优先、宿主中立、渐进披露、可恢复变更、
证据驱动和 guidance 与 enforcement 分离等原则，也讨论了 Policy Engine、Canonical IR、Pack/Registry 和更完整的
控制平面。

前一组原则已经影响当前设计；后一组方案中的许多内容没有实现，有些已被明确列为不支持。它们是历史选项和设计输入，
不是当前产品承诺，也不能用来推断 CLI 行为。

## 近期 Agent Harness 综述

`Agent Harness Engineering: A Survey` 汇总了 170 多个开源项目，并用 ETCLOVG 七层梳理执行、工具、上下文、生命周期、
可观测、验证和治理。它帮助文档解释 Harness 为什么不能只被理解成提示词，以及为什么长任务、证据归因和能力控制需要
跨层设计。

按当前资料状态，这篇综述尚未经过双盲评审；作者也说明语料偏向英文 GitHub 与 Coding Agent，分类法是描述性的而非
规范性的。因此本站把它当作有价值的研究地图和术语来源，不把其分类、统计或结论写成已确立标准。

## 什么才是当前事实

当前事实的优先级来自实现与可执行契约：`src/`、`template/agent-harness/src/`、测试、schema、manifest、`package.json`、
能力声明和已接受 ADR。本站会把外部资料用于解释“为什么”，但“现在做了什么”必须能回到这些来源核对。

当历史方案、综述和实现冲突时，以当前事实为准；如果未来实现了历史提案，应同时补代码、测试、能力证据和文档，而不是
只修改叙述。

## 设计影响如何进入项目

| 思想 | 当前落点 | 没有因此获得的能力 |
| --- | --- | --- |
| guidance 不等于 enforcement | 文档建议与代码/schema/宿主权限分层 | Markdown 不会变成强制权限系统 |
| 渐进披露 | 短入口、route、search、按需 playbook | 不保证宿主一定正确采用建议 |
| 可恢复变更 | preflight、锁、staging、备份、restore、rollback | 不承诺抵御授权根内任意恶意并发攻击 |
| 长任务需要持久状态 | Memory、Task、checkpoint、acceptance gate | 不提供通用 Agent orchestration |
| 模型与 Harness 联合评估 | 仓库门禁 + Host Eval + 人工复核 | 本地记录不等于可信远程 attestation |

完整的一手资料与“为什么与 Harnessmith 相关”见[参考资料](/references)。
