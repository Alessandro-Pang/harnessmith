---
title: ADR-0001：Monorepo 分层与发布边界
description: 为什么仓库分成 packages/cli、packages/harness 与 apps/docs 三个工作区边界
owner: maintainers
---

# ADR-0001：Monorepo 分层与发布边界

> 开发侧文档：面向仓库维护者与贡献者，不发布到文档站点。
> 用户视角的架构说明见站点「架构设计」页（`apps/docs/site/zh/concepts/architecture.md`）。

- 状态：accepted
- 日期：2026-09-03
- 关联：[Issue #6](https://github.com/Alessandro-Pang/harnessmith/issues/6)

## 背景

这个仓库里住着三类演进节奏完全不同的东西：外层安装器必须知道 Codex Home、Cursor 项目目录这些宿主细节；通用 Harness 必须宿主中立才能跨 Agent 复用；文档站点独立构建、不参与 npm 包运行时。如果不给它们划出明确的工作区边界，依赖方向会逐渐失控——Harness 慢慢吸附宿主细节，文档站被运行时代码导入，最后谁都不能独立演进。

## 决策

仓库采用 pnpm workspace，工作区分为三个边界：

- `packages/cli`：公开的 `harnessmith` CLI，负责宿主 adapter、安装事务、备份恢复和发布入口。
- `packages/harness`：宿主中立的嵌入式 Harness CLI、schema、模板和运行时文档，保持私有并由 CLI 分发。
- `apps/docs`：独立构建的 VitePress 文档站，源码位于 `apps/docs/site`，不参与 npm 包运行时。

根目录保留兼容脚本和 npm 发布清单，作为迁移期间的稳定入口。依赖方向只能由 CLI 指向 Harness；Harness 不依赖宿主 adapter，文档站不被运行时代码导入。方向固定后，任何「让 Harness 直接读宿主配置」的诱惑都会在 review 里被结构本身挡住。

## 构建与版本

根 `pnpm run build` 先构建 TypeScript，再生成两个运行时产物。`packages/harness/dist` 是嵌入分发产物，版本跟随根包版本；文档站使用自己的 workspace 脚本独立构建。模板、schema、文档路由的事实源分别属于 `packages/harness` 和 `apps/docs/site`，生成目录禁止手工编辑——改事实源再生成，而不是直接改产物。

## 迁移兼容

安装、升级、恢复、卸载、Memory 和 Task 数据格式保持现有契约。每个阶段都必须通过 `pnpm run preflight`、覆盖率门禁和 `npm pack --dry-run`；若依赖未安装，验证结果标记为 inconclusive，不降低门槛——验证不了就明说，而不是放行。

## 后果

这条边界带来的收益是 owner 清晰：三个工作区各自独立构建与测试，依赖方向单向，宿主中立性有了结构保证。代价是迁移期的兼容成本：npm 发布仍由根包承担，`packages/harness` 的产物路径和发布清单要保持兼容；只有在完成独立构建、测试、版本与回滚验证之后，工作区才可进一步拆分为独立发布包。
