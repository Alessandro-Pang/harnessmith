---
title: Harness Engineering 与 Harnessmith
description: 一个后来进入项目的领域视角，以及 Harnessmith 在其中的位置
owner: maintainers
---

# Harness Engineering 与 Harnessmith

先说结论：Harnessmith 不是从 Harness Engineering 的概念或分层模型出发设计的。项目先在实际使用中解决规则复用、文档检索和工作记录的问题；后来做通用化时撞上宿主适配、授权、Memory、生命周期和验证边界，回头再看，才发现这些问题的形状与业界讨论的 Harness Engineering 高度重合。换句话说，这个概念是事后找到的坐标系，不是事前的蓝图。它帮助核对已做的事，而不是解释为什么去做。

真实演进顺序见[历史与思想来源](/concepts/history-and-influences)。本页只解释这个领域概念本身，以及它如何帮你看清 Harnessmith 当前做了什么、没做什么。

## 什么是 Harness Engineering

一个朴素的问题：模型能力相同的前提下，为什么两个 Agent 的实际表现差距很大？答案往往不在模型里。模型决定「能推理到什么程度」，Harness 决定模型在什么环境中得到哪些上下文、能调用什么、如何持续工作，以及结果怎样被观察和验证。

举个具体的例子。假设你让两个 Agent 各自完成一次跨仓库的重构，两者的模型能力完全相同。第一个 Agent 在任务开始时，`AGENTS.md` 里只有不到 20 行规则，清楚地列出了每个仓库的职责、owner 和常用命令；它读完规则后直接定位到正确仓库，沿 Manifest 找到依赖关系，运行测试确认 baseline，修改代码，再跑一次测试验证。第二个 Agent 的入口文件塞了 200 多行，混着安全规则、操作手册、半年前的发布记录和三条互相矛盾的项目命名约定；它花了大量上下文理解这些内容，最终选择了错误的仓库，因为过期信息里提到「那个模块已迁移」，而实际上迁移在三周前被回滚了。

同样的模型，第一个 Agent 完成了任务，第二个走进了死胡同。差别不在模型，在于 Harness：上下文是否干净、导航是否准确、历史是否被正确标记。对 Coding Agent 来说，只优化提示词通常不够；工具接口、仓库可读性、权限边界和反馈回路同样会改变最终表现。

## 从 Prompt 到完整工作系统

这三个词经常被混用，但它们关心的是逐层外扩的不同问题。用一个跨仓库发布任务来区分：

- **Prompt engineering** 关注如何表达一次请求。比如，「请修改发布脚本」和「请在不修改当前已发布版本的前提下，为下次发布增加一个 dry-run 模式，并在修改后运行现有的发布测试」——后者多花了 15 秒写 prompt，但省掉了三轮来回纠正。
- **Context engineering** 关注本次运行应该看到哪些规则、事实和历史。你给 Agent 的上下文里是否包含了正确的仓库路径、当前发布规则、最近一次发布失败的原因，还是混入了 10 个不同项目的 README？
- **Harness engineering** 继续向外，关注执行环境、工具、生命周期、观测、验证和治理如何共同支撑任务。发布脚本修改后，谁来验证它真的能跑？如果脚本在 CI 里失败了，Agent 怎么知道不是自己的问题？跨会话重跑时，Agent 从哪里恢复「上次改到哪了」？

