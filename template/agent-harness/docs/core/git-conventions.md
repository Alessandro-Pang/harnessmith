---
title: Git Conventions
type: harness-core
status: active
updated: 2026-08-17
sources:
  - https://commitlint.js.org/llms-full.txt
  - https://www.conventionalcommits.org/en/v1.0.0/
---

# Git Conventions

本文件定义个人仓库的跨语言 Git 默认契约。仓库内更具体的 `AGENTS.md`、贡献指南、受保护分支
规则、Git hook 或 CI 配置优先；发现冲突时先报告，不通过绕过校验来制造提交。

## 分支命名

新建分支必须匹配：

```text
^(feature|hotfix|refactor)/[0-9]{8}_[a-z0-9]+(?:-[a-z0-9]+)*$
```

结构为 `(feature|hotfix|refactor)/YYYYMMDD_<feature-name>`：

- `feature`：新能力或可感知的功能扩展；
- `hotfix`：需要快速修复的缺陷；
- `refactor`：不改变外部行为的结构调整；正确拼写是 `refactor`，不是 `refatcor`；
- `YYYYMMDD`：创建分支时的本地日期；
- `feature-name`：小写 ASCII kebab-case，表达一个清晰目标，不含空格、下划线或额外 `/`。

示例：

```text
feature/20260817_agent-memory-index
hotfix/20260817_token-refresh-race
refactor/20260817_repository-layer
```

该契约约束新建分支。遇到历史分支、用户已在工作的分支或远端共享分支，只报告不合规；除非
用户明确授权，不自动重命名、切换、发布或删除分支。若项目需要 `release`、`docs`、工单号等
额外模式，应在项目规则中明确扩展或覆盖。

## 提交信息

默认采用 Conventional Commits，并以 `@commitlint/config-conventional` 的常见规则作为兼容目标：

```text
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

默认 `type`：

```text
build chore ci apps/docs/site feat fix perf refactor revert style test
```

- `type` 必填并小写；有明确模块边界时可加小写 `scope`，不要为了形式臆造 scope。
- `description` 必填，简洁说明单一意图，不以句号结尾；语言服从项目约定，未约定时与仓库近期
  提交保持一致。
- 一个提交只承载一个可解释的逻辑变更。正文说明动机、取舍或非显然影响，不复述 diff。
- 不兼容变更用 `!`，并在 footer 写 `BREAKING CHANGE: <description>`；issue、review 或协作者
  元信息放 footer。
- merge、revert、自动生成和平台合并提交可服从 Git/托管平台或项目已有格式。

示例：

```text
feat(auth): add device authorization flow
fix(api): handle expired refresh tokens
refactor(storage)!: replace legacy repository interface
docs: document local memory lifecycle
```

## Agent 执行顺序

当用户明确授权创建提交时：

1. 读取项目 `AGENTS.md`、贡献指南、近期提交风格，以及 commitlint、hook、CI 等已有规则。
2. 若仓库已有 commitlint，读取其解析后配置（如 `commitlint --print-config json`）并用项目现有
   包管理器校验候选消息；项目配置高于本文件的默认 type、scope、大小写和长度约束。
3. 若没有 commitlint，按本文件人工检查结构；不要仅为一次提交安装 Node、commitlint、Husky
   或修改 manifest/lockfile。
4. hook 拒绝时按错误中的规则名修正并重试；不得使用 `git commit --no-verify`。
5. commit 后只在必要时检查最终消息；push、merge、rebase 和发布仍需单独明确授权。

## 是否引入校验工具

规范是语言无关的提交文本契约，校验器是项目级实现选择：

- JavaScript/TypeScript 仓库已经使用 Node 工具链时，可采用 commitlint + `commit-msg` hook，
  并在 CI 校验 PR 的完整 commit range。
- Go、Python 或混合语言仓库不要为了本规范默认引入 Node。优先复用现有 hook 框架、CI、
  pre-commit、Make/Task 脚本或轻量脚本；团队确需与 commitlint 完全一致时，再评估集中式 CI
  或固定版本的 commitlint 容器。
- 个人全局 Git hook 不作为仓库合规的唯一保障：它不可随仓库版本化，容易与项目 hook 冲突，
  也不能约束其他贡献者。真正需要强制执行时，应由仓库内配置和 CI 提供可复现门禁。
- 引入任何工具前，先确认团队接受、运行时成本、版本锁定、提交范围算法与紧急修复流程；工具
  变更应作为独立项目决策，而不是 Agent 的隐式副作用。

commitlint 官方 Agent 指南强调：已安装时读取解析后的配置、提交前校验候选消息、hook 失败后
按具体规则修正；它不意味着每个仓库都必须安装 commitlint。
