---
title: 迁移指南
description: 升级 Harnessmith、Runtime 和 Memory 时的检查与恢复步骤
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
---

# 迁移指南

当前公开 npm 版本会随发布变化，不在长期文档里复制当前版本号；升级前请以 `npx --yes harnessmith --version` 和发布说明为准。

升级时要同时看三个版本：外层安装器、安装后的 Runtime，以及 Memory/Task 数据格式。它们可以独立变化；安装器升级成功，不代表旧 Memory 已迁移，也不代表真实 Host 已验证。

## 迁移前先留证

```bash
npx --yes harnessmith --version
npx --yes harnessmith status --agent codex --explain --json
npx --yes harnessmith version --json
npx --yes harnessmith memory check /path/to/project --indexed --json
```

保存上述 JSON 和当前 Git/工作区状态。先运行 `setup --dry-run --json`，确认目标文件是 `managed`、没有意外的 `modified` 或 `unmanaged`，再决定是否写入。

## 安装器迁移

推荐路径：

```bash
npx --yes harnessmith setup --agent codex --dry-run --json
npx --yes harnessmith setup --agent codex --yes --json
npx --yes harnessmith status --agent codex --explain --json
```

### 当前布局：单一全局 CLI，skill 交给 `skills`

发布后的全局 `harnessmith` 是唯一命令入口：安装器命令由外层执行，Runtime 子命令直接执行 npm 包根目录中同版本的 `dist/harness.mjs`，Runtime 不复制到 skill 或用户数据目录。外层 Adapter 只向宿主渲染普通的 always-on 指令文件（`AGENTS.md`，Claude Code 另加 `CLAUDE.md`，Cursor 另加 `.mdc` 规则），不是符号链接。skill 的安装与卸载完全交给固定版本的生产依赖 `skills@1.7.6`，规范副本与宿主链接由 `skills` 拥有。

用户数据默认在 `~/.harnessmith`（`HARNESS_HOME` 可覆盖）：`state/`、`rules/`（`HARNESS_PERSONAL_HOME`）、`memory/`（`HARNESS_MEMORY_HOME`）。Harnessmith 不创建、读取或删除 `~/.agents/harnessmith` 与旧的宿主内 Harness 副本。如果你仍把个人规则或 Memory 留在旧位置，可自行搬移，或用 `HARNESS_PERSONAL_HOME` / `HARNESS_MEMORY_HOME` 指向原位置。

### 破坏性安装记录变更

当前安装只读取 `schemaVersion: 3` 的单层普通文件记录。旧版 schema 1/2、hub 链接、整棵 Runtime 副本与多层安装链均不再支持：不会自动升级，不能用当前 `status` / `restore` / `uninstall` 管理，也不会为了接管它们删除旧文件。

已有用户必须先备份自己的规则和配置。若需要干净移除旧版，使用原先安装的 Harnessmith 版本执行其卸载命令；或者在辨认哪些内容是旧版 managed 产物后手工移走旧产物与记录，再执行当前 `setup --dry-run` 和 `setup`。不要用 `--force` 绕过未知记录或覆盖尚未确认归属的文件。

新安装的 `restore` 只恢复本次 record 指向的普通文件备份；`uninstall` 只恢复当前记录的备份并移除当前指令和记录，不再逐层回收历史 Runtime 或 Hub。用户数据、`state/` 与 Memory 都不删除。

Host 指令文件与 `skills` 管理的 skill 是两个事务。Host 写入失败会尝试回滚 Host 文件；Host 已提交但 skill 失败时，命令会明确报告部分完成，不能把它当作完整回滚或完整安装。若旧 Hub 内脚本或每宿主 Runtime 路径仍被硬编码，请改为全局 `harnessmith` 命令。

如果预览发现冲突，先停止并处理冲突；不要用 `--force` 掩盖未知内容。`restore` 只能处理当前记录，不能恢复未知记录或从未由 Harnessmith 接管的文件。

## Runtime 与 schema 迁移

Runtime 的 `version --json` 会报告 Harness、Task 和 Memory schema 版本。升级后先执行只读检查：

```bash
npx --yes harnessmith version --json
npx --yes harnessmith doctor
npx --yes harnessmith validate --project /absolute/project/path --json
npx --yes harnessmith memory check /absolute/project/path --indexed --json
```

未知 schema、缺少 owner 或引用断裂时，先保留原目录和输出，不要手工改 JSON。能自动处理的旧 metadata 通过 `memory migrate` 生成 proposal；只有 proposal 状态为 `ready`，并在重新核对目标未变化后，才显式应用：

```bash
npx --yes harnessmith memory migrate /absolute/project/path --json
npx --yes harnessmith memory migrate /absolute/project/path --proposal <proposal-id> --apply --yes --json
npx --yes harnessmith memory check /absolute/project/path --indexed --json
```

若当前版本没有对应迁移命令或 proposal 不是 `ready`，结果应记录为 `inconclusive`，保留原数据并提交维护者处理。

## Memory 与 Task 数据迁移

Memory 是待核对线索，不是事实数据库。迁移只改变 schema、索引或生命周期 metadata，不会把记忆自动提升为正式规则，也不会关闭 Task。

建议顺序：

1. 备份或复制 `.agent-docs/` 与共享 Memory；
2. `memory check --indexed` 确认当前基线；
3. 生成迁移 proposal，审阅影响路径、digest、过期时间和 recovery path；
4. 显式应用单个或有界 proposal；
5. 再次执行 `memory check --indexed`、`task status` 和相关 verifier；
6. 失败时保留原文件和 proposal，不重试不同目标。

`passed` 只能表示当前 verifier 通过；环境、宿主或外部 registry 无法确认时保持 `inconclusive`，不能为了完成迁移把它改成成功。

## 迁移后的验收

至少确认：

- `status --explain` 的当前记录、输出 checksum 与下一步建议符合预期；
- Runtime `doctor`、`health`、`validate` 和 Memory check 通过；
- Task acceptance 状态没有被迁移意外关闭；
- 需要真实 Host 的项目仍单独完成 Host Eval；
- 备份、proposal 和失败现场按生命周期规则保留或归档。

迁移成功只说明本地状态完成升级，不说明模型、工具权限、认证或宿主行为已经通过真实验证。