近期综述 [Agent Harness Engineering: A Survey](https://picrew.github.io/LLM-Harness/) 用 ETCLOVG 七层描述这一领域：Execution、Tool、Context、Lifecycle、Observability、Verification、Governance。要强调的是，这是一种有用的分析框架，不是成熟标准，也不是产品功能清单。层与层会相互影响：增加工具能力会扩大权限面；延长任务生命周期会增加状态、观测和验证需求，所以不能孤立地优化某一层。

## Harnessmith 在七层中的位置

| 层 | Harnessmith 当前职责 | 边界 |
| --- | --- | --- |
| Execution | 安装过程的路径安全、锁、事务与回滚 | Agent sandbox 和命令执行由宿主负责 |
| Tool | 提供工具选择与授权规则的渐进文档 | 不实现 MCP 或工具调度器 |
| Context | 短入口、文档路由、检索和非权威 Memory | 宿主决定最终上下文和压缩策略 |
| Lifecycle | Task、checkpoint、handoff 与 acceptance gate | 不实现通用 Agent loop 或多 Agent 编排 |
| Observability | 接收受限、脱敏的宿主元数据 | 不自动捕获宿主事件，不证明事件真实性 |
| Verification | 仓库门禁、候选绑定 Host Eval 记录 | 真实宿主执行和可信 attestation 在外部 |
| Governance | 明确授权边界和能力 owner | 运行时权限批准与凭据仍由宿主和用户负责 |

表里每行的「边界」列和「职责」列同样重要。Harnessmith 的选择是做一个「个人 Harness 的分发与工作状态控制层」，而不是复制每个宿主已有的 Runtime——宿主在模型、工具和权限上的真实差异本来就该保留，能复用的是稳定的方法层。

逐层细看：

**Execution 层**：Harnessmith 管的是「安装过程」这条窄路径的路径安全、锁、事务与回滚。但 Agent 实际执行命令时，sandbox 由宿主提供，命令是否被允许、能访问哪些文件、网络是否可达，都是宿主在控制。Harnessmith 不会把自己写进宿主的 sandbox 策略里，也做不到。

**Tool 层**：Harnessmith 的文档可以告诉你「这个工具应该只用于只读分析」「发布操作需要先 dry-run」，但它不实现 MCP server，也不拦截工具调用。工具实际上被不被调用、被调用时传入什么参数，是宿主工具调度器的事。

**Context 层**：这是 Harnessmith 最核心的投入。短入口、文档路由、检索和非权威 Memory 共同回答了「Agent 应该看到什么」。但最终上下文有多长、哪些内容被压缩、哪些被丢弃，是宿主模型在管理。Harnessmith 可以提供优先级建议，不能改写压缩算法。

**Lifecycle 层**：Task、checkpoint、handoff 和 acceptance gate 提供了跨会话的持久工作状态。但 Harnessmith 不实现通用 Agent loop（不控制 Agent 何时启动、何时暂停、何时重试），也不做多 Agent 编排，那些是 orchestration 框架的领域。

**Observability 层**：Harnessmith 的 audit 接收受限、脱敏的元数据（trace、操作、耗时、结果、artifact digest），但不会自动捕获宿主事件。一个工具调用是否发生、是否被批准、是否超时，这些事件由宿主产生，Harnessmith 只能记录「有人上报了什么」，不能证明「上报的内容真实」。

**Verification 层**：仓库门禁（单元测试、preflight、schema）和 Host Eval 记录绑定是 Harnessmith 能做的最强验证。但真实宿主执行和可信 attestation 在外部。Harnessmith 可以验证一份记录的结构是否自洽，不能证明记录来自真实的宿主会话。

**Governance 层**：Harnessmith 明确授权边界和能力 owner，规则里写清楚「远端写入需要授权」「一次 push 不自动包含 merge」。但运行时权限批准和凭据管理仍由宿主和用户负责。把规则写进 Markdown 和把它变成宿主权限系统的 enforcement，是两件不同的事。

## 一个重要判断：模型与 Harness 要一起评估

当 Agent 失败时，原因可能来自模型，也可能来自缺失上下文、工具返回不稳定、环境没准备好、任务状态丢失，或 verifier 本身错误。只看最终回答很难归因。

举个例子。一个 Agent 报告「发布脚本测试通过」，但实际上：模型完全理解需求并生成了正确的代码，但测试运行时缺少一个环境变量，所有测试被跳过，退出码仍然是 0。Agent 看到退出码为 0 就报告了通过。这里模型没有出错，错在 Harness：verifier 只检查了退出码，没有检查测试是否实际执行。

因此 Harnessmith 把确定性仓库验证、真实宿主场景、记录结构校验和人工复核分开，并明确每一层能证明什么。确定性仓库验证能证明「代码在当前环境下通过了测试」，但不能证明「真实宿主执行了测试」；Host Eval 能证明「某个精确候选包在真实宿主中完成了场景」，但一次通过不能证明所有场景都成立；记录结构校验能证明「记录格式正确」，不能证明「记录内容来自真实宿主」。把四层分开，归因才有依据。细节见[证据与评测](/concepts/evidence-and-evaluation)。
