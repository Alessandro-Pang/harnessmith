---
title: 参考资料
description: 按证据等级整理项目契约、协议、工程实践与研究资料
owner: maintainers
---

# 参考资料

外部资料用于解释设计背景，不覆盖仓库中的可执行事实。本页优先链接一手来源，并说明每项资料与 Harnesssmith 的关系。
链接状态核对日期：2026-08-29。

## 当前项目契约

这一组直接定义 Harnesssmith 当前做什么：

- [能力声明—证据矩阵](https://github.com/Alessandro-Pang/harnessmith/blob/main/docs/capability-evidence.yaml)：
  公开能力的 owner、implemented/delegated/unsupported 状态与证据路径。
- [Harness CLI 架构](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/harness-cli-architecture.md)：
  内嵌 Runtime 的命令、数据边界和模块 owner。
- [Manifest](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/manifest.json)：
  Runtime、schema 和分发文件契约。
- [Security Policy](https://github.com/Alessandro-Pang/harnessmith/blob/main/SECURITY.md)：
  漏洞报告与支持范围。

如果本页其余资料与这些契约冲突，以当前代码、测试、schema、manifest 和已接受 ADR 为准。

## Agent 规则与渐进上下文

- [AGENTS.md](https://agents.md/)：跨 Coding Agent 的开放规则入口。Harnesssmith 使用它作为主要人机分离入口，但额外
  增加文档路由和安全安装生命周期。
- [Codex 的 AGENTS.md 发现规则](https://developers.openai.com/codex/guides/agents-md/)：说明 Codex 如何发现全局和项目
  指令；Harnesssmith 的 Codex Adapter 必须尊重宿主契约。
- [Agent Skills specification](https://agentskills.io/specification)：技能目录、metadata 和渐进披露规范。它为
  Harnesssmith 的“先发现、后读取”提供生态参照，但项目 playbook 不是该规范的替代实现。
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)：强调让仓库知识对 Agent 可读，以及用机械
  约束执行架构边界。它支持 guidance 与 enforcement 分离的设计理由。

## 长任务、状态与交接

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)：
  讨论跨上下文增量工作、初始化与交接 artifact；对应 Harnesssmith 的 Task、checkpoint 和 acceptance 思路。
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)：
  进一步讨论任务分解、结构化交接和 evaluator，但其多 Agent 结构不代表 Harnesssmith 已实现编排。
- [OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)：把 issue tracker 与任务 runner
  视为持久控制面。它是完整 orchestration 的参考，不是 Harnesssmith 当前能力声明。

## 工具协议与安全

- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/)：工具与资源互操作协议。
  Harnesssmith 不实现 MCP；宿主负责调度和认证。
- [MCP security best practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)：
  token passthrough、会话、权限与本地服务风险。它说明“能连接工具”与“能安全授权”是两个问题。
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)：
  提供 goal hijack、tool misuse、memory poisoning、cascading failures 等威胁语言，用于审视边界，不表示项目已经覆盖
  全部类别。
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)：
  自愿、非特定行业的风险管理框架。Harnesssmith 借鉴持续治理、测量与管理的思路，不声称合规认证。
- [SLSA specification](https://slsa.dev/spec/v1.1/)：软件供应链来源与构建完整性框架，用于理解候选 artifact、CI 和
  attestation 的信任差异。

## 评测与可观测

- [OpenAI Evals](https://github.com/openai/evals)：可执行评测与回归思路。
- [SWE-bench](https://www.swebench.com/)：真实仓库 issue 任务与 verifier 驱动评测的代表性基准。
- [OpenTelemetry](https://opentelemetry.io/docs/specs/otel/)：trace、metric 和 log 的开放可观测规范。Harnessmith 的
  audit 只借鉴结构化元数据思想，并不是完整 OTel collector。

## 研究地图与历史资料

- [Agent Harness Engineering: A Survey（2026）](https://picrew.github.io/LLM-Harness/)：覆盖 170 多个开源项目，并提出
  ETCLOVG 七层分类。按当前资料状态尚未经过双盲评审，且作者声明语料和分类边界存在限制；本站将其作为研究地图，
  不作为规范。
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)：长上下文中的信息位置影响，为渐进披露提供研究背景。

项目如何从手工维护 `AGENTS.md` 与跨项目搜索实践演变而来，见[历史与思想来源](/project/history-and-influences)。

## 文档站点与交付

- [VitePress deployment guide](https://vitepress.dev/guide/deploy)：静态构建与 GitHub Pages 工作流。
- [VitePress local search](https://vitepress.dev/reference/default-theme-search)：构建期本地索引。当前站点使用该能力，
  不需要外部搜索服务。
- [GitHub Pages](https://docs.github.com/pages)：Pages 权限与部署模型。

新增引用时，请同时写明它是当前契约、必须遵守的协议、实现依赖、历史输入还是设计启发；只列名字不能形成可追溯依据。
