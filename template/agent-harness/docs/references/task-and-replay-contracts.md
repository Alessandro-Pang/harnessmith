---
title: Task, Handoff, and Replay Contracts
type: harness-reference
status: active
updated: 2026-09-04
owner: long-running-tasks
---

# Task、Handoff 与 Replay 机械契约

这是 `long-running-tasks` 的低频参考。它只在实现、诊断或审计精确字段、证据、重试和 Replay 时加载；核心判断仍以 [long-running task protocol](../core/long-running-tasks.md) 为准。

## Handoff payload

同一 session/workstream 的最新 generation 为 active/blocked 时原位更新；latest generation 已 complete 或 archived 且同一 base 出现新任务时，确定性创建下一 generation 并保留旧 episode。写前读取旧 Handoff 与 active Task；`facts`、`decisions`、`verification`、`open`、scope 和 source refs 省略时保留。生成 reconcile payload 时，未变化的可选字段必须省略，不得顺手改写；显式原样重放除外。只有已证实 resolved/superseded 才用 clear 删除。

Handoff payload 每次必填 `session`、`title`、`objective`、`completed`、`next`、`reason`，均为非空 string；title/objective 未变也必须从当前 Handoff 原样带入。`completed` 与 `next` 必须提交完整 reconcile 后的当前状态。`next` 优先取当前 `open`、active Task、plan/backlog 中首个仍有效的未完成项，并点名具体文件、命令或动作；已知 verifier 时一并写明。空泛或冲突的旧 `next` 必须替换。

确无仍有效待办、但没有结束信号而不能 close 时，`next` 才可使用“等待用户给出范围” sentinel；它不覆盖任何已知 `open`、plan/backlog 或 next，也不要求主动询问用户。执行 Handoff 前自检：若首项点名文件，`next` 必须点名同一文件；适用的 verifier 也必须出现。缺一先修 payload，不跳过 signal checkpoint。

Handoff JSON payload 中旧 `open` 全部 resolved 时只接受布尔字段 `clearOpen: true`；不得使用 `clear` 数组、空字符串或 `open` 占位（例如 “No known remaining”）。仅部分 resolved 时提交 replacement `open`，明列剩余项；省略字段会保留旧值，不能用 close 代替。

每次 handoff mutation attempt 都先写入全新 payload 路径；命令执行后路径和内容冻结，失败也不得覆盖或复用；重试必须写入新路径。跨 turn replay 例外仅在宿主明确要求 identical replay、上一回合 checkpoint 已成功且路径与内容完全相同时成立；不重写文件。

## Replay proof

Host 或评测器要求 replay 时，先用 `replay verify --payload-file <evidence> --json` 核验状态机。`new-mutation` 只允许没有 previous payload 的新 identity；started/failed attempt 固定返回 `new-payload-required`。

`identical-replay` 必须同时满足 payload path 与 digest 相同、命令相同、目标 artifact 和 workspace 未变化、verifier exit 0，以及 candidate/workspace digest 与当前状态绑定。重复 signal 的 signal id 相同只改变 reason code，不授权再次执行 mutation。stdout 缺失时仅可依赖 persisted-state proof；字段缺失或漂移返回 `inconclusive`，不得从 `completed` 文本或预期结果推断成功。

## Task evidence 与验收

`task verify` 证明调用方选择的 command/test 实际成功，或 file/diff 被机械读取并摘要，同时绑定记录时的 HEAD、workspace 和 scope freshness；它不理解自由文本 criterion，也不证明所选 command、file 或 scope 在语义上相关。无关但返回 0 的命令仍可能得到机械 `passed`，因此高风险 predicate 必须由用户或 CI/Host-owned verifier 固定。

verification 必须绑定精确命令、exit 0、当前 HEAD/workspace/scope 新鲜度和证据；completed 文本不能代替 verification。关闭交接使用 `memory close-handoff <scope> --outcome completed|cancelled`，且只能在 core 协议规定的 workstream 边界满足后执行。

`task accept --evidence` 只保存结构化外部证据，最多标为 `failed` 或 `inconclusive`；裸字符串、调用方自报的 exit code/digest 和 observation 不能产生 `passed`。CLI 生成的证据绑定 `recordedAt`、规范化项目 cwd、HEAD、workspace digest、scope digest、实际 exit code/signal/timeout 和输出摘要。

`command`/`test` 使用 execFile 语义直接执行 `--command` 与重复 `--arg`，不经过 shell；二者至少提供一个 `--scope`。`file` 只读取项目根内 regular file，`diff` 要求可读 Git workspace；路径同时做 lexical/realpath containment，拒绝 symlink、特殊文件、目录型 file evidence 与 `.git`/`.agent-docs` 元数据边界。

一次机械验证最多接受 16 个互不重叠 scope；聚合预算为最多 25,000 个条目、128 MiB 总读取、32 MiB 单文件、32 层和 15 秒。Git 子进程默认 deadline 5 秒，并禁用仓库 fsmonitor/untracked cache；预算或 workspace digest 不可用时 fail closed。`browser`/`observation` 只能是 external `inconclusive`。

`task status` 每次读取校验完整 schema，并报告 branch、HEAD 和相对初始化基线的 dirty 漂移；旧 `passed` 证据失新鲜时派生只读 `stale: true`，不静默改账本。`task close --status complete` 重新计算当前 artifact/scope digest；所有验收项均为当前机械 `passed` 才能关闭。v1/v2 旧 evidence 迁移后不能用于新的 close。

Task、acceptance 和 checkpoint 更新按任务目录加锁；并发冲突必须失败并重试，不能覆盖另一进程。checkpoint 只记录事实、变更、验证、风险和 next，不复制日志或源码；`blocked` 关闭必须带非空 `--next`，checkpoint 不能写 `complete`/`superseded`。

## Host signal 输出

纯 host-signal/replay turn 的可见性由 core 协议决定：宿主允许空响应时不发 `agent_message`，强制响应时只报告上一用户任务验证结果。没有真实 Host transport/evaluator 时，静态 Prompt、单测和 scenario contract 只能证明 deterministic contract，不能证明宿主遵循。
