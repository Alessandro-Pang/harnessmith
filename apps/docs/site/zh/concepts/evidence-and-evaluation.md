---
title: 证据与评测
description: 区分仓库验证、真实宿主评测、记录门禁和人工验收
owner: maintainers
audience: users-and-maintainers
status: active
updated: 2026-09-05
---

# 证据与评测

命令退出码为 0、Agent 说“完成了”、真实宿主行为已经验证，这三件事经常被混成一个“通过”。Harnessmith 把它们分开，因为每个结论都需要对应层级的证据。本文说明四条验证链、评测阶段和发布后 clean-room 检查分别能证明什么，以及哪些结论必须保留为 `inconclusive`。

本文说明四条验证链、从任务到结论的五个阶段，以及发布前后的门禁。它们共同限定「Harnessmith 已验证某能力」这句话能覆盖到哪一层。

## 四条互补验证链

四条链各自回答一个不同的问题，任何一条都不能冒充另一条的结论。

### Prompt 与 route 的确定性基准

`pnpm run bench:prompt-route` 使用 `evals/prompt-route-corpus.v1.json` 的同一批输入运行 version 1 benchmark。报告绑定 corpus digest、仅含 id/query 的 input digest、规则 fingerprint 和当前 router candidate digest；使用 `--baseline-report <path>` 比较时，要求 corpus 与 input digest 完全相同，否则拒绝生成 delta。语料变了，比较就失去意义。

确定性指标包括 action routing Top-1 accuracy、topic recall、ambiguity precision/recall/rate、forbidden action count 与整例 rule-adherence rate。阈值保存在 versioned corpus 中；每个案例保留 expected/actual、failure code 和 `false-positive-guard` / `false-negative-guard` 分类。只保留聚合分数会掩盖单例失败，因此不满足证据要求。

这条链有一个诚实的盲区声明：deterministic router 不读取项目事实，也没有模型 token 或 Host tool-call 遥测，因此 fact verification、token cost 和 tool-call cost 必须报告 `not-measured`，不得估算为 0；mock/evaluator 与 real Host 层没有证据时同样报告 `not-provided`。benchmark `passed` 只证明当前源码对该 corpus 的确定性契约达标，`sourceOfTruth` 与 `hostProof` 均为 false；它不能替代下述真实 Host Eval，也不能证明 Agent 实际遵从 Prompt、回查事实或控制 token/tool 成本。

### 确定性仓库验证

单元测试、类型检查、lint、schema、`preflight`、覆盖率门禁和 `npm pack --dry-run` 在受控仓库环境中运行。它们适合证明路径算法、状态机、序列化契约、包内容和失败回滚等可重复性质，这些性质的特点是：同样输入必然同样输出，跑一百次也成立。

这条链不能证明第三方 Coding Agent 真的读取了规则、触发了权限提示，或按场景使用了工具。它管的是仓库内部的一致性，宿主的行为在它的管辖之外。

### First Value 本地体验回归

`pnpm run eval:first-value` 在 disposable 本地目录中复现 setup preview、managed install、deterministic health、status explain 和 restore preview，并输出 version 1 acceptance record。它能发现 journey 术语、下一步指引、安装与恢复入口的回归，且默认不上传 telemetry。

该记录明确把 `installed`、`healthy` 与 `host-configured`、`host-verified` 分开。本地 baseline 通过时，Host-owned 状态仍为 `inconclusive`，`firstValueAchieved` 固定为 `false`；npm downloads、GitHub traffic 和本地 tests 均被列为不能用于推断 active users 的指标。完整 journey 见 [首次价值循环](/guide/first-value-loop)。

### 真实宿主评测

一条完整的 Host Eval 使用精确候选 tarball，在真实宿主中执行场景，并采集脱敏 JSONL、工具行为、文件差异和 verifier 结果。场景断言同时检查期望行为与禁止行为，不靠最终文本关键词判定成功。仓库提供场景、记录 schema 和门禁脚本，但不负责启动、登录或认证第三方宿主；真实执行需要维护者准备环境。

