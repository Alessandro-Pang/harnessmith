---
title: 迁移指南
description: npm 版本、Runtime schema、升级和发布记录边界
owner: maintainers
---

# 迁移指南

Harnessmith 有三个不同的版本维度，不能混为一个数字——混在一起，你将无法判断一次升级到底改变了什么。三个维度分别回答三个问题：发行了什么、运行时能力变了什么、本地数据还能不能读。

| 维度 | 事实源 | 含义 | 典型变化 |
| --- | --- | --- | --- |
| npm package | 根 `package.json` | 外层安装器与公开发行版本 | 新增 Adapter、CLI 选项变更、安装事务优化 |
| Harness Runtime | `template/agent-harness/manifest.json` | 内嵌工作状态能力版本 | 新增 route 规则、Memory schema 扩展、Task 命令变更 |
| schema | 各 schema 与 manifest | 持久化数据兼容契约 | 字段新增/废弃、数据格式变更、迁移规则 |

举个例子：`npm package` 从 0.9.0 升到 0.10.0，可能意味着新增了某个 Adapter 支持或修复了安装器的一个 bug——但你的 Task 数据格式完全没变，不需要迁移。`Harness Runtime` 的 `harnessVersion` 从 2 升到 3，意味着内嵌 Runtime 的行为变了，比如 route 的契约从 v2 升到 v3——但 Task 数据可能仍然兼容。只有 `schema` 版本变化时，你才需要关心本地数据是否需要迁移。

精确 npm 版本以根 `package.json`、npm registry 和
[GitHub Releases](https://github.com/Alessandro-Pang/harnessmith/releases)为准。发布说明直接维护在 GitHub Release 中，不在长期文档里复制当前版本，也不维护会无限增长的仓库 Changelog 文件——版本信息只有一个事实源，避免文档与 registry 各说各话。

## 升级

重新运行 install 即可升级受管层。推荐的顺序是「先看、再装、后核」：

```bash
npx harnessmith@latest --dry-run --agent codex
npx harnessmith@latest install --agent codex
npx harnessmith@latest status --agent codex
```

先用候选版本 dry-run，确认目标和接管状态，再执行安装。dry-run 输出里需要特别关注三个信息：

- 哪些文件是 `managed`（当前版本管理，可以安全升级）
- 哪些文件是 `modified`（你手动改过，升级会备份后替换）
- 哪些文件是 `unmanaged`（不在 Harnessmith 管理范围内，升级不会碰）

安装器会保留上一层备份；需要回退时运行 `restore`，升级永远留有退路。如果你在多个宿主上都装了 Harnessmith，建议逐个升级，每个宿主升级后先跑一次 `status` 确认正常，再升级下一个。

## 状态迁移

Runtime 读取旧 Task ledger 时执行确定性内存迁移，但不会用旧的宽松结论绕过当前 acceptance gate。这两点分别展开：

- **确定性迁移**意味着同一份旧数据，在任何机器、任何时间迁移，都会得到相同的新格式，不会因为环境差异产生不同的迁移结果。
- **旧 `passed` 降为 `inconclusive`** 意味着：如果旧版本 Task 的某个验收项在旧规则下被标记为 `passed`，但旧规则比当前规则宽松（比如旧版本不要求机械 verifier 证据），那么这个 `passed` 在新版本中会被降级为 `inconclusive`。你需要重新运行 `task verify` 来获取当前规则下的证据。这个设计防止了「升级后自动继承旧结论」。格式可以迁移，结论不能。

Memory metadata 迁移采用 proposal-first，必须显式应用，不会自动覆盖原记录。你需要先运行 `memory migrate` 生成 proposal，审阅迁移范围和影响，再通过 `--apply` 确认执行。

新增持久化 schema 时，必须记录：输入版本、输出版本、是否可逆、失败行为、备份位置、兼容窗口和验证命令。重大取舍直接写入对应的架构或迁移文档，并说明背景、替代方案和兼容后果。迁移设计留痕，升级的人才有依据。
