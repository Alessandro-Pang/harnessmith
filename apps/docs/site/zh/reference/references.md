---
title: 参考资料
description: Harnessmith 设计、实现和验证所依据的公开资料
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
---

# 参考资料

本页列出设计背景和外部术语来源。它们用于解释概念，不覆盖仓库中的可执行事实；若资料与代码、schema、测试、manifest 或 [能力证据矩阵](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml)冲突，以当前仓库为准。

## 资料如何使用

| 类别 | 用途 | 不能证明什么 |
| --- | --- | --- |
| 当前实现 | 判断命令、字段、默认值和拒绝条件 | 不能自动解释用户该怎样使用 |
| 测试与 CI | 判断可重复的回归和门禁 | 不能证明真实 Host 永远一致 |
| 设计/架构资料 | 理解背景、术语和取舍 | 不能替代当前实现契约 |
| 历史资料 | 追踪问题如何演进 | 不能当作当前支持列表 |

新增引用时，请标注它属于实现依赖、强制协议、历史输入还是设计启发，并给出直接链接和访问日期。无法访问的外部链接记录为 `inconclusive`，不要把标题或搜索摘要当作事实。

## 公开资料

### 当前项目契约

- [能力证据矩阵](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml)：能力 owner、状态和可执行证据路径。
- [Harness CLI 架构](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/harness-cli-architecture.md)：Runtime 命令、数据边界和模块 owner。
- [Manifest](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/manifest.json)：Runtime、schema 和分发文件契约。
- [Security Policy](https://github.com/Alessandro-Pang/harnessmith/blob/main/SECURITY.md)：漏洞报告与支持范围。

### Agent 规则与渐进上下文

- [AGENTS.md](https://agents.md/)：跨 Coding Agent 的规则入口；Harnesssmith 另外提供文档路由和安全安装生命周期。
- [Codex 的 AGENTS.md 发现规则](https://developers.openai.com/codex/guides/agents-md/)：Codex 的全局和项目指令发现契约。
- [Agent Skills specification](https://agentskills.io/specification)：技能目录、metadata 和渐进披露规范。
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)：让仓库知识可读，并用机械约束执行架构边界。

### 长任务、状态与交接

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)：跨上下文工作、初始化与交接 artifact。
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)：任务分解、结构化交接和 evaluator。
- [OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)：issue tracker 与任务 runner 的持久控制面参照。

### 工具协议与安全

- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/)：工具与资源互操作协议；Harnesssmith 不实现 MCP。
- [MCP security best practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)：token passthrough、会话、权限与本地服务风险。
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)：goal hijack、tool misuse、memory poisoning 等威胁语言。
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)：持续治理、测量与管理的风险框架参照。
- [SLSA specification](https://slsa.dev/spec/v1.1/)：候选 artifact、CI 和 attestation 的供应链完整性参照。

### 评测、可观测与研究

- [Test harness（Wikipedia）](https://en.wikipedia.org/wiki/Test_harness)：测试 harness 的通用术语背景。
- [EleutherAI lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：评测任务、模型适配与可重复证据的公开实现。
- [OpenAI Evals](https://github.com/openai/evals)：可执行评测与回归思路。
- [SWE-bench](https://www.swebench.com/)：真实仓库任务与 verifier 驱动评测的代表性基准。
- [OpenTelemetry](https://opentelemetry.io/docs/specs/otel/)：trace、metric 和 log 的开放可观测规范。
- [Agent Harness Engineering: A Survey（2026）](https://picrew.github.io/LLM-Harness/)：相关开源项目和分类的研究地图，不作为规范。
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)：长上下文中的信息位置效应，为渐进披露提供研究背景。

### 文档站点与交付

- [VitePress deployment guide](https://vitepress.dev/guide/deploy)：静态构建与部署方式。
- [VitePress local search](https://vitepress.dev/reference/default-theme-search)：构建期搜索索引和边界。
- [GitHub Pages documentation](https://docs.github.com/pages)：站点发布和权限模型。

## 核对顺序

需要回答具体行为时，按下面顺序查找：

1. 当前命令的 `--help` 和源码注册；
2. schema、Adapter 定义和配置；
3. 相关单元测试、preflight 和 capability evidence；
4. 本站指南与参考页；
5. 外部资料和历史记录。

这个顺序让外部资料提供背景，而不是意外成为未经验证的产品承诺。
