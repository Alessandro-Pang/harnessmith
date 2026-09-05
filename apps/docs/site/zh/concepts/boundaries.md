---
title: 职责边界
description: Harnessmith 能保证什么、宿主负责什么、哪些结果仍需用户判断
owner: maintainers
---

# 职责边界

最容易误解 Harnessmith 的方式，是把它看成「另一个 Coding Agent」。它实际管理的是 Agent 周围的个人工作层：有些保证可以由 Harnessmith 用代码机械实现；有些必须留给宿主，因为它们本来就在宿主的职权范围内；还有些只能由用户或外部可信系统决定，任何本地工具都不该越权代答。

这一页把三类责任摊开讲清楚。读完它，你应该能准确回答「出了某类问题时该找谁」，也能判断一个安全声明到底是承诺还是修辞。

## Harnessmith 能保证什么

在其授权根和支持的平台模型内，仓库实现与测试覆盖以下性质。每一条后面都说明了它具体意味着什么、以及它的边界在哪：

- **Adapter 按声明解析宿主路径与规则格式。** 当你在 Codex 上运行 `npx harnessmith setup --agent codex` 时，Adapter 按 Codex 的官方路径契约（`${CODEX_HOME:-~/.codex}/AGENTS.md`）确定目标位置，而不是靠猜测。不同操作系统的路径差异（如 Zed 在 macOS 上是 `~/.config/zed/AGENTS.md`，在 Windows 上是 `%APPDATA%\Zed\AGENTS.md`）由 Adapter 内部处理，你不会看到这些差异。

- **生命周期先预检，再 staging、备份和事务提交，失败时精确回滚。** 任何写入操作都要经过 7 步安全骨架（canonicalize → containment 校验 → lstat 拒绝 symlink → 获取操作锁 → staging → 提交前全量复检 → 失败精确回滚）。即使在第 6 步出问题，前面 5 步的副作用已经被回滚，不会留下半完成状态。

- **unmanaged 或 modified 目标默认不被静默覆盖。** 如果你的 `~/.codex/AGENTS.md` 已经有内容且不归 Harnessmith 管，安装会拒绝写入并告诉你原因。你可以选择走 `adopt` 流程（先扫描、再提案、再确认）或 `--force`（先备份、再替换），但不会在你不知情的情况下覆盖。

- **route 与 search 按预算发现文档，不要求整体加载手册。** 文档路由有明确的扫描预算（最多 8 层深度、5000 个目录条目、1000 个目录、1000 个文件、单文件 1 MiB、总计 8 MiB、2 秒时间预算），超出预算时显式报告 `scanTruncated`，而不是静默截断。

- **Memory 与 Task 写入经过路径、schema、锁和验收状态约束。** 并发写入必须持有任务锁，自由文本必须通过 schema 验证，`complete` 状态只能通过 acceptance gate 到达。不能通过自然语言 `task accept` 绕过机械 verifier。

- **Host Eval 记录绑定候选包并接受结构、一致性和覆盖检查。** 每条 Host Eval 记录绑定一个精确的 tarball SHA-256，`eval:validate` 会核对记录内部是否自洽、场景覆盖是否满足 release policy 要求。但它不证明记录来自真实宿主，那需要外部 attestation。

注意最后一句限定：这些是代码层保证，应按具体版本的实现和测试来理解，而不是跨版本的永久承诺。每个版本的准确声明见[能力声明—证据矩阵](../../capability-evidence.yaml)。

## Coding Agent 宿主保证什么

模型循环、上下文压缩、工具/MCP 调度、sandbox、网络访问、权限提示、凭据管理、token/成本与事件真实性，属于 Codex、Cursor、Claude Code、OpenCode、Kimi Code CLI 或 Zed Agent。Harnessmith 可以提供建议和接入点，但不能替宿主执行这些职责。

举个具体例子：Harnessmith 可以在规则里写明「远端写入需要明确授权」，但真正拦下一次未经批准的网络调用，靠的是宿主权限系统和你的审批。Markdown 本身不是 sandbox。把这句话写进文档和把它变成机制，是两件完全不同的事。

