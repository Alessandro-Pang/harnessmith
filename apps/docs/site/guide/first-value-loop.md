---
title: First Value Loop
description: 从理解定位到真实宿主验证的首次价值路径与证据边界
owner: maintainers
---

# First Value Loop

Harnessmith 的 First Value 不是安装量、下载量或绿色测试，而是：用户选择的真实 Host 已加载受管理规则，完成文档中的
首次只读受控任务，保留可复核证据，并且用户已经看到检查与恢复路径。

起点是 `positioning`：理解 Harnessmith 是跨 Host 分发 Personal Harness 的 initializer，不拥有模型循环、权限或 Host
执行。终点是 `host-verified`。在到达终点前，还必须完成 `recovery-aware` 检查点。

## 四个不可混用的状态

| 状态 | 含义 | Owner | 本地能否独立证明 |
| --- | --- | --- | --- |
| `installed` | 安装记录存在，所有受管输出与 checksum 一致 | outer installer | 能 |
| `healthy` | 内嵌 Runtime 的确定性 health 通过 | embedded Runtime | 能 |
| `host-configured` | 真实 Host 已按自身契约加载规则、认证和权限 | Host | 不能 |
| `host-verified` | 真实 Host 完成首次受控任务并留下 verifier 证据 | Host 与用户 | 不能 |

`setup` 成功最多把前两项标为 `passed`；`status` 只检查 installation，因此即使是 `managed`，也把 `healthy` 标为
`not-checked`。没有真实 Host 证据时，后两项固定为 `inconclusive`，不能由本地测试、npm downloads 或 GitHub traffic
推断。

## Journey 与下一步

1. `positioning`：阅读定位与边界，确认需求匹配。
2. `host-selected`：显式选择内置 Adapter 与正确 scope。
3. `previewed`：运行 `setup --dry-run`，审阅目标、冲突、不变项和恢复命令。
4. `installed`：确认安装，核对受管 checksum。
5. `healthy`：运行确定性 Runtime health。
6. `controlled-task-ready`：取得 setup 输出中的首次只读任务和 verifier 要求。
7. `host-configured`：在真实 Host 中确认规则加载、认证与只读权限。
8. `recovery-aware`：查看 `status --explain` 与 `restore --dry-run`。
9. `host-verified`：执行首次受控任务，保留工具、文件系统与 verifier 证据。

在 `installed` 后，统一下一步是：

```bash
npx harnessmith diagnostics --agent <agent> --json
```

确定性 health 通过后，再进入真实 Host，而不是把 `installed-and-healthy` 当作终点。

## 无遥测体验回归

```bash
pnpm run eval:first-value
```

该命令在 disposable 本地目录中执行 preview、install、health、status explain 与 restore preview，输出符合
`evals/first-value-record.schema.json` 的 v1 acceptance record。基础回归通过时结果是 `local-baseline-passed`，但
`hostConfigured` 与 `hostVerified` 仍为 `inconclusive`，`firstValueAchieved` 仍为 `false`。

命令不上传 telemetry，也不读取远端活跃度数据。未来任何 telemetry 都必须另行设计 opt-in、用途限制、隐私审查、
保留期限和关闭机制。
