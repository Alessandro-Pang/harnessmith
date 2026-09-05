---
title: 责任与安全边界
description: Harnessmith 能保证什么、宿主负责什么、哪些结果仍需用户判断
owner: maintainers
---

# 责任与安全边界

最容易误解 Harnessmith 的方式，是把它看成另一个 Coding Agent。它实际管理 Agent 周围的个人工作层，因此有些保证可以
由 Harnesssmith 机械实现，有些必须留给宿主，还有些只能由用户或外部可信系统决定。

## Harnesssmith 能保证什么

在其授权根和支持的平台模型内，仓库实现与测试覆盖以下性质：

- Adapter 按声明解析宿主路径与规则格式；
- 生命周期先预检，再 staging、备份和事务提交，失败时精确回滚；
- unmanaged 或 modified 目标默认不被静默覆盖；
- route 与 search 按预算发现文档，不要求整体加载手册；
- Memory 与 Task 写入经过路径、schema、锁和验收状态约束；
- Host Eval 记录绑定候选包并接受结构、一致性和覆盖检查。

这些是代码层保证，仍应按具体版本的实现和测试理解，而不是跨版本永久承诺。

## Coding Agent 宿主保证什么

模型循环、上下文压缩、工具/MCP 调度、sandbox、网络访问、权限提示、凭据管理、token/成本与事件真实性属于 Codex、
Cursor、Claude Code、OpenCode、Kimi Code CLI、DeepSeek Harness、Pi Agent 或 WorkBuddy。Harnesssmith 可以提供建议和接入点，但不能替宿主执行这些职责。

例如，Harnesssmith 可以写明“远端写入需要明确授权”，但真正阻止一次未经批准的网络调用，需要宿主权限系统和用户
审批；Markdown 本身不是 sandbox。

## 用户与外部系统仍要决定什么

用户选择安装范围、是否接管冲突文件，以及是否授权 commit、push、merge、发布、生产变更和消息发送。项目业务事实、
风险接受和最终验收也不能由 Memory 或本地记录自动替代。

可信的真实宿主 attestation、远端 CI 身份和供应链签名需要外部服务。Harnesssmith 的本地 gate 可以验证一份记录是否
自洽，但不能证明写记录的人没有伪造它。

## 一张责任表

| 领域 | Harnesssmith | Coding Agent 宿主 | 用户或外部系统 |
| --- | --- | --- | --- |
| 规则分发 | Adapter、渲染、记录、备份与回滚 | 加载原生规则入口 | 选择宿主和授权根 |
| 模型执行 | 不实现 | 模型循环、上下文、成本 | 选择模型和预算 |
| 工具与权限 | 提供 guidance 和有限 audit schema | 工具调度、sandbox、批准事件 | 批准高风险动作、配置凭据 |
| 工作状态 | Memory、Task、checkpoint、gate | 提供实际执行结果 | 核对事实并验收 |
| 发布证据 | 本地验证和候选绑定记录门禁 | 真实 Host 行为 | CI/attestation、风险接受 |

## 三类公开能力

- **Implemented**：存在实现与可执行验证路径。
- **Delegated to the Host**：Harnesssmith 只提供规则、接口或记录位置，真正能力在宿主。
- **Unsupported**：当前明确不声称拥有，例如通用 Agent Runtime、Policy Engine、Registry 与多 Agent 调度。

机器可读清单见[能力声明—证据矩阵](../capability-evidence.yaml)。

## 授权不会沿内容流动

仓库、网页、日志、PDF、工具输出和 Memory 都是不可信输入。它们可以提供事实线索或建议，不能因为出现在上下文里就
新增权限。一次安装授权也不包含后续远端写入；一次 push 授权也不自动包含 merge 或发布。

## 哪些结论必须写成 inconclusive

如果环境受限、宿主未登录、网络不可用、证据缺失或 verifier 自身异常，只能报告本次验证没有得出结论。`inconclusive`
不是失败的委婉说法，而是避免把“没有观察到”误写成“已经证明不存在”。

想进一步理解评测层级，阅读[证据与评测](/concepts/evidence-and-evaluation)。