这条链成本更高，也更容易受到认证、网络、宿主版本、超时和评测基础设施故障影响。因此环境准备、候选绑定、失败归因和证据保留本身也是评测设计的一部分，而不只是「跑完收工」。

**结果的四类固定分类。** Host Eval v6 记录把结果固定为四类：`passed` 表示行为与断言通过；`behavior-failed` 表示真实产品行为未满足场景；transport、TLS、WebSocket、runner 超时或 circuit breaker 终止只能记为 `infra-inconclusive`；evaluator 本身无法完成判定时记为 `evaluator-failed`。后三类都不能满足发布覆盖，尤其不能把 `infra-inconclusive` 降格解释成产品行为失败或通过——基础设施坏了，说明不了产品对错。

**预算与重试。** 执行证据同时记录 tier、attempt、elapsed time 和 termination。单场景预算上限为 15 分钟，整套矩阵预算上限为 60 分钟；transport failure 最多自动重试一次，即总尝试次数不超过两次。`eval:validate` 会拒绝超预算、重试次数超限以及 termination 与结果分类冲突的记录。当前实现还提供依赖范围内的增量选择、宿主中立 runner，以及当前 required Host Codex 的显式进程 transport；CI 认证与其它第三方 Host transport 仍由后续集成实现。

**增量选择与依赖绑定。** 每个场景声明可影响其行为的 `dependencyPaths`，fingerprint 将这些文件绑定为独立的 `dependencySha256`；全局 `rulesSha256` 继续用于审计，但不再让一个无关规则变更淘汰全部场景记录。`eval:plan` 把变更分为 L1、L2、L3：L1 仅需确定性验证；L2 最多选择三个被依赖映射覆盖的 Host 场景；L3 对未知行为源或过宽选择执行完整矩阵。出现 `unmapped-behavior-source` 时必须 fail closed 到 L3，不能静默继承旧证据。

**调度与 transport 的细节。** 调度层提供宿主中立的 runner contract：独立场景默认 2 路、最多 3 路有界并行；单次 transport failure 最多重试一次，连续两次后打开 circuit-breaker，并把尚未启动的场景明确记为 `infra-blocked`。runner 为每次执行传入带硬 deadline 的 `AbortSignal`，同时限制单场景与整套矩阵预算。`behavior-failed` 和 `evaluator-failed` 不会触发 transport 熔断，也不会与 `infra-inconclusive` 混淆。Codex transport 使用无 shell 的 argv、stdin prompt、ephemeral JSONL session、`workspace-write` sandbox 和 automatic approval review；只接受绝对 disposable workspace，并分别限制 stdout/stderr 为 1 MiB。runner 取消会终止进程树；启动、连接、TLS 与 WebSocket 故障归为 transport failure，输出超限、未知非零退出或 evaluator 崩溃归为 evaluator failure。退出码为 0 仍必须交给独立 evaluator，不能自动升级成行为通过。该能力不会自动登录、启动或持久化第三方 Host 证据，真实 RC 演练仍需维护者显式执行与复核。

#### 候选—基线 Host A/B 比较

`pnpm run eval:compare -- --baseline-runs-dir <dir> --baseline-artifact <tgz> --candidate-runs-dir <dir> --candidate-artifact <tgz>` 会先复用现有 schema、artifact 与 secret 检查，再按 Adapter、Host 产品与版本、模型与模型版本、场景 ID 和场景 fingerprint 一一配对。两侧 tarball SHA-256 必须分别匹配记录；dependency、rules 与 artifact fingerprint 作为被测实现分别保留，允许不同，不能被误当成环境漂移。

每个单元固定分类为 `improved`、`unchanged-passed`、`regressed`、`unchanged-failed` 或 `inconclusive`。任一侧出现 transport/evaluator 不可判定时只能得到 `inconclusive`；总体通过要求所有候选单元都通过且没有回归。报告给出断言、禁止行为、工具动作数和耗时 delta；当前记录没有稳定 token 字段，因此明确写 `not-measured`。该比较减少人工对照错误，但不启动 Host、不生成证据，也不替代 release gate 或人工语义复核。

