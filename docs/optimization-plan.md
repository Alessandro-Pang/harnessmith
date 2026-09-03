---
title: Harnesssmith 优化方案
description: 面向真实 Coding Agent 体验的 Prompt、Memory、功能与评测优化路线
owner: maintainers
status: proposal
updated: 2026-09-03
---

# Harnesssmith 优化方案

## 执行基线校准（2026-09-03）

用户明确要求本方案的后续修改在 `develop` 分支进行。当前核对基线为
`ac53d63`，使用已检出的 develop 工作树；不将旧分支文件整份覆盖到新基线，不执行提交、推送或 rebase。

原方案及 2026-09-02 评审基于旧分支 `1b410b8`。下文“现状”和阶段缺口是该时点的设计输入，
不是 develop 当前缺失能力的证明。阶段开工前必须核对实现、测试与真实运行证据，再确定最小差量。

| 方案项目 | develop 中已发现的实现 | 后续处理 |
| --- | --- | --- |
| Prompt 字段协议归属 | `template/AGENTS.md` 已下沉 handoff 字段协议，测试校验单一 owner | 保留当前版本；旧分支的两处 Prompt/test 改动不重复迁入 |
| 意图路由 | 入口已要求可靠识别动作后使用 `route --intent` | 核对当前路由测试和行为边界，不重复创建同类接口 |
| 有界启动发现 | 已有 bootstrap brief/recommendations | 核对推荐质量与上下文预算 |
| 分析类沉淀 | 已有 typed finding 命令及测试 | 核对资格、来源、写入安全和现有类型，不假定需要新增 writer |
| 候选与策展 | 已有 candidate discovery、curation 与 apply 测试 | 区分现有候选发现与方案所提质量反馈，不新建平行存储 |
| 真实体验与 Host Hook | 尚未在本次基线校准中验证 | 保持待核验；源码或单测不等于真实 Host 通过 |

本节仅记录基线与复用方向，不宣布任一阶段全部验收完成。旧工作树的未提交改动保留，不自动清理。

## 1. 决策结论

Harnesssmith 不需要重新定义为通用 Agent Runtime。当前最合理的方向是继续做“跨 Host 的 Personal Harness 分发与工作状态控制层”，但把产品优化重点从“增加更多治理契约”转向“证明 Agent 真的更容易工作”。

本方案的核心目标是建立一条可测量的闭环：

```text
任务输入 → 最小上下文召回 → 安全执行 → 阶段状态保存 → 结果验证
       ↑                                      ↓
       └──── 记忆质量反馈 ← 经验沉淀 ←───────┘
```

必须保留的原则：

- Prompt 负责策略、边界和路由；CLI、schema、测试和宿主权限负责机械约束。
- Memory 是可追溯、可核对的历史线索，不是事实源。
- 自动沉淀可以自动产生候选，但不能自动修改规则、Prompt、源码或权限。
- 任何“体验提升”结论都必须来自绑定候选包的真实 Host Eval，而不是静态 Prompt 测试。

## 2. 现状判断

### 已经具备的基础

- 外层 Adapter、SafePath、锁、staging、备份、restore、uninstall 和回滚边界成熟。
- `AGENTS.md` 已压缩为高损失规则和渐进式发现入口。
- Task、handoff、acceptance evidence、Memory 生命周期和 secret hygiene 已有较完整的机器契约。
- Host Eval 已具备场景、候选包 digest、预算、证据和 gate 模型。

### 当前主要缺口

1. **真实行为证据不足**：Prompt 是否让 Agent 更可靠，尚未由完整真实宿主矩阵证明。
2. **自动记忆没有事件保证**：没有稳定的 session-end、compaction-before 或权限事件 hook，Autopilot 依赖宿主 Agent 主动执行 CLI。
3. **记忆质量缺少反馈**：目前主要验证“写入是否合法”，没有系统衡量“记忆是否帮助后续任务”。
4. **Prompt 与机械契约仍有重叠**：很多字段级、顺序级、失败重试规则仍由自然语言承载。
5. **个人用户的默认路径偏重**：Repository Map、Audit、Release Evidence 等能力对维护者有价值，但不应成为所有用户的认知负担。
6. **检索以词法匹配为主**：BM25 和有界扫描可靠，但对同义词、跨语言和隐含关系的召回有限。

## 3. 目标、非目标与成功指标

### 目标

- 新项目在首次任务中能够找到正确入口，而不是读取整套手册。
- 跨会话任务能够恢复“已完成、当前依据、未完成、下一步”。
- Agent 不因历史 Memory 直接绕过当前事实核对。
- 自动记忆尽量无感，但失败、误写和低质量召回可被发现。
- 不同 Host 的行为差异能够被真实场景测量，而不是由 Adapter 存在推断。

### 非目标

- 不实现模型循环、MCP 调度器、通用 Policy Engine 或多 Agent 编排。
- 不自动把 Memory 提升为正式规则或修改 Prompt。
- 不把本地 JSON、hash 或 maintainer-attested record 当成不可伪造的证明。
- 不为个人用户引入云端知识库、向量数据库或远程同步作为默认依赖。

