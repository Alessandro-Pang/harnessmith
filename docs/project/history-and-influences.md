---
title: 历史与思想来源
description: 从个人 AGENTS.md、跨项目协作实践到 Harnesssmith
owner: maintainers
---

# 历史与思想来源

Harnesssmith 不是从一份完整蓝图开始的。它来自长期使用 Coding Agent 时不断出现的实际问题：个人规则怎样跨项目复用，
多个仓库的关系怎样让 Agent 找到，长任务如何续接，安装和升级又怎样不破坏已有文件。项目把这些原本依赖人工维护的做法
逐步拆成了规则入口、检索、宿主适配、Memory、Task 和安全生命周期。

## 起点：项目根目录中的 AGENTS.md

最早的工作方式，是在项目根目录手动维护 `AGENTS.md`。除了单个仓库的开发规范，还会通过指令记录多个项目之间的关系、
职责和协作约束。Agent 进入仓库后，可以先读这份文件，再决定需要查看哪些相邻项目和事实源。

这种方式直接、透明，也证明了自然语言规则可以显著改善 Agent 的工作质量。但随着项目增多，问题也逐渐显现：相同规则
会在不同仓库重复，跨项目关系容易过期，入口文件持续变长，而且每个 Coding Agent 的规则位置和加载方式并不相同。

## 第二阶段：Starport 的规则与搜索实践

随后，Starport 项目中的 `AGENTS.md` 变得更规范：入口开始强调边界、事实来源和按需发现，而不是承载全部细节；配套的
搜索 CLI 则让 Agent 可以先定位相关文档，再读取最小必要正文。这一阶段形成了两个关键认识：

- 常驻规则应该是一张地图，而不是一本百科全书；
- 多项目知识不能只靠模型记忆，需要可检查、可检索的本地结构。

这些实践后来演变为 Harnesssmith 的短规则入口、manifest、`route`、`explain`、`search` 和 Repository Map。Harnesssmith
并不是把 Starport 的文件直接复制到所有项目，而是把其中可复用的方法抽离出来，再补上跨宿主适配和安全安装边界。

## 从个人实践到 Harnesssmith

当同一套方法需要进入 Codex、Cursor、Claude Code、OpenCode 与 Kimi Code CLI 时，单纯复制 `AGENTS.md` 已经不够。
Harnesssmith 因此形成了两层职责：外层 CLI 处理宿主路径、预检、备份、锁与回滚；安装后的 Personal Harness 处理规则
路由、跨项目关系、非权威 Memory、长任务状态和有限审计。

研发过程中，代码、测试、真实宿主差异和发布经验持续收缩能力边界。例如 Markdown 可以提供 guidance，却不能替代宿主
权限系统；Task gate 可以检查证据新鲜度，却不是语义评审器；本地 audit 可以保存受限元数据，却不能自行证明事件真实。

## 领域研究提供的坐标

[Agent Harness Engineering: A Survey](https://picrew.github.io/LLM-Harness/) 用 Execution、Tool、Context、Lifecycle、
Observability、Verification、Governance 七层观察 Agent Harness。它帮助项目把已经出现的工程问题放进更完整的领域地图，
也提醒我们不能只从 Prompt 或模型能力解释 Agent 的表现。

按当前资料状态，该综述尚未经过双盲评审，其语料和分类边界也有明确限制。因此 Harnesssmith 把它作为术语与研究地图，
不把分类法当成行业标准，更不会用论文描述替代项目自身的实现证据。

## 什么才是当前事实

项目经历解释“为什么逐渐走到这里”，但不定义“当前具体做了什么”。当前事实仍来自 `src/`、
`template/agent-harness/src/`、测试、schema、manifest、`package.json`、能力声明和已接受 ADR。

| 形成中的认识 | 当前落点 | 明确边界 |
| --- | --- | --- |
| 入口是地图，不是百科全书 | 短规则入口、manifest、`route`、`search` | 不保证宿主一定采用建议 |
| 跨项目关系需要结构化维护 | Personal overlay 与 Repository Map | 外部观察只形成 proposal |
| 历史线索不能冒充项目事实 | 非权威 Memory 与显式 promotion | 不自动改写规则、源码或正式文档 |
| 长任务需要验收契约 | Task、checkpoint、evidence、acceptance gate | gate 不判断自由文本的语义相关性 |
| 本地变更必须可恢复 | preflight、锁、staging、备份、restore、rollback | 不承诺不可失败的文件系统原子性 |

当历史实践、外部研究和当前实现冲突时，以当前代码和可执行契约为准。
