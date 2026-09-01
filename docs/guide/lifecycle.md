---
title: 安全生命周期
description: 安装、状态检查、恢复、卸载与故障处理
owner: maintainers
---

# 安全生命周期

Harnessmith 把每次写入视为可审计的本地事务：先解析并预检全部目标，再 staging、备份和提交；失败时只回滚
本次记录的精确路径。

## 安装与升级

```bash
npx harnessmith install --agent codex
```

目标不存在或仍与上一层安装记录一致时可安全接管。遇到 unmanaged 或已修改文件默认拒绝；`--force` 会先备份再替换，
应在理解差异后显式使用。

已有规则不应直接用 `--force` 覆盖。先运行 `adopt` 获取只读 inventory 和内容绑定提案，审阅导入 diff、备份与回滚路径后，
再确认同一个 `proposalId`：

```bash
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json
```

`adopt` 只导入可移植规则正文；Host-specific 配置只保留在原文件备份中。扫描或确认阶段发现 secret、symlink、未知格式、
路径越界、受管文件被修改，或提案后内容发生变化时都会停止。实际写入与安装共享预检、锁、备份和事务回滚。

## 只读预览与状态

```bash
npx harnessmith --dry-run --agent codex
npx harnessmith status --agent codex --json
```

`--dry-run` 展示目标但不写入。`status` 检查所有权与完整性；受限环境中的失败只能说明本次检查
`inconclusive`，不能自动推出安装损坏。

## 恢复与卸载

```bash
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

`restore` 回到前一安装层；`uninstall` 恢复全部受管层并移除 Harnessmith 安装记录。两者都会先验证当前文件、
备份关系和路径边界，不会重新渲染模板，也不会删除共享/项目 `.agent-docs` 或用户维护的 personal overlay。升级同样保留
可变 `state/`，避免把运行记录与受管理模板混为一体。

## 临时资源

staging、payload、release 和 eval 产生的临时资源应由创建者在成功与失败路径清理。诊断残留可运行：

```bash
pnpm run temp:scan
```

资源 owner、保留条件与安全删除边界见[临时资源生命周期](/temporary-resources)。

## 常见故障

- 目标已存在且 unmanaged：先查看 dry-run/status，确认后再决定是否 `--force`。
- 检测到 symlink 或路径越界：修正目标根或目录结构；不要绕过 fail-closed 检查。
- Node 版本不满足：升级到 Node.js 24.12.0 或更高版本。
- 多宿主操作中途失败：Harnesssmith 会按已提交步骤回滚；再次运行 status 核对每个 Adapter。
