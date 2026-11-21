---
title: Harness CLI Contracts
type: harness-reference
status: active
updated: 2026-11-21
owner: harness-cli-architecture
---

# Harness CLI Contracts

这是低频参考，不是每次任务的启动 Prompt。只有实现、调试或审计 Harness CLI 时才加载；当前任务的权限和
Memory 语义仍以 Core、playbook 和对应 owner 文档为准。

## 源码归属

| 问题 | 首先检查 |
| --- | --- |
| 外层安装、Adapter、staging、备份、恢复 | `packages/cli/src/` |
| 内层命令注册与参数 | `packages/harness/src/cli.ts`、`packages/harness/src/program/` |
| 用例命令 | `packages/harness/src/commands/` |
| 可复用领域原语 | `packages/harness/src/lib/` |
| Runtime 路径、身份和环境 | `packages/harness/src/runtime.ts` |
| 分发入口 | 全局 `harnessmith`；同包的根 `dist/harness.mjs` 为内部 bundled Runtime，不分发进 skill |

`packages/cli` 是外层 Adapter，不是通用 Memory/Task 实现的 owner。`dist/` 是生成物，不手工编辑。

## Schema 与 Runtime 身份

- version --json 返回 harnessVersion、schemaVersion、memorySchemaVersion 和 Node 契约；当前兼容值为 schemaVersion: 3、memorySchemaVersion: 1、node: >=22.20.0。未知 schema 必须 fail closed。
- Runtime 只从当前 npm 包内的 `dist/harness.mjs` 启动，以根 package manifest 与包内 skill manifest 的组合结构证明 standalone 身份；不读取安装记录或 install-context.json，不依赖 source-tree 文件位置字面值。
- personal、memory、state 与 repository paths 只由当前环境变量或 `~/.harnessmith` 默认位置决定；旧安装上下文不能改变路径。
- 任何写入命令先做 Runtime identity、SafePath、领域 schema 和 owner 状态校验；只读命令不得借此获得写入资格。

## 命令与输出

- bootstrap --project <path> --detail brief|full [--intent <intent>] --json [query...] 只读地汇总项目与 Memory 启动信息；
  brief 是默认边界，不能把省略或截断解释为不存在。带 query 时在同一命令内完成文档路由：`route.load` 为按序读取的绝对路径，
  `route.ask` 非空表示 unmatched、歧义或 required topic 被预算省略，必须先提问；不带 query 时 `route` 为 `null`。
  `skill` 字段指向已安装的 `SKILL.md`。
- health --project <path> --json 聚合 Runtime、installation、global memory、audit 和可选 project memory；
  healthy 只由 failed check 决定，audit 未配置是允许状态，warning 不是 failed。doctor 偏环境/入口可用性，
  validate 偏安装、内容、schema 与项目接入。
- 预期无结果、歧义、非法输入、身份失败和执行失败必须保持可区分；不要用后续命令的成功码覆盖前一条失败。

- 参数、退出码和 JSON 错误以 `--help`、源码和测试的当前实现为准；文档中的示例不是事实源。
- 项目定位有三种形态，不可互换：`bootstrap`、`health`、`task *` 用 `--project <path>`；读写 Memory 的
  `memory *` 用位置参数 `<scope>`（`.` 为当前项目）；`memory evaluate-capture`、`discover-candidates` 是不触盘的
  纯函数，两者都不接受。
- `route`/`explain` 只读 manifest，不读取正文；报告区分 `rawQuery`、`normalizedQuery`、playbook、supporting
  topic、required topic 与 deferred reference。
- required topic 与 supporting topic 各有最多四个的独立预算；required 超出时列入 `omittedRequiredTopics` 并返回非零，可选 topic 与 reference 的省略只表示延迟加载。
- 任何会写入托管状态的命令都必须经过 owning store/transaction、SafePath、锁、原子写和结果校验。

## 搜索与索引

- auto 只有在 index format、backend、analyzer、ICU、policy、scope 和源文件 identity 全部有效时使用全文索引，
  否则回退有界扫描；fulltext 在同一条件不满足时 fail closed；scan 强制扫描。
- 只有显式 --refresh-index 写入可重建缓存；它不能与 --mode scan 组合。索引位于
  state/search/<scope-hash>/index-v1.json，以锁、原子替换和 0600 保护，正文不存入倒排索引。
- provenance 必须保留 source、trust、path、line、retrieval、scanTruncated、预算、统计和跳过原因；扫描截断时
  未命中只能是 inconclusive。MiniSearch、tokenizer、字段权重和 benchmark 证据见 search-and-benchmarks.md。