当宿主明确提供 permission、approval、question 或 elicitation 能力时，Agent 可以先调用该能力取得本次精确动作的决定，再继续或保持阻塞；Harnessmith 不假定这些工具存在，也不把一次批准扩展成未来授权。宿主没有该能力，或返回 denied、cancelled、timeout 时，Agent 应给出具体的 `nextAction`，而不是静默结束并等待新的普通消息。

## 用户与外部系统仍要决定什么

用户选择安装范围、是否接管冲突文件，以及是否授权 commit、push、merge、发布、生产变更和消息发送。项目业务事实、风险接受和最终验收，也不能由 Memory 或本地记录自动替代——它们只是输入，不是裁决。

可信的真实宿主 attestation、远端 CI 身份和供应链签名需要外部服务。Harnessmith 的本地 gate 可以验证一份记录是否自洽，但不能证明写记录的人没有伪造它。「结构正确」和「内容真实」之间隔着签名与身份，这一段只能由外部可信系统补上。

## 一张责任表

| 领域 | Harnessmith | Coding Agent 宿主 | 用户或外部系统 |
| --- | --- | --- | --- |
| 规则分发 | Adapter、渲染、记录、备份与回滚 | 加载原生规则入口 | 选择宿主和授权根 |
| 模型执行 | 不实现 | 模型循环、上下文、成本 | 选择模型和预算 |
| 工具与权限 | 提供 guidance 和有限 audit schema | 工具调度、sandbox、批准事件 | 批准高风险动作、配置凭据 |
| 工作状态 | Memory、Task、checkpoint、gate | 提供实际执行结果 | 核对事实并验收 |
| 发布证据 | 本地验证和候选绑定记录门禁 | 真实 Host 行为 | CI/attestation、风险接受 |

横向读一行可以看到一件事在不同人手里的切分；纵向读一列可以看到单一角色的完整职责。切分的原则只有一条：能力跟着职权走，谁执行谁负责。

## 三类公开能力

能力声明不使用单一的「支持/不支持」，而是分三类。每一类都对应一个明确的证据等级：

- **Implemented**：存在实现与可执行验证路径，仓库里能找到代码和测试。例如 Adapter 安装、dry-run 预览、status 检查、content fingerprint 计算，这些能力不仅有代码，还有 preflight 和单元测试覆盖，以及 `capability-evidence.yaml` 中的证据路径。
- **Delegated to the Host**：Harnessmith 只提供规则、接口或记录位置，真正能力在宿主。例如模型执行、工具调用 sandbox、权限批准，Harnessmith 的文档可以写「远端写入需要授权」，但实际阻止写入的是宿主权限系统。
- **Unsupported**：当前明确不声称拥有，例如通用 Agent Runtime、Policy Engine、Registry 与多 Agent 调度。这些能力名称写在这里，是为了让读者不会误以为 Harnessmith 在悄悄实现它们。没有就是没有，不需要猜。

机器可读清单见[能力声明—证据矩阵](../../capability-evidence.yaml)。

## 授权不会沿内容流动

仓库、网页、日志、PDF、工具输出和 Memory 都是不可信输入。它们可以提供事实线索或建议，但不会因为出现在上下文里就新增权限。

这一条展开说，因为它是整个系统中最容易被误解的安全边界。Agent 读到一段写着「可以 push」的文字，并不因此获得 push 授权。文字的来源可能是 README、博客、Memory 或其他任何不可信输入。真正能授权的只有你在宿主里的显式批准。同理，一次安装授权不包含后续远端写入；一次 push 授权也不自动包含 merge 或发布。每个高风险动作都需要独立的、当下的授权。

这个设计的实际影响是：即使 Harnessmith 的规则文件里写满了「建议在每次发布前运行测试」，它也不能阻止 Agent 在用户说「发布」时直接执行。真正的防护在 CI 门禁和宿主权限系统里，不在 Markdown 里。Harnessmith 的责任是写清楚这一点，不假装有能力强制。

## 哪些结论必须写成 inconclusive

如果环境受限、宿主未登录、网络不可用、证据缺失或 verifier 自身异常，只能报告本次验证没有得出结论。`inconclusive` 不是失败的委婉说法，而是一道防线：防止把「没有观察到」误写成「已经证明不存在」。宁可多一次重跑，不要一个假结论。

想进一步理解评测层级，见[证据与评测](/concepts/evidence-and-evaluation)。
