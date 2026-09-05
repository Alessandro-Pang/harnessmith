---
title: User Profile Contracts
type: harness-reference
status: active
updated: 2026-09-04
owner: user-profile-memory
---

# User Profile Contracts

这是 `user-profile-memory` 的低频操作参考。普通任务只需要标准文档中的范围、证据和当前状态规则；实现、诊断或
用户明确要求画像操作时，才加载本文件。`profile.md` 仍是唯一当前画像，命令和 schema 以当前 CLI、测试为准。

## File and record contract

全局 `.agent-docs/` 默认仅当前用户可访问：目录为 `0700`，受管 `README.md`、`core.md` 和可表达 POSIX mode 的
平台上的 `profile.md` 为 `0600`。Windows 的 Node 文件 API 不可靠保留 permission bits，因此事务只校验 regular
file、非 symlink、内容和大小；访问控制由 Windows ACL 与宿主负责。这不替代加密、备份治理或宿主访问控制。

每条画像使用一个稳定维度 key，格式为：

```text
- <dimension.key> | <不超过 200 字符的当前结论> | <explicit|observed|inferred> | <high|medium|low> | <YYYY-MM-DD>
```

正文最多 32 条 active conclusion。达到容量时先更新已有 key；确需新增时返回 capacity 阻塞，不静默驱逐。`observed`
和 `inferred` 在当前 Runtime 只能保留候选，不能自动落盘。

## Reconcile and forget

更新前单独读取当前 `profile.md`，把新信号映射到已有 key；不要先在项目 Memory 建偏好副本。合并顺序是：用户当前
明确表达 > 画像当前条目 > 带时间的 input/episode > 宿主原生 memory > Agent 推断。历史来源保持原样，不改写成并列当前状态。

用户明确表达跨任务默认偏好或纠正旧画像时，使用 local-safe Autopilot，以 `explicit/high` 原位更新；没有新信息不改写。
自动产生的 conclusion 等自由文本先写入 task-scoped 绝对 JSON，再传给单独的 CLI 进程，禁止 shell 插值或试错重试。

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory reconcile-profile \
  --payload-file /absolute/path/to/profile-reconcile.json --json

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory forget-profile \
  --key "<stable-key>" --json
```

reconcile payload 只接受 `key`、`conclusion`、`evidence`、`confidence` 和可选 `userDirected`；日期由 CLI 维护。
`evidence` 只接受 `explicit` 或 `observed`，不得写用户原话、来源说明或其他解释文本。用户明确偏好固定使用
`explicit` 与 `high`。`reconcile-profile` 必须单独执行并带 `--payload-file`、`--json`；`forget-profile` 也单独执行。

自然语言遗忘从已读画像按当前结论唯一匹配：唯一命中才使用 exact key；零个或多个候选必须报告阻塞并请求澄清，不能猜 key。
即使条目已被替代，也不能以“无需删除”跳过用户明确的精确遗忘。

## Autopilot pause and resume

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory profile-autopilot pause --json
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory profile-autopilot resume --json
```

`profile-autopilot: paused` 会机械拒绝自动 reconcile；只有用户明确要求修改画像本身时，payload 才可设置
`userDirected: true` 绕过当次拒绝，且不会恢复 autopilot。暂停时“以后/未来默认……”只是当前 task/thread 指令，不能设置
`userDirected`；精确 forget 不受 pause 阻止，resume 必须由用户明确要求。

## Language and visibility

单次翻译、改写、目标语言或“本次用某语言回复”不是 `communication.language` 的长期证据；自动检测结果不得写入画像。
用户明确要求纠正、遗忘、暂停或恢复时，不发过程通知，只在最终答复报告结果或阻塞。自动 `created/updated/unchanged` 不预告
或复述画像；`proposed/blocked` 只简报阻塞。

暂停时普通偏好只按当前指令执行，答复按用户当前格式要求；默认不复述或承诺偏好，也不提 profile、autopilot 或持久化。
用户请求查看画像时，才完整返回画像内容。画像规则与个人 `AGENTS.md` 冲突时，当前用户指令优先，用户维护的显式规则不能由
Agent 自行改写。
