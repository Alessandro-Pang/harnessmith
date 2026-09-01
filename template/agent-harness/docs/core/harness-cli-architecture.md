---
title: Harness CLI Architecture
type: harness-core
status: active
updated: 2026-08-28
---

# Harness CLI Architecture

CLI 使用 Node.js 24.12+。源码使用 strict TypeScript，开发态使用成熟库承担通用基础设施，并由
tsup 生成自包含 bundle；
安装到 Agent home 后不需要再次运行包管理器。对用户保持单一入口 `bin/harness.mjs`，内部按职责
拆分，避免记忆、搜索、验证和参数解析继续耦合。

## 分层与依赖

```text
bin/harness.mjs
  └── dist/harness.mjs          # tsup 自包含运行产物
        └── src/cli.ts          # Commander 命令契约
        ├── src/commands/*.ts
        │     └── src/lib/*.ts
        └── src/runtime.ts
```

- `bin/`：进程边界，只加载 bundle、处理顶层异常和退出码；不放业务逻辑。
- `dist/`：由 tsup 生成并随 npm 包分发的运行产物；禁止手工编辑。
- `src/cli.ts`：用 Commander 声明公开命令语法、帮助和分发；不直接读写文件。
- `src/commands/`：一个文件负责一组用户用例，组合底层能力并产生用户输出。
- `src/lib/`：无命令语义的可复用能力；优先纯函数或小型同步原语。
- `src/runtime.ts`：集中解析 HOME、可覆盖路径、owner、日期和源码位置；命令不得自行读取相同
  环境变量或硬编码用户路径。
- `templates/`：安装时保留动态 token，实际初始化全局或项目记忆时再渲染。
- `docs/`：Agent 按需读取的规则、playbook、标准和研究；不放可执行源码。
- `schemas/`：任务、配置和结果等机器契约；schema 变更必须升级版本，并先提供显式、可测试、
  fail-closed 的兼容路径。当前 Task schema 为 3、Memory schema 为 1；旧 Task evidence 读取时降级为
  不可通过门禁的 `legacy`/`external`，旧 Memory metadata 只能经 `memory migrate` 显式迁移。
- `state/`：安装态可选运行数据，升级时保留且不参与受管理 runtime checksum；不得存 secret，
  也不作为规则或项目事实源。
- `{{HARNESS_PERSONAL_HOME}}/`：用户所有的个人 overlay，位于受管理安装目录之外。CLI 只幂等创建
  缺失模板，升级、恢复和卸载均不得覆盖或删除。

通用能力优先使用经过维护的实现：Commander 负责 argv/帮助，`yaml` 负责 manifest 与
frontmatter，Ajv 负责 JSON Schema，`write-file-atomic` 负责原子写。路径越界校验、记忆协议、
任务完成门禁和安装事务属于 Harness 领域逻辑，保留在本项目中。新增依赖必须能被 bundle，且
不得要求用户在 Agent home 再安装依赖。

依赖只能从上向下。`lib` 不导入 `commands`，命令之间原则上不互相依赖；`task` 允许调用
`initProject`，因为创建任务账本前必须保证项目记忆协议存在。

## 扩展命令

1. 先判断能力属于通用原语还是用户用例，分别放入 `lib` 或 `commands`。
2. 命令函数首参接收 `runtime`，输出通过可注入的 `io`，避免测试依赖真实 HOME 和 console。
3. 在 `src/cli.ts` 增加 Commander 参数契约和分发，并同步根 README 与相关专题文档。
4. 成功返回 `0`；可预期的“无搜索结果”返回 `1`；非法输入或状态抛出带精确上下文的 Error。
5. 涉及文件写入必须幂等、保护已有内容并使用原子写。
6. 为领域规则增加单元测试，为用户命令增加临时 HOME 端到端测试。

`doctor` 检查运行环境、已安装 CLI、共享记忆与个人 overlay 的可用性，`validate` 检查内容、路由、
结构和项目接入。宿主安装、规则文件
映射、staging、备份和回滚属于外层 adapter，不进入通用 Harness 命令层。

`health --json` 聚合 Runtime、安装、全局记忆、运行审计和可选项目记忆；未配置审计不是故障，warning 不等于失败，任一 failed check
使退出码非零。`route` 与 `explain` 只读取 manifest trigger 并返回名称、路径和 matched triggers，不
加载文档正文。`search` 与 `memory search` 的 `auto|scan|fulltext` 模式共享同一 provenance 契约：
`auto` 只在索引格式、backend、analyzer、ICU、policy、scope 和源文件身份全部有效时使用全文索引，
否则回退有界扫描；`fulltext` 对同一条件 fail closed；`scan` 保留原路径。只有显式
`--refresh-index` 是写操作，并先验证 Runtime 身份。