**发布证据的分级。** 发布证据按矩阵单元区分 `exact`、`inherited`、`infra-blocked`：`exact` 绑定当前候选 artifact；`inherited` 额外绑定来源版本与 artifact digest；`infra-blocked` 不计入 passing coverage。release state 和 release attestation 会保留这三类清单，并校验它们与聚合计数、`inheritedFrom` 和完整 release matrix 一致。正常发布不得含 `infra-blocked`；风险例外只能记录已包含在精确 `uncoveredScenarios` 中的 blocked 单元，不能把基础设施阻塞转换成通过证据。旧 schema 仍可读取，新准备的发布会写入显式证据 schema。

## 从任务到结论的五个阶段

1. **定义任务与验收**：场景说明要观察什么，什么行为明确禁止。
2. **检查就绪状态**：确认候选包、宿主、认证和依赖可用，避免把环境失败误判为产品失败。
3. **受控执行与采集**：运行真实 Host，保存限界、脱敏且可追溯的轨迹和文件证据。
4. **多层判断与归因**：结合机械 verifier、场景断言和人工复核，区分模型、Harness、环境与 evaluator 问题。
5. **回归与发布反馈**：把结果绑定到精确候选和 release policy；实现或规则变化后重新评测。

## `eval:validate`、`eval:gate` 能证明什么

它们会核对记录 schema、候选包版本与 SHA-256、behavior fingerprint、freshness、场景覆盖、artifact digest、断言和 verdict 的内部一致性。release gate 还会检查当前 policy 要求的宿主和场景是否齐全。

同样要写清楚它们不能证明什么：记录一定来自真实 Host、脱敏前证据完整、维护者结论正确或第三方服务没有异常。仓库写入者可以伪造一份结构正确的本地记录；更强信任需要外部 CI、签名 attestation 和人工证据复核。门禁挡的是无心之失，不是蓄意伪造。

## 发布后的 Registry Clean-room

发布前的 tarball 与 Host Eval 不能证明 npm registry 最终向用户提供了相同字节。发布与全球传播之间存在一段不受发布者控制的窗口。tag publish workflow 因此在 `npm publish` 成功后运行 `release:verify-registry`：等待精确版本可见，核对官方 registry metadata、SHA-1、SHA-512 integrity、SHA-256 和 provenance，再对实际下载的 tarball 执行隔离安装，HOME 与 npm cache 均位于受管临时目录。smoke 依次覆盖外层 CLI version、capabilities、无写 dry-run、最小 install，以及内嵌 Harness 的 doctor 和 health。

验证输出把传播延迟、metadata 不匹配、integrity 不匹配和运行失败分成稳定错误码，并写入 `registry-verification.json` 供对应 GitHub Actions run 上传。已经成功发布但 clean-room 失败时，只保留诊断证据并停止创建 GitHub Release，不尝试覆盖或删除 npm 中不可变的已发布版本。registry 里的字节改不了，能做的只有不盖章。

## 为什么不只检查最终文本

最终文本可能说「测试通过」，但文件没有修改；也可能没有出现预期关键词，却已经完成了正确工具调用。Harnessmith 的场景可以组合结构化工具记录、文件系统差异、独立 verifier、逐项行为断言和禁止行为断言。文本匹配可以是某个局部 predicate，但不应独自决定总体 verdict。

## 评测失败时如何解释

首先区分产品行为失败与评测基础设施失败。无法访问宿主、认证过期或 runner 超时只能得到 `infra-inconclusive`，不能直接证明 Harnessmith 不支持该宿主；evaluator 自身故障必须记为 `evaluator-failed`，不能伪装成 `behavior-failed`。同样，本地 `eval:validate` 通过也不能升级成「真实 Host 已验证」。

具体命令见项目 `package.json` 中的 `eval:check`、`eval:validate`、`eval:gate`、`release:check` 和 `release:verify-registry`；当前公开能力与证据路径以[能力声明—证据矩阵](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml)为准。
