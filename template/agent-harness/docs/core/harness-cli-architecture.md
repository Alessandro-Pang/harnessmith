---
title: Harness CLI Architecture
type: harness-core
status: active
updated: 2026-08-19
---

# Harness CLI Architecture

CLI 使用 Node.js 24.12+。源码使用 strict TypeScript，开发态使用成熟库承担通用基础设施，并由
tsup 生成自包含 bundle；
安装到 Agent home 后不需要再次运行包管理器。对用户保持单一入口 `bin/harness.mjs`，内部按职责
拆分，避免记忆、搜索、验证和参数解析继续耦合。

## 分层与依赖

```text
bin/harness.mjs
  └── dist/harness.mjs          # tsup 自包含运行产物
        └── src/cli.ts          # Commander 命令契约
        ├── src/commands/*.ts
        │     └── src/lib/*.ts
        └── src/runtime.ts
```

- `bin/`：进程边界，只加载 bundle、处理顶层异常和退出码；不放业务逻辑。
- `dist/`：由 tsup 生成并随 npm 包分发的运行产物；禁止手工编辑。
- `src/cli.ts`：用 Commander 声明公开命令语法、帮助和分发；不直接读写文件。
- `src/commands/`：一个文件负责一组用户用例，组合底层能力并产生用户输出。
- `src/lib/`：无命令语义的可复用能力；优先纯函数或小型同步原语。
- `src/runtime.ts`：集中解析 HOME、可覆盖路径、owner、日期和源码位置；命令不得自行读取相同
  环境变量或硬编码用户路径。
- `templates/`：安装时保留动态 token，实际初始化全局或项目记忆时再渲染。
- `docs/`：Agent 按需读取的规则、playbook、标准和研究；不放可执行源码。
- `schemas/`：任务、配置和结果等机器契约；schema 变更必须升级版本，并先提供显式、可测试、
  可回滚的迁移命令。当前 schema 都为 1，没有待迁移内容，也没有 `migrate` 命令。
- `state/`：安装态可选运行数据，升级时保留且不参与受管理 runtime checksum；不得存 secret，
  也不作为规则或项目事实源。
- `{{HARNESS_PERSONAL_HOME}}/`：用户所有的个人 overlay，位于受管理安装目录之外。CLI 只幂等创建
  缺失模板，升级、恢复和卸载均不得覆盖或删除。

通用能力优先使用经过维护的实现：Commander 负责 argv/帮助，`yaml` 负责 manifest 与
frontmatter，Ajv 负责 JSON Schema，`write-file-atomic` 负责原子写。路径越界校验、记忆协议、
任务完成门禁和安装事务属于 Harness 领域逻辑，保留在本项目中。新增依赖必须能被 bundle，且
不得要求用户在 Agent home 再安装依赖。

依赖只能从上向下。`lib` 不导入 `commands`，命令之间原则上不互相依赖；`task` 允许调用
`initProject`，因为创建任务账本前必须保证项目记忆协议存在。

## 扩展命令

1. 先判断能力属于通用原语还是用户用例，分别放入 `lib` 或 `commands`。
2. 命令函数首参接收 `runtime`，输出通过可注入的 `io`，避免测试依赖真实 HOME 和 console。
3. 在 `src/cli.ts` 增加 Commander 参数契约和分发，并同步根 README 与相关专题文档。
4. 成功返回 `0`；可预期的“无搜索结果”返回 `1`；非法输入或状态抛出带精确上下文的 Error。
5. 涉及文件写入必须幂等、保护已有内容并使用原子写。
6. 为领域规则增加单元测试，为用户命令增加临时 HOME 端到端测试。

`doctor` 检查运行环境、已安装 CLI、共享记忆与个人 overlay 的可用性，`validate` 检查内容、路由、
结构和项目接入。宿主安装、规则文件
映射、staging、备份和回滚属于外层 adapter，不进入通用 Harness 命令层。

`version --json` 是兼容性查询入口，返回 `harnessVersion`、`schemaVersion`、
`memorySchemaVersion` 和 Node 契约。`validate` 必须拒绝未知 schema，不能把未知版本当作兼容。

Memory maintenance 遵循非权威边界：`supersede` 只建立可校验的替代链接，`archive` 默认只移动
complete 或 superseded 文档并拒绝仍被 active index 引用的记忆，`promote` 只输出 proposal。
Runtime 不得通过 promote 自动写项目 `docs/` 或 ADR。

## 调试路径

- 参数或帮助异常：从 `src/cli.ts` 开始。
- 自动初始化或 ignore 异常：`src/commands/init.ts`。
- 记忆索引、引用或 metadata 异常：`src/commands/memory.ts` 与 `src/lib/frontmatter.ts`。
- 搜索结果异常：`src/commands/search.ts` 与 `src/lib/search.ts`。
- 路径在不同机器不一致：`src/runtime.ts` 与模板 token。
- 环境诊断异常：`src/commands/doctor.ts`。

测试命令：

```bash
pnpm run preflight
pnpm run test:coverage
node template/agent-harness/bin/harness.mjs doctor
```

端到端测试必须使用临时 `HARNESS_HOME`、`HARNESS_MEMORY_HOME` 和 `HARNESS_PERSONAL_HOME`，
不得修改开发者真实全局目录。
