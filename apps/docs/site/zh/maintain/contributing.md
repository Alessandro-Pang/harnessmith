---
title: 项目贡献
description: 给 Harnessmith 贡献代码的流程：环境、边界、验证与从 Issue 到发布
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
---

# 项目贡献

本页覆盖给 Harnessmith 项目贡献代码的完整流程。文档站点内容的修改、预览与发布规则见[文档贡献](/maintain/contributing-docs)。项目贡献规则以仓库根目录的 [`CONTRIBUTING.md`](https://github.com/Alessandro-Pang/harnessmith/blob/main/CONTRIBUTING.md) 为准，本页是便于上手的摘要；两者不一致时，以根目录文件为准。

## 环境与验证

要求：Node.js `24.12.0` 或更高版本、pnpm `10.13.0`、Git。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run format
pnpm run preflight
pnpm run test:coverage
npm pack --dry-run
```

- `format`：Biome 是共享的格式化器和 linter，源码改动后必须执行；
- `preflight`：仓库级完整门禁（类型、包与 CLI 契约、Harness 文档路由、全部测试），`pre-push` 钩子会完整执行一遍；
- `test:coverage`：覆盖率门禁，阈值是回归下限，只能保持或提高，不能降低；
- `npm pack --dry-run`：校验 npm 发布清单；仓库自身的依赖与脚本工作流一律使用 pnpm；
- `test:harness`：嵌入式 Runtime（`packages/harness/`）的定向测试。

每个行为变更都要新增或更新测试。安装类变更应视情况覆盖全新安装、冲突、升级、回滚、恢复和卸载路径；`template/` 下的改动必须保持宿主中立测试通过。端到端安装测试不能替代源码级的命令与库测试。

## 代码结构与硬边界

| 位置 | 职责 | 不可破坏的边界 |
| --- | --- | --- |
| `packages/cli/src/` | 宿主 Adapter、安装事务、备份、恢复与发布边界 | 宿主身份、路径和环境变量只能进入外层 Adapter |
| `packages/harness/src/` | 通用 Harness 能力（嵌入式 Runtime） | 源码是严格 TypeScript；改动需配套自身 `__tests__/` 下的定向测试 |
| `packages/harness/dist/`、根 `dist/` | 构建产物 | 只修改 TypeScript 源码再运行 `pnpm run build`，永远不要直接编辑产物 |
| `template/` | 随安装分发的可移植 Harness 核心 | 不得标识任何具体宿主产品 |
| 就近 `__tests__/` | 单元与集成测试 | 测试跟随所属代码，位于 `packages/cli/src/__tests__/`、`packages/harness/src/__tests__/` 或 `evals/__tests__/`；不要在仓库根目录新建 `test/` |

新增内置 Adapter 的步骤：在 `packages/cli/src/adapters/adapter-registry.ts` 注册宿主身份（规范名、标签、别名、能力），在 `packages/cli/src/adapters/adapters.ts` 添加穷举路径解析器，markdown/mdc 等指令渲染形状放在 `packages/cli/src/adapters/instruction-formats.ts`；然后运行 `pnpm run eval:schema:generate`，让 `evals/run.schema.json` 的 `host.adapter.enum` 从注册表重新生成。preflight 会运行 `eval:schema:check` 拒绝漂移，共享生命周期覆盖由 `packages/cli/src/__tests__/adapter-conformance.test.ts` 提供。不要添加动态插件加载器或 Pack Registry。

以下不变量不接受评审妥协：受管理分发、可变 `state/`、共享个人规则 `~/.agent-harness/` 和非权威记忆 `.agent-docs/` 必须彼此分离；文件接管默认拒绝 `unmanaged` / `modified` 目标，跨 Adapter 操作必须先完整预检并支持回滚；Task 的 `complete` 只能通过 acceptance gate，并发写入必须持有任务锁。稳定规则放在紧凑指令模板，详细工作流放在按需路由的文档；`.agent-docs` 是非权威记忆，永远不能成为项目事实或规则的唯一来源；个人 overlay 归用户所有，位于受管安装产物之外。

质量工具各司其职：Knip 拒绝不可达文件与导出；Secretlint 扫描源码、prompt 与文档面中的已知凭据格式；Markdownlint 检查仓库文档；`scripts/preflight/preflight.ts` 检查包与 CLI 契约、Harness 文档路由、frontmatter、相对链接、模板 token 与宿主中立性；Vitest 的 V8 gate 覆盖被导入的运行时与发布辅助模块，c8 合并 preflight 和 eval CLI 子进程的覆盖率。通用基础设施优先使用维护中的库，但 Harness 领域规则保持本地实现；仅被嵌入式 Runtime 使用的依赖放在 `devDependencies` 并打包进产物——Agent home 不允许二次安装依赖。

## 从 Issue 到发布

1. 先开一个聚焦的 Issue，写清问题、范围、验收标准与相关边界；
2. 分支命名 `<type>/<issue>-<slug>`，例如 `feat/12-indexed-doc-search` 或 `fix/15-clean-temp-files`；`gh issue develop 12 --checkout --name feat/12-indexed-doc-search` 一步创建并关联；
3. 使用 Conventional Commits，尽早开 Draft PR；PR 正文保留 `Closes #<issue>`，填完模板每一节，关闭的 Issue 编号与分支一致；
4. 按需打 `enhancement`、`bug` 或 `documentation` 标签；`skip-changelog` 只用于不应出现在生成发布说明中的变更；定向验证和完整验证都通过后移出 Draft；
5. `PR Contract`、`CI Required`、评审对话与验收标准全部通过后 squash 合并；关联 Issue 由 PR 关键词关闭；
6. 打 tag 的发布先验证 npm，再创建 GitHub Release；publish job 上传 registry clean-room 报告，把官方 metadata、完整性、provenance、下载字节与隔离 smoke 结果绑定到确切 tag。`CHANGELOG.md` 保持固定指针，不累积发布历史。

Commitlint 通过 Husky `commit-msg` 钩子强制 Conventional Commits；`pre-commit` 钩子检查暂存的代码与文档；`pre-push` 运行完整的 `pnpm run preflight`。preflight 接受长期分支、Dependabot 分支和上述 Issue 关联分支契约。