全文索引使用 Markdown heading/YAML 边界切块、版本化中英文 tokenizer、MiniSearch BM25、字段 boost、
受限 Latin fuzzy 和末词 prefix。trust 只进入 provenance，不参与评分；同分结果按 source 顺序、路径、
行号和 chunk id 确定排序。缓存位于 `state/search/<scope-hash>/index-v1.json`，以任务锁、原子替换和
`0600` 权限保护；manifest 保存源文件 identity、content digest 与稳定 chunk id，快照同时校验 corpus、
backend digest 和 backend 文档清单，倒排索引不存正文。
缓存可增量更新、可随时重建，不是 Memory、规则或项目事实源；`route` / `explain` 不依赖它。

Phase 1 backend 选型证据固定在独立 benchmark 提交
[`bf27c9331a5cacb6294eadcb310919799d6d43c3`](https://github.com/Alessandro-Pang/harnessmith/tree/bf27c9331a5cacb6294eadcb310919799d6d43c3/benchmarks/search-candidates)，
方法提交为 `653f554033555745909d0a00ffe2e9fc592c4d51`。该结果使用 Node 24.19.0、macOS arm64、
Apple M4、16 GiB RAM 和 30 次查询迭代；真实 Harness 源语料 digest 为
`543d6a82728099e5682fe6eb44fa56bc62b5da32f4125e54706259c1df5abd05`，10k 扩容语料 digest 为
`9dc18925e5eb55c8d953243e25bf7ea9d1d3eda606502c677836ea0c3e1f7d83`，query set digest 为
`3a0f41ae11ae9f14c0c6a58c356fae4a67ea665e876dda03f59d926e89702a64`，统一配置 digest 为
`429037b8b687c31b5fba2902944473920f0c94664d7cb7bed1a310bc673ddd50`。在 10k persistent-index
规模上，MiniSearch 的 cold restore 为 267 ms、retained heap 为 83.6 MiB、索引为 20.7 MiB，固定质量集
Top-5/Top-10 均为 100%；Orama 分别为 418 ms、254.5 MiB、108.5 MiB，中文自然句 Top-5/Top-10
为 83%。因此 Phase 1 选择 MiniSearch，且不把 Orama 引入生产依赖。两者在固定 1 GiB old-space 下的
50k 真实正文扩容均因 OOM 失败；这是一条明确的负面规模证据，不扩大当前 10k 选型结论，也不取消
既有源文件、时间、序列化大小门禁和扫描回退。

结果数/行长限制和扫描预算彼此独立；扫描默认最多深入 8 层、访问 5000 个目录条目、进入 1000 个目录、
访问 1000 个普通文件、读取单文件 1 MiB、总计 8 MiB，并运行 2 秒；读取前先 stat。显式索引
刷新把发现上限扩展到 50000 个文件、256 MiB 和 60 秒，但仍可由相同预算参数收窄。JSON 结果除
source、trust、path、line 和结果 `truncated` 外，还携带 `retrieval`、`scanTruncated`、`scanLimits`、
`scanStats` 和至多 50 条结构化跳过详情；超出的详情数仍在统计中可见。项目 docs 与记忆默认标为
untrusted。

`audit record` 是 Host-neutral 的显式事件接入点，不是自动 Host hook。它只接受 payload-file 中的
固定元数据字段，拒绝原始 prompt、输出、tool arguments 和未知字段；`list`/`summary` 有读取预算，
`maintain` 只读报告保留候选，`archive` 默认 proposal、显式 `--apply` 才移动完整日文件。事件放在
可变 `state/audit/`，不参与 managed checksum，也不作为 Memory、项目事实或权限强制来源。完整契约见
[runtime observability](observability.md)。

`health` 的 installation check 先验证 Runtime 身份：managed 分发必须存在合法且与当前 Runtime
完全一致的 `install-context.json`，随后再核验 installation record 与全部 managed checksum；缺失或
损坏 context 不得降级为 standalone。standalone 只接受 Harnessmith 源码树布局与 package manifest
共同证明的身份。managed output containment 同时拒绝 `..`、absolute relative route 和 Windows
跨盘路径。

`version --json` 是兼容性查询入口，返回 `harnessVersion`、`schemaVersion`、
`memorySchemaVersion` 和 Node 契约。`validate` 必须拒绝未知 schema，不能把未知版本当作兼容。

`repository-map` 把 personal YAML 语义层、generated Markdown 视图与 runtime verification state
分开。`check`、`maintain` 和外部 observation reconcile 默认只读；`render --write`、内置确定性
`discover packages --apply` 与 `verify --record` 才写入，并使用 personal/state 对应的协调锁和原子
写。外部 observation 是不可信 proposal，不能仅凭自报 extractor id 获得自动提升权限。

Task acceptance gate 是机械新鲜度门禁，不是语义评审器或安全边界。`task verify` 可以证明调用方选择
的 command/test 退出成功，或 file/diff 已被读取并摘要，并将证据绑定到当时的 HEAD、workspace 与
scope 以及对应 task/criterion；它不能判断自由文本 criterion 是否真的被这些证据满足。绑定可拒绝
原样跨任务复制，但 schema、原子写和锁不提供签名、防篡改能力。高风险 predicate 必须由用户审阅
或 CI/Host-owned verifier 持有，并
限制当前任务替换 verifier 的权限；Task ledger 只记录结果，外部 evidence 不能直接产生 `passed`。

外层 Adapter 的 rollback 按已登记路径尝试恢复，但不把多文件系统操作宣传为不可失败的原子事务。
若逆向操作失败，命令必须报错并保留 recovery path，供用户核验和恢复，不能声称整体已回滚。

Memory maintenance 遵循非权威边界：`migrate` 默认只输出 proposal，只有 ready 提案与显式
`--apply` 才写入；`supersede` 建立可校验替代链接，`archive` 默认只移动 complete/superseded 且拒绝
仍被 active index 引用的记忆，`promote` 只输出 proposal。`check --indexed` 要求 active/blocked
文档可从 index 到达，`maintain` 只读报告候选。Runtime 不得自动写项目正式文档或删除记忆。

`memory curate <project> --task <id>` 是只读的 task/workstream 策展报告。它只输出 proposal 候选并显式区分
phase、task、workstream 完成与用户取消；不得嵌入 `task close`，也不得代替 `promote`、`close-input`、
`supersede` 或 `archive` 的 mutation 与门禁。

Memory Autopilot 只有五类窄写入口：`capture-input`、`capture-experience`、`capture-finding`、`handoff`
生命周期以及用户画像生命周期。各入口的业务状态机由对应专题文档拥有；本文件只定义 CLI 的参数、payload
和执行安全契约。

`memory evaluate-capture --payload-file <path> --json` 是只读的统一资格判断入口。它要求完整 typed payload，
先返回 negative eligibility，再处理价值、来源、typed writer、授权、root 状态和语义重复；不会初始化 Memory
或代替具体写命令。资格输出使用 `unchanged / proposed / blocked / not-evaluated` 与稳定 `reasonCode`；实际写入口
继续返回 `created / updated / unchanged`，并同时返回同值 `status` 与稳定 `reasonCode`。因此未运行 evaluator
不能被编码成 `unchanged`，而 evaluator 的 `proposed` 也不能被描述成已经写入。

自动产生的自由文本必须先由宿主的非 shell 文件能力写入 task-scoped 绝对 JSON 文件，再通过
`--payload-file` 传入单独的 CLI 进程；禁止把不可信文本放入 shell 参数、重定向或命令替换。payload 必须
通过 schema 和目标身份校验，命令才能进入领域写入。

`--consume-payload-file` 是显式的一次性文件契约：CLI 先读取并校验 payload 文件身份，领域命令成功且
托管结果完成校验后才删除文件；schema、身份、领域写入或结果校验失败时保留文件供诊断。调用方不能把
“已读取”或“schema 已通过”误当成消费成功，也不能用独立清理掩盖领域失败。

Harnesssmith 外层临时 workspace 使用带 owner、purpose、创建时间和 lifecycle 的受管理 marker；成功与
普通失败通过统一 disposer 清理，只有明确的 recovery 需要才保留并返回精确路径。release 候选与 Host Eval
证据属于 workstream/evidence，不得当作匿名 `/tmp` 内容通配删除。历史维护先运行仓库的 `pnpm run
temp:scan` dry-run；未知目录、活动 lock/proof 和 recovery 引用不进入自动删除路径。

Input schema v2 要求显式 `mode: verbatim|summary`、五类 `purpose` 与 `retention: workstream|durable`；
workstream retention 必须绑定稳定 workstream。Input 对 verbatim 绑定原始文本，对可靠摘要绑定规范化文本，
并同时绑定来源和模式。`close-input` 原子写入完成原因和可选消费证据，并从 `core.md` 移除 active 引用；
typed experience 要求 lesson/failure、结论、理由、应用、证据与来源；旧的 v1 experience 文档继续可读。
`capture-finding` 只接受 analysis/review/research，并要求结论、理由、应用、证据、来源与显式 `fact-class`；
`durable` 映射到 distilled，只接受 `settled-fact` 或 `verification-pointer`，拒绝易漂移的 `current-state`
和恢复态。`workstream` 映射到 working，必须绑定稳定 workstream 和明确 expiry。二者都按结论 digest
去重并合并来源与证据，不开放任意 Markdown 写入。Handoff 固定为非权威 `recovery-state`，并由 handoff
lifecycle 负责过期；旧文档保持可读，缺少分类时不自动猜测。搜索与 bootstrap 输出分类，并对
`current-state`/`recovery-state` 标记重新验证。Handoff 字段与 reconcile/close 语义以
[long-running task protocol](long-running-tasks.md) 为准，画像命令以
[user profile standard](../standards/user-profile-memory.md) 为准。

新 typed Memory 文档同时写入 `document-purpose-schema-version: 1` 与单一
`document-purpose`。purpose 与 title 必须一致，description 必须包含该 title；`相关内容`、`任务信息`、
`related content`、`task information` 等低信息 title/description 对新文档属于校验失败，对 legacy 文档仅
产生 warning。`memory maintain` 检测重复 canonical purpose 和多个 purpose/结论标题，输出可解释的 split
proposal，但不得自动拆分或改写历史正文。缺少 purpose 的 legacy 文档继续可读，migration 不自动猜测。
所有 coordinated write 在读取或写入任何 entry 前对整组路径执行 SafePath preflight，再使用
secret scan、共享锁、原子写、托管 Memory 校验和失败回滚；`core.md` 按完整 `memory:` token 更新，
不能用前缀匹配。

这里的“自我学习/进化”只是可审计的记忆适配闭环，不是模型权重学习；Autopilot 不得自动改写
prompt、skill、规则或源码，这些变化仍需明确授权、评审和验证。

Task/Handoff 的触发、保留、关闭和优先级遵循 long-running task protocol；Runtime 只负责机械校验并拒绝
非法状态转换。宿主事件 hook 尚未提供，因此“每次宿主会话结束必定执行”仍不是 Runtime 的
机械保证，prompt/单元测试和 scenario contract 也不能替代真实 Host Eval；没有绑定候选包的 passing
record 时不得声称 Host 行为已经通过。
`.agent-docs/host-evals/` 刻意排除在 Memory 扫描之外，由 `pnpm run eval:validate` 单独执行 schema、
artifact digest 与高置信 secret gate。

每个新宿主 task/thread 首次工作前有界读取一次 canonical `profile.md`；其余全局 Memory 才按当前主题读取
元信息与 `core.md`，且不递归加载历史。新 distilled memory 若没有 typed 流程或当前明确写入授权，只能
形成 proposal；Autopilot 不得凭推断自由扩展写入类型。

初始化、Memory 写命令以及 task progress/core 协调写入使用同一共享 memory-root lock；proposal、
list、search、check、maintain 和 route 保持只读。锁只保证 CLI 并发互斥，不把 Markdown guidance
提升为权限强制，也不替代 Host sandbox。

## 调试路径

- 参数或帮助异常：从 `src/cli.ts` 开始。
- 自动初始化或 ignore 异常：`src/commands/init.ts`。
- 记忆索引、引用或 metadata 异常：`src/commands/memory.ts` 与 `src/lib/frontmatter.ts`。
- 搜索结果异常：`src/commands/search.ts`、`src/lib/search.ts` 与 `src/lib/search-index*.ts`。
- 文档路由异常：`src/commands/route.ts`、`src/lib/docs-routing.ts` 与 `docs/manifest.yaml`。
- 路径在不同机器不一致：`src/runtime.ts` 与模板 token。
- 环境诊断异常：`src/commands/doctor.ts`、`src/commands/health.ts` 与 `src/lib/health.ts`。

测试命令：

```bash
pnpm run preflight
pnpm run test:coverage
pnpm run bench:search -- --sizes 1000,10000,50000
node template/agent-harness/bin/harness.mjs doctor
```

端到端测试必须使用临时 `HARNESS_HOME`、`HARNESS_MEMORY_HOME` 和 `HARNESS_PERSONAL_HOME`，
不得修改开发者真实全局目录。
