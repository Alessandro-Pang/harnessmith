---
title: 证据与评测
description: 区分仓库验证、真实宿主评测、记录门禁和人工验收
owner: maintainers
---

# 证据与评测

Harnesssmith 不把“命令退出码为 0”“Agent 最终说完成了”和“真实宿主行为已经验证”视为同一件事。评测的核心不是
制造一个绿色状态，而是让每个结论都对应正确层级的证据。

## 两条互补验证链

### 确定性仓库验证

单元测试、类型检查、lint、schema、`preflight`、覆盖率门禁和 `npm pack --dry-run` 在受控仓库环境中运行。
它们适合证明路径算法、状态机、序列化契约、包内容和失败回滚等可重复性质。

这条链不能证明第三方 Coding Agent 真的读取了规则、触发了权限提示，或按场景使用了工具。

### 真实宿主评测

一份完整的 Host Eval 应使用某个精确候选 tarball，在真实宿主中执行场景，并采集脱敏的 JSONL、工具行为、文件差异和
verifier 结果。场景断言同时检查期望行为与禁止行为，避免只靠最终文本中的关键词判定成功。Harnessmith 仓库提供场景、
记录 schema 和门禁脚本，但这些脚本本身不负责启动、登录或认证第三方宿主。

这条链成本更高，也更容易受到认证、网络、宿主版本、超时和评测基础设施故障影响。因此环境准备、候选绑定、失败
归因和证据保留本身也是评测设计的一部分。

Host Eval v6 记录把结果固定为四类：`passed` 表示行为与断言通过；`behavior-failed` 表示真实产品行为未满足场景；
transport、TLS、WebSocket、runner 超时或 circuit breaker 终止只能记为 `infra-inconclusive`；evaluator 本身无法完成判定时记为
`evaluator-failed`。后三类都不能满足发布覆盖，尤其不能把 `infra-inconclusive` 降格解释成产品行为失败或通过。

执行证据同时记录 tier、attempt、elapsed time 和 termination。单场景预算上限为 15 分钟，整套矩阵预算上限为 60 分钟；
transport failure 最多自动重试一次，即总尝试次数不超过两次。`eval:validate` 会拒绝超预算、重试次数超限以及 termination
与结果分类冲突的记录。当前 phase 还提供依赖范围内的增量选择；真实 Host 的有界并行和 circuit-break 调度仍由后续
runner/CI 集成实现。

每个场景声明可影响其行为的 `dependencyPaths`，fingerprint 将这些文件绑定为独立的 `dependencySha256`。全局
`rulesSha256` 继续用于审计，但不再让一个无关规则变更淘汰全部场景记录。`eval:plan` 把变更分为 L1、L2、L3：L1 仅需
确定性验证；L2 最多选择三个被依赖映射覆盖的 Host 场景；L3 对未知行为源或过宽选择执行完整矩阵。出现
`unmapped-behavior-source` 时必须 fail closed 到 L3，不能静默继承旧证据。

## 从任务到结论的五个阶段

1. **定义任务与验收**：场景说明要观察什么，什么行为明确禁止。
2. **检查就绪状态**：确认候选包、宿主、认证和依赖可用，避免把环境失败误判为产品失败。
3. **受控执行与采集**：运行真实 Host，保存限界、脱敏且可追溯的轨迹和文件证据。
4. **多层判断与归因**：结合机械 verifier、场景断言和人工复核，区分模型、Harness、环境与 evaluator 问题。
5. **回归与发布反馈**：把结果绑定到精确候选和 release policy；实现或规则变化后重新评测。

## `eval:validate`、`eval:gate` 能证明什么

它们会核对记录 schema、候选包版本与 SHA-256、behavior fingerprint、freshness、场景覆盖、artifact digest、断言和
verdict 的内部一致性。release gate 还会检查当前 policy 要求的宿主和场景是否齐全。

它们不能证明记录一定来自真实 Host，也不能证明脱敏前证据完整、维护者结论正确或第三方服务没有异常。仓库写入者可以
伪造一份结构正确的本地记录；更强信任需要外部 CI、签名 attestation 和人工证据复核。

## 发布后的 Registry Clean-room

发布前的 tarball 与 Host Eval 不能证明 npm registry 最终向用户提供了相同字节。tag publish workflow 因此在
`npm publish` 成功后运行 `release:verify-registry`：等待精确版本可见，核对官方 registry metadata、SHA-1、SHA-512
integrity、SHA-256 和 provenance，再对实际下载的 tarball 执行隔离安装，HOME 与 npm cache 均位于受管临时目录。smoke 依次覆盖外层 CLI
version、capabilities、无写 dry-run、最小 install，以及内嵌 Harness 的 doctor 和 health。

验证输出把传播延迟、metadata 不匹配、integrity 不匹配和运行失败分成稳定错误码，并写入
`registry-verification.json` 供对应 GitHub Actions run 上传。已经成功发布但 clean-room 失败时只保留诊断证据并停止创建
GitHub Release，不尝试覆盖或删除 npm 中不可变的已发布版本。

## 为什么不只检查最终文本

最终文本可能说“测试通过”，但文件没有修改；也可能没有出现预期关键词，却已经完成了正确工具调用。Harnesssmith 的
场景可以组合结构化工具记录、文件系统差异、独立 verifier、逐项行为断言和禁止行为断言。文本匹配可以是某个局部
predicate，但不应独自决定总体 verdict。

## 评测失败时如何解释

首先区分产品行为失败与评测基础设施失败。无法访问宿主、认证过期或 runner 超时只能得到
`infra-inconclusive`，不能直接证明 Harnessmith 不支持该宿主；evaluator 自身故障必须记为 `evaluator-failed`，不能伪装成
`behavior-failed`。同样，本地 `eval:validate` 通过也不能升级成“真实 Host 已验证”。

具体命令见项目 `package.json` 中的 `eval:check`、`eval:validate`、`eval:gate`、`release:check` 和
`release:verify-registry`；当前公开能力与证据路径
以[能力声明—证据矩阵](../capability-evidence.yaml)为准。
