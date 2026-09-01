---
title: CLI 参考
description: Harnessmith 外层 CLI 的命令、选项与示例
owner: maintainers
---

# CLI 参考

## 命令

| 命令 | 作用 | 是否写入 |
| --- | --- | --- |
| `setup` | 预览、确认、安装并验证首个 Harness | dry-run 否；确认后是 |
| `adopt` | 盘点并安全导入已有 Host 规则 | 默认否；确认精确提案后是 |
| `harnessmith` / `install` | 安装或升级 Harness | 是 |
| `status` | 检查安装所有权与完整性 | 否 |
| `restore` | 恢复上一安装层 | 是 |
| `uninstall` | 恢复全部安装层并移除记录 | 是 |
| `capabilities` | 输出 Adapter 范围、激活和权限边界 | 否 |
| `diagnostics` | 预览本地脱敏诊断报告 | 否 |

## 通用选项

| 选项 | 说明 |
| --- | --- |
| `-a, --agent <name>` | 目标宿主；可重复或使用逗号分隔 |
| `--project <path>` | Cursor 项目根，默认当前目录 |
| `--force` | 备份并替换 unmanaged 或已修改文件 |
| `--json` | 输出机器可读 JSON |
| `-y, --yes` | 禁用提示；未指定宿主时默认 Codex |
| `--dry-run` | 只预览目标，不执行写入 |
| `--no-init-global` | 跳过共享全局 Memory 初始化 |
| `--explain` | 仅用于 `status`；解释状态、证据、风险和安全下一步 |
| `--proposal <id>` | 仅用于 `adopt`；绑定先前只读扫描返回的精确提案 |
| `-v, --version` | 输出版本 |
| `-h, --help` | 输出帮助 |

`--yes` 只关闭交互，并在未指定宿主时选择 Codex；它不会自动接受文件冲突。`--force` 会接管 unmanaged 或已修改文件，
使用前必须先审阅 dry-run/status 和备份目标。

## 首次配置 `setup`

`setup` 将 Host 选择、目标根、Adapter 能力边界、文件状态、预期变更、不变项和恢复命令组织成一份共享计划。
`--dry-run`、交互确认和 `--json` 使用相同的计划结构；非交互实际写入必须显式提供 `--yes`。

```bash
npx harnessmith setup --agent codex --dry-run --json
npx harnessmith setup --agent codex
npx harnessmith setup --agent cursor --project /path/to/project --yes --json
```

计划将目标区分为 `missing`、`managed`、`unmanaged` 和 `modified`，并明确 `unsupported` 与 `host-dependent` 边界。
确认不会绕过安全策略：`unmanaged` / `modified` 默认拒绝，只有审阅所有权和备份行为后才能显式使用 `--force`。
安装事务失败会尝试回滚并给出 dry-run、status、restore 恢复顺序。

成功报告中的 `installed-and-healthy` 只表示安装所有权与内嵌 Runtime 的确定性检查通过；不代表真实 Host 中的模型行为、
工具权限、认证或运行时事件已经通过。

## 安全接管 `adopt`

`adopt` 默认只读扫描已有 Host 规则，将内容逐项分类为 managed-compatible、user-owned overlay、冲突规则、
Host-specific 配置或不可导入内容，并返回导入 diff、备份目标、owner、回滚路径与内容绑定的 `proposalId`。

```bash
# 第一步只读预览
npx harnessmith adopt --agent codex --json
npx harnessmith adopt --agent cursor --project /path/to/project --json

# 审阅后，以原样 proposalId 明确确认
npx harnessmith adopt --agent codex --proposal <proposalId> --yes --json
```

非交互写入必须同时提供 `--yes` 和精确 `--proposal`。文件在预览后发生变化时，提案失效并停止；secret、symlink、
未知格式、越界路径与已修改的受管文件 fail closed。确认后的接管复用安装事务的完整预检、operation lock、精确备份与
回滚，并只把可移植规则追加到用户所有的 personal overlay；Host frontmatter、受管理分发、可变 state 与项目
`.agent-docs` 不会混入 overlay。成功后再次运行只返回幂等的 `already-adopted`。

## 可解释状态 `status --explain`

```bash
npx harnessmith status --agent codex --explain
npx harnessmith status --agent codex --explain --json
```

解释输出使用稳定的 `observedState`、`reasonCode` 和 action `code`，逐项列出安装记录、受管理输出与备份证据。
本地状态可判定为 `managed`、`modified`、`unmanaged`、`partial` 或 `missing`；`unsupported` 表示没有 Adapter
契约并在路径解析前停止。Harness capability、Host configuration 和真实 Host behavior 分开报告，无法从本地证明的 Host
结论固定为 `inconclusive` / `host-dependent`，不会误报为 healthy。

建议动作只作为下一步展示，带有 `automatic: false`、`destructive: false` 和授权要求，不会由 `status` 自动执行。

## 脱敏诊断 `diagnostics`

```bash
npx harnessmith diagnostics --agent codex --json
```

报告只包含 allowlist 中的版本、Adapter capability、状态码、计数、SHA-256 摘要、采集预算、失败分类和复核命令。
原始 prompt、模型输出、tool arguments、文件正文、环境变量、secret、用户标识符和本地路径不能进入报告；未知字段由
schema 拒绝。命令只将报告预览到 stdout，不写文件也不上传，分享前由用户审阅。

每个子命令最多读取 256 KiB，最长运行 10 秒。超限、超时、无输出和无效 JSON 都保留为稳定失败分类；一个采集步骤
成功不会覆盖此前失败。未初始化的项目 Memory 和未执行的真实 Host 行为明确标为 `inconclusive`。

## 示例

```bash
# 交互式安装
npx harnessmith

# 首次配置引导
npx harnessmith setup --agent codex --dry-run
npx harnessmith setup --agent codex

# 多宿主安装前预览
npx harnessmith --dry-run --agent codex,opencode,kimi-code

# Cursor 项目安装
npx harnessmith install --agent cursor --project /path/to/project

# 自动化检查
npx harnessmith status --agent codex --json
npx harnessmith status --agent codex --explain --json
npx harnessmith adopt --agent codex --json
npx harnessmith capabilities --json
npx harnessmith diagnostics --agent codex --json

# 回退生命周期
npx harnessmith restore --agent codex
npx harnessmith uninstall --agent codex
```

## 自动化输出与退出码

非交互调用应显式指定 `--agent`，需要稳定协议时使用 `--json`。JSON 失败输出为单条 stderr 对象，包含 `version`、
`error.code`、`message` 与 `exitCode`。

| Exit code | 含义 |
| ---: | --- |
| 1 | 未分类内部错误 |
| 2 | CLI 用法错误 |
| 3 | 安全或完整性拒绝 |
| 4 | operation lock 冲突 |
| 5 | 没有可操作的安装状态 |

命令行参数是外层分发器契约。安装后内嵌的 Harness CLI 拥有独立命令面，负责文档路由、Memory、Task、仓库关系与审计；
完整用户命令见[运行时 CLI](/reference/runtime-cli)，设计边界见[Memory 与 Task](/concepts/memory-and-tasks)。
