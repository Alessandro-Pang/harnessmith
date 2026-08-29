---
title: 参考资料
description: 项目契约、技术选择与设计思想的可追溯来源
owner: maintainers
---

# 参考资料

本页区分“项目契约”与“设计参考”。外部资料用于解释取舍，不会覆盖仓库中的可执行事实。

## 项目契约

- [能力声明—证据矩阵](https://github.com/Alessandro-Pang/harnessmith/blob/main/docs/capability-evidence.yaml)：公开能力、owner、状态和证据路径。
- [Harness CLI 架构](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/harness-cli-architecture.md)：内嵌 Runtime 的命令与模块边界。
- [Manifest](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/manifest.json)：分发文件、版本与 schema 契约。
- [Security Policy](https://github.com/Alessandro-Pang/harnessmith/blob/main/SECURITY.md)：漏洞报告和支持边界。

## 文档与交付技术

- [VitePress deployment guide](https://vitepress.dev/guide/deploy)：静态构建和 GitHub Pages 工作流。
- [VitePress local search](https://vitepress.dev/reference/default-theme-search)：构建期本地全文索引与 MiniSearch 配置。
- [GitHub Pages documentation](https://docs.github.com/pages)：Pages 环境、权限与部署模型。

## 设计参考

- [Architecture Decision Records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)：用短记录保留决策背景与后果。
- [Semantic Versioning 2.0.0](https://semver.org/)：公开版本号语义。
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)：规范性关键词的解释方式。
- [The Twelve-Factor App: Dev/prod parity](https://12factor.net/dev-prod-parity)：缩小本地与自动化交付差异的思想参考。

引用外部思想时，应说明它是设计启发、实现依赖还是必须遵守的协议；不能只给出名称而不说明与当前决策的关系。
