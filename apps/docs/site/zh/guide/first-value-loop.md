---
title: 首次价值循环
description: 从理解定位到真实宿主验证的首次价值路径与证据边界
owner: maintainers
audience: users
status: active
updated: 2026-09-05
---

# 首次价值循环

安装命令成功，只能说明本地文件写入完成。Harnessmith 把“真正用上”定义为一个更完整的闭环：真实宿主加载受管理规则，完成首次只读受控任务，留下可复核证据，并且使用者已经确认检查与恢复路径。四件事都完成，才进入 `host-verified`。

这条路径的起点是 `positioning`：理解 Harnessmith 是跨宿主分发 Personal Harness 的 initializer，它不拥有模型循环、权限或宿主执行。终点是 `host-verified`。在抵达终点之前，还必须完成 `recovery-aware` 检查点。知道坏了怎么修，才有资格谈「在工作」。

## 四个不可混用的状态

| 状态 | 含义 | Owner | 本地能否独立证明 |
| --- | --- | --- | --- |
| `installed` | 安装记录存在，所有受管输出与 checksum 一致 | outer installer | 能 |
| `healthy` | 内嵌 Runtime 的确定性 health 通过 | embedded Runtime | 能 |
| `host-configured` | 真实宿主已按自身契约加载规则、认证和权限 | Host | 不能 |
| `host-verified` | 真实宿主完成首次受控任务并留下 verifier 证据 | Host 与用户 | 不能 |

前两项是本地可证明的事实，后两项不是。`setup` 成功最多把前两项标为 `passed`；`status` 只检查 installation，所以即使结果是 `managed`，`healthy` 也标为 `not-checked`。没有真实宿主证据时，后两项固定为 `inconclusive`。本地测试、npm downloads 或 GitHub traffic 都不能替代或推断它们。把这四个状态分开，是为了让「装好了」和「真的在工作」这两句话各自有明确含义。

## Journey：九步走到闭环

九步按顺序排列，每一步都有明确的完成条件，不靠感觉判断「应该差不多了」。前六步都在本地，第七步开始进入真实宿主。

1. **`positioning`**：阅读定位与边界，确认需求匹配。如果你只偶尔用一个 Agent、几行项目说明就够用，在这里就应该停下来——继续走下去是在给自己加不必要的负担。

2. **`host-selected`**：显式选择内置 Adapter 与正确 scope。Codex、Claude Code、OpenCode、Kimi Code CLI、Zed Agent 用全局范围；Cursor 用项目范围。选错范围是最常见的安装前错误。

3. **`previewed`**：运行 `setup --dry-run`，审阅目标、冲突、不变项和恢复命令。这一步的关键是「看懂输出」，确认目标路径符合预期，`unmanaged` 或 `modified` 文件不会在你不知情的情况下被覆盖。

4. **`installed`**：确认安装，核对受管 checksum。安装记录存在，所有受管输出与 checksum 一致——这是第一个可以被机械证明的里程碑。

5. **`healthy`**：运行确定性 Runtime health。内嵌 Runtime 的版本检查、路由功能和 Memory 可用性全部通过。这一步通过后，工具就位，但还没有在真实宿主中工作过。

6. **`controlled-task-ready`**：取得 setup 输出中的首次只读任务和 verifier 要求。比如「只读分析当前仓库的发布流程，说明事实来源和未验证范围，不要修改文件」。任务本身只读，但能验证规则加载、上下文获取和证据保留是否正常工作。

7. **`host-configured`**：在真实宿主中确认规则加载、认证与只读权限。这一步开始跨出本地：确认 Agent 真的能读到你的规则，且权限系统按预期工作。

8. **`recovery-aware`**：查看 `status --explain` 与 `restore --dry-run`。知道坏了怎么修，才有资格谈「在工作」。如果安装出了问题，你能恢复吗？这一步确保你知道答案。

9. **`host-verified`**：执行首次受控任务，保留工具、文件系统与 verifier 证据。Agent 完成了任务，且你保留了可复核的证据：它用了哪些工具、读了哪些文件、输出了什么结果、verifier 说了什么。至此，First Value 闭环完成。

在 `installed` 之后，统一的下一步是：

```bash
npx harnessmith diagnostics --agent <agent> --json
```

确定性 health 通过后，再进入真实宿主。不要把 `installed-and-healthy` 当作终点，它只说明工具就位，还没有任何证据说明它在为你工作。

## 无遥测体验回归

```bash
pnpm run eval:first-value
```

维护者侧的回归验证用的是这条命令：在 disposable 本地目录中执行 preview、install、health、status explain 与 restore preview，输出符合 `evals/first-value-record.schema.json` 的 v1 acceptance record。基础回归通过时结果是 `local-baseline-passed`，但 `hostConfigured` 与 `hostVerified` 仍为 `inconclusive`，`firstValueAchieved` 仍为 `false`。回归本身不冒充真实使用。

命令不上传 telemetry，也不读取远端活跃度数据。未来如果引入任何 telemetry，必须另行设计 opt-in、用途限制、隐私审查、保留期限和关闭机制；这些约束写在这里，是为了让它不容易被悄悄稀释。
