---
title: Prompt Rule Contract
type: harness-standard
status: active
updated: 2026-09-04
owner: prompt-rule-contract
---

# Prompt Rule Contract

重要 Prompt 规则同时影响授权、写入、完成判定或跨 Host 声明时，不能只依赖 `必须`、`不得` 等措辞强度。
机器可读登记位于 `prompt-rules.yaml`；本标准解释字段和使用边界。

## 一条规则需要回答什么

| 字段 | 含义 |
| --- | --- |
| `principle` | 必须保持的边界 |
| `rationale` | 防止的具体失败，而不是重复原则 |
| `action` | Agent 或 CLI 应执行的动作 |
| `fallback` | 条件不足时的安全降级 |
| `guarantee` | `enforced`、`guided` 或 `host-dependent` |
| `enforcedBy` | 违规由 `runtime`、`verifier`、`agent` 或 `host` 哪一方负责阻止/判定 |
| `owner` | `manifest.yaml` 中唯一负责完整协议的 route ID |

入口 Prompt 可以保留高损失摘要和 owner 指针，不复制 owner 文档的字段、状态机或命令细节。新增规则前先检查
现有 ID、owner 和 `confusingWith`，避免用同义规则覆盖同一个失败模式。`enforcedBy` 必须和 guarantee 的实际
证据一致：自然语言 guidance 由 `agent` 承担，机械门禁由 `runtime`/`verifier` 承担，宿主事件和权限由 `host` 承担。

## 分层与加载

规则按下面的层级放置；每条内容只保留在一个 normative owner 中：

| 层 | 放什么 | 加载时机 |
| --- | --- | --- |
| Entry | 每次任务都适用的信任、授权、启动和停止边界 | 宿主入口常驻 |
| Index | 路由表、owner、加载顺序和预算 | 启动发现 |
| Playbook | 当前动作的目标、步骤、失败回退和交付 | 选定唯一动作后 |
| Core topic/standard | 跨任务稳定的领域边界和项目差异 | 命中概念后 |
| Reference | 字段、命令、schema、低频例外和长样例 | 明确需要精确细节时 |

普通任务只加载 Entry、Index、一个 Playbook 和命中的 supporting topics；`reference` 通常只作为候选返回，不能因为
它出现在路由结果中就自动读入。`reasoningModes` 是唯一的认知模式例外：它表示路由器已经根据任务结构完成选择，
Agent 应读取返回模式对应的章节。若一条规则同时描述多个层级，拆出 owner 指针；若规则能由 schema、CLI、hook、
测试或 CI 判定，优先把判定移出 Prompt。

推荐的最小表达是：`标准术语 + 一句项目差异 + 一个正/反例 + 例外 + 可执行验收`。术语可以激活通用知识，
但不能替代项目的 type 枚举、路径、权限、状态转换、失败回退或 verifier；这些项目差异必须显式写出。

对于需要持续执行的 Agent 规则，最小表达应升级为：`状态 + 当前产物 + 下一步 + 预期证据 + 停止条件`。
只写“认真检查”或“采用某种思维方式”不能形成可观察的行为约束。

入口 Prompt 采用 50 行硬预算，只容纳每次任务都必须看到且遗漏代价高的边界。字段级输出、状态转换、重试和
Host 事件响应由 owner 文档完整定义；契约测试同时验证入口预算、必要摘要和详细协议的唯一 owner。

## 保证等级

- `enforced`：代码、schema、validator、锁或事务可机械拒绝违规；必须同时提供实现与 executable verification。
- `guided`：自然语言指导 Agent 行为，不能声称宿主或 CLI 已机械保证；必须指向公开边界。
- `host-dependent`：结果依赖宿主事件、hook、sandbox、权限或真实运行；必须指向边界，未验证时使用
  `inconclusive`，不能降格成 `guided` 后宣称已实现。

绝对安全边界仍可使用明确的“必须/不得”，但 guarantee 只由证据决定，不由语气决定。

## Confusing pairs

`confusingWith` 必须双向登记。它用于固定容易被合并的两个判断维度，例如：

- 用户任务对象只读，不等于托管 sidecar 必然禁止写入；
- Task acceptance gate 决定能否 `complete`，completion curation 只判断 Memory 候选；
- CLI 能机械生成 route 结果，不等于 Host 必然调用或遵循 route。

新增 pair 时分别写清两条规则的 action 与 fallback；不要用一条含多个例外的长规则替代。

## Validator 边界

文档预检验证必填字段、唯一 ID、owner route、保证等级、执行主体、证据路径和 confusing-pair 引用。它不会解析任意自然语言来
推断规则是否正确，也不是 Policy Engine。Prompt QA 与真实 Host Eval 仍分别验证 guidance 可理解性和宿主行为。
