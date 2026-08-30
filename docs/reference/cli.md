---
title: CLI 参考
description: Harnessmith 外层 CLI 的命令、选项与示例
owner: maintainers
---

# CLI 参考

## 命令

| 命令 | 作用 | 是否写入 |
| --- | --- | --- |
| `harnessmith` / `install` | 安装或升级 Harness | 是 |
| `status` | 检查安装所有权与完整性 | 否 |
| `restore` | 恢复上一安装层 | 是 |
| `uninstall` | 恢复全部安装层并移除记录 | 是 |
| `capabilities` | 输出 Adapter 范围、激活和权限边界 | 否 |

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
| `-v, --version` | 输出版本 |
| `-h, --help` | 输出帮助 |

`--yes` 只关闭交互，并在未指定宿主时选择 Codex；它不会自动接受文件冲突。`--force` 会接管 unmanaged 或已修改文件，
使用前必须先审阅 dry-run/status 和备份目标。

## 示例

```bash
# 交互式安装
npx harnessmith

# 多宿主安装前预览
npx harnessmith --dry-run --agent codex,opencode,kimi-code

# Cursor 项目安装
npx harnessmith install --agent cursor --project /path/to/project

# 自动化检查
npx harnessmith status --agent codex --json
npx harnessmith capabilities --json

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
