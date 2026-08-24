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

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs task verify \
  --project /absolute/project/path --id <task-id> \
  --criterion criterion-1 --type test --command "<test-runner>" \
  --arg "<runner-argument>" --scope "<source-path>" --scope "<test-path>"

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
- `passed` 只能由 `task verify` 机械产生。`task accept --evidence` 仍可保存结构化外部证据，但只能
  标记为 `failed` 或 `inconclusive`；裸字符串、调用方自报的 exit code 或 digest 都不能通过门禁。
- `task verify` 证明的是调用方选择的 command/test 已执行成功，或 file/diff 已被机械读取并摘要，
  同时证明记录时的 HEAD、workspace 和 scope 新鲜度；它不理解自由文本 criterion，也不证明所选
  命令、文件或 scope 与该 criterion 在语义上相关。无关但返回 0 的命令仍可能得到机械 `passed`。
- task ledger 是非权威工作记忆，不是签名或防篡改日志。schema、原子写和锁用于拒绝坏格式及并发
  覆盖；evidence 绑定 task/criterion，可拒绝原样跨任务复制，但不对抗直接修改 `task.json` 或绑定
  字段，也不对抗同一执行者替换 verifier。close 只表示当时重算结果匹配；之后的工作区变化不会追溯
  修改已关闭账本。
- 高风险验收应由用户审阅，或由 CI/Host-owned verifier 持有当前任务无权替换的 predicate、命令和
  scope，再通过 `task verify` 调用。权威结论仍来自该 verifier；外部观察只作为 `inconclusive` 线索，
  不能借 `task accept` 直接变成 `passed`。
- `command`/`test` 使用 `execFile` 语义直接执行 `--command` 与重复 `--arg`，不经过 shell；执行受
  timeout 和输出上限约束，并记录实际 exit code、signal、timeout 与输出摘要。二者必须提供至少一个
  `--scope`，CLI 在执行后自动计算 scope digest。
- `file` 从受项目根约束的 `--file` 自动读取 regular file 并计算 digest；`diff` 只支持可读 Git
  workspace，并要求显式 `--scope`。scope/file 路径同时做 lexical 与 realpath containment，拒绝
  symlink、特殊文件、目录型 file evidence 和 `.git`/`.agent-docs` 元数据边界。
- 一次机械验证最多接受 16 个互不重叠的 scope；路径校验、regular-file/元数据判定和 digest 共用
  一次聚合预算：最多 25,000 个条目、128 MiB 总读取、32 MiB 单文件、从项目根起 32 层和 15 秒。
  close 的新鲜度重算使用同样边界；任一预算耗尽都 fail closed，不能产生或维持 `passed`。
- 项目快照的全部 Git 子进程共用默认 5 秒的有限 deadline，并显式禁用仓库配置的 fsmonitor 和
  untracked cache。超时或无法读取 workspace digest 时返回不可用证据，`verify`/`complete` 不放行。
- `browser`/`observation` 当前无法由 CLI 机械复核，只能作为 external `inconclusive` 证据，不能
  支持 `passed`。CLI 生成的证据自动绑定 `recordedAt`、规范化项目 `cwd`、当前 `HEAD`、workspace
  digest 和 scope digest。
- `task status` 每次读取都会校验完整 schema，并报告 branch、HEAD、dirty 相对初始化基线的漂移；
  已存储为 `passed` 但机械证据不再新鲜的 criterion 会派生只读 `stale: true`，不静默改写账本。
  task 列表遇到坏账本也明确失败，不静默跳过。
- `task close --status complete` 会重新读取当前项目状态并重算 artifact/scope digest；每个 passed
  criterion 至少需要一条 Harness 机械生成、仍绑定当前项目、当前 HEAD 和 workspace digest 的证据。
  HEAD、未提交工作区或显式 scope（包括 ignored file 与 nested repository）变化都会让旧证据失效。
  非 Git 目录使用确定性的本地 workspace digest，不再以 `null == null` 放行。
- v1/v2 task 可读取并在下一次写入时迁移为 v3；旧字符串保留为 `legacy`，v2 typed evidence 标记为
  `external`。仍活跃 task 的旧 `passed` 会降为 `inconclusive`，必须重新运行 `task verify`；已关闭
  历史账本保留状态，但旧证据不能用于新的 close。
- 只有所有验收项均为 `passed` 时才能以 `complete` 关闭；阻塞或被替代应使用对应状态。以
  `blocked` 关闭时必须同时提供非空 `--next`，明确恢复任务所需的下一步。
- checkpoint 不能写入 `complete` 或 `superseded`，关闭任务必须走 `task close` 的验收门禁。
- task、acceptance 和 checkpoint 更新按任务目录加锁；并发写入冲突必须失败并重试，不能静默
  覆盖另一进程的进度。
- checkpoint 只记录已确认事实、实际变更、验证、风险和下一步，不复制大段日志或源码。
- 未经授权不通过 commit 制造恢复点；默认记录 branch、HEAD、dirty 状态、diff/测试证据。
- 任务完成后将稳定结论提升到正式事实源，再将任务标为 `complete`；不要让 task ledger 成为
  第二套项目事实。
