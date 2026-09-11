---
title: Git Conventions
type: harness-core
status: active
updated: 2026-09-04
owner: git-conventions
sources:
  - https://commitlint.js.org/llms-full.txt
  - https://www.conventionalcommits.org/en/v1.0.0/
---

# Git Conventions

本文件是跨语言默认契约：使用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
表达提交意图，并以项目现有规则为最终约束。它只规范用户已明确授权的 Git 动作；不授权 commit、push、
merge、rebase、发布或删除分支。

## 分支

分支名不是跨仓默认：创建或重命名前读取目标项目规则（`AGENTS.md`、贡献指南和 CI）。历史分支、用户
正在使用的分支和远端共享分支只报告问题，不自动重命名、切换或删除。Harnesssmith 本仓的精确覆盖只在明确处理本仓时
加载 [project Git overrides](../references/git-project-overrides.md)，不得外推。

## 提交

最小格式：

```text
<type>[optional scope][!]: <description>
```

Conventional Commits 规定提交结构和语义，不保证目标项目接受某个完整的 `type` 枚举；type、scope、长度和字符集必须从目标项目配置核对。模块名是可能的 `scope`，不是默认 `type`；只有项目配置明确允许时才新增类型。

必须满足：

- `type` 小写且有效，`description` 非空、表达一个逻辑意图、默认不以句号结束；
- scope 只在确有模块边界时使用，并服从项目的大小写/字符集约束；
- breaking change 使用 `!`，并在 footer 说明 `BREAKING CHANGE:`；普通动机、issue 和 review 信息放 body/footer；
- merge、revert、自动生成和平台合并提交可遵循项目或托管平台的专用格式。

```text
feat(auth): add device authorization flow
fix(api): handle expired refresh tokens
docs(site): clarify local memory lifecycle
```

以下不是默认合规提交：`feat:`, `feature: add thing.`, `Docs(API): ...`（除非项目规则明确覆盖）。

## 项目覆盖与验收

跨仓默认只约束提交意图的 Conventional Commits 结构；分支名、type 集合、scope 字符集和长度都由目标项目覆盖。
提交前先读取项目 `AGENTS.md`、贡献指南、近期提交和 hook/CI；若存在 commitlint，读取并解析其配置，使用其**解析后的配置**
校验候选消息，项目配置优先于本文件。解析配置中的 header 最大长度、scope、type 枚举等字段必须逐项服从；不要把某个仓库
的覆盖值外推到别的仓库。

有可用的现有校验器就运行它；没有则按上面的最小格式人工检查，不为一次提交引入新工具或修改 lockfile。
hook 失败按具体规则修正，不使用 `git commit --no-verify`。校验通过只证明提交消息合规，不代表获得任何远端
操作授权。
