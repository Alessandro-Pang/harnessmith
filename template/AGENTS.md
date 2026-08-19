# Personal Coding Agent Harness

仅保留高损失、不可推断的默认规则；详细流程见
`{{HARNESS_HOME}}/agent-harness/docs/README.md`。更近的项目规则覆盖本文件，用户当前指令优先。

## 默认协作语言

- 回复与文档默认使用简体中文；代码标识符、协议字段、命令、错误原文和专有名词保留英文。
- 先给结论和证据，再说明过程；不把工具调用流水账当作交付。

## 任务启动

1. 若 `{{HARNESS_MEMORY_HOME}}/README.md` 或 `core.md` 缺失，立即运行
   `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init global`；该操作幂等且不得覆盖已有记忆。
   若 `{{HARNESS_PERSONAL_HOME}}/AGENTS.md` 或 `projects/repository-map.md` 缺失，立即运行
   `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs init personal`；只补齐缺失文件。
2. 读取 `{{HARNESS_PERSONAL_HOME}}/AGENTS.md` 中的个人补充规则；该文件由用户维护，Harnesssmith
   升级、restore 和 uninstall 均不得覆盖或删除。
3. 确认当前目录、Git 根、工作树状态和更近的 `AGENTS.md`；不要假定当前目录就是仓库根。
   面对陌生、多语言或结构不明项目，可运行
   `node {{HARNESS_HOME}}/agent-harness/bin/harness.mjs project inspect . --json` 获取事实快照。
4. 若位于项目且 `.agent-docs/` 缺失，按记忆写入阈值判断是否初始化：明确需要跨会话交接、保存
   重要用户输入/证据、记录未完成工作或昂贵发现时自动初始化；明显是一次性任务时不初始化；
   无法确定时询问用户。命令见 `agent-harness/docs/standards/project-agent-docs.md`。
5. 先读与任务直接相关的源码、配置、测试和仓库脚本。README、manifest、lockfile 与可运行代码
   是当前实现事实；设计文档和计划不自动代表已经实现。
6. 不递归读取整棵 `docs/`、`.agent-docs/`、历史会话或全部规则。先读索引或名称清单，再加载
   必要正文。全局规则路由见 `{{HARNESS_HOME}}/agent-harness/docs/README.md`。
7. 任务涉及多个仓库或仓库集合时，先读取
   `{{HARNESS_PERSONAL_HOME}}/projects/repository-map.md`，再按其中来源确认所有者、契约和发布关系。
8. 任务边界足够清楚时直接推进；只有会显著改变结果、权限或影响范围的缺失信息才阻塞询问。

## 工作循环

- 发现所有者、调用链、现有实现与边界；多文件、高风险或跨仓任务写短计划。
- 预计跨上下文或多阶段推进的任务使用 `harness task init/checkpoint/status/close` 保存目标、验收条件
  和下一步；简单任务不创建任务账本。细则见 `agent-harness/docs/core/long-running-tasks.md`。
- 最小且完整地实施，保护用户改动；先做最窄验证，再按风险扩大。
- 交付说明变更、证据、未验证项和风险；长期事实同步到正式文档。
- 修改、诊断、评审、调研设计和发布迁移细则按任务从 `agent-harness/docs/README.md` 路由。

## 事实与文档

- 冲突时按“当前用户确认的意图与安全要求 → 可运行代码/测试/契约 → 已接受决策 → 目标方案
  → 临时工作记录”判断，并明确时间与版本差异。
- 项目 `docs/` 是长期事实，`agent-harness/docs/` 是个人运行规则，`.agent-docs/` 只保存非权威项目
  记忆：用户输入、会话交接、工作状态、证据和提炼记忆。
- 读取记忆时先看名称/元信息和 `.agent-docs/core.md`，再按引用读取正文；不自动注入整个记忆库。
- 首次需要项目记忆时按 `agent-harness/docs/standards/project-agent-docs.md` 初始化，并同步让
  `.gitignore` 与 `.ignore` 忽略整个 `.agent-docs/`。
- 跨项目个人记忆位于 `{{HARNESS_MEMORY_HOME}}/`；宿主提供的原生 memory 是补充召回层，不替代这里
  的可审阅交接，也不得成为规则或项目事实的唯一来源。

## 工具与能力路由

- 优先使用项目一手事实与现有脚本，再使用官方/版本匹配文档、专用验证工具和通用搜索；完整
  路由见 `agent-harness/docs/core/tool-routing.md`。
- 查询库、框架、SDK、CLI 或云服务的当前用法时，使用 Context7 或官方文档；代码中的实际锁定
  版本优先于泛化知识。
- Web 运行验收使用浏览器/DevTools；Figma 实现先读取设计上下文与 token。纯后端、算法或文档
  任务不启动浏览器。
- 私有数据使用已授权连接器；工具不可用时明确降级。搜索优先 `rg`，Python 使用 `python3`，
  包管理器以项目 lockfile 和 `packageManager` 为准。

## 安全与变更边界

- 未经明确授权，不执行 commit、push、merge、rebase、发布、生产迁移、远端写入、消息发送、
  全局安装或不可恢复删除。
- 先只读确认精确目标，再执行写操作。禁止泄露或写入 secret、token、cookie、验证码和个人凭据。
- 不覆盖用户现有改动，不用 destructive Git 命令清场，不通过降级测试或删除断言让检查通过。
- 网络、权限、沙箱或平台受限导致的阴性结果标为 `inconclusive`，不能直接推断资源不存在。
- 细则见 `agent-harness/docs/core/safety-and-verification.md`。

## Git 契约

- 新建分支必须匹配 `(feature|hotfix|refactor)/YYYYMMDD_<feature-name>`；`feature-name`
  使用小写 kebab-case。不得未经授权重命名已有分支。
- 提交信息遵循 Conventional Commits / commitlint 风格；提交前优先读取并服从仓库已有配置，
  否则使用 `type(scope)!: description` 默认格式。不得用 `--no-verify` 绕过校验。
- 本规则不要求所有仓库安装 Node 或 commitlint。分支、提交、校验器选择与跨语言落地细则见
  `agent-harness/docs/core/git-conventions.md`。

## 项目规则设计

- 项目 `AGENTS.md` 只保留无法从代码推断的高损失约束和按需路由；可机械执行的约束应进入
  formatter、lint、schema、测试、hook 或 CI。演进规则见 `agent-harness/docs/standards/project-agents.md`。
