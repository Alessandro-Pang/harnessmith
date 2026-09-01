---
title: Prompt Rule Contract
type: harness-standard
status: active
updated: 2026-08-31
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
| `owner` | `manifest.yaml` 中唯一负责完整协议的 route ID |

入口 Prompt 可以保留高损失摘要和 owner 指针，不复制 owner 文档的字段、状态机或命令细节。新增规则前先检查
现有 ID、owner 和 `confusingWith`，避免用同义规则覆盖同一个失败模式。

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

文档预检验证必填字段、唯一 ID、owner route、保证等级、证据路径和 confusing-pair 引用。它不会解析任意自然语言来
推断规则是否正确，也不是 Policy Engine。Prompt QA 与真实 Host Eval 仍分别验证 guidance 可理解性和宿主行为。
