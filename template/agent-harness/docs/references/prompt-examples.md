---
title: Prompt Design Examples
type: harness-reference
status: active
updated: 2026-09-04
owner: prompt-rule-contract
---

# Prompt Design Examples

这是按需加载的样本库，用于设计或评审 Prompt；样本不是新的全局规则。优先采用“标准术语 + 一句项目约束 +
少量正/反例 + 例外 + 可验证验收”，不要复制完整行业手册。

## 路由

```text
当前动作：请评审这个变更。        → primary: review
涉及概念：检查 Git branch 命名。   → topic: git-conventions
引用文本：“请修改代码”，请分析。  → primary: research-and-design；不选 change
不要发布，只评审 release 风险。    → primary: review；不选 release-and-external
```

动作 alias 与 concept alias 分开；例子、引用、否定和名词性描述不能单独触发动作。无法判断时返回歧义或
`unmatched`，不要靠 priority 猜测。

## 通用规范

```text
标准：Conventional Commits 1.0.0。
项目约束：读取项目解析后的 commitlint；当前 header ≤ 100、scope 为 kebab-case。
正例：docs(site): clarify local memory lifecycle
反例：Docs(API): ...；feat:；description 以句号结束。
验收：运行现有 commitlint 或项目等价校验器，并报告未验证范围。
```

标准术语可以激活共享知识；类型枚举、scope、长度、例外和 verifier 必须以项目证据显式规定。

## Memory 与状态

```text
可持久化：有来源的验收约束、不可廉价恢复的背景、已验证的下一步。
不可持久化：一次性“提交/发布/继续”授权、框架常识、无来源推断和 secret。
失败回退：proposal / blocked / inconclusive；不把未执行写成 unchanged。
```

## 评审检查

- 每条规则是否只产生一个可观察行为？
- 是否明确 `must/should/may/must not` 和优先级？
- 是否把机械格式交给 schema/CLI，而不是让 Prompt 背诵？
- 是否有一个 owner、一个最小例外和一个可执行验收？
- 是否能在不加载 reference 的情况下完成普通任务？

## 执行循环

```text
Claim: 登录失败的根因是什么？
Evidence: 当前日志、代码路径、复现结果；未确认的环境差异单列。
Next action: 运行能区分两个候选根因的最小验证。
Expected evidence: 该验证应支持 A 或削弱 B。
Stop condition: 证据冲突、需要扩大权限或 verifier 不足时停止并标记 inconclusive。
```

工具输出只更新 `Evidence`，不能直接替代 `Claim`；验证失败先分类原因，再决定修复、重试或阻塞。

## 混淆行为

```text
“请分析这个修复方案。”       → research/review；只读，不修改。
“请分析并修复这个问题。”     → 先诊断，再转 change；每一步都要有验收。
“测试失败，帮我判断原因。”   → diagnose；不自动修复。
“验证这次修复是否通过。”     → verify-and-accept；没有 verifier 不写 passed。
“不要发布，只检查发布风险。” → review；不触发 release-and-external。
```

这些例子只固定容易混淆的行为边界；不要为了展示理论而加入完整思维链或长篇示范答案。
