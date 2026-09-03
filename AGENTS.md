# Harnessmith Contributor Guide

Harnessmith 是跨 Codex、Cursor、Claude Code、OpenCode、Kimi Code CLI 分发个人 Agent Harness 的 npm initializer。详细贡献
规范见 `CONTRIBUTING.md`；内置 Harness 架构见
`template/agent-harness/docs/core/harness-cli-architecture.md`。

## 不可破坏的边界

- `packages/cli/src/` 只负责宿主 Adapter、安装事务、备份、恢复与发布边界；通用 Harness 能力放在
  `packages/harness/src/`。
- `packages/harness/dist/` 和根 `dist/` 是构建产物，只修改 TypeScript 源码。
- 测试跟随所属代码放入就近的 `__tests__/`；不要在仓库根目录新建 `test/` 或 `tests/`。
- 受管理分发、可变 `state/`、共享个人规则 `~/.agent-harness/` 和非权威记忆 `.agent-docs/`
  必须保持分离。
- 新增宿主身份、路径或环境变量只能进入外层 Adapter；分发模板保持宿主中立。
- 文件接管默认拒绝 unmanaged/modified 目标；跨 Adapter 操作必须先完整预检并支持回滚。
- Task 的 `complete` 只能通过 acceptance gate；并发写入必须持有任务锁。

## 验证

- 定向 Harness 测试：`pnpm run test:harness`
- 完整预检：`pnpm run preflight`
- 覆盖率门禁：`pnpm run test:coverage`
- 发布清单：`npm pack --dry-run`

未经明确授权，不执行 commit、push、tag、npm publish 或远端写入。
