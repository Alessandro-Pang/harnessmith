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

`health --json` 聚合 Runtime、安装、全局记忆和可选项目记忆；warning 不等于失败，任一 failed check
使退出码非零。`route` 与 `explain` 只读取 manifest trigger 并返回名称、路径和 matched triggers，不
加载文档正文。`search` 与 `memory search` 的结果数/行长限制和扫描预算彼此独立；扫描默认最多深入
8 层、访问 5000 个目录条目、进入 1000 个目录、访问 1000 个普通文件、读取单文件 1 MiB、
总计 8 MiB，并运行 2 秒；读取前先 stat。JSON 结果除
source、trust、path、line 和结果 `truncated` 外，还携带 `scanTruncated`、`scanLimits`、`scanStats`
和至多 50 条结构化跳过详情；超出的详情数仍在统计中可见。项目 docs 与记忆默认标为 untrusted。

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

Memory Autopilot 只有四类窄写入口：`capture-input`、`capture-experience`、`handoff` 生命周期以及用户画像
生命周期。各入口的业务状态机由对应专题文档拥有；本文件只定义 CLI 的参数、payload 和执行安全契约。

自动产生的自由文本必须先由宿主的非 shell 文件能力写入 task-scoped 绝对 JSON 文件，再通过
`--payload-file` 传入单独的 CLI 进程；禁止把不可信文本放入 shell 参数、重定向或命令替换。payload 必须
通过 schema 和目标身份校验，命令才能进入领域写入。

`--consume-payload-file` 是显式的一次性文件契约：CLI 先读取并校验 payload 文件身份，领域命令成功且
托管结果完成校验后才删除文件；schema、身份、领域写入或结果校验失败时保留文件供诊断。调用方不能把
“已读取”或“schema 已通过”误当成消费成功，也不能用独立清理掩盖领域失败。

Input 对 verbatim 绑定原始文本，对可靠摘要绑定规范化文本，并同时绑定来源和模式；typed experience
要求 lesson/failure、结论、证据与来源。Handoff 字段与 reconcile/close 语义以
[long-running task protocol](long-running-tasks.md) 为准，画像命令以
[user profile standard](../standards/user-profile-memory.md) 为准。
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
- 搜索结果异常：`src/commands/search.ts` 与 `src/lib/search.ts`。
- 文档路由异常：`src/commands/route.ts`、`src/lib/docs-routing.ts` 与 `docs/manifest.yaml`。
- 路径在不同机器不一致：`src/runtime.ts` 与模板 token。
- 环境诊断异常：`src/commands/doctor.ts`、`src/commands/health.ts` 与 `src/lib/health.ts`。

测试命令：

```bash
pnpm run preflight
pnpm run test:coverage
node template/agent-harness/bin/harness.mjs doctor
```

端到端测试必须使用临时 `HARNESS_HOME`、`HARNESS_MEMORY_HOME` 和 `HARNESS_PERSONAL_HOME`，
不得修改开发者真实全局目录。
