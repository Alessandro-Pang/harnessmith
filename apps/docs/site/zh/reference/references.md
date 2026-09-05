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

- [Harnesssmith capability evidence](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml)：能力 owner、状态和可执行证据路径。
- [VitePress deployment guide](https://vitepress.dev/guide/deploy)：静态构建与部署方式。
- [VitePress local search](https://vitepress.dev/reference/default-theme-search)：构建期搜索索引和边界。
- [GitHub Pages documentation](https://docs.github.com/pages)：站点发布和权限模型。
- [Test harness（Wikipedia）](https://en.wikipedia.org/wiki/Test_harness)：测试 harness 的通用术语背景。
- [LLM Harness](https://picrew.github.io/LLM-Harness/)：相关领域的公开讨论，用于历史和术语对照。
- [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：评测 harness 的公开实现，用于比较评测任务与证据边界。

## 核对顺序

需要回答具体行为时，按下面顺序查找：

1. 当前命令的 `--help` 和源码注册；
2. schema、Adapter 定义和配置；
3. 相关单元测试、preflight 和 capability evidence；
4. 本站指南与参考页；
5. 外部资料和历史记录。

这个顺序让外部资料提供背景，而不是意外成为未经验证的产品承诺。
