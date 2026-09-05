---
title: 迁移指南
description: 升级 Harnessmith、Runtime 和 Memory 时的检查与恢复步骤
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
---

# 迁移指南

当前公开 npm 版本会随发布变化，不在长期文档里复制当前版本号；升级前请以 `npx harnessmith --version` 和发布说明为准。

升级时要同时看三个版本：外层安装器、安装后的 Runtime，以及 Memory/Task 数据格式。它们可以独立变化；安装器升级成功，不代表旧 Memory 已迁移，也不代表真实 Host 已验证。

## 迁移前先留证

```bash
npx harnessmith --version
npx harnessmith status --agent codex --explain --json
node <harness-path>/bin/harness.mjs version --json
node <harness-path>/bin/harness.mjs memory check /path/to/project --indexed --json
```

保存上述 JSON 和当前 Git/工作区状态。先运行 `setup --dry-run --json`，确认目标文件是 `managed`、没有意外的 `modified` 或 `unmanaged`，再决定是否写入。

## 安装器迁移

推荐路径：

```bash
npx harnessmith setup --agent codex --dry-run --json
npx harnessmith setup --agent codex --yes --json
npx harnessmith status --agent codex --explain --json
```

如果预览发现冲突，先停止并处理冲突；不要用 `--force` 掩盖未知内容。写入失败时按下面顺序恢复：

```bash
npx harnessmith status --agent codex --explain
npx harnessmith restore --agent codex
npx harnessmith status --agent codex --explain
```

只有明确知道将被覆盖的文件、备份位置和回滚方式时，才使用 `--force`。`restore` 只能恢复已有安装记录，不能恢复从未由 Harnessmith 接管的文件。

## Runtime 与 schema 迁移

Runtime 的 `version --json` 会报告 Harness、Task 和 Memory schema 版本。升级后先执行只读检查：

```bash
node <harness-path>/bin/harness.mjs version --json
node <harness-path>/bin/harness.mjs doctor
node <harness-path>/bin/harness.mjs validate --project /absolute/project/path --json
node <harness-path>/bin/harness.mjs memory check /absolute/project/path --indexed --json
```

未知 schema、缺少 owner 或引用断裂时，先保留原目录和输出，不要手工改 JSON。能自动处理的旧 metadata 通过 `memory migrate` 生成 proposal；只有 proposal 状态为 `ready`，并在重新核对目标未变化后，才显式应用：

```bash
node <harness-path>/bin/harness.mjs memory migrate /absolute/project/path --json
node <harness-path>/bin/harness.mjs memory migrate /absolute/project/path --proposal <proposal-id> --apply --yes --json
node <harness-path>/bin/harness.mjs memory check /absolute/project/path --indexed --json
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

- `status --explain` 的 content fingerprint 与预期一致；
- Runtime `doctor`、`health`、`validate` 和 Memory check 通过；
- Task acceptance 状态没有被迁移意外关闭；
- 需要真实 Host 的项目仍单独完成 Host Eval；
- 备份、proposal 和失败现场按生命周期规则保留或归档。

迁移成功只说明本地状态完成升级，不说明模型、工具权限、认证或宿主行为已经通过真实验证。
