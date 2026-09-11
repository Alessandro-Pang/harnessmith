---
title: Understand and Map Playbook
type: harness-playbook
status: active
updated: 2026-09-05
owner: understand-and-map
---

# 理解与梳理

触发：理解代码库、架构探索、调用链追踪、模块盘点、项目上手或需要先建立现状模型。

## 执行状态

`frame → map → trace → validate → explain`。只扩展能改变当前解释或决策的范围，不按目录递归阅读全部源码。

1. `frame`：明确要解释的对象、问题、深度、时间范围和不需要覆盖的部分。
2. `map`：先读入口、manifest、配置和测试，列出组件、owner、输入、输出和边界。
3. `trace`：沿真实调用关系扩展，记录控制流、数据流、依赖和延迟；不要把名称相似当成依赖关系。
4. `validate`：分开记录已核对事实、代码推断、待验证假设和未知边界，并为关键关系找到验证入口。
5. 输出组件 owner、数据/控制流、外部边界、关键不变量、验证入口和未决问题。

最小交付记录：`scope`、`components`、`owners`、`flows`、`boundaries`、`verified-relations`、`unknowns`。
6. 需要方案时转入 `research-and-design`；需要修改时转入 `change`；需要验证结论时转入 `verify-and-accept`。

默认只读。理解结果不能授权修改代码、记忆、配置或远端系统；昂贵发现只有在符合对应 Memory 资格和授权时才提交 proposal。
