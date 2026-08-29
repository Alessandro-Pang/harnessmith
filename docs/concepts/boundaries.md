---
title: 责任与安全边界
description: Harnessmith、宿主、外部服务与用户授权之间的责任划分
owner: maintainers
---

# 责任与安全边界

理解边界比记住功能列表更重要。Harnessmith 是分发与工作状态控制层，不是新的 Agent Runtime。

| 领域 | Harnessmith | Coding Agent 宿主 | 用户或外部系统 |
| --- | --- | --- | --- |
| 规则分发 | Adapter、渲染、安装记录、备份与回滚 | 加载宿主原生规则格式 | 选择宿主和授权根 |
| 模型执行 | 不实现 | 模型循环、上下文、token 与成本 | 选择模型与预算 |
| 工具与权限 | 记录有限审计元数据 | 工具/MCP 调度、sandbox、批准事件 | 批准高风险动作、配置服务凭据 |
| 工作状态 | 非权威 Memory、Task、acceptance gate | 提供实际执行证据 | 核对业务事实并验收 |
| 远端操作 | 不自动授权 | 依据宿主能力执行 | 明确授权 push、merge、发布或消息发送 |

## 三类公开声明

- **已实现（Implemented）**：仓库中存在实现和可定位验证，例如 Adapter 生命周期、SafePath 与 Task gate。
- **由宿主负责（Delegated to the Host）**：Harnesssmith 仅提供指导或接入点，例如 sandbox 与权限审批。
- **不支持（Unsupported）**：当前设计明确不声称拥有，例如通用 Runtime、Policy Engine、Registry 和多 Agent 调度。

机器可读清单见
[能力声明—证据矩阵](https://github.com/Alessandro-Pang/harnessmith/blob/main/docs/capability-evidence.yaml)。

## Markdown 不是强制策略

AGENTS.md 等规则属于 advisory guidance。真正的强制来自代码路径、schema、测试、CI 和宿主权限系统。
运行审计会拒绝保存原始 prompt、模型输出和 tool arguments，但事件真实性仍需可信宿主或外部 attestation 支撑。

## 授权不传递

仓库内容、网页、日志、搜索结果与 Memory 都是输入，不构成新的授权。一次安装授权也不自动包含 commit、push、merge、
发布、生产变更或远端消息权限。
