---
title: 安全生命周期
description: 安装、升级、迁移、恢复、卸载与故障处理的完整事务语义
owner: maintainers
---

# 安全生命周期

这一页回答的问题是：Harnessmith 动我的文件时，凭什么值得信任。答案是：它把每次写入都当作一笔可审计的本地事务。先解析并预检全部目标，再 staging、备份、提交；失败时只回滚本次记录的精确路径，不碰其他任何东西。读完这一页，你可以放心执行安装、升级、迁移、恢复和卸载中的任何一个动作，并知道每个动作的安全边界在哪。

## 安装与升级

```bash
npx harnessmith install --agent codex
```

`install` 是安装或升级的直接命令，裸命令 `npx harnessmith` 默认执行的就是它。第一次接触某个宿主时更推荐用 `setup`：它按「预览 → 确认 → 安装 → 自动健康检查」的引导流程走，每一步都有人工确认的机会。两个命令的完整选项见 [安装器 CLI](/reference/cli)。

升级就是再跑一次 install。目标不存在，或仍与上一层安装记录一致时，可以安全接管；升级会保留可变 `state/`，不会把你的运行记录和受管理模板混在一起重置。

### 遇到 unmanaged 或已修改的文件

目标已存在但不归 Harnessmith 管（`unmanaged`），或受管后被改过（`modified`）时，默认拒绝写入。`--force` 会先备份再替换，但应在理解差异后显式使用。

如果你的 AGENTS.md 里已经沉淀了自己的规则，不要直接覆盖。先运行 `adopt`，拿到只读 inventory 和内容绑定提案，审阅导入 diff、备份与回滚路径后，再确认同一个 `proposalId`：

```bash
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json
```

`adopt` 只导入可移植的规则正文；宿主专属配置留在原文件备份里，不会丢失。扫描或确认阶段发现 secret、symlink、未知格式、路径越界、受管文件被修改，或提案之后内容又变了，流程都会停下来等你处理。实际的写入与安装共享同一套预检、锁、备份和事务回滚。

## 配置迁移

换机器或换目录时，用 `export` / `import` 迁移个人配置。它们只迁移 user-owned personal overlay——也就是你自己维护的那一层；不复制受管 Runtime、`state/`、Memory、credential、cache 或 workspace 内容。受管部分本来就该由新机器上的安装重新生成，个人部分才需要搬家。

export 可以先在 stdout 预览要搬什么，确认后再用 `--output` 写入新文件；import 首次运行只返回冲突 plan 和内容绑定的 `proposalId`，审阅之后才以 `--proposal <id> --yes` 提交——和 adopt 一样，先看清单再动手。

一个硬边界：目标已有不同内容时，import 固定拒绝。它不能成为静默跨 root 合并或覆盖的入口。写入期间持有 personal root lock，失败按写前快照回滚；未知版本、篡改 digest、越界路径和 symlink bundle 都会在写入前被拦下。

## 只读预览与状态

```bash
npx harnessmith --dry-run --agent codex
npx harnessmith status --agent codex --json
```

`--dry-run` 展示目标但不写入；`status` 检查所有权与完整性。受限环境里的失败只能说明本次检查 `inconclusive`，不能自动推出「安装损坏」——区分这两者，可以省掉很多误判。

## 恢复与卸载

```bash
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

`restore` 回到前一安装层；`uninstall` 恢复全部受管层并移除 Harnessmith 安装记录。两者都会先验证当前文件、备份关系和路径边界，不会重新渲染模板，也不会删除共享或项目里的 `.agent-docs`、你维护的 personal overlay。换句话说：卸载清掉的是 Harnessmith 装进去的东西，你自己的东西还在。

## 临时资源

staging、payload、release 和 eval 过程中会产生临时资源，应由创建者在成功与失败路径上各自清理。诊断有没有残留，可以跑：

```bash
pnpm run temp:scan
```

资源 owner、保留条件与安全删除边界见[临时资源生命周期](/reference/temporary-resources)。

## 常见故障

- **目标已存在且 unmanaged**：先看 dry-run / status 输出，确认来源后再决定是否走 `adopt` 或 `--force`。
- **检测到 symlink 或路径越界**：修正目标根或目录结构，不要绕过 fail-closed 检查。它们拦住的正是真正的风险。
- **Node 版本不满足**：升级到 Node.js 24.12.0 或更高版本。
- **多宿主操作中途失败**：Harnessmith 会按已提交的步骤回滚；再跑一次 `status`，逐个 Adapter 核对现场。