## Payload-file

自由文本先由宿主的非 shell 文件能力写入 task-scoped 绝对 JSON，再以 `--payload-file` 传入独立 CLI 进程。
CLI 依次校验文件身份、schema、目标身份和领域条件；禁止把不可信文本放入 shell 参数、重定向或命令替换。

`capture-input` 的 JSON payload 必须使用 `sourceRefs`（复数命名）；不得使用 `sourceRef`。`source` 只接受
`chat`、`file`、`meeting`、`link`、`other`。

`--consume-payload-file` 只有在领域命令成功且托管结果完成校验后才删除文件。读取成功、schema 通过或部分
写入失败都不代表消费成功；失败时保留文件，重试按 owner 文档生成新 payload 路径。

audit record 是 host-supplied、Host-neutral 的显式事件入口，不是自动 Host hook。它只接受固定元数据：
trace、canonical UTC timestamp、operation/action、policy、duration、outcome、artifact digests，以及可选的
token/cost/error 字段；拒绝原始 prompt、输出、tool arguments、未知字段和 secret。事件写入 state/audit/，
不参与 managed checksum，也不成为 Memory、项目事实或权限来源。list/summary/maintain 只读；archive 默认
proposal，只有显式 --apply 才移动日文件。

## Task evidence 与验收

`task verify` 只产生绑定记录时 HEAD、workspace、scope、task 和 criterion 的机械 evidence，不理解自由文本
criterion，也不证明语义相关性；精确字段、执行与路径边界、预算、验收门禁和 Replay 状态机由
[task-and-replay-contracts](task-and-replay-contracts.md) 独占，本文件不复制。

## Memory 与 Repository Map 入口

- memory evaluate-capture 是只读资格判断；memory migrate 默认 proposal，显式 apply 才写入；memory repair 的
  分阶段协议、分类与 backup/recovery 边界由 memory-contracts.md 独占，本文件不复制。
- repository-map 把 personal canonical YAML、generated Markdown 和 runtime verification state 分离；
  check/maintain 默认只读，render --write、内置 discover ... --apply 和 verify --record 才写入。
  schema、命令、预算和迁移见 repository-map-contracts.md。
- memory、task、repository-map 的领域状态机由各自 owner 文档拥有；本文件只定义跨命令的身份、payload、
  证据和失败边界，不复制完整专题流程。

## 安装、回滚与恢复

外层 Adapter 只向宿主写入普通 instruction files，并写入 `schemaVersion: 3` 单份当前 record；旧 Hub、
pre-hub Runtime 树、symbolic-link 布局与历史 record 链没有读取或迁移路径。路径 containment 与用户文件保护
仍然必需，每次 install/restore/uninstall 只保留一个文件回滚事务。任何 rollback、恢复或清理失败都必须保留并
报告精确 recovery path，不能声称整体已回滚或已清理。Host 文件与 `skills` 管理的 skill 是独立事务；后者失败
要明确报告部分完成，不能谎称跨 owner 原子回滚。personal overlay、state 与 Memory 位于受管输出之外，升级和
卸载不得覆盖或删除用户正文和用户旧数据。

临时 workspace 必须带 owner、purpose、创建时间和 lifecycle marker；成功与普通失败统一 disposer 清理，只有明确
recovery 需要才保留。历史维护先运行仓库 temp:scan dry-run；未知目录、活动 lock/proof 和 recovery 引用不进入
自动删除路径。

## 常用诊断路径

- 安装与宿主边界：`packages/cli/src/adapters/`、`packages/cli/src/installation/`。
- 内层参数/帮助：`packages/harness/src/cli.ts`、`packages/harness/src/program/`。
- 初始化：`packages/harness/src/commands/init.ts`。
- Memory：`packages/harness/src/commands/memory/`、`packages/harness/src/lib/memory/`。
- 搜索：`packages/harness/src/commands/search/search.ts`、`packages/harness/src/lib/search/`。
- 路由：`packages/harness/src/commands/routing/route.ts`、`packages/harness/src/lib/documentation/`、`docs/manifest.yaml`。
- 健康检查：`packages/harness/src/commands/health/`、`packages/harness/src/lib/health/`。

## 验证入口

```bash
pnpm run test:harness
pnpm run check:docs
pnpm run preflight
```

端到端命令必须使用临时 `HARNESS_HOME`、`HARNESS_MEMORY_HOME` 和 `HARNESS_PERSONAL_HOME`，不要修改真实全局目录。
