---
title: 什么是 Harness Engineering
description: 解释模型之外的执行、上下文、状态、验证与治理基础设施
owner: maintainers
---

# 什么是 Harness Engineering

模型决定“能推理到什么程度”，Harness 决定模型在什么环境中得到哪些上下文、能调用什么、如何持续工作，以及结果
怎样被观察和验证。对 Coding Agent 来说，只优化提示词通常不够；工具接口、仓库可读性、权限边界和反馈回路同样会
改变最终表现。

## 从 Prompt 到完整工作系统

- **Prompt engineering** 关注如何表达一次请求。
- **Context engineering** 关注本次运行应该看到哪些规则、事实和历史。
- **Harness engineering** 继续向外，关注执行环境、工具、生命周期、观测、验证和治理如何共同支撑任务。

近期综述 [Agent Harness Engineering: A Survey](https://picrew.github.io/LLM-Harness/) 用 ETCLOVG 七层描述这一领域：
Execution、Tool、Context、Lifecycle、Observability、Verification、Governance。这是一种有用的分析框架，不是成熟
标准，也不是产品功能清单。层与层会相互影响：增加工具能力会扩大权限面；延长任务生命周期会增加状态、观测和验证需求。

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

Harnessmith 的选择是做一个“个人 Harness 的分发与工作状态控制层”，而不是复制每个宿主已有的 Runtime。这样可以在
宿主之间复用稳定方法，同时保留各宿主在模型、工具和权限上的真实差异。

## 一个重要判断：模型与 Harness 要一起评估

当 Agent 失败时，原因可能来自模型，也可能来自缺失上下文、工具返回不稳定、环境没有准备好、任务状态丢失，或 verifier
本身错误。只看最终回答很难归因。因此 Harnessmith 把确定性仓库验证、真实宿主场景、记录结构校验和人工复核分开，
并明确每一层能证明什么。
