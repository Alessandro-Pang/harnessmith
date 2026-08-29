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

命令行参数是外层分发器契约。安装后内嵌的 Harness CLI 拥有独立命令面，负责 Memory、Task、文档路由与审计；
参见 [Memory 与 Task](/concepts/memory-and-tasks)及仓库中的
[Harness CLI 架构](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/harness-cli-architecture.md)。
