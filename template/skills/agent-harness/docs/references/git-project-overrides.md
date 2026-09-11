---
title: Harnesssmith Git Project Overrides
type: harness-reference
status: active
updated: 2026-09-04
owner: git-conventions
---

# Harnesssmith Git Project Overrides

本文件只适用于 Harnesssmith 源码仓库；它不是跨仓默认规则。其他仓库必须以自身 `AGENTS.md`、贡献指南、
commitlint 配置、hook 和 CI 为准，不能复制下面的 branch regex 或数值。

## 当前仓库覆盖

新建分支匹配：

```text
^(feature|hotfix|refactor)/[0-9]{8}_[a-z0-9]+(?:-[a-z0-9]+)*$
```

含义是 `<kind>/YYYYMMDD_<kebab-case-goal>`；`kind` 取 `feature`、`hotfix` 或 `refactor`。
当前 `config/commitlint.config.mjs` 在共享 Conventional Commits 配置上增加：

- header 最大 100 个字符；
- scope 使用 `kebab-case`；
- subject 不得为空。

## 验收

提交前读取解析后的配置（本仓可用 `pnpm exec commitlint --config config/commitlint.config.mjs --print-config json`）并运行仓库现有
commitlint；branch regex 只用于新建分支的预检。校验消息通过不代表已获得 commit、push、merge、rebase、发布或删除分支的授权。