### 首要指标

| 指标 | 基线方法 | 目标 |
| --- | --- | --- |
| 首次有效动作时间 | 从用户 Prompt 到首次正确文件/命令动作 | 相比无 Harness 降低 30% |
| 重复解释次数 | 每个跨会话场景中用户重新提供背景的次数 | 降低 50% |
| 错误上下文读取率 | 读取无关规则、Memory 或 archive 的比例 | 低于 10% |
| 阶段恢复成功率 | 压缩/新会话后恢复正确 next action 的比例 | ≥90% |
| 记忆有效率 | 后续任务中被召回且经事实核对后有帮助的记忆比例 | ≥70% |
| 误记忆率 | 导致错误决策或被用户纠正的记忆比例 | <5% |
| 高风险越权率 | 真实场景中未经授权的写入、远端动作或秘密泄露 | 0 |

上述数值是实验目标，不是当前已经达到的事实。

## 4. 总体设计

### 4.1 三层 Prompt

**全局入口层**只保留：

- 信任与授权优先级；
- 只读/写入/远端/破坏性动作边界；
- 事实源与 Memory 的区别；
- 先路由、后读取、回到事实源核对；
- 未验证结果必须明确为 `inconclusive`。

**任务路由层**负责：

- 根据用户原话选择一个 primary playbook；
- 返回必要 supporting topics；
- 给出本轮最小读取集合；
- 将评审、诊断、设计、发布等意图分开。

**机械契约层**下沉到 CLI/schema/test：

- payload 字段、路径、大小和类型；
- handoff reason 和 clear 语义；
- evidence freshness；
- 锁、原子写、secret scan 和回滚；
- 退出码和 JSON 错误结构。

Prompt 不再重复完整命令手册。每条自然语言规则都要回答“模型需要判断什么”；若答案是“格式是否合规”，就应优先进入机械校验。

### 4.2 分层产品模式

提供三种安装/启用档位，但共用同一 Runtime：

| 模式 | 默认能力 | 面向用户 |
| --- | --- | --- |
| Lite | AGENTS、route、search、基础 Memory | 日常单仓开发者 |
| Standard | Task、handoff、acceptance、profile | 跨会话和多项目用户 |
| Maintainer | Host Eval、Repository Map、Audit、release gate | Harness 维护者和团队 |

Lite 不应初始化完整维护者工作流；只有用户进入长任务、跨仓或发布场景时才逐步引入复杂能力。

### 4.3 Memory 质量模型

在现有五类 Memory 之上增加“候选质量”概念，不新增第二套存储协议：

```text
观察到的信号
  → candidate（有来源、低承诺）
  → repeated / explicit confirmation
  → typed input / experience
  → 事实源核对
  → formal docs / rules / tests（需要明确写入授权）
```

候选记忆只允许进入受控的 proposal 区域，不进入 canonical profile、active core 或规则上下文，除非满足既有 typed writer 条件。

每条可复用经验增加质量元数据：

- `first-seen`、`last-used`；
- `recall-count`、`helpful-count`、`corrected-count`；
- `superseded-by`；
- 来源和事实核对状态。

这些字段只用于排序、维护和审计，不能把使用次数当作真实性证明。

### 4.4 自动沉淀触发器

在没有 Host hook 时，采用“显式可调用 + 宿主适配可选 hook”的双轨设计：

- **阶段完成**：验证通过且存在有效 next action 时，建议更新同一 handoff。
- **上下文压缩信号**：宿主提供信号时执行 compaction checkpoint；没有信号时不声称保证。
- **重复任务**：同一 session 中出现第二个独立已验证任务时，使用 `multi-task` reconcile。
- **失败经验**：仅在有明确失败结果和证据时形成 failure candidate。
- **用户纠正**：将被纠正的 profile 或 experience 降级、标记或 supersede。

所有触发器都应是幂等的，并以“同一快照重复执行返回 unchanged”为验收条件。

### 4.5 记忆召回反馈

不保存完整 Prompt、模型输出或 tool arguments。只记录限界元数据：

- 某记忆是否被召回；
- 是否回到事实源核对；
- 后续 verifier 是否通过；
- 用户是否纠正；
- 记忆是否导致额外无关读取。

这可以通过现有 audit record 扩展事件类型完成，但必须保持脱敏、预算和 `source-of-truth: false` 边界。

## 5. 分阶段路线

### Phase 0：基线与可观测性（优先）

内容：

- 固定当前候选包、Prompt fingerprint、scenario fingerprint 和 Host/Model 版本；
- 完成 Codex 所需真实矩阵；
- 建立 Lite/Standard/Maintainer 三类用户旅程；
- 为每个场景记录首次有效动作、重复解释、错误读取、恢复结果和最终 verifier。

验收：

- 候选 tarball 可复现；
- 真实 Host Eval 记录完整、脱敏、可校验；
- `eval:gate` 对缺失、过期、行为失败和基础设施失败分别分类；
- 不把 fixture 或静态测试当作 Host 通过证据。

停止条件：真实 Host 运行未完成前，不进行大规模 Prompt 重写。

### Phase 1：Prompt 收敛与路由改进

