---
title: Long-running Task Protocol
type: harness-core
status: active
updated: 2026-08-21
---

# Long-running Task Protocol

任务预计跨上下文、多阶段或需要交接时，使用 `.agent-docs/working/<task-id>/task.json` 保存机器
可读的目标、验收条件、基线、检查点和下一步；`progress.md` 保存简短的人类叙述。它们属于非
权威工作记忆，不替代代码、测试、ADR、正式计划或产品规格。

## 何时创建

- 创建：跨上下文、跨仓、多阶段、高风险、昂贵调查，或存在多个必须逐项验证的验收条件。
- 不创建：简单问答、一次性小改动、无需交接且能从 Git/代码快速恢复的工作。
- 不确定时询问用户，不因工具存在就给每个任务增加状态文件。
- 初始化至少提供一个可判定的 `--accept`；没有成功条件的任务不能进入账本。

## 生命周期

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task init \
  --project /absolute/project/path \
  --objective "建立可重复的文档验证" \
  --accept "断链会导致 validate 失败" \
  --accept "正常文档检查通过"

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task checkpoint \
  --project /absolute/project/path --id <task-id> \
  --summary "完成路由覆盖检查" --next "实现相对链接检查"

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task accept \
  --project /absolute/project/path --id <task-id> \
  --criterion criterion-1 --status passed --evidence "command:node --test"

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task status --project /absolute/project/path --id <task-id>
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task close --project /absolute/project/path \
  --id <task-id> --summary "全部验收通过"
```

## 行为约束

- `task init` 自动把 `working/<task-id>/progress.md` 挂入 `.agent-docs/core.md`；checkpoint 保持入口
  与状态同步，complete/superseded 关闭后自动移除，blocked 保留以便下次启动发现。
- 恢复任务时先运行 `task status` 并读取 `core.md` 中对应 progress 引用，再加载必要证据；不递归读取
  整个 `.agent-docs/working`。
- 每次只推进一个边界清晰的增量；开始前读取任务状态并验证必要基线。
- `passed` 必须附可复核 evidence；环境受限使用 `inconclusive`，不能标为通过。
- 只有所有验收项均为 `passed` 时才能以 `complete` 关闭；阻塞或被替代应使用对应状态。
- checkpoint 不能写入 `complete` 或 `superseded`，关闭任务必须走 `task close` 的验收门禁。
- task、acceptance 和 checkpoint 更新按任务目录加锁；并发写入冲突必须失败并重试，不能静默
  覆盖另一进程的进度。
- checkpoint 只记录已确认事实、实际变更、验证、风险和下一步，不复制大段日志或源码。
- 未经授权不通过 commit 制造恢复点；默认记录 branch、HEAD、dirty 状态、diff/测试证据。
- 任务完成后将稳定结论提升到正式事实源，再将任务标为 `complete`；不要让 task ledger 成为
  第二套项目事实。
