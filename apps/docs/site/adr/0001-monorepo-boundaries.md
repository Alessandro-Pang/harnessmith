# ADR-0001：Monorepo 分层与发布边界

- 状态：accepted
- 日期：2026-09-03
- 关联：Issue #6

## 决策

仓库采用 pnpm workspace，工作区分为三个边界：

- `packages/cli`：公开的 `harnessmith` CLI，负责宿主 adapter、安装事务、备份恢复和发布入口。
- `packages/harness`：宿主中立的嵌入式 Harness CLI、schema、模板和运行时文档，保持私有并由 CLI 分发。
- `apps/docs`：独立构建的 VitePress 文档站，源码位于 `apps/docs/site`，不参与 npm 包运行时。

根目录保留兼容脚本和 npm 发布清单，作为迁移期间的稳定入口。依赖方向只能由 CLI 指向 Harness；Harness 不依赖宿主 adapter，文档站不被运行时代码导入。

## 构建与版本

根 `pnpm run build` 先构建 TypeScript，再生成两个运行时产物。`packages/harness/dist` 是嵌入分发产物，版本跟随根包版本；文档站使用自己的 workspace 脚本独立构建。模板、schema、文档路由的事实源分别属于 `packages/harness` 和 `apps/docs/site`，生成目录禁止手工编辑。

## 迁移兼容

安装、升级、恢复、卸载、Memory 和 Task 数据格式保持现有契约。每个阶段都必须通过 `pnpm run preflight`、覆盖率门禁和 `npm pack --dry-run`；若依赖未安装，验证结果标记为 inconclusive，不降低门槛。