内容：

- 从 `template/AGENTS.md` 移除可由 schema/CLI 拒绝的字段级契约；
- 保留高损失边界和路由决策；
- 将用户原话拆为意图维度，而不是只按关键词 priority 选路由；
- 对“评审 + 设计 + 自动记忆 + 长任务”等复合请求支持一个 primary playbook 加多个 topics；
- 对歧义输出 `inconclusive`/clarification，而不是静默选错。

验收：

- Prompt 静态契约测试通过；
- 代表性真实场景的错误路由率下降；
- 输入短、复合、中文/英文混合和高风险请求均有覆盖；
- 文档正文读取量和无关读取率下降。

### Phase 2：Memory candidate 与质量反馈

内容：

- 增加 proposal/candidate 的窄接口或等价 metadata 状态；
- 为 experience 和 profile 增加使用/纠正反馈；
- 增加 analysis/review/research 的 typed capture 映射，仍复用现有 `lesson/failure` 和 source refs；
- 为低质量、长期未命中、被纠正和已替代记忆提供只读维护报告。

验收：

- 候选不会进入 canonical profile 或正式规则；
- 重复捕获保持幂等；
- 纠正能够精确定位并 supersede 原记录；
- `memory check --indexed`、secret scan、锁和回滚继续通过。

### Phase 3：宿主 Hook 与 Autopilot 适配

内容：

- 为支持事件的 Host 增加 adapter-level session/compaction hook；
- 没有 hook 的 Host 保持显式 fallback，不宣称自动保证；
- 将 hook 产生的事件转换为受限 payload-file；
- 对 hook 丢失、重复、超时和异常进程增加 `inconclusive` 分类。

验收：

- 每个 Host 分别记录 hook availability；
- hook 失败不阻塞用户主任务，也不伪造成功 handoff；
- 重复事件不产生重复 Memory；
- 不把宿主私有凭据、完整 transcript 或 tool arguments 写入证据。

### Phase 4：体验优化与规模边界

内容：

- 根据真实数据调整 Lite/Standard 默认路径；
- 优化中文同义召回、字段 boost 和结果解释；
- 对大规模 Memory 建立明确降级策略，不把 10k 结果外推到 50k；
- 以用户旅程而不是模块数量评估功能取舍。

验收：

- 关键指标达到目标或给出 `inconclusive` 解释；
- 搜索预算、内存和超时边界有回归测试；
- Lite 用户无需理解 Task/Evidence/Host Eval 即可完成基础任务。

## 6. 方案比较

| 方案 | 优点 | 缺点 | 决策 |
| --- | --- | --- | --- |
| 保持现状 | 风险小，已有测试稳定 | 无法证明真实体验，自动记忆仍依赖 Prompt | 作为短期基线 |
| 最小增量 | 先做真实 Eval、Prompt 收敛、记忆反馈 | 需要新增少量指标和 Host 工作 | **推荐** |
| 结构性重构 | 可做完整事件总线、语义检索和策略引擎 | 复杂度、权限面和维护成本显著增加 | 暂不采用 |

不建议现在引入向量数据库、云端 Memory、自动 Prompt 演化或第二套 Memory ontology。这些方案会扩大边界，却不能先解决当前最关键的真实行为证据缺口。

## 7. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| Prompt 变短后安全边界丢失 | 只移除机械契约；保留授权、事实源、未验证和交付边界的回归测试 |
| 自动沉淀污染 Profile | candidate/proposal 隔离；高置信和显式证据门禁 |
| Host hook 造成隐藏写入 | payload-file、SafePath、锁、secret scan、事件去重和失败保留 |
| 评测数据伪造 | 精确候选包、外部 attestation、人工复核和 `inconclusive` 分类 |
| 维护成本继续膨胀 | Lite/Standard/Maintainer 分层；每个新增模块必须绑定用户指标 |
| 词法检索误召回 | 记录召回质量，先做可测量改进，再决定是否引入语义检索 |

## 8. 明确不做的事情

- 不用更强硬的 Prompt 代替 Host 权限或 sandbox。
- 不因“用户可能想记住”就自动写入长期 Profile。
- 不把一次成功的测试命令当作语义验收完成。
- 不把缺少真实 Host 证据包装成“已支持所有宿主”。
- 不为了追求自动化而删除 proposal、来源、证据和回滚边界。

## 9. 最终验收门

只有同时满足以下条件，才能宣称本轮优化完成：

1. `pnpm run test:harness`、`pnpm run preflight`、覆盖率和包清单检查通过；
2. Prompt、路由、Memory、Task 和 schema 的定向测试通过；
3. 至少一个 required Host 使用同一候选 tarball 完成新鲜、完整、脱敏的真实矩阵；
4. 体验指标与基线对比有可复核数据；
5. 未覆盖的 Host、hook 或规模边界明确标为 `inconclusive`；
6. 文档、能力矩阵和发布说明没有把 proposal 或 maintainer-attested structure 写成事实保证。

在第 3、4 项完成前，项目可以说“架构和契约已优化”，不能说“Prompt 已证明有效”或“实现了自主学习”。
