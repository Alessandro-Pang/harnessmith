---
title: Compact User Profile Memory
type: harness-standard
status: active
updated: 2026-08-25
---

# 紧凑用户画像记忆

`{{HARNESS_MEMORY_HOME}}/profile.md` 是 Harness 内唯一的当前用户画像，只记录用户本身的当前状态，
用于跨项目改善协作。它不是项目事实、任务日志、聊天摘要、通讯录或未经用户授权的数据档案。

其他全局 memory 和项目 input/episode 可以保留来源或历史证据，但不得另写一份“当前偏好”或
“用户画像”摘要。项目 distilled memory 只提炼项目经验。宿主原生 memory 是外部召回线索，不能
直接视为当前结论，也不能因为它已记录就跳过与 `profile.md` 的合并。

## 记录范围

有证据且对未来协作有价值时，可覆盖以下维度，但不要求填满：

- 当前身份、角色、职责范围和工作语境；
- 编码风格、工程习惯、解释深度、决策与协作偏好；
- 熟悉的语言、框架、工具和技术栈；
- 最近持续研究或明确关注的方向；
- 用户主动表达、会实际影响协作的个人偏好或当前约束。

只记录用户本身。仓库结构、业务规则、某次任务目标、实现结论、临时情绪和一次性指令必须留在
对应的项目事实源、input、episode 或 working memory 中。

用户给出的例子、假设和第三方信息不是用户画像事实。不得把“例如我喜欢甜食”一类说明规则的
假设误记为真实偏好。

## 证据与准确性

证据优先级为：用户当前明确说明 > 用户较早明确说明 > 多次一致观察 > 单次行为推断。明确说明
通常记为 `explicit/high`；多次行为可记为 `observed/medium`；合理但未确认的归纳只能记为
`inferred/low`，并在后续证据不支持时删除或修正。不得为了画像完整而填补未知信息。

不得推断敏感属性，包括健康、政治、宗教、族群、性取向等。用户明确表达且该信息确实影响未来协作时，
只记录必要的当前操作约束，不扩写诊断或背景。例如记录“当前饮食减少糖分”，而不是推演病史。

## 紧凑格式

每条画像是一个稳定维度的当前结论：

```text
- <dimension.key> | <不超过 200 字符的当前结论> | <explicit|observed|inferred> | <high|medium|low> | <YYYY-MM-DD>
```

使用可复用的 key，例如 `identity.current-role`、`engineering.coding-style`、
`communication.explanation`、`interests.current-research`。同一维度只能存在一个 key。正文最多 32 条
活跃结论；优先合并语义相近条目，用一条高信息密度陈述覆盖多个重复观察。

“完整”指在已有证据覆盖的不同维度中不遗漏高价值信息，不代表记录每个细节。达到上限时不得静默
驱逐现有条目：先更新已有 key；确需新增时报告 capacity 阻塞，只有用户明确纠正或要求遗忘后才释放
对应槽位。

## 变化与冲突

发现偏好、身份、技术方向或约束变化时，对同一维度原位改写，禁止追加相互冲突的并列条目。
当前状态优先；只有变化过程能防止未来误解且不显著增加篇幅时，才在一条记录中写成“过去……，
现在……”。画像接近容量上限时只保留当前状态。

例如，旧记录是“喜欢披萨”，用户后来明确表示不再喜欢：优先改成“不喜欢披萨”；若变化本身确实
有用且篇幅允许，可写成“以前喜欢披萨，现在不喜欢”。不得同时保留“喜欢”和“不喜欢”两条。

冲突信息无法判断新旧或可靠性时，不得擅自二选一：降低置信度、暂缓写入，或在确实影响当前结果
时向用户确认。Autopilot enabled 时，用户纠正画像后立即按当前表述更新。自动画像暂停时，普通偏好表达不得
自动 reconcile；只有用户明确要求更正画像本身时，才可以 `userDirected: true` 执行当次纠正，且保持
paused。用户要求恢复自动维护时才 `resume`；精确删除条目始终可执行，pause 不阻止 forget。

全局 `.agent-docs/` 默认收紧为仅当前用户可访问：目录 `0700`，受管的 `README.md`、`core.md` 与
`profile.md` 为 `0600`。这只是本地文件权限边界，不替代磁盘加密、备份治理或宿主访问控制。

更新前必须先读取现有 `profile.md`，把新信号映射到已有稳定 key；禁止先在其他 memory 新建偏好
摘要再复制回来。合并优先级为：用户当前明确表达 > 画像现有当前条目 > 带时间的 input/episode >
宿主原生 memory > Agent 推断。宿主线索、历史记录与画像不一致时，只修改画像中的对应 key，
历史来源保持原样并继续作为历史，不把它重新解释为并列当前状态。

个人 `AGENTS.md` 只保存需要执行的工作规则，不保存人物描述；规则与画像表达相近时属于执行投影，
不是第二份画像。若二者冲突，先服从用户当前指令，再修正过期画像；用户维护的显式规则不得由 Agent
自行改写。

## Agent 维护时机

每个新宿主 task/thread 首次工作前的首个只读动作是有界读取一次 canonical
`{{HARNESS_MEMORY_HOME}}/profile.md`（即唯一 `profile.md`），即使当前请求没有重复偏好；不得先运行项目发现命令或读取项目文件，
同一 task/thread 不重复读取，文件缺失时继续。正文最多 32 条使该启动读取保持有界；读取本身不授权写入，
也不触发其他全局 Memory 的递归加载。

安装初始化的全局 Memory root 使用 local-safe Autopilot。只有用户明确表达为跨任务默认的稳定偏好、
角色、工作方式，或明确纠正旧画像时，才以 `explicit/high` 自动原位更新，无需再说“请记住”：

```bash
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory reconcile-profile \
  --payload-file /absolute/path/to/profile-reconcile.json --json

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory forget-profile \
  --key "<stable-key>"

node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory profile-autopilot pause
node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs memory profile-autopilot resume
```

本次任务或本项目偏好只留在项目 `input`/`handoff`，不能提升为全局画像。Runtime 尚不能绑定多条独立
观察证据，因此 `observed`/`inferred` 只保留为候选，不自动落盘。命令原位替换同 key 并在失败时回滚；
没有新信息时不改写。自动产生的 conclusion 等自由文本必须由非 shell 文件能力写入 JSON payload，并用
`--payload-file` 传递；禁止把不可信文本做 shell 插值。reconcile payload 只接受 `key`、`conclusion`、
`evidence`、`confidence` 与可选 `userDirected`，日期由 CLI 维护，不得自行加入 `date` 或其他字段。自动
`reconcile-profile` 必须单独执行并带 `--payload-file` 与 `--json`，不得与验证命令拼接。
`profile-autopilot: paused` 会机械拒绝自动 reconcile；
仅当用户明确要求修改画像本身时，payload 才设置 `userDirected: true` 绕过当次拒绝，不会恢复 autopilot。
暂停不阻止精确遗忘，恢复自动维护必须由用户明确要求。例行 `created/updated/unchanged` 不发过程通知；用户要求
纠正、忘记、暂停或恢复时不发过程通知，仅在最终答复简短报告结果或阻塞；默认单句，但用户当前格式要求优先。
paused 时普通偏好只作为当前指令执行，不报告画像或持久化状态；查看画像按用户请求完整回答。
