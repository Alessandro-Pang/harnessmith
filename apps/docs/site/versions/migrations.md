---
title: 版本与迁移
description: npm 版本、Runtime schema、升级和发布记录边界
owner: maintainers
---

# 版本与迁移

Harnessmith 有三个不同的版本维度，不能混为一个数字：

| 维度 | 事实源 | 含义 |
| --- | --- | --- |
| npm package | 根 `package.json` | 外层安装器与公开发行版本 |
| Harness Runtime | `template/agent-harness/manifest.json` | 内嵌工作状态能力版本 |
| schema | 各 schema 与 manifest | 持久化数据兼容契约 |

精确 npm 版本以根 `package.json`、npm registry 和
[GitHub Releases](https://github.com/Alessandro-Pang/harnessmith/releases)为准。发布说明直接维护在 GitHub Release 中，
不在长期文档里复制当前版本，也不维护会无限增长的仓库 Changelog 文件。

## 升级

重新运行 install 即可升级受管层：

```bash
npx harnessmith@latest --dry-run --agent codex
npx harnessmith@latest install --agent codex
npx harnessmith@latest status --agent codex
```

先用候选版本 dry-run，确认目标和接管状态，再执行安装。安装器会保留上一层备份；需要回退时运行 restore。

## 状态迁移

Runtime 读取旧 Task ledger 时执行确定性内存迁移，但不会用旧的宽松结论绕过当前 acceptance gate。仍活跃 Task 的旧
`passed` 会降为 `inconclusive`，需要重新机械验证。Memory metadata 迁移采用 proposal-first，必须显式应用，
不会自动覆盖原记录。

新增持久化 schema 时，必须记录：输入版本、输出版本、是否可逆、失败行为、备份位置、兼容窗口和验证命令。重大取舍
直接写入对应的架构或迁移文档，并说明背景、替代方案和兼容后果。
