---
title: Harness CLI Contracts
type: harness-reference
status: active
updated: 2026-09-04
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
| 分发入口 | `template/agent-harness/bin/harness.mjs`、`template/agent-harness/dist/harness.mjs` |

`packages/cli` 是外层 Adapter，不是通用 Memory/Task 实现的 owner。`dist/` 是生成物，不手工编辑。

## 兼容性与 Runtime 身份

- version --json 返回 harnessVersion、schemaVersion、memorySchemaVersion 和 Node 契约；当前兼容值为 schemaVersion: 3、memorySchemaVersion: 1、node: >=24.12.0。未知 schema 必须 fail closed。
- managed Runtime 必须由当前安装目录内合法的 install-context.json 证明，并匹配 adapter、harness home、memory/personal home、repository root、owner 和 instruction files；不能把缺失或损坏 context 降级成 standalone。
- standalone 只在经源码布局、packages/harness/src/runtime.ts 和根 package manifest 共同证明时成立。
- 任何写入命令先做 Runtime identity、SafePath、领域 schema 和 owner 状态校验；只读命令不得借此获得写入资格。

## 命令与输出

- bootstrap --project <path> --detail brief|full --json 只读地汇总项目与 Memory 启动信息；brief 是默认边界，
  不能把省略或截断解释为不存在。
- health --project <path> --json 聚合 Runtime、installation、global memory、audit 和可选 project memory；
  healthy 只由 failed check 决定，audit 未配置是允许状态，warning 不是 failed。doctor 偏环境/入口可用性，
  validate 偏安装、内容、schema 与项目接入。
- 预期无结果、歧义、非法输入、身份失败和执行失败必须保持可区分；不要用后续命令的成功码覆盖前一条失败。

- 参数、退出码和 JSON 错误以 `--help`、源码和测试的当前实现为准；文档中的示例不是事实源。
- `route`/`explain` 只读 manifest，不读取正文；报告区分 `rawQuery`、`normalizedQuery`、playbook、supporting
  topic、required topic 与 deferred reference。
- required topic 超过硬预算时列入 `omittedRequiredTopics` 并返回非零；可选 topic 与 reference 的省略只表示延迟加载。
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

task verify 只产生机械 evidence：可证明选定的 command/test 实际退出成功，或 file/diff 被读取并摘要，并绑定
记录时的 HEAD、workspace、scope、task 和 criterion。它不理解自由文本 criterion，也不证明所选 command、file
或 scope 在语义上相关；无关但返回 0 的命令仍可能得到机械 passed。高风险 predicate 必须由用户、CI 或
Host-owned verifier 固定，外部 evidence 不能直接产生 passed。

command/test 使用 execFile 语义直接执行 executable 与 args，不经过 shell；file 只接受项目根内 regular file，
diff 要求可读 Git workspace。路径须做 lexical/realpath containment，拒绝 symlink、特殊文件、目录型 file
evidence 和 .git/.agent-docs 元数据边界。Task、acceptance 和 checkpoint 写入任务锁；陈旧或 legacy evidence
不能关闭 Task。精确字段、预算和 Replay 状态机见 task-and-replay-contracts.md。

## Memory 与 Repository Map 入口

- memory evaluate-capture 是只读资格判断；memory migrate 默认 proposal，显式 apply 才写入；memory repair 必须
  按 diagnose-only → content-bound proposal → explicit apply → independent verifier 分阶段，精确分类、
  backup/recovery、锁和恢复边界见 memory-contracts.md。
- repository-map 把 personal canonical YAML、generated Markdown 和 runtime verification state 分离；
  check/maintain 默认只读，render --write、内置 discover ... --apply 和 verify --record 才写入。
  schema、命令、预算和迁移见 repository-map-contracts.md。
- memory、task、repository-map 的领域状态机由各自 owner 文档拥有；本文件只定义跨命令的身份、payload、
  证据和失败边界，不复制完整专题流程。

## 安装、回滚与恢复

外层 Adapter 的 managed outputs、install-context.json、installation record、staging、备份和恢复必须保持
路径 containment 与用户文件保护。多文件 rollback 不是不可失败的原子事务；任何 rollback、恢复或清理失败都必须
保留并报告精确 recovery path，不能声称整体已回滚或已清理。个人 overlay 位于 managed output 之外，升级和卸载
不得覆盖或删除用户正文。

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
